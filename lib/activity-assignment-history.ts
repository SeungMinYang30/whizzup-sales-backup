import { getD1 } from "../db";
import {
  AccessError,
  ensureCollaborationReady,
  hasMemberPermission,
  type Member,
} from "./collaboration";
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
  return Promise.resolve(getD1());
}

export async function transferActivityAssignment(
  activityId: number,
  targetMemberId: number,
  actor: Member,
) {
  const d1 = await ensureActivityAssignmentHistoryReady();
  const current = await d1
    .prepare(
      `SELECT id, organization, progress_manager
       FROM activities
       WHERE id = ?`,
    )
    .bind(activityId)
    .first<{
      id: number;
      organization: string;
      progress_manager: string;
    }>();
  if (!current) {
    throw new AccessError("담당자를 변경할 기록을 찾을 수 없습니다.", 404);
  }
  if (
    current.progress_manager.trim() !== actor.displayName.trim() &&
    !hasMemberPermission(actor, "records:manage")
  ) {
    throw new AccessError(
      "현재 진행 담당자 또는 기록 관리 권한이 있는 구성원만 담당자를 변경할 수 있습니다.",
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
    throw new AccessError("현재 담당자와 다른 구성원을 선택해 주세요.", 400);
  }

  await d1.batch([
    d1
      .prepare(
        `UPDATE activities
         SET progress_manager = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(target.display_name, activityId),
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
