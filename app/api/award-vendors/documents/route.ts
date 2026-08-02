import { accessErrorResponse, requireApprovedMember } from "../../../../lib/collaboration";
import { AWARD_VENDOR_MAX_FILE_BYTES, awardVendorDocumentJson, ensureAwardVendorsReady, getAwardVendorBucket, type AwardVendorDocumentRow } from "../../../../lib/award-vendors";

export const dynamic = "force-dynamic";
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const allowedKinds = new Set(["business_registration", "bankbook", "business_card"]);
function idOf(value: unknown) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : 0; }

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const id = idOf(new URL(request.url).searchParams.get("id"));
    const d1 = await ensureAwardVendorsReady();
    const row = await d1.prepare("SELECT * FROM award_vendor_documents WHERE id = ?").bind(id).first<AwardVendorDocumentRow>();
    if (!row) return Response.json({ error: "문서를 찾지 못했습니다." }, { status: 404 });
    const stored = await getAwardVendorBucket().get(row.object_key);
    if (!stored) return Response.json({ error: "저장된 문서를 찾지 못했습니다." }, { status: 404 });
    return new Response(stored.body, { headers: { "Content-Type": row.content_type, "Content-Length": String(stored.size), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return accessErrorResponse(error); }
}

export async function POST(request: Request) {
  let objectKey = "";
  try {
    const member = await requireApprovedMember();
    const form = await request.formData();
    const vendorId = idOf(form.get("vendorId"));
    const documentType = String(form.get("documentType") ?? "");
    const file = form.get("file");
    if (!vendorId || !allowedKinds.has(documentType)) return Response.json({ error: "업체와 문서 종류를 확인해 주세요." }, { status: 400 });
    if (!(file instanceof File) || !allowedTypes.has(file.type) || file.size < 1 || file.size > AWARD_VENDOR_MAX_FILE_BYTES) return Response.json({ error: "JPG, PNG, WebP, PDF 파일을 12MB 이하로 올려 주세요." }, { status: 400 });
    const d1 = await ensureAwardVendorsReady();
    const vendor = await d1.prepare("SELECT id FROM award_vendors WHERE id = ?").bind(vendorId).first();
    if (!vendor) return Response.json({ error: "업체를 먼저 저장해 주세요." }, { status: 404 });
    const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg");
    objectKey = `award-vendors/${vendorId}/${documentType}/${crypto.randomUUID()}.${ext}`;
    await getAwardVendorBucket().put(objectKey, file, { httpMetadata: { contentType: file.type, contentDisposition: "inline" }, customMetadata: { vendorId: String(vendorId), documentType } });
    const row = await d1.prepare("INSERT INTO award_vendor_documents (vendor_id, document_type, original_name, object_key, content_type, size_bytes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *").bind(vendorId, documentType, file.name.slice(0, 240), objectKey, file.type, file.size, member.id).first<AwardVendorDocumentRow>();
    if (!row) throw new Error("문서 정보를 저장하지 못했습니다.");
    return Response.json({ document: awardVendorDocumentJson(row) }, { status: 201 });
  } catch (error) {
    if (objectKey) { try { await getAwardVendorBucket().delete(objectKey); } catch { /* orphan cleanup can retry later */ } }
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireApprovedMember();
    const { id: rawId } = await request.json() as { id?: unknown };
    const id = idOf(rawId);
    const d1 = await ensureAwardVendorsReady();
    const row = await d1.prepare("SELECT * FROM award_vendor_documents WHERE id = ?").bind(id).first<AwardVendorDocumentRow>();
    if (!row) return Response.json({ error: "문서를 찾지 못했습니다." }, { status: 404 });
    await getAwardVendorBucket().delete(row.object_key);
    await d1.prepare("DELETE FROM award_vendor_documents WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
  } catch (error) { return accessErrorResponse(error); }
}
