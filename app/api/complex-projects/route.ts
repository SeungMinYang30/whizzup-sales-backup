import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  addComplexBudget,
  createComplexProject,
  deleteComplexEntity,
  listComplexProjects,
  saveComplexDelivery,
  saveComplexItem,
  saveComplexZone,
  updateComplexProject,
} from "../../../lib/complex-projects";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedMember();
    return Response.json(await listComplexProjects());
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const result = action === "create_project"
      ? await createComplexProject(payload, member)
      : action === "update_project"
        ? await updateComplexProject(payload, member)
        : action === "add_budget"
          ? await addComplexBudget(payload, member)
          : action === "save_zone"
            ? await saveComplexZone(payload, member)
            : action === "save_item"
              ? await saveComplexItem(payload, member)
              : action === "save_delivery"
                ? await saveComplexDelivery(payload, member)
                : action === "delete_entity"
                  ? await deleteComplexEntity(payload, member)
                  : null;
    if (!result) {
      return Response.json({ error: "복합사업 작업을 확인해 주세요." }, { status: 400 });
    }
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}
