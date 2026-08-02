import { accessErrorResponse, requireApprovedMember } from "../../../lib/collaboration";
import { awardVendorJson, ensureAwardVendorsReady, type AwardVendorDocumentRow } from "../../../lib/award-vendors";

export const dynamic = "force-dynamic";

const fields = ["companyName", "businessNumber", "representativeName", "businessType", "businessItem", "address", "phone", "email", "bankName", "accountNumber", "accountHolder", "contactName", "contactTitle", "contactPhone", "contactEmail", "notes"] as const;
const columns: Record<(typeof fields)[number], string> = {
  companyName: "company_name", businessNumber: "business_number", representativeName: "representative_name",
  businessType: "business_type", businessItem: "business_item", address: "address", phone: "phone", email: "email",
  bankName: "bank_name", accountNumber: "account_number", accountHolder: "account_holder", contactName: "contact_name",
  contactTitle: "contact_title", contactPhone: "contact_phone", contactEmail: "contact_email", notes: "notes",
};
function clean(value: unknown, max = 500) { return String(value ?? "").trim().slice(0, max); }
function validId(value: unknown) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : 0; }

async function fullVendor(d1: Awaited<ReturnType<typeof ensureAwardVendorsReady>>, id: number) {
  const row = await d1.prepare("SELECT * FROM award_vendors WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const docs = await d1.prepare("SELECT * FROM award_vendor_documents WHERE vendor_id = ? ORDER BY created_at DESC, id DESC").bind(id).all<AwardVendorDocumentRow>();
  return awardVendorJson(row, docs.results);
}

export async function GET() {
  try {
    await requireApprovedMember();
    const d1 = await ensureAwardVendorsReady();
    const vendors = await d1.prepare("SELECT * FROM award_vendors WHERE is_active = 1 ORDER BY company_name COLLATE NOCASE").all<Record<string, unknown>>();
    const docs = await d1.prepare("SELECT * FROM award_vendor_documents ORDER BY created_at DESC, id DESC").all<AwardVendorDocumentRow>();
    return Response.json({
      vendors: vendors.results.map((row: Record<string, unknown>) =>
        awardVendorJson(
          row,
          docs.results.filter(
            (doc: AwardVendorDocumentRow) =>
              Number(doc.vendor_id) === Number(row.id),
          ),
        ),
      ),
    });
  } catch (error) { return accessErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = await request.json() as Record<string, unknown>;
    const values = fields.map((field) => clean(payload[field], field === "notes" ? 2000 : 500));
    if (!values[0]) return Response.json({ error: "업체명을 입력해 주세요." }, { status: 400 });
    const d1 = await ensureAwardVendorsReady();
    const placeholders = fields.map(() => "?").join(", ");
    const updateFields = fields.slice(1).map((field) => `${columns[field]} = excluded.${columns[field]}`).join(", ");
    const row = await d1.prepare(
      `INSERT INTO award_vendors (${fields.map((f) => columns[f]).join(", ")}, created_by, updated_by)
       VALUES (${placeholders}, ?, ?)
       ON CONFLICT(company_name) DO UPDATE SET
         ${updateFields},
         is_active = 1,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
    ).bind(...values, member.id, member.id).first<{ id: number }>();
    if (!row) throw new Error("업체 정보를 저장하지 못했습니다.");
    return Response.json({ vendor: await fullVendor(d1, Number(row.id)) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return Response.json({ error: "같은 이름의 업체가 이미 등록되어 있습니다." }, { status: 409 });
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = await request.json() as Record<string, unknown>;
    const id = validId(payload.id);
    if (!id) return Response.json({ error: "업체를 선택해 주세요." }, { status: 400 });
    const values = fields.map((field) => clean(payload[field], field === "notes" ? 2000 : 500));
    if (!values[0]) return Response.json({ error: "업체명을 입력해 주세요." }, { status: 400 });
    const d1 = await ensureAwardVendorsReady();
    await d1.prepare(`UPDATE award_vendors SET ${fields.map((f) => `${columns[f]} = ?`).join(", ")}, is_active = 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...values, member.id, id).run();
    return Response.json({ vendor: await fullVendor(d1, id) });
  } catch (error) { return accessErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = await request.json() as Record<string, unknown>;
    const id = validId(payload.id);
    if (!id) return Response.json({ error: "업체를 선택해 주세요." }, { status: 400 });
    const d1 = await ensureAwardVendorsReady();
    await d1
      .prepare(
        `UPDATE award_vendors
         SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(member.id, id)
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
