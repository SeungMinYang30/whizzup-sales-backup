import {
  AccessError,
  accessErrorResponse,
  requireAdminMember,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  addBudgetAlias,
  applyBudgetRetrofit,
  connectExistingBudgetNames,
  createStandardBudgetName,
  deactivateStandardBudgetName,
  groupBudgetNames,
  keepBudgetNamesUnclassified,
  listBudgetNameHistory,
  listBudgetNameManagement,
  moveBudgetMember,
  permanentlyDeleteStandardBudgetName,
  previewPermanentStandardBudgetDelete,
  previewBudgetRetrofit,
  processBudgetNameRequest,
  registerNewStandardBudgetName,
  reorderStandardBudgetNames,
  setStandardBudgetActive,
  setBudgetReviewExclusions,
  undoBudgetGroup,
  undoBudgetEvent,
  unlinkBudgetAlias,
  unlinkBudgetMember,
  updateStandardBudgetName,
} from "../../../lib/budget-names";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const view = new URL(request.url).searchParams.get("view");
    if (view === "history") {
      await requireMemberPermission("trash:manage");
      return Response.json(await listBudgetNameHistory());
    }
    await requireAdminMember();
    return Response.json(await listBudgetNameManagement());
  } catch (error) {
    if (error instanceof Error) {
      return Response.json(
        { error: `예산명 조회 진단: ${error.message}` },
        { status: 500 },
      );
    }
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const action = String(payload.action ?? "");
    const member =
      action === "undo-event"
        ? await requireMemberPermission("trash:manage")
        : await requireAdminMember();
    if (action === "create-standard") {
      return Response.json(await createStandardBudgetName(member, payload));
    }
    if (action === "update-standard") {
      return Response.json(await updateStandardBudgetName(member, payload));
    }
    if (action === "add-alias") {
      return Response.json(await addBudgetAlias(member, payload));
    }
    if (action === "deactivate") {
      return Response.json(
        await deactivateStandardBudgetName(member, payload.groupId),
      );
    }
    if (action === "set-active") {
      return Response.json(await setStandardBudgetActive(member, payload));
    }
    if (action === "reorder") {
      return Response.json(await reorderStandardBudgetNames(member, payload));
    }
    if (action === "connect-existing") {
      return Response.json(await connectExistingBudgetNames(member, payload));
    }
    if (action === "register-new") {
      return Response.json(
        await registerNewStandardBudgetName(member, payload),
      );
    }
    if (action === "keep-unclassified") {
      return Response.json(
        await keepBudgetNamesUnclassified(member, payload.selectedNames),
      );
    }
    if (action === "preview-permanent-delete") {
      return Response.json(await previewPermanentStandardBudgetDelete(payload.groupId));
    }
    if (action === "permanent-delete") {
      return Response.json(await permanentlyDeleteStandardBudgetName(member, payload));
    }
    if (action === "set-review-exclusions") {
      return Response.json(await setBudgetReviewExclusions(member, payload));
    }
    if (action === "process-request") {
      return Response.json(await processBudgetNameRequest(member, payload));
    }
    if (action === "preview-retrofit") {
      return Response.json(await previewBudgetRetrofit(payload));
    }
    if (action === "apply-retrofit") {
      return Response.json(await applyBudgetRetrofit(member, payload));
    }
    if (action === "undo-event") {
      return Response.json(await undoBudgetEvent(member, payload.eventId));
    }
    if (action === "group") {
      return Response.json(
        await groupBudgetNames(
          member,
          payload.selectedNames,
          payload.canonicalName,
        ),
      );
    }
    if (action === "undo-group") {
      const groupId = Number(payload.groupId);
      if (!Number.isInteger(groupId) || groupId < 1) {
        return Response.json({ error: "예산 묶음을 선택해 주세요." }, { status: 400 });
      }
      return Response.json(await undoBudgetGroup(member, groupId));
    }
    if (action === "unlink-alias") {
      const aliasId = Number(payload.aliasId);
      if (!Number.isInteger(aliasId) || aliasId < 1) {
        return Response.json({ error: "해제할 별칭을 선택해 주세요." }, { status: 400 });
      }
      return Response.json(await unlinkBudgetAlias(member, aliasId));
    }
    if (action === "unlink-member") {
      return Response.json(
        await unlinkBudgetMember(
          member,
          Array.isArray(payload.memberIds)
            ? payload.memberIds
            : payload.memberId,
        ),
      );
    }
    if (action === "move-member") {
      return Response.json(await moveBudgetMember(member, payload));
    }
    return Response.json({ error: "지원하지 않는 예산명 작업입니다." }, { status: 400 });
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    if (error instanceof Error && error.message) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}
