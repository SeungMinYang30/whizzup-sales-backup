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
import {
  downloadDriveFile,
  driveFileIdFromKey,
  driveObjectKey,
  isGoogleDriveConfigured,
  moveDriveFile,
  removeDriveFile,
  rollbackDriveMoves,
  safeDriveFolderName,
  uploadDriveFile,
} from "../../../lib/google-drive-storage";

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
  const driveFileId = driveFileIdFromKey(key);
  if (driveFileId) {
    const stored = await downloadDriveFile(driveFileId);
    const contentType =
      stored.headers.get("Content-Type") ||
      (row.original_name.toLowerCase().endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/pdf");
    const disposition =
      searchParams.get("download") === "1" || contentType !== "application/pdf"
        ? "attachment"
        : "inline";
    return new Response(stored.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
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
    const businessRound = Math.max(
      1,
      Math.min(99, Number(searchParams.get("businessRound")) || 1),
    );
    if (!organization) {
      return Response.json({ error: "기관명이 필요합니다." }, { status: 400 });
    }
    const d1 = await ensureQuotationDocumentsReady();
    const result = await d1
      .prepare(
        `SELECT *
         FROM quotation_documents
         WHERE organization = ? AND business_round = ?
         ORDER BY quote_date DESC, created_at DESC, id DESC`,
      )
      .bind(organization, businessRound)
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
  let uploadedDriveFileId = "";
  try {
    const member = await requireApprovedMember();
    const formData = await request.formData();
    const organization = clean(formData.get("organization"), 120);
    const businessRound = Math.max(
      1,
      Math.min(99, Number(clean(formData.get("businessRound"), 2)) || 1),
    );
    const quoteAmount = clean(formData.get("quoteAmount"), 120);
    const pdf = formData.get("pdf");
    const sourceFile = formData.get("sourceFile");
    const pages = formData
      .getAll("pages")
      .filter((entry): entry is File => entry instanceof File);

    if (!organization) {
      return Response.json(
        { error: "기관명이 필요합니다." },
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
    if (
      sourceFile != null &&
      (!(sourceFile instanceof File) ||
        !sourceFile.name.toLowerCase().endsWith(".xlsx") ||
        sourceFile.size < 1 ||
        sourceFile.size > QUOTATION_MAX_PDF_BYTES)
    ) {
      return Response.json(
        { error: "원본 엑셀은 20MB 이하 XLSX 파일만 보관할 수 있습니다." },
        { status: 400 },
      );
    }

    const companyName =
      clean(formData.get("companyName"), 120) ||
      pdf.name.replace(/\.pdf$/i, "").trim().slice(0, 120) ||
      "견적서 PDF";
    const quoteDate =
      clean(formData.get("quoteDate"), 10) ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

    const d1 = await ensureQuotationDocumentsReady();
    const storage = await quotationStorageStats(d1);
    const originalFile =
      isGoogleDriveConfigured() && sourceFile instanceof File ? sourceFile : pdf;
    const totalSize = originalFile.size + pages.reduce((sum, page) => sum + page.size, 0);
    if (!isGoogleDriveConfigured() && totalSize > storage.remainingBytes) {
      return Response.json(
        { error: "견적서 저장공간이 부족합니다. 기존 파일을 정리해 주세요." },
        { status: 413 },
      );
    }

    const prefix = `quotation-documents/${crypto.randomUUID()}`;
    let originalKey = `${prefix}/original.pdf`;
    const pageKeys = pages.map(
      (_, index) => `${prefix}/page-${String(index + 1).padStart(3, "0")}.webp`,
    );
    const bucket = getQuotationBucket();
    if (isGoogleDriveConfigured()) {
      const regionRow = await d1
        .prepare(
          `SELECT region FROM activities
           WHERE organization = ? AND business_round = ? AND TRIM(region) <> ''
           ORDER BY updated_at DESC, id DESC LIMIT 1`,
        )
        .bind(organization, businessRound)
        .first<{ region: string }>();
      const stored = await uploadDriveFile({
        file: originalFile,
        folderSegments: [
          "01_기관자료",
          safeDriveFolderName(regionRow?.region, "지역 미분류"),
          safeDriveFolderName(organization),
          "견적서",
          quoteDate.slice(0, 4),
        ],
        contextType: "institution-quotation",
        contextId: `${organization}|${businessRound}`,
      });
      uploadedDriveFileId = stored.fileId;
      originalKey = driveObjectKey(stored.fileId);
    } else {
      await bucket.put(originalKey, pdf, {
        httpMetadata: {
          contentType: "application/pdf",
          contentDisposition: "inline",
        },
        customMetadata: { organization, originalName: pdf.name.slice(0, 240) },
      });
      uploadedKeys.push(originalKey);
    }
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
          organization, business_round, company_name, quote_amount, quote_date,
          original_name, original_key, original_size,
          page_keys_json, page_sizes_json, page_count, total_size,
          created_by, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *`,
      )
      .bind(
        organization,
        businessRound,
        companyName,
        quoteAmount,
        quoteDate,
        originalFile.name.slice(0, 240),
        originalKey,
        originalFile.size,
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
    if (uploadedDriveFileId) {
      await removeDriveFile(uploadedDriveFileId).catch(() => undefined);
    }
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
  let archivedDriveMove: Awaited<ReturnType<typeof moveDriveFile>> | null = null;
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
    const driveFileId = driveFileIdFromKey(row.original_key);
    if (driveFileId) {
      archivedDriveMove = await moveDriveFile(driveFileId, [
        "99_보관",
        "기관자료",
        safeDriveFolderName(row.organization),
        "견적서",
        String(new Date().getFullYear()),
      ]);
    }
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
    if (archivedDriveMove) {
      await rollbackDriveMoves([archivedDriveMove]).catch(() => undefined);
    }
    return accessErrorResponse(error);
  }
}
