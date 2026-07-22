import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  ensureQuotationDocumentsReady,
  getQuotationBucket,
  parseStoredStringList,
  QUOTATION_MAX_PAGES,
  QUOTATION_MAX_PDF_BYTES,
  quotationDocumentJson,
  quotationStorageStats,
  type QuotationDocumentRow,
} from "../../../lib/quotation-documents";
import {
  createTrashBatch,
  ensureTrashReady,
} from "../../../lib/trash-store";

export const dynamic = "force-dynamic";

function clean(value: FormDataEntryValue | null, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validDocumentId(value: string | null) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

async function findDocument(id: number) {
  const d1 = await ensureQuotationDocumentsReady();
  const row = await d1
    .prepare("SELECT * FROM quotation_documents WHERE id = ? LIMIT 1")
    .bind(id)
    .first<QuotationDocumentRow>();
  return { d1, row };
}

async function serveStoredFile(request: Request, id: number) {
  await requireApprovedMember();
  const { row } = await findDocument(id);
  if (!row) {
    return Response.json({ error: "견적서를 찾지 못했습니다." }, { status: 404 });
  }
  const searchParams = new URL(request.url).searchParams;
  const kind = searchParams.get("file");
  const pageNumber = Number(searchParams.get("page"));
  const pageKeys = parseStoredStringList(row.page_keys_json);
  const key =
    kind === "page" && Number.isSafeInteger(pageNumber) && pageNumber > 0
      ? pageKeys[pageNumber - 1]
      : kind === "original"
        ? row.original_key
        : "";
  if (!key) {
    return Response.json({ error: "파일 위치가 올바르지 않습니다." }, { status: 400 });
  }
  const stored = await getQuotationBucket().get(key);
  if (!stored) {
    return Response.json({ error: "저장된 파일을 찾지 못했습니다." }, { status: 404 });
  }
  const contentType =
    kind === "page"
      ? stored.httpMetadata?.contentType || "image/webp"
      : "application/pdf";
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Length": String(stored.size),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (kind === "original") {
    const disposition = searchParams.get("download") === "1" ? "attachment" : "inline";
    headers.set(
      "Content-Disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
    );
  }
  return new Response(stored.body, { headers });
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const id = validDocumentId(searchParams.get("id"));
    if (id && searchParams.get("file")) {
      return await serveStoredFile(request, id);
    }
    await requireApprovedMember();
    const organization = (searchParams.get("organization") || "").trim().slice(0, 120);
    if (!organization) {
      return Response.json({ error: "기관명이 필요합니다." }, { status: 400 });
    }
    const d1 = await ensureQuotationDocumentsReady();
    const result = await d1
      .prepare(
        `SELECT *
         FROM quotation_documents
         WHERE organization = ?
         ORDER BY quote_date DESC, created_at DESC, id DESC`,
      )
      .bind(organization)
      .all<QuotationDocumentRow>();
    return Response.json({
      documents: result.results.map(quotationDocumentJson),
      storage: await quotationStorageStats(d1),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const uploadedKeys: string[] = [];
  try {
    const member = await requireApprovedMember();
    const formData = await request.formData();
    const organization = clean(formData.get("organization"), 120);
    const companyName = clean(formData.get("companyName"), 120);
    const quoteAmount = clean(formData.get("quoteAmount"), 120);
    const quoteDate = clean(formData.get("quoteDate"), 10);
    const pdf = formData.get("pdf");
    const pages = formData
      .getAll("pages")
      .filter((entry): entry is File => entry instanceof File);

    if (!organization || !companyName) {
      return Response.json(
        { error: "기관명과 견적 업체명을 입력해 주세요." },
        { status: 400 },
      );
    }
    if (!(pdf instanceof File) || !pdf.name.toLowerCase().endsWith(".pdf")) {
      return Response.json({ error: "PDF 견적서를 선택해 주세요." }, { status: 400 });
    }
    if (pdf.size < 1 || pdf.size > QUOTATION_MAX_PDF_BYTES) {
      return Response.json(
        { error: "PDF는 20MB 이하 파일만 첨부할 수 있습니다." },
        { status: 400 },
      );
    }
    if (!pages.length || pages.length > QUOTATION_MAX_PAGES) {
      return Response.json(
        { error: `견적서는 1~${QUOTATION_MAX_PAGES}페이지까지 첨부할 수 있습니다.` },
        { status: 400 },
      );
    }
    if (
      pages.some(
        (page) =>
          !page.type.startsWith("image/") || page.size < 1 || page.size > 3 * 1024 * 1024,
      )
    ) {
      return Response.json(
        { error: "변환된 페이지 이미지의 형식 또는 용량이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    const signature = await pdf.slice(0, 5).text();
    if (signature !== "%PDF-") {
      return Response.json({ error: "올바른 PDF 파일이 아닙니다." }, { status: 400 });
    }

    const d1 = await ensureQuotationDocumentsReady();
    const storage = await quotationStorageStats(d1);
    const totalSize = pdf.size + pages.reduce((sum, page) => sum + page.size, 0);
    if (totalSize > storage.remainingBytes) {
      return Response.json(
        { error: "견적서 저장공간이 부족합니다. 기존 파일을 정리해 주세요." },
        { status: 413 },
      );
    }

    const prefix = `quotation-documents/${crypto.randomUUID()}`;
    const originalKey = `${prefix}/original.pdf`;
    const pageKeys = pages.map(
      (_, index) => `${prefix}/page-${String(index + 1).padStart(3, "0")}.webp`,
    );
    const bucket = getQuotationBucket();
    await bucket.put(originalKey, pdf, {
      httpMetadata: {
        contentType: "application/pdf",
        contentDisposition: "inline",
      },
      customMetadata: { organization, originalName: pdf.name.slice(0, 240) },
    });
    uploadedKeys.push(originalKey);
    for (let index = 0; index < pages.length; index += 1) {
      await bucket.put(pageKeys[index], pages[index], {
        httpMetadata: { contentType: pages[index].type || "image/webp" },
        customMetadata: {
          organization,
          page: String(index + 1),
        },
      });
      uploadedKeys.push(pageKeys[index]);
    }

    const row = await d1
      .prepare(
        `INSERT INTO quotation_documents (
          organization, company_name, quote_amount, quote_date,
          original_name, original_key, original_size,
          page_keys_json, page_sizes_json, page_count, total_size,
          created_by, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *`,
      )
      .bind(
        organization,
        companyName,
        quoteAmount,
        quoteDate,
        pdf.name.slice(0, 240),
        originalKey,
        pdf.size,
        JSON.stringify(pageKeys),
        JSON.stringify(pages.map((page) => page.size)),
        pages.length,
        totalSize,
        member.id,
        member.displayName,
      )
      .first<QuotationDocumentRow>();
    if (!row) throw new Error("견적서 정보를 저장하지 못했습니다.");
    return Response.json(
      {
        document: quotationDocumentJson(row),
        storage: await quotationStorageStats(d1),
      },
      { status: 201 },
    );
  } catch (error) {
    if (uploadedKeys.length) {
      try {
        await getQuotationBucket().delete(uploadedKeys);
      } catch {
        // The database row is not created, so a later storage cleanup can remove these keys.
      }
    }
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as { id?: unknown };
    const id = validDocumentId(String(payload.id ?? ""));
    if (!id) {
      return Response.json({ error: "올바른 견적서 ID가 필요합니다." }, { status: 400 });
    }
    const { d1, row } = await findDocument(id);
    if (!row) {
      return Response.json({ error: "견적서를 찾지 못했습니다." }, { status: 404 });
    }
    await ensureTrashReady();
    const trashBatchId = await createTrashBatch(
      d1,
      member,
      "quotation",
      `${row.organization} · ${row.original_name}`,
      1,
      { tables: { quotation_documents: [row] } },
    );
    await d1.prepare("DELETE FROM quotation_documents WHERE id = ?").bind(id).run();
    return Response.json({
      ok: true,
      trashBatchId,
      storage: await quotationStorageStats(d1),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
