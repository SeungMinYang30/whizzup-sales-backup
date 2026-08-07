import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  ensureProductComparisonDocumentsReady,
  getProductComparisonBucket,
  PRODUCT_COMPARISON_MAX_BYTES,
  productComparisonDocumentJson,
  type ProductComparisonDocumentRow,
} from "../../../lib/product-comparison-documents";

export const dynamic = "force-dynamic";

const allowedExtensions = new Set(["pdf", "xlsx", "xls", "docx"]);

function clean(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function documentId(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function findDocument(id: number) {
  const d1 = await ensureProductComparisonDocumentsReady();
  const row = await d1
    .prepare("SELECT * FROM product_comparison_documents WHERE id = ? LIMIT 1")
    .bind(id)
    .first<ProductComparisonDocumentRow>();
  return { d1, row };
}

async function serveDocument(row: ProductComparisonDocumentRow) {
  const stored = await getProductComparisonBucket().get(row.object_key);
  if (!stored) {
    return Response.json({ error: "첨부 파일을 찾지 못했습니다." }, { status: 404 });
  }
  return new Response(stored.body, {
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      "Content-Length": String(stored.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const search = new URL(request.url).searchParams;
    const id = documentId(search.get("id"));
    if (id) {
      const { row } = await findDocument(id);
      if (!row) {
        return Response.json({ error: "비교표를 찾지 못했습니다." }, { status: 404 });
      }
      return await serveDocument(row);
    }

    const productId = clean(search.get("productId"), 180);
    if (!productId) {
      return Response.json({ error: "제품 ID가 필요합니다." }, { status: 400 });
    }
    const d1 = await ensureProductComparisonDocumentsReady();
    const result = await d1
      .prepare(
        `SELECT * FROM product_comparison_documents
         WHERE product_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .bind(productId)
      .all<ProductComparisonDocumentRow>();
    if (search.get("latest") === "1") {
      const latest = result.results[0];
      if (!latest) {
        return Response.json({ error: "등록된 비교표가 없습니다." }, { status: 404 });
      }
      return await serveDocument(latest);
    }
    return Response.json({
      documents: result.results.map(productComparisonDocumentJson),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let uploadedKey = "";
  try {
    const member = await requireApprovedMember();
    const formData = await request.formData();
    const productId = clean(formData.get("productId"), 180);
    const file = formData.get("file");
    if (!productId) {
      return Response.json({ error: "제품 ID가 필요합니다." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size < 1) {
      return Response.json({ error: "비교표 파일을 선택해 주세요." }, { status: 400 });
    }
    if (file.size > PRODUCT_COMPARISON_MAX_BYTES) {
      return Response.json({ error: "비교표는 20MB 이하만 첨부할 수 있습니다." }, { status: 413 });
    }
    const extension = file.name.toLowerCase().split(".").pop() || "";
    if (!allowedExtensions.has(extension)) {
      return Response.json(
        { error: "PDF, Excel 또는 Word 비교표만 첨부할 수 있습니다." },
        { status: 400 },
      );
    }

    const mimeType = file.type || "application/octet-stream";
    uploadedKey = `product-comparison/${encodeURIComponent(productId)}/${crypto.randomUUID()}.${extension}`;
    await getProductComparisonBucket().put(uploadedKey, file, {
      httpMetadata: {
        contentType: mimeType,
        contentDisposition: "attachment",
      },
      customMetadata: {
        productId,
        originalName: file.name.slice(0, 240),
      },
    });

    const d1 = await ensureProductComparisonDocumentsReady();
    const row = await d1
      .prepare(
        `INSERT INTO product_comparison_documents (
           product_id, original_name, object_key, mime_type, size_bytes,
           created_by, created_by_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        productId,
        file.name.slice(0, 240),
        uploadedKey,
        mimeType,
        file.size,
        member.id,
        member.displayName,
      )
      .first<ProductComparisonDocumentRow>();
    if (!row) throw new Error("비교표 정보를 저장하지 못했습니다.");
    return Response.json(
      { document: productComparisonDocumentJson(row) },
      { status: 201 },
    );
  } catch (error) {
    if (uploadedKey) {
      await getProductComparisonBucket().delete(uploadedKey).catch(() => undefined);
    }
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireApprovedMember();
    const payload = (await request.json()) as { id?: unknown };
    const id = documentId(String(payload.id ?? ""));
    if (!id) {
      return Response.json({ error: "올바른 비교표 ID가 필요합니다." }, { status: 400 });
    }
    const { d1, row } = await findDocument(id);
    if (!row) {
      return Response.json({ error: "비교표를 찾지 못했습니다." }, { status: 404 });
    }
    await d1.prepare("DELETE FROM product_comparison_documents WHERE id = ?").bind(id).run();
    await getProductComparisonBucket().delete(row.object_key);
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
