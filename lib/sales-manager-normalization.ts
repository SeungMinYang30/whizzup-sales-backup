import { getD1 } from "../db";
import { resolveRegisteredSalesName } from "./sales-names";

type D1 = ReturnType<typeof getD1>;
type ProgressManagerReplacement = {
  current: string;
  canonical: string;
};

const LATEST_AUTHOR_PROGRESS_MANAGER_BACKFILL_KEY =
  "latest_author_progress_manager_backfill_v1";
const AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER_REPAIR_KEY =
  "auto_backfilled_owner_progress_manager_repair_v2";
const AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER = "양승민 이사";

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function listRegisteredSalesNames(d1: D1) {
  const result = await d1
    .prepare(
      `SELECT display_name
       FROM members
       WHERE status = 'approved' AND is_sales = 1
       ORDER BY display_name COLLATE NOCASE, id`,
    )
    .all<{ display_name: string }>();
  return result.results
    .map((member: { display_name: string }) => cleanName(member.display_name))
    .filter(Boolean);
}

export function canonicalProgressManagerName(
  value: unknown,
  registeredNames: string[],
) {
  const current = cleanName(value);
  if (!current) return "";
  return resolveRegisteredSalesName(current, registeredNames) ?? current;
}

export function progressManagerForAward(
  awardStatus: unknown,
  value: unknown,
  registeredNames: string[],
) {
  const status = cleanName(awardStatus);
  if (status === "협력사 수주") {
    return "해당 없음";
  }
  return canonicalProgressManagerName(value, registeredNames);
}

type BusinessProgressManagerSource = {
  organization: string;
  business_round: number;
  award_status: string;
  progress_manager: string | null;
};

async function listBusinessProgressManagerSources(
  d1: D1,
  organization = "",
  businessRound = 0,
) {
  const result = await d1
    .prepare(
      `WITH business_keys AS (
         SELECT DISTINCT organization, business_round
         FROM activities
         WHERE TRIM(COALESCE(organization, '')) <> ''
           AND (? = '' OR organization = ?)
           AND (? = 0 OR business_round = ?)
       )
       SELECT
         business.organization,
         business.business_round,
         COALESCE((
           SELECT current.award_status
           FROM activities current
           WHERE current.organization = business.organization
             AND current.business_round = business.business_round
           ORDER BY current.activity_date DESC, current.id DESC
           LIMIT 1
         ), '미정') AS award_status,
         COALESCE((
           SELECT member.display_name
           FROM activities locked
           JOIN members member
             ON member.display_name = locked.progress_manager
            AND member.status = 'approved'
            AND member.is_sales = 1
           WHERE locked.organization = business.organization
             AND locked.business_round = business.business_round
             AND locked.progress_manager_locked = 1
           ORDER BY locked.updated_at DESC, locked.id DESC
           LIMIT 1
         ), (
           SELECT member.display_name
           FROM activities latest
           JOIN activity_authors author ON author.activity_id = latest.id
           JOIN members member
             ON member.id = author.member_id
            AND member.status = 'approved'
            AND member.is_sales = 1
           WHERE latest.organization = business.organization
             AND latest.business_round = business.business_round
           ORDER BY latest.activity_date DESC, latest.id DESC
           LIMIT 1
         )) AS progress_manager
       FROM business_keys business`,
    )
    .bind(organization, organization, businessRound, businessRound)
    .all<BusinessProgressManagerSource>();
  return result.results;
}

function prepareBusinessProgressManagerUpdate(
  d1: D1,
  source: BusinessProgressManagerSource,
) {
  if (cleanName(source.award_status) === "협력사 수주") {
    return d1
      .prepare(
        `UPDATE activities
         SET progress_manager = '해당 없음',
             progress_manager_locked = 0
         WHERE organization = ? AND business_round = ?`,
      )
      .bind(source.organization, source.business_round);
  }
  const manager = cleanName(source.progress_manager);
  if (!manager) return null;
  return d1
    .prepare(
      `UPDATE activities
       SET progress_manager = ?
       WHERE organization = ?
         AND business_round = ?
         AND progress_manager_locked = 0
         AND award_status <> '협력사 수주'
         AND progress_manager <> ?`,
    )
    .bind(
      manager,
      source.organization,
      source.business_round,
      manager,
    );
}

export async function syncBusinessProgressManagerFromLatestAuthor(
  d1: D1,
  organization: string,
  businessRound: number,
) {
  const [source] = await listBusinessProgressManagerSources(
    d1,
    organization,
    businessRound,
  );
  if (!source) return;
  const statement = prepareBusinessProgressManagerUpdate(d1, source);
  if (statement) await statement.run();
}

export async function backfillHistoricalProgressManagersFromLatestAuthors(
  d1: D1,
) {
  const completed = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(LATEST_AUTHOR_PROGRESS_MANAGER_BACKFILL_KEY)
    .first<{ value: string }>();
  if (completed?.value === "completed") return 0;

  const sources = await listBusinessProgressManagerSources(d1);
  let updatedBusinessCount = 0;
  for (let start = 0; start < sources.length; start += 50) {
    const statements = sources
      .slice(start, start + 50)
      .map((source) => prepareBusinessProgressManagerUpdate(d1, source))
      .filter((statement): statement is NonNullable<typeof statement> =>
        Boolean(statement),
      );
    if (statements.length) {
      await d1.batch(statements);
      updatedBusinessCount += statements.length;
    }
  }
  await d1
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, 'completed', CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(LATEST_AUTHOR_PROGRESS_MANAGER_BACKFILL_KEY)
    .run();
  return updatedBusinessCount;
}

