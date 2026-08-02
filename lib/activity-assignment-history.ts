import { getD1 } from "../db";
import {
  AccessError,
  ensureCollaborationReady,
  isPrimaryOwner,
  type Member,
} from "./collaboration";
import { ensureCampaignsReady } from "./campaign-store";
import { syncCampaignTargetsFromActivity } from "./campaign-institution-basics";
import { ensureRecordsReady } from "./records-store";

const createTableSql = `
  CREATE TABLE IF NOT EXISTS activity_assignment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    from_manager TEXT NOT NULL DEFAULT '',
    to_member_id INTEGER NOT NULL,
    to_manager TEXT NOT NULL,
    changed_by_member_id INTEGER NOT NULL,
    changed_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY (to_member_id) REFERENCES members(id),
    FOREIGN KEY (changed_by_member_id) REFERENCES members(id)
  )
`;

let activityAssignmentHistoryReadyPromise:
  | Promise<ReturnType<typeof getD1>>
  | null = null;

async function initializeActivityAssignmentHistory() {
  await ensureRecordsReady();
  const d1 = await ensureCollaborationReady();
  await d1.batch([
    d1.prepare(createTableSql),
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS activity_assignment_history_activity_idx
       ON activity_assignment_history (activity_id, created_at)`,
    ),
  ]);
  return d1;
}

export function ensureActivityAssignmentHistoryReady() {
  if (!activityAssignmentHistoryReadyPromise) {
    activityAssignmentHistoryReadyPromise =
      initializeActivityAssignmentHistory().catch((error) => {
        activityAssignmentHistoryReadyPromise = null;
        throw error;
      });
  }
  return activityAssignmentHistoryReadyPromise;
}

async function openCorrectionRequestReassignmentStatements(
  d1: ReturnType<typeof getD1>,
  activityIds: Set<number>,
  assigneeName: string,
  changedByMemberId: number,
) {
  const rows = await d1
    .prepare(
      `SELECT key, value
       FROM app_settings
       WHERE key LIKE 'equipment_correction_request_v1:%'`,
    )
    .all<{ key: string; value: string }>();

  return rows.results.flatMap((row) => {
    try {
      const task = JSON.parse(row.value) as Record<string, unknown>;
      if (
        !activityIds.has(Number(task.activityId)) ||
        String(task.status ?? "") !== "open" ||
        String(task.assigneeName ?? "").trim() === assigneeName
      ) {
        return [];
      }
      return [
        d1
          .prepare(
            `UPDATE app_settings
             SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
             WHERE key = ?`,
          )
          .bind(
            JSON.stringify({
              ...task,
              assigneeName,
              updatedAt: new Date().toISOString(),
            }),
            changedByMemberId,
            row.key,
          ),
      ];
    } catch {
      return [];
    }
  });
}

export async function reassignOpenCorrectionRequests(
  activityIds: number[],
  assigneeName: string,
  changedByMemberId: number,
) {
  if (!activityIds.length || !assigneeName.trim()) return;
  const d1 = await ensureActivityAssignmentHistoryReady();
  const statements = await openCorrectionRequestReassignmentStatements(
    d1,
    new Set(activityIds),
    assigneeName,
    changedByMemberId,
  );
  for (let start = 0; start < statements.length; start += 50) {
    await d1.batch(statements.slice(start, start + 50));
  }
}

export async function transferActivityAssignment(
  activityId: number,
  targetMemberId: number,
  actor: Member,
) {
  const d1 = await ensureActivityAssignmentHistoryReady();
  const current = await d1
    .prepare(
      `SELECT id, organization, business_round, progress_manager, award_status
       FROM activities
       WHERE id = ?`,
    )
    .bind(activityId)
    .first<{
      id: number;
      organization: string;
      business_round: number;
      progress_manager: string;
      award_status: string;
    }>();
  if (!current) {
    throw new AccessError("담당자를 변경할 기록을 찾을 수 없습니다.", 404);
  }
  if (current.award_status.trim() === "협력사 수주") {
    throw new AccessError(
      "협력사 수주의 진행 담당자는 해당 없음으로 고정됩니다.",
      400,
    );
  }
  if (!actor.isSales && !(await isPrimaryOwner(actor))) {
    throw new AccessError(
      "영업 담당자만 진행 담당자를 직접 변경할 수 있습니다.",
      403,
    );
  }
  const target = await d1
    .prepare(
      `SELECT id, display_name
       FROM members
       WHERE id = ? AND status = 'approved' AND is_sales = 1`,
    )
    .bind(targetMemberId)
    .first<{ id: number; display_name: string }>();
  if (!target) {
    throw new AccessError("등록된 영업 담당자를 찾을 수 없습니다.", 400);
  }
  if (target.display_name.trim() === current.progress_manager.trim()) {
    await ensureCampaignsReady();
    await syncCampaignTargetsFromActivity(d1, activityId);
    const record = await d1
      .prepare(
        `SELECT a.*, aa.created_by_name
         FROM activities a
         LEFT JOIN activity_authors aa ON aa.activity_id = a.id
         WHERE a.id = ?`,
      )
      .bind(activityId)
      .first<Record<string, unknown>>();
    if (!record) {
      throw new AccessError("담당자 변경 결과를 불러오지 못했습니다.", 500);
    }
    return { record };
  }

  await d1.batch([
    d1
      .prepare(
        `UPDATE activities
         SET progress_manager_locked = 0
         WHERE organization = ? AND business_round = ?`,
      )
      .bind(current.organization, current.business_round),
    d1
      .prepare(
        `UPDATE activities
         SET progress_manager = ?,
             progress_manager_locked = 0,
             updated_by_member_id = ?, updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(target.display_name, actor.id, actor.displayName, activityId),
    d1
      .prepare(
        `INSERT INTO activity_assignment_history (
           activity_id, from_manager, to_member_id, to_manager,
           changed_by_member_id, changed_by_name
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        activityId,
        current.progress_manager,
        target.id,
        target.display_name,
        actor.id,
        actor.displayName,
      ),
  ]);
  await reassignOpenCorrectionRequests(
    [activityId],
    target.display_name,
    actor.id,
  );
  await ensureCampaignsReady();
  await syncCampaignTargetsFromActivity(d1, activityId);

  const record = await d1
    .prepare(
      `SELECT a.*, aa.created_by_name
       FROM activities a
       LEFT JOIN activity_authors aa ON aa.activity_id = a.id
       WHERE a.id = ?`,
    )
    .bind(activityId)
    .first<Record<string, unknown>>();
  if (!record) {
    throw new AccessError("담당자 변경 결과를 불러오지 못했습니다.", 500);
  }
  return {
    record,
    assignment: {
      activityId,
      organization: current.organization,
      fromManager: current.progress_manager,
      toMemberId: target.id,
      toManager: target.display_name,
      changedByMemberId: actor.id,
      changedByName: actor.displayName,
    },
  };
}

export async function setActivityAssignmentAutomatic(
  activityId: number,
  actor: Member,
) {
  const d1 = await ensureActivityAssignmentHistoryReady();
  if (!(await isPrimaryOwner(actor))) {
    throw new AccessError(
      "대표관리자만 진행 담당자 배정 방식을 변경할 수 있습니다.",
      403,
    );
  }
  const current = await d1
    .prepare(
      `SELECT id, organization, business_round, award_status
       FROM activities
       WHERE id = ?`,
    )
    .bind(activityId)
    .first<{
      id: number;
      organization: string;
      business_round: number;
      award_status: string;
    }>();
  if (!current) {
    throw new AccessError("배정 방식을 변경할 기록을 찾을 수 없습니다.", 404);
  }
  if (current.award_status.trim() === "협력사 수주") {
    throw new AccessError(
      "협력사 수주의 진행 담당자는 해당 없음으로 고정됩니다.",
      400,
    );
  }
  await d1.batch([
    d1
      .prepare(
        `UPDATE activities
         SET progress_manager_locked = 0
         WHERE organization = ? AND business_round = ?`,
      )
      .bind(current.organization, current.business_round),
    d1
      .prepare(
        `UPDATE activities
         SET updated_by_member_id = ?, updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(actor.id, actor.displayName, activityId),
  ]);
  const record = await d1
    .prepare(
      `SELECT a.*, aa.created_by_name
       FROM activities a
       LEFT JOIN activity_authors aa ON aa.activity_id = a.id
       WHERE a.id = ?`,
    )
    .bind(activityId)
    .first<Record<string, unknown>>();
  if (!record) {
    throw new AccessError("배정 방식 변경 결과를 불러오지 못했습니다.", 500);
  }
  return { record };
}

export async function setActivityAssignmentFixed(
  activityId: number,
  actor: Member,
) {
  const d1 = await ensureActivityAssignmentHistoryReady();
  if (!(await isPrimaryOwner(actor))) {
    throw new AccessError(
      "대표관리자만 진행 담당자 배정 방식을 변경할 수 있습니다.",
      403,
    );
  }
  const current = await d1
    .prepare(
      `SELECT id, organization, business_round, progress_manager, award_status
       FROM activities
       WHERE id = ?`,
    )
    .bind(activityId)
    .first<{
      id: number;
      organization: string;
      business_round: number;
      progress_manager: string;
      award_status: string;
    }>();
  if (!current) {
    throw new AccessError("배정 방식을 변경할 기록을 찾을 수 없습니다.", 404);
  }
  if (current.award_status.trim() === "협력사 수주") {
    throw new AccessError(
      "협력사 수주의 진행 담당자는 해당 없음으로 고정됩니다.",
      400,
    );
  }
  if (
    !current.progress_manager.trim() ||
    current.progress_manager.trim() === "해당 없음"
  ) {
    throw new AccessError("진행 담당자를 먼저 선택해 주세요.", 400);
  }
  await d1.batch([
    d1
      .prepare(
        `UPDATE activities
         SET progress_manager_locked = 0
         WHERE organization = ? AND business_round = ?`,
      )
      .bind(current.organization, current.business_round),
    d1
      .prepare(
        `UPDATE activities
         SET progress_manager_locked = 1,
             updated_by_member_id = ?, updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(actor.id, actor.displayName, activityId),
  ]);
  const record = await d1
    .prepare(
      `SELECT a.*, aa.created_by_name
       FROM activities a
       LEFT JOIN activity_authors aa ON aa.activity_id = a.id
       WHERE a.id = ?`,
    )
    .bind(activityId)
    .first<Record<string, unknown>>();
  if (!record) {
    throw new AccessError("배정 방식 변경 결과를 불러오지 못했습니다.", 500);
  }
  return { record };
}
