import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";
import { ensureRecordsReady } from "./records-store";

export type ActivityReviewAcknowledgement = {
  activityId: number;
  issueSignature: string;
  snoozedUntil: string;
  updatedAt: string;
};

export type ActivityReviewAcknowledgementInput = {
  activityId: number;
  issueSignature: string;
  snoozedUntil: string | null;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS activity_review_acknowledgements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    activity_id INTEGER NOT NULL,
    issue_signature TEXT NOT NULL,
    snoozed_until TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )
`;

let activityReviewsReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeActivityReviews() {
  await ensureRecordsReady();
  const d1 = await ensureCollaborationReady();
  await d1.batch([
    d1.prepare(createTableSql),
    d1.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS activity_review_ack_member_activity_idx
       ON activity_review_acknowledgements (member_id, activity_id)`,
    ),
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS activity_review_ack_snoozed_idx
       ON activity_review_acknowledgements (member_id, snoozed_until)`,
    ),
  ]);
  return d1;
}

export function ensureActivityReviewsReady() {
  return Promise.resolve(getD1());
}

function mapAcknowledgement(
  row: Record<string, unknown>,
): ActivityReviewAcknowledgement {
  return {
    activityId: Number(row.activity_id),
    issueSignature: String(row.issue_signature ?? ""),
    snoozedUntil: String(row.snoozed_until ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listActivityReviewAcknowledgements(memberId: number) {
  const d1 = await ensureActivityReviewsReady();
  const result = await d1
    .prepare(
      `SELECT activity_id, issue_signature, snoozed_until, updated_at
       FROM activity_review_acknowledgements
       WHERE member_id = ?
       ORDER BY updated_at DESC, activity_id DESC`,
    )
    .bind(memberId)
    .all<Record<string, unknown>>();
  return result.results.map(mapAcknowledgement);
}

export async function saveActivityReviewAcknowledgements(
  memberId: number,
  items: ActivityReviewAcknowledgementInput[],
) {
  const d1 = await ensureActivityReviewsReady();
  await d1.batch(
    items.map((item) =>
      d1
        .prepare(
          `INSERT INTO activity_review_acknowledgements (
             member_id, activity_id, issue_signature, snoozed_until
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(member_id, activity_id) DO UPDATE SET
             issue_signature = excluded.issue_signature,
             snoozed_until = excluded.snoozed_until,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          memberId,
          item.activityId,
          item.issueSignature,
          item.snoozedUntil,
        ),
    ),
  );
  return listActivityReviewAcknowledgements(memberId);
}

export async function removeActivityReviewAcknowledgements(
  memberId: number,
  activityIds: number[],
) {
  const chunks = Array.from(
    { length: Math.ceil(activityIds.length / 50) },
    (_, index) => activityIds.slice(index * 50, index * 50 + 50),
  );
  const d1 = await ensureActivityReviewsReady();
  for (const chunk of chunks) {
    const placeholders = chunk.map(() => "?").join(", ");
    await d1
      .prepare(
        `DELETE FROM activity_review_acknowledgements
         WHERE member_id = ? AND activity_id IN (${placeholders})`,
      )
      .bind(memberId, ...chunk)
      .run();
  }
  return listActivityReviewAcknowledgements(memberId);
}
