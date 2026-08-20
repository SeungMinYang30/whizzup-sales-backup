import {
  accessErrorResponse,
  ensureCollaborationReady,
  requireAdminMember,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  defaultAirpassEquipmentKitPlans,
  normalizeAirpassEquipmentKitPlans,
} from "../../../lib/airpass-equipment-kit";

export const dynamic = "force-dynamic";

const SETTING_KEY = "airpass_equipment_kit_plans_v1";

async function readPlans() {
  const d1 = await ensureCollaborationReady();
  const row = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(SETTING_KEY)
    .first<{ value: string }>();
  if (!row?.value) return defaultAirpassEquipmentKitPlans();
  try {
    return normalizeAirpassEquipmentKitPlans(JSON.parse(row.value));
  } catch {
    return defaultAirpassEquipmentKitPlans();
  }
}

export async function GET() {
  try {
    const member = await requireApprovedMember();
    return Response.json({ plans: await readPlans(), canManage: member.role === "admin" });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireAdminMember();
    const payload = (await request.json()) as { plans?: unknown };
    const plans = normalizeAirpassEquipmentKitPlans(payload.plans);
    const d1 = await ensureCollaborationReady();
    await d1.prepare(`
      INSERT INTO app_settings (key, value, updated_by, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).bind(SETTING_KEY, JSON.stringify(plans), member.id).run();
    return Response.json({ ok: true, plans });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