export async function repairAutoBackfilledOwnerProgressManagers(d1: D1) {
  const completed = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER_REPAIR_KEY)
    .first<{ value: string }>();
  if (completed?.value === "completed") return 0;

  const previousBackfill = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(LATEST_AUTHOR_PROGRESS_MANAGER_BACKFILL_KEY)
    .first<{ value: string }>();
  const assignmentHistoryTable = await d1
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = 'activity_assignment_history'
       LIMIT 1`,
    )
    .first<{ name: string }>();
  const campaignTargetsTable = await d1
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = 'sales_campaign_targets'
       LIMIT 1`,
    )
    .first<{ name: string }>();

  let repairedCount = 0;
  if (
    previousBackfill?.value === "completed" &&
    assignmentHistoryTable?.name === "activity_assignment_history" &&
    campaignTargetsTable?.name === "sales_campaign_targets"
  ) {
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE sales_campaign_targets
           SET assigned_member_id = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE assigned_member_id IN (
               SELECT member.id
               FROM members member
               WHERE TRIM(member.display_name) = ?
                 AND member.status = 'approved'
                 AND member.is_sales = 1
             )
             AND COALESCE((
               SELECT latest.award_status
               FROM activities latest
               WHERE latest.organization =
                       sales_campaign_targets.organization
                 AND latest.business_round =
                       sales_campaign_targets.business_round
               ORDER BY latest.activity_date DESC, latest.id DESC
               LIMIT 1
             ), '미정') <> '협력사 수주'
             AND NOT EXISTS (
               SELECT 1
               FROM activities fixed
               WHERE fixed.organization =
                       sales_campaign_targets.organization
                 AND fixed.business_round =
                       sales_campaign_targets.business_round
                 AND fixed.progress_manager_locked = 1
                 AND TRIM(COALESCE(fixed.progress_manager, '')) = ?
             )
             AND NOT EXISTS (
               SELECT 1
               FROM activity_assignment_history history
               JOIN activities assigned ON assigned.id = history.activity_id
               WHERE assigned.organization =
                       sales_campaign_targets.organization
                 AND assigned.business_round =
                       sales_campaign_targets.business_round
                 AND TRIM(COALESCE(history.to_manager, '')) = ?
             )
             AND ? = (
               SELECT member.display_name
               FROM activities latest
               JOIN activity_authors author ON author.activity_id = latest.id
               JOIN members member
                 ON member.id = author.member_id
                AND member.status = 'approved'
                AND member.is_sales = 1
               WHERE latest.organization =
                       sales_campaign_targets.organization
                 AND latest.business_round =
                       sales_campaign_targets.business_round
               ORDER BY latest.activity_date DESC, latest.id DESC
               LIMIT 1
             )`,
        )
        .bind(
          AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER,
          AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER,
          AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER,
          AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER,
        ),
      d1
        .prepare(
          `UPDATE activities
           SET progress_manager = ''
           WHERE progress_manager_locked = 0
             AND TRIM(COALESCE(progress_manager, '')) = ?
             AND award_status <> '협력사 수주'
             AND NOT EXISTS (
               SELECT 1
               FROM activities fixed
               WHERE fixed.organization = activities.organization
                 AND fixed.business_round = activities.business_round
                 AND fixed.progress_manager_locked = 1
                 AND TRIM(COALESCE(fixed.progress_manager, '')) = ?
             )
             AND NOT EXISTS (
               SELECT 1
               FROM activity_assignment_history history
               JOIN activities assigned ON assigned.id = history.activity_id
               WHERE assigned.organization = activities.organization
                 AND assigned.business_round = activities.business_round
                 AND TRIM(COALESCE(history.to_manager, '')) = ?
             )
             AND ? = (
               SELECT member.display_name
               FROM activities latest
               JOIN activity_authors author ON author.activity_id = latest.id
               JOIN members member
                 ON member.id = author.member_id
                AND member.status = 'approved'
                AND member.is_sales = 1
               WHERE latest.organization = activities.organization
                 AND latest.business_round = activities.business_round
               ORDER BY latest.activity_date DESC, latest.id DESC
               LIMIT 1
             )`,
        )
        .bind(
          AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER,
          AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER,
          AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER,
          AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER,
        ),
    ]);
    repairedCount = results.reduce(
      (total, result) => total + Number(result.meta?.changes ?? 0),
      0,
    );
  }

  await d1
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, 'completed', CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER_REPAIR_KEY)
    .run();
  return repairedCount;
}

export async function normalizeHistoricalProgressManagers(d1: D1) {
  const registeredNames = await listRegisteredSalesNames(d1);
  if (!registeredNames.length) return [];

  const result = await d1
    .prepare(
      `SELECT DISTINCT progress_manager
       FROM activities
       WHERE TRIM(COALESCE(progress_manager, '')) <> ''`,
    )
    .all<{ progress_manager: string }>();
  const replacements: ProgressManagerReplacement[] = result.results.flatMap(
    (row: { progress_manager: string }): ProgressManagerReplacement[] => {
      const current = cleanName(row.progress_manager);
      const canonical = canonicalProgressManagerName(current, registeredNames);
      return canonical && canonical !== current
        ? [{ current: row.progress_manager, canonical }]
        : [];
    },
  );

  for (let index = 0; index < replacements.length; index += 50) {
    const chunk = replacements.slice(index, index + 50);
    await d1.batch(
      chunk.map(
        ({ current, canonical }: ProgressManagerReplacement) =>
          d1
            .prepare(
              `UPDATE activities
               SET progress_manager = ?
               WHERE progress_manager = ?`,
            )
            .bind(canonical, current),
      ),
    );
  }
  return replacements;
}
