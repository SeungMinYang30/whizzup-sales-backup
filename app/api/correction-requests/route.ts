import {
  accessErrorResponse,
  ensureCollaborationReady,
  requireApprovedMember,
  requireMemberPermission,
} from "../../../lib/collaboration";

export const dynamic = "force-dynamic";

const SETTING_PREFIX = "equipment_correction_request_v1:";

type CorrectionTask = {
  id: string;
  activityId: number;
  businessRound: number;
  organization: string;
  assigneeName: string;
  itemIds: number[];
  itemNames: string[];
  requestedByName: string;
  status: "open" | "completed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedByName?: string;
};

function cleanText(value: unknown, maxLength = 300) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanPositiveIntegers(value: unknown, maxItems = 200) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .slice(0, maxItems)
        .map(Number)
        .filter((entry) => Number.isInteger(entry) && entry > 0),
    ),
  ];
}

function cleanItemNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .slice(0, 200)
        .map((entry) => cleanText(entry))
        .filter(Boolean),
    ),
  ];
}

function parseTask(value: string): CorrectionTask | null {
  try {
    const task = JSON.parse(value) as Partial<CorrectionTask>;
    if (
      !task.id ||
      !Number.isInteger(task.activityId) ||
      !task.organization ||
      !task.assigneeName ||
      !Array.isArray(task.itemNames)
    ) {
      return null;
    }
    return {
      id: cleanText(task.id, 120),
      activityId: Number(task.activityId),
      businessRound: Math.max(1, Number(task.businessRound) || 1),
      organization: cleanText(task.organization),
      assigneeName: cleanText(task.assigneeName, 120),
      itemIds: cleanPositiveIntegers(task.itemIds),
      itemNames: cleanItemNames(task.itemNames),
      requestedByName: cleanText(task.requestedByName, 120),
      status: task.status === "completed" ? "completed" : "open",
      createdAt: cleanText(task.createdAt, 40),
      updatedAt: cleanText(task.updatedAt, 40),
      ...(task.completedAt
        ? { completedAt: cleanText(task.completedAt, 40) }
        : {}),
      ...(task.completedByName
        ? { completedByName: cleanText(task.completedByName, 120) }
        : {}),
    };
  } catch {
    return null;
  }
}

async function saveTask(task: CorrectionTask, memberId: number) {
  const d1 = await ensureCollaborationReady();
  await d1
    .prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(`${SETTING_PREFIX}${task.id}`, JSON.stringify(task), memberId)
    .run();
}

export async function GET() {
  try {
    const member = await requireApprovedMember();
    const d1 = await ensureCollaborationReady();
    const rows = await d1
      .prepare(
        `SELECT value
         FROM app_settings
         WHERE key LIKE ?
         ORDER BY updated_at DESC`,
      )
      .bind(`${SETTING_PREFIX}%`)
      .all<{ value: string }>();
    const tasks = rows.results
      .map((row) => parseTask(String(row.value ?? "")))
      .filter(
        (task): task is CorrectionTask =>
          Boolean(
            task &&
              task.status === "open" &&
              task.assigneeName === member.displayName,
          ),
      );
    return Response.json(
      { tasks },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const body = (await request.json()) as Record<string, unknown>;
    const activityId = Number(body.activityId);
    const itemIds = cleanPositiveIntegers(body.itemIds);
    const itemNames = cleanItemNames(body.itemNames);
    if (
      !Number.isInteger(activityId) ||
      activityId < 1 ||
      !itemIds.length ||
      !itemNames.length
    ) {
      return Response.json(
        { error: "금액을 확인할 기관과 품목을 다시 선택해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureCollaborationReady();
    const activity = await d1
      .prepare(
        `SELECT organization, business_round, progress_manager
         FROM activities
         WHERE id = ?
         LIMIT 1`,
      )
      .bind(activityId)
      .first<{
        organization: string;
        business_round: number;
        progress_manager: string;
      }>();
    if (!activity) {
      return Response.json(
        { error: "연결된 영업 기록을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    const assigneeName = cleanText(activity.progress_manager, 120);
    if (!assigneeName || assigneeName === "해당 없음") {
      return Response.json(
        { error: "먼저 기관 영업 기록에 진행 담당자를 지정해 주세요." },
        { status: 400 },
      );
    }

    const businessRound = Math.max(
      1,
      Number(activity.business_round) || Number(body.businessRound) || 1,
    );
    const id = `${activityId}:${businessRound}`;
    const existing = await d1
      .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
      .bind(`${SETTING_PREFIX}${id}`)
      .first<{ value: string }>();
    const previous = existing?.value ? parseTask(existing.value) : null;
    const now = new Date().toISOString();
    const task: CorrectionTask = {
      id,
      activityId,
      businessRound,
      organization: cleanText(activity.organization),
      assigneeName,
      itemIds,
      itemNames,
      requestedByName: member.displayName,
      status: "open",
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    await saveTask(task, member.id);
    return Response.json({ task });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const member = await requireApprovedMember();
    const body = (await request.json()) as Record<string, unknown>;
    const id = cleanText(body.id, 120);
    if (!id) {
      return Response.json(
        { error: "완료할 업무를 선택해 주세요." },
        { status: 400 },
      );
    }
    const d1 = await ensureCollaborationReady();
    const row = await d1
      .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
      .bind(`${SETTING_PREFIX}${id}`)
      .first<{ value: string }>();
    const task = row?.value ? parseTask(row.value) : null;
    if (!task) {
      return Response.json(
        { error: "확인 업무를 찾지 못했습니다." },
        { status: 404 },
      );
    }
    if (task.assigneeName !== member.displayName && member.role !== "admin") {
      return Response.json(
        { error: "이 업무를 완료할 권한이 없습니다." },
        { status: 403 },
      );
    }
    const now = new Date().toISOString();
    const completedTask: CorrectionTask = {
      ...task,
      status: "completed",
      updatedAt: now,
      completedAt: now,
      completedByName: member.displayName,
    };
    await saveTask(completedTask, member.id);
    return Response.json({ task: completedTask });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
