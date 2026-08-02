import { getD1 } from "../db";
import { ensureRecordsReady } from "./records-store";
import { ensureTrashReady, trashBatchJson, type TrashBatchRow } from "./trash-store";

export type DataControlUnit = {
  id: string;
  organization: string;
  businessRound: number;
  region: string;
  status: string;
  awardStatus: string;
  awardCompany: string;
  progressManager: string;
  source: string;
  budgetNames: string[];
  activityCount: number;
  activityIds: number[];
  latestActivityDate: string;
  testLike: boolean;
};

export type DataControlEventRow = {
  id: number;
  action: string;
  subject: string;
  item_count: number;
  archive_ids_json: string;
  actor_member_id: number;
  actor_name: string;
  details_json: string;
  created_at: string;
};

type ActivitySummaryRow = {
  id: number;
  activity_date: string | null;
  region: string;
  organization: string;
  business_round: number;
  budget_type: string;
  budget_original_name: string;
  status: string;
  award_status: string;
  award_company: string;
  progress_manager: string;
  source_chat: string;
  notes: string;
};

const createEventsTableSql = `
  CREATE TABLE IF NOT EXISTS data_control_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,
    archive_ids_json TEXT NOT NULL DEFAULT '[]',
    actor_member_id INTEGER NOT NULL,
    actor_name TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function unitKey(organization: string, businessRound: number) {
  return `${organization}\u0000${businessRound}`;
}

function isLater(left: ActivitySummaryRow, right: ActivitySummaryRow) {
  const leftDate = clean(left.activity_date);
  const rightDate = clean(right.activity_date);
  return leftDate > rightDate || (leftDate === rightDate && Number(left.id) > Number(right.id));
}

function looksLikeTestData(row: ActivitySummaryRow) {
  const source = [
    row.organization,
    row.source_chat,
    row.notes,
  ]
    .join(" ")
    .toLowerCase();
  return /(^|\s)(테스트|test|demo|샘플|sample)(\s|$)/i.test(source);
}

export async function ensureDataControlReady() {
  const d1 = getD1();
  await d1.prepare(createEventsTableSql).run();
  await d1
    .prepare(
      `CREATE INDEX IF NOT EXISTS data_control_events_created_idx
       ON data_control_events (created_at DESC, id DESC)`,
    )
    .run();
  return d1;
}

export async function listDataControlUnits(): Promise<DataControlUnit[]> {
  const d1 = await ensureRecordsReady();
  const result = await d1
    .prepare(
      `SELECT
         id, activity_date, region, organization, business_round,
         budget_type, budget_original_name, status, award_status,
         award_company, progress_manager, source_chat, notes
       FROM activities
       WHERE TRIM(organization) <> ''
       ORDER BY organization ASC, business_round ASC, activity_date ASC, id ASC`,
    )
    .all<ActivitySummaryRow>();

  const grouped = new Map<
    string,
    {
      latest: ActivitySummaryRow;
      rows: ActivitySummaryRow[];
      budgets: Set<string>;
      testLike: boolean;
    }
  >();

  result.results.forEach((row) => {
    const organization = clean(row.organization);
    const businessRound = Math.max(1, Number(row.business_round) || 1);
    const key = unitKey(organization, businessRound);
    const current = grouped.get(key);
    const budget = clean(row.budget_original_name) || clean(row.budget_type);
    if (!current) {
      grouped.set(key, {
        latest: row,
        rows: [row],
        budgets: new Set(budget ? [budget] : []),
        testLike: looksLikeTestData(row),
      });
      return;
    }
    current.rows.push(row);
    if (budget) current.budgets.add(budget);
    if (isLater(row, current.latest)) current.latest = row;
    current.testLike ||= looksLikeTestData(row);
  });

  return [...grouped.values()]
    .map(({ latest, rows, budgets, testLike }) => {
      const organization = clean(latest.organization);
      const businessRound = Math.max(1, Number(latest.business_round) || 1);
      return {
        id: `${encodeURIComponent(organization)}:${businessRound}`,
        organization,
        businessRound,
        region: clean(latest.region),
        status: clean(latest.status) || "미정",
        awardStatus: clean(latest.award_status) || "미정",
        awardCompany: clean(latest.award_company),
        progressManager: clean(latest.progress_manager) || "미지정",
        source: clean(latest.source_chat) || "직접 입력",
        budgetNames: [...budgets].sort((left, right) => left.localeCompare(right, "ko")),
        activityCount: rows.length,
        activityIds: rows.map((row) => Number(row.id)).filter(Number.isSafeInteger),
        latestActivityDate: clean(latest.activity_date),
        testLike,
      };
    })
    .sort(
      (left, right) =>
        right.latestActivityDate.localeCompare(left.latestActivityDate) ||
        left.organization.localeCompare(right.organization, "ko") ||
        left.businessRound - right.businessRound,
    );
}

export async function listActiveDataArchives() {
  const d1 = await ensureTrashReady();
  const result = await d1
    .prepare(
      `SELECT * FROM deletion_batches
       WHERE restored_at IS NULL
       ORDER BY deleted_at DESC
       LIMIT 300`,
    )
    .all<TrashBatchRow>();
  return result.results.map(trashBatchJson);
}

export async function listDataControlEvents() {
  const d1 = await ensureDataControlReady();
  const result = await d1
    .prepare(
      `SELECT * FROM data_control_events
       ORDER BY created_at DESC, id DESC
       LIMIT 300`,
    )
    .all<DataControlEventRow>();
  return result.results.map((row) => ({
    id: Number(row.id),
    action: row.action,
    subject: row.subject,
    itemCount: Number(row.item_count) || 0,
    archiveIds: (() => {
      try {
        const parsed = JSON.parse(row.archive_ids_json);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    })(),
    actorName: row.actor_name,
    details: (() => {
      try {
        const parsed = JSON.parse(row.details_json);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    })(),
    createdAt: row.created_at,
  }));
}

export async function logDataControlEvent(input: {
  action: "archive" | "restore" | "purge";
  subject: string;
  itemCount: number;
  archiveIds?: string[];
  actorMemberId: number;
  actorName: string;
  details?: Record<string, unknown>;
}) {
  const d1 = await ensureDataControlReady();
  await d1
    .prepare(
      `INSERT INTO data_control_events (
         action, subject, item_count, archive_ids_json,
         actor_member_id, actor_name, details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.action,
      input.subject.slice(0, 300),
      Math.max(0, Number(input.itemCount) || 0),
      JSON.stringify(input.archiveIds || []),
      input.actorMemberId,
      input.actorName,
      JSON.stringify(input.details || {}),
    )
    .run();
}
