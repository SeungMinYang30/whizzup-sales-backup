import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  ensureProductComparisonDocumentsReady,
  getProductComparisonBucket,
  type ProductComparisonDocumentRow,
} from "../../../lib/product-comparison-documents";
import {
  downloadDriveFile,
  moveDriveFile,
  rollbackDriveMoves,
  safeDriveFolderName,
  uploadDriveFile,
  type DriveMoveSnapshot,
} from "../../../lib/google-drive-storage";

export const dynamic = "force-dynamic";

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function catalogId(value: unknown) {
  return String(value ?? "").trim().slice(0, 120);
}

async function findDocument(id: number) {
  const d1 = await ensureProductComparisonDocumentsReady();
  const row = await d1.prepare(
    "SELECT * FROM product_comparison_documents WHERE id = ? LIMIT 1",
  ).bind(id).first<ProductComparisonDocumentRow>();
  return { d1, row };
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const params = new URL(request.url).searchParams;
    const id = positiveInteger(params.get("id"));
    if (id && params.get("download") === "1") {
      const { row } = await findDocument(id);
      if (!row || row.archived_at) {
        return Response.json({ error: "물품 비교표를 찾지 못했습니다." }, { status: 404 });
      }
      const stored = row.drive_file_id
        ? await downloadDriveFile(row.drive_file_id)
        : row.object_key
          ? await getProductComparisonBucket().get(row.object_key)
          : null;
      if (!stored) {
        return Response.json({ error: "비교표 파일을 찾지 못했습니다." }, { status: 404 });
      }
      const contentType =
        "headers" in stored
          ? stored.headers.get("Content-Type")
          : stored.httpMetadata?.contentType;
      return new Response(stored.body, {
        headers: {
          "Content-Type": contentType || row.mime_type || "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const d1 = await ensureProductComparisonDocumentsReady();
    const productId = catalogId(params.get("catalogProductId"));
    if (productId) {
      const result = await d1.prepare(
        `SELECT * FROM product_comparison_documents
         WHERE catalog_product_id = ? AND archived_at IS NULL ORDER BY id DESC`,
      ).bind(productId).all<ProductComparisonDocumentRow>();
      return Response.json({ documents: result.results ?? [] });
    }
    const itemId = positiveInteger(params.get("equipmentItemId"));
    if (!itemId) return Response.json({ documents: [] });
    const result = await d1.prepare(
      `SELECT * FROM product_comparison_documents
       WHERE equipment_item_id = ? AND archived_at IS NULL ORDER BY id DESC`,
    ).bind(itemId).all<ProductComparisonDocumentRow>();
    return Response.json({ documents: result.results ?? [] });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const form = await request.formData();
    const itemId = positiveInteger(form.get("equipmentItemId"));
    const productId = catalogId(form.get("catalogProductId"));
    const productName = String(form.get("productName") ?? "").trim().slice(0, 200);
    const file = form.get("file");
    if ((!itemId && !productId) || !(file instanceof File) || !file.size) {
      return Response.json({ error: "품목과 비교표 파일을 확인해 주세요." }, { status: 400 });
    }
    const year = new Date().getFullYear().toString();
    const uploaded = await uploadDriveFile({
      file,
      folderSegments: ["02_제품자료", "물품 비교표", safeDriveFolderName(productName || "미분류"), year],
      contextType: "product-comparison",
      contextId: productId || String(itemId),
    });
    const d1 = await ensureProductComparisonDocumentsReady();
    const previous = productId
      ? await d1.prepare(
          `SELECT * FROM product_comparison_documents
           WHERE catalog_product_id = ? AND archived_at IS NULL ORDER BY id DESC`,
        ).bind(productId).all<ProductComparisonDocumentRow>()
      : { results: [] as ProductComparisonDocumentRow[] };
    const archivedMoves: DriveMoveSnapshot[] = [];
    try {
      for (const document of previous.results) {
        if (document.drive_file_id) {
          archivedMoves.push(await moveDriveFile(document.drive_file_id, [
            "99_보관", "제품자료", "물품 비교표", safeDriveFolderName(document.product_name || "미분류"), year,
          ]));
        }
      }
      const statements = previous.results.map((document: ProductComparisonDocumentRow) => d1.prepare(
        "UPDATE product_comparison_documents SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL",
      ).bind(document.id));
      statements.push(d1.prepare(
        `INSERT INTO product_comparison_documents
         (equipment_item_id, catalog_product_id, product_name, original_name, drive_file_id, drive_folder_id,
          mime_type, size_bytes, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        itemId, productId, productName, file.name.slice(0, 240), uploaded.fileId, uploaded.folderId,
        uploaded.mimeType, uploaded.sizeBytes, member.id, member.displayName,
      ));
      await d1.batch(statements);
      const inserted = await d1.prepare(
        "SELECT id FROM product_comparison_documents WHERE drive_file_id = ? LIMIT 1",
      ).bind(uploaded.fileId).first<{ id: number }>();
      return Response.json({ ok: true, id: inserted?.id ?? 0, replaced: previous.results.length > 0 });
    } catch (error) {
      await rollbackDriveMoves(archivedMoves).catch(() => undefined);
      await moveDriveFile(uploaded.fileId, ["99_보관", "제품자료", "물품 비교표", year]).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireApprovedMember();
    const id = positiveInteger(new URL(request.url).searchParams.get("id"));
    const { d1, row } = await findDocument(id);
    if (!row || row.archived_at) {
      return Response.json({ error: "물품 비교표를 찾지 못했습니다." }, { status: 404 });
    }
    const snapshot = row.drive_file_id
      ? await moveDriveFile(row.drive_file_id, [
          "99_보관", "제품자료", "물품 비교표", safeDriveFolderName(row.product_name || "미분류"),
          new Date().getFullYear().toString(),
        ])
      : null;
    try {
      await d1.prepare(
        "UPDATE product_comparison_documents SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(id).run();
    } catch (error) {
      if (snapshot) await rollbackDriveMoves([snapshot]).catch(() => undefined);
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
