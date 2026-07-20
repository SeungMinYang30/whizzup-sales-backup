import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";

export type ManagerAlertAcknowledgement = {
  organization: string;
  issueSignature: string;
  snoozedUntil: string;
  updatedAt: string;
};

export type ManagerAlertAcknowledgementInput = {
  organization: string;
  issueSignature: string;
  snoozedUntil: string | null;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS manager_alert_acknowledgements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    organization TEXT NOT NULL,
    issue_signature TEXT NOT NULL,
    snoozed_until TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
  )
`;

let managerAlertsReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeManagerAlerts() {
  const d1 = await ensureCollaborationReady();
  await d1.batch([
    d1.prepare(createTableSql),
    d1.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS manager_alert_ack_member_org_idx
       ON manager_alert_acknowledgements (member_id, organization)`,
    ),
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS manager_alert_ack_snoozed_idx
       ON manager_alert_acknowledgements (member_id, snoozed_until)`,
    ),
  ]);
  return d1;
}

export function ensureManagerAlertsReady() {
  return Promise.resolve(getD1());
}

function mapAcknowledgement(
  row: Record<string, unknown>,
): ManagerAlertAcknowledgement {
  return {
    organization: String(row.organization ?? ""),
    issueSignature: String(row.issue_signature ?? ""),
    snoozedUntil: String(row.snoozed_until ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listManagerAlertAcknowledgements(memberId: number) {
  const d1 = await ensureManagerAlertsReady();
  const result = await d1
    .prepare(
      `SELECT organization, issue_signature, snoozed_until, updated_at
       FROM manager_alert_acknowledgements
       WHERE member_id = ?
       ORDER BY updated_at DESC, organization`,
    )
    .bind(memberId)
    .all<Record<string, unknown>>();
  return result.results.map(mapAcknowledgement);
}

export async function saveManagerAlertAcknowledgements(
  memberId: number,
  items: ManagerAlertAcknowledgementInput[],
) {
  const d1 = await ensureManagerAlertsReady();
  await d1.batch(
    items.map((item) =>
      d1
        .prepare(
          `INSERT INTO manager_alert_acknowledgements (
             member_id, organization, issue_signature, snoozed_until
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(member_id, organization) DO UPDATE SET
             issue_signature = excluded.issue_signature,
             snoozed_until = excluded.snoozed_until,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          memberId,
          item.organization,
          item.issueSignature,
          item.snoozedUntil,
        ),
    ),
  );
  return listManagerAlertAcknowledgements(memberId);
}

export async function removeManagerAlertAcknowledgements(
  memberId: number,
  organizations: string[],
) {
  const d1 = await ensureManagerAlertsReady();
  const chunks = Array.from(
    { length: Math.ceil(organizations.length / 50) },
    (_, index) => organizations.slice(index * 50, index * 50 + 50),
  );
  for (const chunk of chunks) {
    const placeholders = chunk.map(() => "?").join(", ");
    await d1
      .prepare(
        `DELETE FROM manager_alert_acknowledgements
         WHERE member_id = ? AND organization IN (${placeholders})`,
      )
      .bind(memberId, ...chunk)
      .run();
  }
  return listManagerAlertAcknowledgements(memberId);
}
