import { getD1, isPostgresDatabase } from "../db";
import type { Member } from "./collaboration";
import {
  cleanBudgetText,
  isBudgetEligibleAwardStatus,
  meaningfulBudgetAmount,
  normalizeBudgetAmountMode,
  normalizeBudgetKind,
  normalizeBudgetSearchKey,
  rankBudgetCatalogCandidates,
  type BudgetAmountMode,
  type BudgetKind,
  type BudgetMatchMethod,
  type BudgetMatchStatus,
} from "./budget-policy";

type D1Database = ReturnType<typeof getD1>;
type BudgetEntityType = "activity" | "equipment_project";
type BudgetRequestStatus = "pending" | "hold" | "rejected" | "approved";

export type BudgetResolution = {
  name: string;
  originalName: string;
  canonicalName: string;
  aliasKey: string;
  groupId: number | null;
  budgetKind: BudgetKind;
  amountMode: BudgetAmountMode;
  matchMethod: BudgetMatchMethod;
  matchStatus: BudgetMatchStatus;
  candidates: Array<{
    groupId: number;
    canonicalName: string;
    budgetKind: BudgetKind;
    amountMode: BudgetAmountMode;
  }>;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS budget_name_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT NOT NULL,
    canonical_key TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    budget_kind TEXT NOT NULL DEFAULT 'unclassified',
    amount_mode TEXT NOT NULL DEFAULT 'manual',
    default_amount INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    disabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS budget_name_groups_active_key_idx
    ON budget_name_groups(canonical_key, active)`,
  `CREATE TABLE IF NOT EXISTS budget_name_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    alias_name TEXT NOT NULL,
    alias_key TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    disabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS budget_name_aliases_group_idx
    ON budget_name_aliases(group_id, active)`,
  `CREATE INDEX IF NOT EXISTS budget_name_aliases_active_key_idx
    ON budget_name_aliases(alias_key, active)`,
  `CREATE TABLE IF NOT EXISTS budget_name_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    alias_key TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unlinked_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS budget_name_members_entity_idx
    ON budget_name_members(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS budget_name_members_group_idx
    ON budget_name_members(group_id, active)`,
  `CREATE TABLE IF NOT EXISTS budget_name_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER,
    action TEXT NOT NULL,
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    request_id TEXT,
    batch_key TEXT NOT NULL DEFAULT '',
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS budget_name_events_group_idx
    ON budget_name_events(group_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS budget_name_requests (
    id TEXT PRIMARY KEY,
    requested_name TEXT NOT NULL,
    requested_key TEXT NOT NULL,
    expected_budget_kind TEXT NOT NULL DEFAULT 'unclassified',
    reason TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '',
    requester_member_id INTEGER NOT NULL,
    requester_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_group_id INTEGER,
    resolution_type TEXT NOT NULL DEFAULT '',
    decision_reason TEXT NOT NULL DEFAULT '',
    decided_by INTEGER,
    decided_by_name TEXT NOT NULL DEFAULT '',
    decided_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS budget_name_requests_status_key_idx
    ON budget_name_requests(status, requested_key, created_at)`,
  `CREATE INDEX IF NOT EXISTS budget_name_requests_requester_idx
    ON budget_name_requests(requester_member_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS budget_name_request_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(request_id, entity_type, entity_id)
  )`,
  `CREATE INDEX IF NOT EXISTS budget_name_request_records_request_idx
    ON budget_name_request_records(request_id, id)`,
  `CREATE INDEX IF NOT EXISTS budget_name_request_records_entity_idx
    ON budget_name_request_records(entity_type, entity_id)`,
];

const additiveBudgetColumns: Record<
  string,
  Array<{ name: string; definition: string }>
> = {
  budget_name_groups: [
    { name: "budget_kind", definition: "TEXT NOT NULL DEFAULT 'unclassified'" },
    { name: "amount_mode", definition: "TEXT NOT NULL DEFAULT 'manual'" },
    { name: "default_amount", definition: "INTEGER" },
    { name: "sort_order", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "updated_by", definition: "INTEGER" },
    { name: "updated_by_name", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "disabled_at", definition: "TEXT" },
  ],
  budget_name_aliases: [
    { name: "created_by", definition: "INTEGER" },
    { name: "created_by_name", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "disabled_at", definition: "TEXT" },
  ],
  budget_name_events: [
    { name: "request_id", definition: "TEXT" },
    { name: "batch_key", definition: "TEXT NOT NULL DEFAULT ''" },
  ],
  activities: [
    { name: "budget_original_name", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "budget_group_id", definition: "INTEGER" },
    {
      name: "budget_match_status",
      definition: "TEXT NOT NULL DEFAULT 'unclassified'",
    },
    {
      name: "budget_match_method",
      definition: "TEXT NOT NULL DEFAULT 'legacy'",
    },
    { name: "budget_request_id", definition: "TEXT" },
    {
      name: "budget_kind",
      definition: "TEXT NOT NULL DEFAULT 'unclassified'",
    },
    {
      name: "budget_amount_mode",
      definition: "TEXT NOT NULL DEFAULT 'manual'",
    },
    {
      name: "budget_amount_override",
      definition: "TEXT NOT NULL DEFAULT ''",
    },
  ],
  equipment_projects: [
    { name: "budget_original_name", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "budget_group_id", definition: "INTEGER" },
    {
      name: "budget_match_status",
      definition: "TEXT NOT NULL DEFAULT 'unclassified'",
    },
    {
      name: "budget_match_method",
      definition: "TEXT NOT NULL DEFAULT 'legacy'",
    },
    { name: "budget_request_id", definition: "TEXT" },
    {
      name: "budget_kind",
      definition: "TEXT NOT NULL DEFAULT 'unclassified'",
    },
  ],
};

async function ensureAdditiveBudgetSchema(d1: D1Database) {
  for (const [table, columns] of Object.entries(additiveBudgetColumns)) {
    const info = await d1
      .prepare(`PRAGMA table_info(${table})`)
      .all<{ name: string }>();
    const existing = new Set((info.results ?? []).map((column) => column.name));
    const missing = columns.filter((column) => !existing.has(column.name));
    for (const column of missing) {
      try {
        await d1
          .prepare(
            `ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.definition}`,
          )
          .run();
      } catch (error) {
        const message =
          error instanceof Error ? error.message.toLowerCase() : String(error);
        if (!message.includes("duplicate column")) throw error;
      }
    }
  }
  await d1.batch([
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS budget_name_events_request_idx
       ON budget_name_events(request_id, created_at)`,
    ),
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS activities_budget_group_idx
       ON activities(budget_group_id, award_status, activity_date, id)`,
    ),
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS activities_budget_request_idx
       ON activities(budget_request_id, id)`,
    ),
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS equipment_projects_budget_group_idx
       ON equipment_projects(budget_group_id, activity_id, id)`,
    ),
  ]);
}

async function backfillBudgetOriginalNames(d1: D1Database) {
  await d1.batch([
    d1.prepare(
      `UPDATE activities
       SET budget_original_name = budget_type
       WHERE TRIM(COALESCE(budget_original_name, '')) = ''
         AND TRIM(COALESCE(budget_type, '')) <> ''`,
    ),
    d1.prepare(
      `UPDATE equipment_projects
       SET budget_original_name = budget_type
       WHERE TRIM(COALESCE(budget_original_name, '')) = ''
         AND TRIM(COALESCE(budget_type, '')) <> ''`,
    ),
  ]);
}

const ignoredBudgetNames = new Set([
  "",
  "-",
  "미정",
  "미등록",
  "없음",
  "해당없음",
  "예산미정",
  "확인필요",
  "예산명미확인",
  "등록되지않은예산명",
]);

const virtualSportsBudgetMigrationAction =
  "system-normalize-virtual-sports-budget-v1";
const virtualSportsCanonicalName = "가상현실스포츠실";
const virtualSportsAliasNames = [virtualSportsCanonicalName, "문체부"];
let budgetNamesReadyPromise: Promise<D1Database> | null = null;

export function normalizeBudgetNameKey(value: unknown) {
  return normalizeBudgetSearchKey(value);
}

export function cleanBudgetName(value: unknown) {
  return cleanBudgetText(value);
}

async function ensureVirtualSportsBudgetGroup(d1: D1Database) {
  const migrated = await d1
    .prepare(
      `SELECT id FROM budget_name_events
       WHERE action = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(virtualSportsBudgetMigrationAction)
    .first<{ id: number }>();
  if (migrated) {
    const resolution = await resolveCanonicalBudgetName(
      d1,
      virtualSportsCanonicalName,
    );
    if (resolution.groupId) {
      await d1
        .prepare(
          `UPDATE budget_name_groups
           SET budget_kind = 'purpose', amount_mode = 'manual',
               updated_by_name = CASE
                 WHEN TRIM(COALESCE(updated_by_name, '')) = ''
                   THEN '시스템'
                 ELSE updated_by_name
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND (
               budget_kind <> 'purpose'
               OR amount_mode <> 'manual'
               OR TRIM(COALESCE(updated_by_name, '')) = ''
             )`,
        )
        .bind(resolution.groupId)
        .run();
    }
    return;
  }

  const targetKeys = Array.from(
    new Set(virtualSportsAliasNames.map(normalizeBudgetNameKey)),
  );
  const existingAliases = await d1
    .prepare(
      `SELECT a.group_id AS groupId, a.alias_key AS aliasKey,
              g.canonical_name AS canonicalName
       FROM budget_name_aliases a
       JOIN budget_name_groups g ON g.id = a.group_id
       WHERE a.active = 1 AND g.active = 1
         AND a.alias_key IN (${placeholders(targetKeys.length)})`,
    )
    .bind(...targetKeys)
    .all<{ groupId: number; aliasKey: string; canonicalName: string }>();
  const existingGroupIds = Array.from(
    new Set(existingAliases.results.map((alias) => Number(alias.groupId))),
  );
  if (existingGroupIds.length > 1) {
    await d1
      .prepare(
        `INSERT INTO budget_name_events
          (group_id, action, snapshot_json, changed_by, changed_by_name)
         VALUES (NULL, ?, ?, 0, '시스템')`,
      )
      .bind(
        virtualSportsBudgetMigrationAction,
        JSON.stringify({
          skipped: "conflicting-groups",
          groupIds: existingGroupIds,
        }),
      )
      .run();
    return;
  }

  let groupId = existingGroupIds[0] ?? null;
  if (!groupId) {
    const canonicalKey = normalizeBudgetNameKey(virtualSportsCanonicalName);
    await d1
      .prepare(
        `INSERT INTO budget_name_groups
          (canonical_name, canonical_key, active, budget_kind, amount_mode,
           created_by, created_by_name, updated_by_name)
         SELECT ?, ?, 1, 'purpose', 'manual', 0, '시스템', '시스템'
         WHERE NOT EXISTS (
           SELECT 1 FROM budget_name_groups
           WHERE active = 1 AND canonical_key = ?
         )
           AND NOT EXISTS (
             SELECT 1 FROM budget_name_aliases
             WHERE active = 1 AND alias_key = ?
           )`,
      )
      .bind(
        virtualSportsCanonicalName,
        canonicalKey,
        canonicalKey,
        canonicalKey,
      )
      .run();
    const inserted = await d1
      .prepare(
        `SELECT id FROM budget_name_groups
         WHERE active = 1 AND canonical_key = ?
         ORDER BY id LIMIT 1`,
      )
      .bind(canonicalKey)
      .first<{ id: number }>();
    groupId = Number(inserted?.id ?? 0);
    if (!groupId) return;
  }
  await d1
    .prepare(
      `UPDATE budget_name_groups
       SET budget_kind = 'purpose', amount_mode = 'manual',
           updated_by_name = CASE
             WHEN TRIM(COALESCE(updated_by_name, '')) = '' THEN '시스템'
             ELSE updated_by_name
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND (
           budget_kind <> 'purpose'
           OR amount_mode <> 'manual'
           OR TRIM(COALESCE(updated_by_name, '')) = ''
         )`,
    )
    .bind(groupId)
    .run();

  const activeAliasKeys = new Set(
    existingAliases.results
      .filter((alias) => Number(alias.groupId) === groupId)
      .map((alias) => alias.aliasKey),
  );
  const aliasesToInsert = virtualSportsAliasNames.filter(
    (name) => !activeAliasKeys.has(normalizeBudgetNameKey(name)),
  );
  if (aliasesToInsert.length) {
    await d1.batch(
      aliasesToInsert.map((name) =>
        d1
          .prepare(
            `INSERT INTO budget_name_aliases
              (group_id, alias_name, alias_key, active)
             VALUES (?, ?, ?, 1)`,
          )
          .bind(groupId, name, normalizeBudgetNameKey(name)),
      ),
    );
  }

  const [activities, projects] = await Promise.all([
    d1
      .prepare(
        `SELECT id, budget_type AS originalName, budget_amount AS budgetAmount
         FROM activities
         WHERE TRIM(budget_type) <> ''
           AND COALESCE(award_status, '미정')
             NOT IN ('협력사 수주', '타업체 수주')`,
      )
      .all<{ id: number; originalName: string; budgetAmount: string }>(),
    d1
      .prepare(
        `SELECT p.id, p.budget_type AS originalName
         FROM equipment_projects p
         LEFT JOIN activities a ON a.id = p.activity_id
         WHERE TRIM(p.budget_type) <> ''
           AND (
             p.activity_id IS NULL
             OR COALESCE(a.award_status, '미정')
               NOT IN ('협력사 수주', '타업체 수주')
           )`,
      )
      .all<{ id: number; originalName: string }>(),
  ]);
  const activityRows = activities.results.filter((row) =>
    targetKeys.includes(normalizeBudgetNameKey(row.originalName)),
  );
  const projectRows = projects.results.filter((row) =>
    targetKeys.includes(normalizeBudgetNameKey(row.originalName)),
  );
  const statements = [
    ...activityRows.map((row) =>
      d1
        .prepare(
          `INSERT INTO budget_name_members
            (group_id, entity_type, entity_id, original_name, alias_key, active)
           VALUES (?, 'activity', ?, ?, ?, 1)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             group_id = excluded.group_id, original_name = excluded.original_name,
             alias_key = excluded.alias_key, active = 1,
             linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL`,
        )
        .bind(
          groupId,
          row.id,
          row.originalName,
          normalizeBudgetNameKey(row.originalName),
        ),
    ),
    ...projectRows.map((row) =>
      d1
        .prepare(
          `INSERT INTO budget_name_members
            (group_id, entity_type, entity_id, original_name, alias_key, active)
           VALUES (?, 'equipment_project', ?, ?, ?, 1)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             group_id = excluded.group_id, original_name = excluded.original_name,
             alias_key = excluded.alias_key, active = 1,
             linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL`,
        )
        .bind(
          groupId,
          row.id,
          row.originalName,
          normalizeBudgetNameKey(row.originalName),
        ),
    ),
    ...activityRows.map((row) =>
      d1
        .prepare(
          `UPDATE activities
           SET budget_type = ?,
               budget_original_name = CASE
                 WHEN TRIM(COALESCE(budget_original_name, '')) = ''
                   THEN ?
                 ELSE budget_original_name
               END,
               budget_group_id = ?,
               budget_match_status = 'auto',
               budget_match_method = CASE
                 WHEN ? = ? THEN 'canonical_exact'
                 ELSE 'alias_exact'
               END,
               budget_kind = 'purpose',
               budget_amount_mode = 'manual',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          virtualSportsCanonicalName,
          row.originalName,
          groupId,
          row.originalName,
          virtualSportsCanonicalName,
          row.id,
        ),
    ),
    ...projectRows.map((row) =>
      d1
        .prepare(
          `UPDATE equipment_projects
           SET budget_type = ?,
               budget_original_name = CASE
                 WHEN TRIM(COALESCE(budget_original_name, '')) = ''
                   THEN ?
                 ELSE budget_original_name
               END,
               budget_group_id = ?,
               budget_match_status = 'auto',
               budget_match_method = CASE
                 WHEN ? = ? THEN 'canonical_exact'
                 ELSE 'alias_exact'
               END,
               budget_kind = 'purpose',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          virtualSportsCanonicalName,
          row.originalName,
          groupId,
          row.originalName,
          virtualSportsCanonicalName,
          row.id,
        ),
    ),
  ];
  await runBudgetStatementsInChunks(d1, statements);
  await d1
    .prepare(
      `INSERT INTO budget_name_events
        (group_id, action, snapshot_json, changed_by, changed_by_name)
       VALUES (?, ?, ?, 0, '시스템')`,
    )
    .bind(
      groupId,
      virtualSportsBudgetMigrationAction,
      JSON.stringify({
        canonicalName: virtualSportsCanonicalName,
        aliases: virtualSportsAliasNames,
        activityIds: activityRows.map((row) => row.id),
        projectIds: projectRows.map((row) => row.id),
      }),
    )
    .run();
}

async function ensureSelfBudgetGroup(d1: D1Database) {
  const aliasKey = normalizeBudgetNameKey("자체예산");
  const matches = await d1
    .prepare(
      `SELECT g.id, g.canonical_name AS canonicalName
       FROM budget_name_groups g
       WHERE g.active = 1 AND g.canonical_key = ?
       UNION
       SELECT g.id, g.canonical_name AS canonicalName
       FROM budget_name_aliases a
       JOIN budget_name_groups g ON g.id = a.group_id
       WHERE a.active = 1 AND g.active = 1 AND a.alias_key = ?`,
    )
    .bind(aliasKey, aliasKey)
    .all<{ id: number; canonicalName: string }>();
  const groupIds = Array.from(
    new Set((matches.results ?? []).map((row) => Number(row.id))),
  );
  if (groupIds.length > 1) return;
  let groupId = groupIds[0] ?? 0;
  if (!groupId) {
    await d1
      .prepare(
        `INSERT INTO budget_name_groups
          (canonical_name, canonical_key, active, budget_kind, amount_mode,
           sort_order, created_by, created_by_name, updated_by_name)
         SELECT '자체예산', ?, 1, 'self', 'quote_auto',
                -100, 0, '시스템', '시스템'
         WHERE NOT EXISTS (
           SELECT 1 FROM budget_name_groups
           WHERE active = 1 AND canonical_key = ?
         )
           AND NOT EXISTS (
             SELECT 1 FROM budget_name_aliases
             WHERE active = 1 AND alias_key = ?
           )`,
      )
      .bind(aliasKey, aliasKey, aliasKey)
      .run();
    const inserted = await d1
      .prepare(
        `SELECT id FROM budget_name_groups
         WHERE active = 1 AND canonical_key = ?
         ORDER BY id LIMIT 1`,
      )
      .bind(aliasKey)
      .first<{ id: number }>();
    groupId = Number(inserted?.id ?? 0);
    if (!groupId) return;
  } else {
    await d1
      .prepare(
        `UPDATE budget_name_groups
         SET budget_kind = 'self', amount_mode = 'quote_auto',
             updated_by_name = CASE
               WHEN TRIM(COALESCE(updated_by_name, '')) = '' THEN '시스템'
               ELSE updated_by_name
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND (
             budget_kind <> 'self'
             OR amount_mode <> 'quote_auto'
             OR TRIM(COALESCE(updated_by_name, '')) = ''
           )`,
      )
      .bind(groupId)
      .run();
  }
  await d1
    .prepare(
      `INSERT INTO budget_name_aliases
        (group_id, alias_name, alias_key, active, created_by, created_by_name)
       SELECT ?, '자체예산', ?, 1, 0, '시스템'
       WHERE NOT EXISTS (
         SELECT 1 FROM budget_name_aliases
         WHERE active = 1 AND alias_key = ?
       )`,
    )
    .bind(groupId, aliasKey, aliasKey)
    .run();
}

async function ensureKnownPurposeBudgetGroups(d1: D1Database) {
  const knownKeys = [
    normalizeBudgetNameKey("지능형 과학실"),
    normalizeBudgetNameKey("공간재구조화"),
    normalizeBudgetNameKey(virtualSportsCanonicalName),
  ];
  await d1
    .prepare(
      `UPDATE budget_name_groups
       SET budget_kind = 'purpose', amount_mode = 'manual',
           updated_by_name = CASE
             WHEN TRIM(COALESCE(updated_by_name, '')) = '' THEN '시스템'
             ELSE updated_by_name
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE active = 1
         AND (
           budget_kind <> 'purpose'
           OR amount_mode <> 'manual'
           OR TRIM(COALESCE(updated_by_name, '')) = ''
         )
         AND (
           canonical_key IN (${placeholders(knownKeys.length)})
           OR id IN (
             SELECT group_id FROM budget_name_aliases
             WHERE active = 1
               AND alias_key IN (${placeholders(knownKeys.length)})
           )
         )`,
    )
    .bind(...knownKeys, ...knownKeys)
    .run();
}

async function ensureExactBudgetRetrofit(d1: D1Database) {
  const action = "system-standard-budget-retrofit-v1";
  const completed = await d1
    .prepare(
      `SELECT id FROM budget_name_events
       WHERE action = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(action)
    .first<{ id: number }>();
  if (completed) return;
  const [activitiesResult, projectsResult] = await Promise.all([
    d1
      .prepare(
        `SELECT a.id, a.budget_type AS budgetType,
                COALESCE(NULLIF(TRIM(m.original_name), ''),
                         a.budget_original_name) AS budgetOriginalName,
                a.budget_amount AS budgetAmount,
                a.budget_amount_override AS budgetAmountOverride
         FROM activities a
         LEFT JOIN budget_name_members m
           ON m.entity_type = 'activity'
          AND m.entity_id = a.id
          AND m.active = 1
         WHERE TRIM(COALESCE(a.budget_type, '')) <> ''
           AND COALESCE(a.award_status, '미정')
             NOT IN ('협력사 수주', '타업체 수주')`,
      )
      .all<Record<string, unknown>>(),
    d1
      .prepare(
        `SELECT p.id, p.budget_type AS budgetType,
                COALESCE(NULLIF(TRIM(m.original_name), ''),
                         p.budget_original_name) AS budgetOriginalName
         FROM equipment_projects p
         LEFT JOIN activities a ON a.id = p.activity_id
         LEFT JOIN budget_name_members m
           ON m.entity_type = 'equipment_project'
          AND m.entity_id = p.id
          AND m.active = 1
         WHERE TRIM(COALESCE(p.budget_type, '')) <> ''
           AND (
             p.activity_id IS NULL
             OR COALESCE(a.award_status, '미정')
               NOT IN ('협력사 수주', '타업체 수주')
           )`,
      )
      .all<Record<string, unknown>>(),
  ]);
  const allRows = [
    ...(activitiesResult.results ?? []),
    ...(projectsResult.results ?? []),
  ];
  const distinctNames = Array.from(
    new Set(allRows.map((row) => cleanBudgetName(row.budgetType)).filter(Boolean)),
  );
  const resolutions = new Map<string, BudgetResolution>();
  await Promise.all(
    distinctNames.map(async (name) => {
      resolutions.set(name, await resolveCanonicalBudgetName(d1, name));
    }),
  );
  const autoActivities = (activitiesResult.results ?? []).filter(
    (row) => resolutions.get(cleanBudgetName(row.budgetType))?.groupId,
  );
  const autoProjects = (projectsResult.results ?? []).filter(
    (row) => resolutions.get(cleanBudgetName(row.budgetType))?.groupId,
  );
  const statements = [];
  for (const row of autoActivities) {
    const resolution = resolutions.get(cleanBudgetName(row.budgetType));
    if (!resolution?.groupId) continue;
    const originalName =
      cleanBudgetName(row.budgetOriginalName) ||
      cleanBudgetName(row.budgetType);
    const manualValue =
      meaningfulBudgetAmount(row.budgetAmountOverride) ||
      meaningfulBudgetAmount(row.budgetAmount);
    const amountMode =
      resolution.budgetKind === "self" && !manualValue
        ? resolution.amountMode
        : "manual";
    statements.push(
      d1
        .prepare(
          `UPDATE activities
           SET budget_type = ?, budget_original_name = ?,
               budget_group_id = ?, budget_match_status = 'auto',
               budget_match_method = ?, budget_kind = ?,
               budget_amount_mode = ?,
               budget_amount_override = CASE
                 WHEN ? = 'manual'
                   THEN COALESCE(NULLIF(TRIM(budget_amount_override), ''),
                                 NULLIF(TRIM(budget_amount), ''), '')
                 ELSE budget_amount_override
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          resolution.canonicalName,
          originalName,
          resolution.groupId,
          resolution.matchMethod,
          resolution.budgetKind,
          amountMode,
          amountMode,
          Number(row.id),
        ),
      d1
        .prepare(
          `INSERT INTO budget_name_members
            (group_id, entity_type, entity_id, original_name, alias_key, active,
             linked_at, unlinked_at)
           VALUES (?, 'activity', ?, ?, ?, 1, CURRENT_TIMESTAMP, NULL)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             group_id = excluded.group_id,
             original_name = excluded.original_name,
             alias_key = excluded.alias_key,
             active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL`,
        )
        .bind(
          resolution.groupId,
          Number(row.id),
          originalName,
          normalizeBudgetNameKey(originalName),
        ),
    );
  }
  for (const row of autoProjects) {
    const resolution = resolutions.get(cleanBudgetName(row.budgetType));
    if (!resolution?.groupId) continue;
    const originalName =
      cleanBudgetName(row.budgetOriginalName) ||
      cleanBudgetName(row.budgetType);
    statements.push(
      d1
        .prepare(
          `UPDATE equipment_projects
           SET budget_type = ?, budget_original_name = ?,
               budget_group_id = ?, budget_match_status = 'auto',
               budget_match_method = ?, budget_kind = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          resolution.canonicalName,
          originalName,
          resolution.groupId,
          resolution.matchMethod,
          resolution.budgetKind,
          Number(row.id),
        ),
      d1
        .prepare(
          `INSERT INTO budget_name_members
            (group_id, entity_type, entity_id, original_name, alias_key, active,
             linked_at, unlinked_at)
           VALUES (?, 'equipment_project', ?, ?, ?, 1, CURRENT_TIMESTAMP, NULL)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             group_id = excluded.group_id,
             original_name = excluded.original_name,
             alias_key = excluded.alias_key,
             active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL`,
        )
        .bind(
          resolution.groupId,
          Number(row.id),
          originalName,
          normalizeBudgetNameKey(originalName),
        ),
    );
  }
  await runBudgetStatementsInChunks(d1, statements);
  const ambiguousNames = distinctNames.filter(
    (name) => resolutions.get(name)?.matchStatus === "review",
  );
  const unclassifiedNames = distinctNames.filter(
    (name) => resolutions.get(name)?.matchStatus === "unclassified",
  );
  await d1
    .prepare(
      `INSERT INTO budget_name_events
        (group_id, action, snapshot_json, batch_key,
         changed_by, changed_by_name)
       VALUES (NULL, ?, ?, ?, 0, '시스템')`,
    )
    .bind(
      action,
      JSON.stringify({
        summary:
          `기존 예산명 자동 연결: 영업 ${autoActivities.length}건 · ` +
          `사업 ${autoProjects.length}건 · 확인 필요 이름 ${ambiguousNames.length}개 · ` +
          `미분류 이름 ${unclassifiedNames.length}개`,
        counts: {
          activities: autoActivities.length,
          projects: autoProjects.length,
          reviewNames: ambiguousNames.length,
          unclassifiedNames: unclassifiedNames.length,
        },
        activityIds: autoActivities.map((row) => Number(row.id)),
        projectIds: autoProjects.map((row) => Number(row.id)),
        ambiguousNames,
        unclassifiedNames,
        preservedFinancialFields: [
          "budget_amount",
          "commission_collections",
          "equipment_items",
          "equipment_projects.construction_amount",
        ],
      }),
      `retrofit-${Date.now()}`,
    )
    .run();
}

async function initializeBudgetNames() {
  const d1 = getD1();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  await ensureAdditiveBudgetSchema(d1);
  // The standby PostgreSQL database receives already-normalized rows from the
  // primary Sites backup. Re-running the primary D1/SQLite data retrofits here
  // can both mutate replicated data and execute SQLite-only expressions.
  // Keep schema checks above, but leave one-time data repair to the primary.
  if (isPostgresDatabase()) return d1;
  await backfillBudgetOriginalNames(d1);
  await ensureSelfBudgetGroup(d1);
  await ensureKnownPurposeBudgetGroups(d1);
  await ensureVirtualSportsBudgetGroup(d1);
  await ensureExactBudgetRetrofit(d1);
  await d1
    .prepare(
      `UPDATE activities
       SET budget_amount = CAST((
             SELECT g.default_amount
             FROM budget_name_groups g
             WHERE g.id = activities.budget_group_id
               AND g.active = 1
               AND g.amount_mode = 'manual'
               AND g.default_amount > 0
           ) AS TEXT),
           updated_at = CURRENT_TIMESTAMP
       WHERE COALESCE(budget_amount, '') NOT GLOB '*[0-9]*'
         AND COALESCE(budget_amount_override, '') NOT GLOB '*[0-9]*'
         AND COALESCE(award_status, '誘몄젙')
           NOT IN ('?묐젰???섏＜', '??낆껜 ?섏＜')
         AND EXISTS (
           SELECT 1
           FROM budget_name_groups g
           WHERE g.id = activities.budget_group_id
             AND g.active = 1
             AND g.amount_mode = 'manual'
             AND g.default_amount > 0
         )`,
    )
    .run();
  return d1;
}

export function ensureBudgetNamesReady() {
  if (!budgetNamesReadyPromise) {
    budgetNamesReadyPromise = initializeBudgetNames().catch((error) => {
      budgetNamesReadyPromise = null;
      throw error;
    });
  }
  return budgetNamesReadyPromise;
}

export async function resolveCanonicalBudgetName(
  d1: D1Database,
  value: unknown,
): Promise<BudgetResolution> {
  const originalName = cleanBudgetName(value);
  const aliasKey = normalizeBudgetNameKey(originalName);
  if (!aliasKey || ignoredBudgetNames.has(aliasKey)) {
    return {
      name: originalName,
      originalName,
      canonicalName: "",
      aliasKey,
      groupId: null,
      budgetKind: "unclassified",
      amountMode: "manual",
      matchMethod: "unknown",
      matchStatus: "unclassified",
      candidates: [],
    };
  }

  const matches = await d1
    .prepare(
      `SELECT g.id AS groupId, g.canonical_name AS canonicalName,
              g.budget_kind AS budgetKind, g.amount_mode AS amountMode,
              g.canonical_name AS matchedName, 'canonical' AS matchedSource
       FROM budget_name_groups g
       WHERE g.active = 1 AND g.canonical_key = ?
       UNION ALL
       SELECT g.id AS groupId, g.canonical_name AS canonicalName,
              g.budget_kind AS budgetKind, g.amount_mode AS amountMode,
              a.alias_name AS matchedName, 'alias' AS matchedSource
       FROM budget_name_aliases a
       JOIN budget_name_groups g ON g.id = a.group_id
       WHERE a.active = 1 AND g.active = 1 AND a.alias_key = ?
       ORDER BY groupId`,
    )
    .bind(aliasKey, aliasKey)
    .all<{
      groupId: number;
      canonicalName: string;
      budgetKind: string;
      amountMode: string;
      matchedName: string;
      matchedSource: "canonical" | "alias";
    }>();
  const unique = new Map<
    number,
    {
      groupId: number;
      canonicalName: string;
      budgetKind: BudgetKind;
      amountMode: BudgetAmountMode;
      exactCanonical: boolean;
      exactAlias: boolean;
    }
  >();
  for (const match of matches.results ?? []) {
    const groupId = Number(match.groupId);
    const current = unique.get(groupId) ?? {
      groupId,
      canonicalName: cleanBudgetName(match.canonicalName),
      budgetKind: normalizeBudgetKind(match.budgetKind),
      amountMode: normalizeBudgetAmountMode(match.amountMode),
      exactCanonical: false,
      exactAlias: false,
    };
    if (
      match.matchedSource === "canonical" &&
      cleanBudgetName(match.matchedName) === originalName
    ) {
      current.exactCanonical = true;
    }
    if (
      match.matchedSource === "alias" &&
      cleanBudgetName(match.matchedName) === originalName
    ) {
      current.exactAlias = true;
    }
    unique.set(groupId, current);
  }
  const candidates = [...unique.values()].map((match) => ({
    groupId: match.groupId,
    canonicalName: match.canonicalName,
    budgetKind: match.budgetKind,
    amountMode: match.amountMode,
  }));
  if (unique.size !== 1) {
    return {
      name: originalName,
      originalName,
      canonicalName: "",
      aliasKey,
      groupId: null,
      budgetKind: "unclassified",
      amountMode: "manual",
      matchMethod: unique.size > 1 ? "ambiguous" : "none",
      matchStatus: unique.size > 1 ? "review" : "unclassified",
      candidates,
    };
  }
  const match = [...unique.values()][0];
  const matchMethod: BudgetMatchMethod = match.exactCanonical
    ? "canonical_exact"
    : match.exactAlias
      ? "alias_exact"
      : "normalized";
  return {
    name: match.canonicalName,
    originalName,
    canonicalName: match.canonicalName,
    aliasKey,
    groupId: match.groupId,
    budgetKind: match.budgetKind,
    amountMode: match.amountMode,
    matchMethod,
    matchStatus: "auto",
    candidates,
  };
}

export async function isBudgetEntityEligible(
  d1: D1Database,
  entityType: BudgetEntityType,
  entityId: number,
) {
  if (entityType === "activity") {
    const row = await d1
      .prepare(`SELECT award_status AS awardStatus FROM activities WHERE id = ?`)
      .bind(entityId)
      .first<{ awardStatus: string }>();
    return Boolean(row && isBudgetEligibleAwardStatus(row.awardStatus));
  }
  const row = await d1
    .prepare(
      `SELECT p.id, p.activity_id AS activityId,
              COALESCE(a.award_status, '미정') AS awardStatus
       FROM equipment_projects p
       LEFT JOIN activities a ON a.id = p.activity_id
       WHERE p.id = ?`,
    )
    .bind(entityId)
    .first<{ id: number; activityId: number | null; awardStatus: string }>();
  return Boolean(
    row &&
      (row.activityId === null ||
        isBudgetEligibleAwardStatus(row.awardStatus)),
  );
}

export async function linkBudgetNameEntity(
  d1: D1Database,
  input: {
    entityType: BudgetEntityType;
    entityId: number;
    groupId: number | null;
    originalName: string;
    aliasKey: string;
  },
) {
  const eligible = await isBudgetEntityEligible(
    d1,
    input.entityType,
    input.entityId,
  );
  if (!input.groupId || !eligible) {
    await d1
      .prepare(
        `UPDATE budget_name_members
         SET active = 0, unlinked_at = CURRENT_TIMESTAMP
         WHERE entity_type = ? AND entity_id = ? AND active = 1`,
      )
      .bind(input.entityType, input.entityId)
      .run();
    if (!eligible) {
      await d1
        .prepare(
          input.entityType === "activity"
            ? `UPDATE activities
               SET budget_group_id = NULL,
                   budget_match_status = 'unclassified',
                   budget_match_method = 'none',
                   budget_kind = 'unclassified',
                   budget_request_id = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`
            : `UPDATE equipment_projects
               SET budget_group_id = NULL,
                   budget_match_status = 'unclassified',
                   budget_match_method = 'none',
                   budget_kind = 'unclassified',
                   budget_request_id = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
        )
        .bind(input.entityId)
        .run();
    }
    return false;
  }
  await d1
    .prepare(
      `INSERT INTO budget_name_members
        (group_id, entity_type, entity_id, original_name, alias_key, active, linked_at, unlinked_at)
       VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, NULL)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         group_id = excluded.group_id,
         original_name = excluded.original_name,
         alias_key = excluded.alias_key,
         active = 1,
         linked_at = CURRENT_TIMESTAMP,
         unlinked_at = NULL`,
    )
    .bind(
      input.groupId,
      input.entityType,
      input.entityId,
      input.originalName,
      input.aliasKey,
    )
    .run();
  return true;
}

async function readActiveBudgetGroup(
  d1: D1Database,
  groupId: number,
) {
  return d1
    .prepare(
      `SELECT id, canonical_name AS canonicalName,
              budget_kind AS budgetKind, amount_mode AS amountMode,
              default_amount AS defaultAmount
       FROM budget_name_groups
       WHERE id = ? AND active = 1`,
    )
    .bind(groupId)
    .first<{
      id: number;
      canonicalName: string;
      budgetKind: string;
      amountMode: string;
      defaultAmount: number | null;
    }>();
}

function standardDefaultBudgetAmount(
  group: { defaultAmount?: number | null } | null | undefined,
  amountMode: BudgetAmountMode,
) {
  const amount = Number(group?.defaultAmount);
  return amountMode === "manual" && Number.isSafeInteger(amount) && amount > 0
    ? String(amount)
    : "";
}

export async function resolveBudgetRecordMetadata(
  d1: D1Database,
  input: {
    budgetType?: unknown;
    budgetOriginalName?: unknown;
    budgetGroupId?: unknown;
    budgetMatchStatus?: unknown;
    budgetMatchMethod?: unknown;
    budgetRequestId?: unknown;
    budgetNameRequestId?: unknown;
    budgetKind?: unknown;
    budgetAmountMode?: unknown;
    budgetAmount?: unknown;
    budgetInstitutionAmount?: unknown;
    budgetAmountOverride?: unknown;
    budgetOverrideAmount?: unknown;
    budgetAmountSource?: unknown;
    awardStatus?: unknown;
  },
) {
  const originalName =
    cleanBudgetName(input.budgetOriginalName) ||
    cleanBudgetName(input.budgetType);
  const eligible = isBudgetEligibleAwardStatus(input.awardStatus);
  const incomingAmount = meaningfulBudgetAmount(input.budgetAmount);
  const institutionAmount = meaningfulBudgetAmount(
    input.budgetInstitutionAmount ?? input.budgetAmount,
  );
  const incomingOverride = meaningfulBudgetAmount(
    input.budgetAmountOverride ?? input.budgetOverrideAmount,
  );
  const amountSource = cleanBudgetName(input.budgetAmountSource);
  const explicitAutomaticSource =
    amountSource === "auto" || amountSource === "missing";
  const manualValue =
    incomingOverride ||
    (amountSource === "manual" ? incomingAmount : "") ||
    (!amountSource ? institutionAmount : "");
  const selectedGroupId = Number(input.budgetGroupId);
  const requestId = cleanBudgetName(
    input.budgetRequestId ?? input.budgetNameRequestId,
  );

  if (!eligible) {
    return {
      storedName: originalName,
      budgetOriginalName: originalName,
      budgetGroupId: null,
      budgetMatchStatus: "unclassified" as const,
      budgetMatchMethod: "none" as const,
      budgetRequestId: null,
      budgetKind: "unclassified" as const,
      budgetAmountMode: "manual" as const,
      budgetAmount: institutionAmount,
      budgetAmountOverride: incomingOverride || incomingAmount,
      resolution: null,
    };
  }

  if (requestId) {
    const request = await d1
      .prepare(
        `SELECT id, requested_name AS requestedName,
                expected_budget_kind AS expectedKind, status,
                resolved_group_id AS resolvedGroupId
         FROM budget_name_requests WHERE id = ?`,
      )
      .bind(requestId)
      .first<{
        id: string;
        requestedName: string;
        expectedKind: string;
        status: BudgetRequestStatus;
        resolvedGroupId: number | null;
      }>();
    if (!request) throw new Error("새 예산명 신청 내역을 찾을 수 없습니다.");
    if (request.status === "approved" && request.resolvedGroupId) {
      const group = await readActiveBudgetGroup(d1, request.resolvedGroupId);
      if (group) {
        const budgetKind = normalizeBudgetKind(group.budgetKind);
        const defaultMode = normalizeBudgetAmountMode(group.amountMode);
        const explicitMode = cleanBudgetName(input.budgetAmountMode);
        const amountMode =
          budgetKind === "purpose"
            ? "manual"
            : explicitMode
              ? normalizeBudgetAmountMode(explicitMode, defaultMode)
              : manualValue && !explicitAutomaticSource
                ? "manual"
                : defaultMode;
        const resolvedAmount =
          institutionAmount ||
          standardDefaultBudgetAmount(group, amountMode);
        return {
          storedName: group.canonicalName,
          budgetOriginalName: originalName || request.requestedName,
          budgetGroupId: group.id,
          budgetMatchStatus: "auto" as const,
          budgetMatchMethod: "employee_request" as const,
          budgetRequestId: request.id,
          budgetKind,
          budgetAmountMode: amountMode,
          budgetAmount: resolvedAmount,
          budgetAmountOverride:
            amountMode === "manual"
              ? manualValue
              : incomingOverride,
          resolution: null,
        };
      }
    }
    if (request.status === "rejected") {
      throw new Error("반려된 예산명 신청은 새 기록에 사용할 수 없습니다.");
    }
    const budgetKind = normalizeBudgetKind(request.expectedKind);
    return {
      storedName: request.requestedName,
      budgetOriginalName: originalName || request.requestedName,
      budgetGroupId: null,
      budgetMatchStatus: "pending" as const,
      budgetMatchMethod: "employee_request" as const,
      budgetRequestId: request.id,
      budgetKind,
      budgetAmountMode:
        budgetKind === "self"
          ? normalizeBudgetAmountMode(input.budgetAmountMode, "quote_auto")
          : "manual",
      budgetAmount: institutionAmount,
      budgetAmountOverride: incomingOverride || incomingAmount,
      resolution: null,
    };
  }

  if (Number.isInteger(selectedGroupId) && selectedGroupId > 0) {
    const group = await readActiveBudgetGroup(d1, selectedGroupId);
    if (!group) throw new Error("선택한 표준 예산명이 비활성화되었거나 없습니다.");
    const budgetKind = normalizeBudgetKind(group.budgetKind);
    const defaultMode = normalizeBudgetAmountMode(group.amountMode);
    const explicitMode = cleanBudgetName(input.budgetAmountMode);
    const amountMode =
      budgetKind === "purpose"
        ? "manual"
        : explicitMode
          ? normalizeBudgetAmountMode(explicitMode, defaultMode)
          : manualValue && !explicitAutomaticSource
            ? "manual"
            : defaultMode;
    const resolvedAmount =
      institutionAmount ||
      standardDefaultBudgetAmount(group, amountMode);
    return {
      storedName: group.canonicalName,
      budgetOriginalName: originalName || group.canonicalName,
      budgetGroupId: group.id,
      budgetMatchStatus: "auto" as const,
      budgetMatchMethod: "selected" as const,
      budgetRequestId: null,
      budgetKind,
      budgetAmountMode: amountMode,
      budgetAmount: resolvedAmount,
      budgetAmountOverride:
        amountMode === "manual"
          ? manualValue
          : incomingOverride,
      resolution: null,
    };
  }

  const resolution = await resolveCanonicalBudgetName(d1, originalName);
  if (!resolution.groupId) {
    return {
      storedName: originalName,
      budgetOriginalName: originalName,
      budgetGroupId: null,
      budgetMatchStatus: resolution.matchStatus,
      budgetMatchMethod: resolution.matchMethod,
      budgetRequestId: null,
      budgetKind: "unclassified" as const,
      budgetAmountMode: "manual" as const,
      budgetAmount: institutionAmount,
      budgetAmountOverride: incomingOverride || incomingAmount,
      resolution,
    };
  }
  const budgetKind = resolution.budgetKind;
  const explicitMode = cleanBudgetName(input.budgetAmountMode);
  const amountMode =
    budgetKind === "purpose"
      ? "manual"
      : explicitMode
        ? normalizeBudgetAmountMode(explicitMode, resolution.amountMode)
      : manualValue && !explicitAutomaticSource
        ? "manual"
        : resolution.amountMode;
  const resolvedGroup = await readActiveBudgetGroup(d1, resolution.groupId);
  const resolvedAmount =
    institutionAmount ||
    standardDefaultBudgetAmount(resolvedGroup, amountMode);
  return {
    storedName: resolution.name,
    budgetOriginalName: originalName,
    budgetGroupId: resolution.groupId,
    budgetMatchStatus: resolution.matchStatus,
    budgetMatchMethod: resolution.matchMethod,
    budgetRequestId: null,
    budgetKind,
    budgetAmountMode: amountMode,
    budgetAmount: resolvedAmount,
    budgetAmountOverride:
      amountMode === "manual"
        ? manualValue
        : incomingOverride,
    resolution,
  };
}

export async function linkBudgetRequestRecord(
  d1: D1Database,
  input: {
    requestId: unknown;
    entityType: BudgetEntityType;
    entityId: number;
    originalName: unknown;
    organization?: unknown;
  },
) {
  const requestId = cleanBudgetName(input.requestId);
  if (!requestId) return false;
  const request = await d1
    .prepare(
      `SELECT id, requested_name AS requestedName, status
       FROM budget_name_requests WHERE id = ?`,
    )
    .bind(requestId)
    .first<{ id: string; requestedName: string; status: BudgetRequestStatus }>();
  if (!request || request.status === "rejected") return false;
  if (!(await isBudgetEntityEligible(d1, input.entityType, input.entityId))) {
    return false;
  }
  await d1
    .prepare(
      `INSERT INTO budget_name_request_records
        (request_id, entity_type, entity_id, original_name, organization)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(request_id, entity_type, entity_id) DO UPDATE SET
         original_name = excluded.original_name,
         organization = excluded.organization`,
    )
    .bind(
      request.id,
      input.entityType,
      input.entityId,
      cleanBudgetName(input.originalName) || request.requestedName,
      cleanBudgetName(input.organization),
    )
    .run();
  return true;
}

async function writeBudgetEvent(
  d1: D1Database,
  member: Member,
  action: string,
  groupId: number | null,
  snapshot: unknown,
  options?: { requestId?: string | null; batchKey?: string },
) {
  await d1
    .prepare(
      `INSERT INTO budget_name_events
        (group_id, action, snapshot_json, request_id, batch_key,
         changed_by, changed_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      groupId,
      action,
      JSON.stringify(snapshot),
      options?.requestId ?? null,
      options?.batchKey ?? "",
      member.id,
      member.displayName,
    )
    .run();
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function budgetMemberIds(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  ).slice(0, 100);
}

async function runBudgetStatementsInChunks(
  d1: D1Database,
  statements: Array<ReturnType<D1Database["prepare"]>>,
  chunkSize = 40,
) {
  for (let start = 0; start < statements.length; start += chunkSize) {
    await d1.batch(statements.slice(start, start + chunkSize));
  }
}

export async function listBudgetNameManagement() {
  const d1 = await ensureBudgetNamesReady();
  const [
    namesResult,
    groupsResult,
    aliasesResult,
    membersResult,
    requestRowsResult,
    requestRecordsResult,
    eventsResult,
  ] =
    await Promise.all([
      d1
        .prepare(
          `WITH activity_counts AS (
             SELECT budget_type AS name, COUNT(*) AS activityCount
             FROM activities
             WHERE TRIM(budget_type) <> ''
               AND COALESCE(award_status, '미정')
                 NOT IN ('협력사 수주', '타업체 수주')
               AND budget_group_id IS NULL
               AND COALESCE(budget_match_status, 'unclassified')
                 IN ('review', 'unclassified', 'legacy')
             GROUP BY budget_type
           ),
           project_counts AS (
             SELECT p.budget_type AS name, COUNT(*) AS projectCount
             FROM equipment_projects p
             LEFT JOIN activities a ON a.id = p.activity_id
             WHERE TRIM(p.budget_type) <> ''
               AND (
                 p.activity_id IS NULL
                 OR COALESCE(a.award_status, '미정')
                   NOT IN ('협력사 수주', '타업체 수주')
               )
               AND p.budget_group_id IS NULL
               AND COALESCE(p.budget_match_status, 'unclassified')
                 IN ('review', 'unclassified', 'legacy')
             GROUP BY p.budget_type
           ),
           all_budget_names AS (
             SELECT name FROM activity_counts
             UNION
             SELECT name FROM project_counts
           )
           SELECT budget.name,
                  COALESCE(activity.activityCount, 0) AS activityCount,
                  COALESCE(project.projectCount, 0) AS projectCount
           FROM all_budget_names budget
           LEFT JOIN activity_counts activity ON activity.name = budget.name
           LEFT JOIN project_counts project ON project.name = budget.name
           ORDER BY
             (COALESCE(activity.activityCount, 0) +
               COALESCE(project.projectCount, 0)) DESC,
             budget.name`,
        )
        .all<{ name: string; activityCount: number; projectCount: number }>(),
      d1
        .prepare(
          `SELECT id, canonical_name AS canonicalName, canonical_key AS canonicalKey,
                  budget_kind AS budgetKind, amount_mode AS amountMode,
                  default_amount AS defaultAmount,
                  active, sort_order AS sortOrder,
                  created_by_name AS createdByName, created_at AS createdAt,
                  updated_at AS updatedAt
           FROM budget_name_groups
           ORDER BY active DESC, sort_order, canonical_name, id`,
        )
        .all<{
          id: number;
          canonicalName: string;
          canonicalKey: string;
          budgetKind: string;
          amountMode: string;
          defaultAmount: number | null;
          active: number;
          sortOrder: number;
          createdByName: string;
          createdAt: string;
          updatedAt: string;
        }>(),
      d1
        .prepare(
          `SELECT id, group_id AS groupId, alias_name AS aliasName,
                  alias_key AS aliasKey
           FROM budget_name_aliases WHERE active = 1
           ORDER BY group_id, id`,
        )
        .all<{ id: number; groupId: number; aliasName: string; aliasKey: string }>(),
      d1
        .prepare(
          `SELECT m.id, m.group_id AS groupId, m.entity_type AS entityType,
                  m.entity_id AS entityId, m.original_name AS originalName,
                  m.alias_key AS aliasKey,
                  CASE
                    WHEN m.entity_type = 'activity' THEN a.id
                    ELSE p.activity_id
                  END AS activityId,
                  CASE
                    WHEN m.entity_type = 'activity' THEN a.organization
                    ELSE p.organization
                  END AS organization,
                  CASE
                    WHEN m.entity_type = 'activity' THEN a.activity_date
                    ELSE COALESCE(pa.activity_date, '')
                  END AS activityDate,
                  CASE
                    WHEN m.entity_type = 'activity' THEN a.business_round
                    ELSE COALESCE(pa.business_round, 1)
                  END AS businessRound,
                  CASE
                    WHEN m.entity_type = 'activity' THEN a.topic
                    ELSE p.name
                  END AS recordName,
                  CASE
                    WHEN m.entity_type = 'activity' THEN a.progress_manager
                    ELSE COALESCE(pa.progress_manager, '')
                  END AS progressManager
           FROM budget_name_members m
           LEFT JOIN activities a
             ON m.entity_type = 'activity' AND a.id = m.entity_id
           LEFT JOIN equipment_projects p
             ON m.entity_type = 'equipment_project' AND p.id = m.entity_id
           LEFT JOIN activities pa ON pa.id = p.activity_id
           WHERE m.active = 1
             AND (
               (m.entity_type = 'activity' AND EXISTS (
                 SELECT 1 FROM activities a
                 WHERE a.id = m.entity_id
                   AND COALESCE(a.award_status, '미정')
                     NOT IN ('협력사 수주', '타업체 수주')
               ))
               OR
               (m.entity_type = 'equipment_project' AND EXISTS (
                 SELECT 1
                 FROM equipment_projects p
                 LEFT JOIN activities a ON a.id = p.activity_id
                 WHERE p.id = m.entity_id
                   AND (
                     p.activity_id IS NULL
                     OR COALESCE(a.award_status, '미정')
                       NOT IN ('협력사 수주', '타업체 수주')
                   )
               ))
             )
           ORDER BY m.group_id, m.id DESC`,
        )
        .all<{
          id: number;
          groupId: number;
          entityType: BudgetEntityType;
          entityId: number;
          activityId: number | null;
          originalName: string;
          aliasKey: string;
          organization: string;
          activityDate: string;
          businessRound: number;
          recordName: string;
          progressManager: string;
        }>(),
      d1
        .prepare(
          `SELECT r.id, r.requested_name AS requestedName,
                  r.requested_key AS requestedKey,
                  r.expected_budget_kind AS expectedKind,
                  r.reason, r.organization,
                  r.requester_member_id AS requesterMemberId,
                  r.requester_name AS requesterName,
                  r.status, r.resolved_group_id AS resolvedGroupId,
                  r.resolution_type AS resolutionType,
                  r.decision_reason AS decisionReason,
                  r.created_at AS createdAt, r.updated_at AS updatedAt
           FROM budget_name_requests r
           ORDER BY
             CASE r.status WHEN 'pending' THEN 0 WHEN 'hold' THEN 1 ELSE 2 END,
             r.created_at DESC`,
        )
        .all<Record<string, unknown>>(),
      d1
        .prepare(
          `SELECT rr.request_id AS requestId, rr.entity_type AS entityType,
                  rr.entity_id AS entityId, rr.original_name AS originalName,
                  rr.organization, rr.created_at AS createdAt
           FROM budget_name_request_records rr
           ORDER BY rr.id DESC`,
        )
        .all<Record<string, unknown>>(),
      d1
        .prepare(
          `SELECT id, group_id AS groupId, action, snapshot_json AS snapshotJson,
                  request_id AS requestId, batch_key AS batchKey,
                  changed_by_name AS changedByName, created_at AS createdAt
           FROM budget_name_events
           ORDER BY id DESC LIMIT 200`,
        )
        .all<Record<string, unknown>>(),
    ]);

  const names = (namesResult.results ?? []) as Array<{
    name: string;
    activityCount: number;
    projectCount: number;
  }>;
  const groups = (groupsResult.results ?? []) as Array<{
    id: number;
    canonicalName: string;
    canonicalKey: string;
    budgetKind: string;
    amountMode: string;
    active: number;
    sortOrder: number;
    createdByName: string;
    createdAt: string;
    updatedAt: string;
  }>;
  const aliases = (aliasesResult.results ?? []) as Array<{
    id: number;
    groupId: number;
    aliasName: string;
    aliasKey: string;
  }>;
  const members = (membersResult.results ?? []) as Array<{
    id: number;
    groupId: number;
    entityType: BudgetEntityType;
    entityId: number;
    activityId: number | null;
    originalName: string;
    aliasKey: string;
  }>;
  const aliasesByGroup = new Map<number, typeof aliases>();
  for (const alias of aliases) {
    const values = aliasesByGroup.get(alias.groupId) ?? [];
    values.push(alias);
    aliasesByGroup.set(alias.groupId, values);
  }
  const membersByGroup = new Map<number, typeof members>();
  for (const member of members) {
    const values = membersByGroup.get(member.groupId) ?? [];
    values.push(member);
    membersByGroup.set(member.groupId, values);
  }
  const visibleNames = names.filter(
    (item) => !ignoredBudgetNames.has(normalizeBudgetNameKey(item.name)),
  );
  const resolvedNames = await Promise.all(
    visibleNames.map(async (item) => {
      const resolution = await resolveCanonicalBudgetName(d1, item.name);
      return {
        ...item,
        matchStatus:
          resolution.matchStatus === "auto"
            ? "review"
            : resolution.matchStatus,
      };
    }),
  );
  const requestRecordsById = new Map<string, Array<Record<string, unknown>>>();
  for (const row of requestRecordsResult.results ?? []) {
    const requestId = String(row.requestId ?? "");
    const values = requestRecordsById.get(requestId) ?? [];
    values.push(row);
    requestRecordsById.set(requestId, values);
  }
  const groupedRequests = new Map<string, Array<Record<string, unknown>>>();
  for (const row of requestRowsResult.results ?? []) {
    const status = String(row.status ?? "pending");
    const key =
      status === "pending" || status === "hold"
        ? `open:${String(row.requestedKey ?? "")}`
        : String(row.id);
    const values = groupedRequests.get(key) ?? [];
    values.push(row);
    groupedRequests.set(key, values);
  }
  const activeCatalog = groups
    .filter((group) => Number(group.active) === 1)
    .map((group) => ({
      id: group.id,
      canonicalName: group.canonicalName,
      budgetKind: normalizeBudgetKind(group.budgetKind),
      amountMode: normalizeBudgetAmountMode(group.amountMode),
      aliases: aliasesByGroup.get(group.id) ?? [],
    }));
  const requests = [...groupedRequests.values()].map((rows) => {
    const first = rows[0];
    const relatedRecords = rows.flatMap((row) => {
      const storedRecords =
        requestRecordsById.get(String(row.id)) ?? [];
      if (!storedRecords.length) {
        return [
          {
            submissionId: String(row.id),
            organization: String(row.organization ?? ""),
            applicantName: String(row.requesterName ?? ""),
            reason: String(row.reason ?? ""),
            originalName: String(row.requestedName ?? ""),
          },
        ];
      }
      return storedRecords.map((record) => ({
        submissionId: String(row.id),
        entityType: record.entityType,
        entityId: Number(record.entityId),
        activityId:
          record.entityType === "activity"
            ? Number(record.entityId)
            : undefined,
        organization: String(record.organization ?? row.organization ?? ""),
        applicantName: String(row.requesterName ?? ""),
        reason: String(row.reason ?? ""),
        originalName: String(record.originalName ?? ""),
      }));
    });
    const candidates = rankBudgetCatalogCandidates(
      first.requestedName,
      activeCatalog,
    ).map((candidate) => ({
      ...candidate,
      reason:
        candidate.score >= 75
          ? `이름이 매우 비슷합니다 (${candidate.score}점)`
          : `유사한 이름입니다 (${candidate.score}점)`,
    }));
    return {
      id: String(first.id),
      requestIds: rows.map((row) => String(row.id)),
      requestedName: String(first.requestedName ?? ""),
      status: String(first.status ?? "pending"),
      expectedKind: normalizeBudgetKind(first.expectedKind),
      submissionCount: rows.length,
      applicants: Array.from(
        new Set(rows.map((row) => String(row.requesterName ?? "")).filter(Boolean)),
      ),
      createdAt: String(first.createdAt ?? ""),
      relatedRecords,
      candidates,
      decisionReason: String(first.decisionReason ?? ""),
    };
  });
  const events = (eventsResult.results ?? []).map((event) => {
    let snapshot: Record<string, unknown> = {};
    try {
      snapshot = JSON.parse(String(event.snapshotJson ?? "{}")) as Record<
        string,
        unknown
      >;
    } catch {
      snapshot = {};
    }
    const summary =
      cleanBudgetName(snapshot.summary) ||
      cleanBudgetName(snapshot.canonicalName) ||
      cleanBudgetName(snapshot.requestedName) ||
      String(event.action ?? "");
    return {
      id: Number(event.id),
      groupId: event.groupId === null ? null : Number(event.groupId),
      action: String(event.action ?? ""),
      requestId: event.requestId ? String(event.requestId) : null,
      batchKey: String(event.batchKey ?? ""),
      changedByName: String(event.changedByName ?? ""),
      createdAt: String(event.createdAt ?? ""),
      summary,
      counts:
        snapshot.counts && typeof snapshot.counts === "object"
          ? snapshot.counts
          : undefined,
      undoable: ["group", "register-new", "create-standard"].includes(
        String(event.action ?? ""),
      ),
    };
  });
  return {
    names: resolvedNames,
    groups: groups.map((group) => ({
      ...group,
      budgetKind: normalizeBudgetKind(group.budgetKind),
      amountMode: normalizeBudgetAmountMode(group.amountMode),
      active: Number(group.active) === 1,
      aliases: aliasesByGroup.get(group.id) ?? [],
      members: membersByGroup.get(group.id) ?? [],
    })),
    requests,
    events,
    retrofitPreview: [],
  };
}

export async function groupBudgetNames(
  member: Member,
  selectedNamesInput: unknown,
  canonicalNameInput: unknown,
) {
  return registerNewStandardBudgetName(member, {
    selectedNames: selectedNamesInput,
    canonicalName: canonicalNameInput,
    budgetKind: "purpose",
    amountMode: "manual",
  });
}

async function restoreBudgetMembers(
  d1: D1Database,
  members: Array<{
    id: number;
    entityType: BudgetEntityType;
    entityId: number;
    originalName: string;
  }>,
) {
  if (!members.length) return;
  await runBudgetStatementsInChunks(
    d1,
    members.flatMap((member) => [
      d1
        .prepare(
          member.entityType === "activity"
            ? `UPDATE activities
               SET budget_type = ?, budget_original_name = ?,
                   budget_group_id = NULL,
                   budget_match_status = 'unclassified',
                   budget_match_method = 'admin',
                   budget_request_id = NULL,
                   budget_kind = 'unclassified',
                   budget_amount_mode = 'manual',
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`
            : `UPDATE equipment_projects
               SET budget_type = ?, budget_original_name = ?,
                   budget_group_id = NULL,
                   budget_match_status = 'unclassified',
                   budget_match_method = 'admin',
                   budget_request_id = NULL,
                   budget_kind = 'unclassified',
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
        )
        .bind(member.originalName, member.originalName, member.entityId),
      d1
        .prepare(
          `UPDATE budget_name_members
           SET active = 0, unlinked_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(member.id),
    ]),
  );
}

export async function undoBudgetGroup(member: Member, groupId: number) {
  const d1 = await ensureBudgetNamesReady();
  const group = await d1
    .prepare(
      `SELECT canonical_name AS canonicalName
       FROM budget_name_groups WHERE id = ? AND active = 1`,
    )
    .bind(groupId)
    .first<{ canonicalName: string }>();
  if (!group) throw new Error("이미 해제되었거나 찾을 수 없는 예산 묶음입니다.");
  const members = await d1
    .prepare(
      `SELECT id, entity_type AS entityType, entity_id AS entityId,
              original_name AS originalName
       FROM budget_name_members WHERE group_id = ? AND active = 1`,
    )
    .bind(groupId)
    .all<{
      id: number;
      entityType: BudgetEntityType;
      entityId: number;
      originalName: string;
    }>();
  await restoreBudgetMembers(d1, members.results ?? []);
  await d1.batch([
    d1
      .prepare(
        `UPDATE budget_name_aliases
         SET active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE group_id = ? AND active = 1`,
      )
      .bind(groupId),
    d1
      .prepare(
        `UPDATE budget_name_groups
         SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(groupId),
  ]);
  await writeBudgetEvent(d1, member, "undo-group", groupId, {
    canonicalName: group.canonicalName,
    restoredMembers: members.results ?? [],
  });
  return listBudgetNameManagement();
}

export async function unlinkBudgetAlias(member: Member, aliasId: number) {
  const d1 = await ensureBudgetNamesReady();
  const alias = await d1
    .prepare(
      `SELECT a.id, a.group_id AS groupId, a.alias_name AS aliasName,
              a.alias_key AS aliasKey, g.canonical_key AS canonicalKey
       FROM budget_name_aliases a
       JOIN budget_name_groups g ON g.id = a.group_id
       WHERE a.id = ? AND a.active = 1 AND g.active = 1`,
    )
    .bind(aliasId)
    .first<{
      id: number;
      groupId: number;
      aliasName: string;
      aliasKey: string;
      canonicalKey: string;
    }>();
  if (!alias) throw new Error("이미 해제되었거나 찾을 수 없는 별칭입니다.");
  if (alias.aliasKey === alias.canonicalKey) {
    throw new Error("대표 예산명은 개별 해제할 수 없습니다. 묶음 전체 취소를 이용해 주세요.");
  }
  const members = await d1
    .prepare(
      `SELECT id, entity_type AS entityType, entity_id AS entityId,
              original_name AS originalName
       FROM budget_name_members
       WHERE group_id = ? AND alias_key = ? AND active = 1`,
    )
    .bind(alias.groupId, alias.aliasKey)
    .all<{
      id: number;
      entityType: BudgetEntityType;
      entityId: number;
      originalName: string;
    }>();
  await restoreBudgetMembers(d1, members.results ?? []);
  await d1
    .prepare(
      `UPDATE budget_name_aliases
       SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(alias.id)
    .run();
  await writeBudgetEvent(d1, member, "unlink-alias", alias.groupId, {
    aliasName: alias.aliasName,
    restoredMembers: members.results ?? [],
  });
  return listBudgetNameManagement();
}

export async function unlinkBudgetMember(
  member: Member,
  memberIdsInput: unknown,
) {
  const d1 = await ensureBudgetNamesReady();
  const memberIds = budgetMemberIds(memberIdsInput);
  if (!memberIds.length) {
    throw new Error("해제할 연결 기록을 선택해 주세요.");
  }
  const targets = await d1
    .prepare(
      `SELECT id, group_id AS groupId, entity_type AS entityType,
              entity_id AS entityId, original_name AS originalName
       FROM budget_name_members
       WHERE id IN (${placeholders(memberIds.length)}) AND active = 1`,
    )
    .bind(...memberIds)
    .all<{
      id: number;
      groupId: number;
      entityType: BudgetEntityType;
      entityId: number;
      originalName: string;
    }>();
  const rows = targets.results ?? [];
  if (rows.length !== memberIds.length) {
    throw new Error("일부 기록이 이미 해제되었거나 찾을 수 없습니다.");
  }
  const sourceGroupIds = new Set(rows.map((row) => Number(row.groupId)));
  if (sourceGroupIds.size !== 1) {
    throw new Error("같은 표준 예산명에 연결된 기록만 함께 해제할 수 있습니다.");
  }
  const sourceGroupId = Number(rows[0].groupId);
  await restoreBudgetMembers(d1, rows);
  await writeBudgetEvent(d1, member, "unlink-member", sourceGroupId, {
    members: rows,
    summary: `한 사업의 영업·사업 기록 ${rows.length}건 연결 해제`,
  });
  return listBudgetNameManagement();
}

export async function moveBudgetMember(
  member: Member,
  input: {
    memberId?: unknown;
    memberIds?: unknown;
    targetGroupId?: unknown;
  },
) {
  const d1 = await ensureBudgetNamesReady();
  const memberIds = budgetMemberIds(
    Array.isArray(input.memberIds) ? input.memberIds : input.memberId,
  );
  const targetGroupId = Number(input.targetGroupId);
  if (!memberIds.length) {
    throw new Error("변경할 연결 기록을 선택해 주세요.");
  }
  if (!Number.isInteger(targetGroupId) || targetGroupId < 1) {
    throw new Error("이동할 표준 예산명을 선택해 주세요.");
  }
  const targets = await d1
    .prepare(
      `SELECT id, group_id AS groupId, entity_type AS entityType,
              entity_id AS entityId, original_name AS originalName
       FROM budget_name_members
       WHERE id IN (${placeholders(memberIds.length)}) AND active = 1`,
    )
    .bind(...memberIds)
    .all<{
      id: number;
      groupId: number;
      entityType: BudgetEntityType;
      entityId: number;
      originalName: string;
    }>();
  const rows = targets.results ?? [];
  if (rows.length !== memberIds.length) {
    throw new Error("일부 기록이 이미 변경되었거나 찾을 수 없습니다.");
  }
  const sourceGroupIds = new Set(rows.map((row) => Number(row.groupId)));
  if (sourceGroupIds.size !== 1) {
    throw new Error("같은 표준 예산명에 연결된 기록만 함께 변경할 수 있습니다.");
  }
  const sourceGroupId = Number(rows[0].groupId);
  if (sourceGroupId === targetGroupId) {
    throw new Error("현재와 다른 표준 예산명을 선택해 주세요.");
  }
  const sourceGroup = await readActiveBudgetGroup(d1, sourceGroupId);
  const moved = await connectBudgetRowsToGroup(d1, member, {
    groupId: targetGroupId,
    targets: rows.map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
    })),
    action: "move-member",
  });
  await writeBudgetEvent(d1, member, "move-member-detail", targetGroupId, {
    memberIds,
    members: rows,
    fromGroupId: sourceGroupId,
    fromCanonicalName: sourceGroup?.canonicalName ?? "",
    toGroupId: targetGroupId,
    toCanonicalName: moved.group.canonicalName,
    summary: `한 사업의 영업·사업 기록 ${rows.length}건을 ‘${sourceGroup?.canonicalName ?? "이전 예산명"}’에서 ‘${moved.group.canonicalName}’으로 연결 변경`,
  });
  return listBudgetNameManagement();
}

async function assertBudgetAliasAvailable(
  d1: D1Database,
  aliasNameInput: unknown,
  allowedGroupId?: number,
) {
  const aliasName = cleanBudgetName(aliasNameInput);
  const aliasKey = normalizeBudgetNameKey(aliasName);
  if (!aliasName || ignoredBudgetNames.has(aliasKey)) {
    throw new Error("사용할 수 있는 예산명을 입력해 주세요.");
  }
  const collision = await d1
    .prepare(
      `SELECT g.id AS groupId, g.canonical_name AS canonicalName
       FROM budget_name_groups g
       WHERE g.active = 1 AND g.canonical_key = ?
       UNION
       SELECT g.id AS groupId, g.canonical_name AS canonicalName
       FROM budget_name_aliases a
       JOIN budget_name_groups g ON g.id = a.group_id
       WHERE a.active = 1 AND g.active = 1 AND a.alias_key = ?
       LIMIT 1`,
    )
    .bind(aliasKey, aliasKey)
    .first<{ groupId: number; canonicalName: string }>();
  if (collision && Number(collision.groupId) !== Number(allowedGroupId)) {
    throw new Error(
      `‘${aliasName}’은(는) 이미 ‘${collision.canonicalName}’에 등록되어 있습니다.`,
    );
  }
  return { aliasName, aliasKey };
}

export async function createStandardBudgetName(
  member: Member,
  input: {
    canonicalName?: unknown;
    budgetKind?: unknown;
    amountMode?: unknown;
    defaultAmount?: unknown;
  },
) {
  const d1 = await ensureBudgetNamesReady();
  const { aliasName: canonicalName, aliasKey: canonicalKey } =
    await assertBudgetAliasAvailable(d1, input.canonicalName);
  const budgetKind = normalizeBudgetKind(input.budgetKind, "purpose");
  const amountMode =
    budgetKind === "self"
      ? normalizeBudgetAmountMode(input.amountMode, "quote_auto")
      : "manual";
  const defaultAmountValue = String(input.defaultAmount ?? "").replace(/[^\d]/g, "");
  const defaultAmount =
    defaultAmountValue && Number.isSafeInteger(Number(defaultAmountValue))
      ? Math.max(0, Number(defaultAmountValue))
      : null;
  const maxOrder = await d1
    .prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS maxOrder
       FROM budget_name_groups`,
    )
    .first<{ maxOrder: number }>();
  const result = await d1
    .prepare(
       `INSERT INTO budget_name_groups
        (canonical_name, canonical_key, active, budget_kind, amount_mode, default_amount,
         sort_order, created_by, created_by_name, updated_by, updated_by_name)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      canonicalName,
      canonicalKey,
      budgetKind,
      amountMode,
      defaultAmount,
      Number(maxOrder?.maxOrder ?? 0) + 10,
      member.id,
      member.displayName,
      member.id,
      member.displayName,
    )
    .run();
  const groupId = Number(result.meta.last_row_id);
  await d1
    .prepare(
      `INSERT INTO budget_name_aliases
        (group_id, alias_name, alias_key, active, created_by, created_by_name)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(groupId, canonicalName, canonicalKey, member.id, member.displayName)
    .run();
  await writeBudgetEvent(d1, member, "create-standard", groupId, {
    canonicalName,
    budgetKind,
    amountMode,
    defaultAmount,
    summary: `표준 예산명 ‘${canonicalName}’ 등록`,
  });
  return { ...(await listBudgetNameManagement()), groupId };
}

export async function updateStandardBudgetName(
  member: Member,
  input: {
    groupId?: unknown;
    canonicalName?: unknown;
    budgetKind?: unknown;
    amountMode?: unknown;
    defaultAmount?: unknown;
  },
) {
  const d1 = await ensureBudgetNamesReady();
  const groupId = Number(input.groupId);
  const previous = await readActiveBudgetGroup(d1, groupId);
  if (!previous) throw new Error("수정할 표준 예산명을 찾을 수 없습니다.");
  const { aliasName: canonicalName, aliasKey: canonicalKey } =
    await assertBudgetAliasAvailable(d1, input.canonicalName, groupId);
  const budgetKind = normalizeBudgetKind(input.budgetKind, "purpose");
  const amountMode =
    budgetKind === "self"
      ? normalizeBudgetAmountMode(input.amountMode, "quote_auto")
      : "manual";
  const defaultAmountValue = String(input.defaultAmount ?? "").replace(/[^\d]/g, "");
  const defaultAmount =
    defaultAmountValue && Number.isSafeInteger(Number(defaultAmountValue))
      ? Math.max(0, Number(defaultAmountValue))
      : null;
  const statements = [
    d1
      .prepare(
        `UPDATE budget_name_groups
         SET canonical_name = ?, canonical_key = ?, budget_kind = ?,
             amount_mode = ?, default_amount = ?, updated_by = ?, updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND active = 1`,
      )
      .bind(
        canonicalName,
        canonicalKey,
        budgetKind,
        amountMode,
        defaultAmount,
        member.id,
        member.displayName,
        groupId,
      ),
    d1
      .prepare(
        `INSERT INTO budget_name_aliases
          (group_id, alias_name, alias_key, active, created_by, created_by_name)
         SELECT ?, ?, ?, 1, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM budget_name_aliases
           WHERE group_id = ? AND alias_key = ? AND active = 1
         )`,
      )
      .bind(
        groupId,
        canonicalName,
        canonicalKey,
        member.id,
        member.displayName,
        groupId,
        canonicalKey,
      ),
    d1
      .prepare(
        `UPDATE activities
         SET budget_type = ?, budget_kind = ?,
             budget_amount = CASE
               WHEN ? IS NOT NULL
                 AND ? > 0
                 AND COALESCE(budget_amount, '') NOT GLOB '*[0-9]*'
                 AND COALESCE(budget_amount_override, '') NOT GLOB '*[0-9]*'
                 THEN CAST(? AS TEXT)
               ELSE budget_amount
             END,
             budget_amount_mode = CASE
               WHEN ? = 'purpose' THEN 'manual'
               WHEN COALESCE(budget_amount_override, '') GLOB '*[0-9]*'
                 OR COALESCE(budget_amount, '') GLOB '*[0-9]*'
                 THEN 'manual'
               ELSE ?
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE budget_group_id = ?
           AND COALESCE(award_status, '미정')
             NOT IN ('협력사 수주', '타업체 수주')`,
      )
      .bind(
        canonicalName,
        budgetKind,
        defaultAmount,
        defaultAmount,
        defaultAmount,
        budgetKind,
        amountMode,
        groupId,
      ),
    d1
      .prepare(
        `UPDATE equipment_projects
         SET budget_type = ?, budget_kind = ?, updated_at = CURRENT_TIMESTAMP
         WHERE budget_group_id = ?
           AND (
             activity_id IS NULL
             OR EXISTS (
               SELECT 1 FROM activities a
               WHERE a.id = equipment_projects.activity_id
                 AND COALESCE(a.award_status, '미정')
                   NOT IN ('협력사 수주', '타업체 수주')
             )
           )`,
      )
      .bind(canonicalName, budgetKind, groupId),
  ];
  await d1.batch(statements);
  await writeBudgetEvent(d1, member, "update-standard", groupId, {
    before: previous,
    after: { canonicalName, budgetKind, amountMode, defaultAmount },
    summary: `표준 예산명 ‘${previous.canonicalName}’ 설정 변경`,
  });
  return listBudgetNameManagement();
}

export async function addBudgetAlias(
  member: Member,
  input: {
    groupId?: unknown;
    aliasName?: unknown;
    retrofitExisting?: unknown;
  },
) {
  const d1 = await ensureBudgetNamesReady();
  const groupId = Number(input.groupId);
  const group = await readActiveBudgetGroup(d1, groupId);
  if (!group) throw new Error("별칭을 추가할 표준 예산명을 찾을 수 없습니다.");
  const { aliasName, aliasKey } = await assertBudgetAliasAvailable(
    d1,
    input.aliasName,
    groupId,
  );
  const existing = await d1
    .prepare(
      `SELECT id FROM budget_name_aliases
       WHERE group_id = ? AND alias_key = ? AND active = 1`,
    )
    .bind(groupId, aliasKey)
    .first<{ id: number }>();
  if (existing) throw new Error("이미 등록된 별칭입니다.");
  await d1
    .prepare(
      `INSERT INTO budget_name_aliases
        (group_id, alias_name, alias_key, active, created_by, created_by_name)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(groupId, aliasName, aliasKey, member.id, member.displayName)
    .run();
  await writeBudgetEvent(d1, member, "add-alias", groupId, {
    aliasName,
    summary: `‘${aliasName}’ 별칭 추가`,
  });
  if (input.retrofitExisting !== false) {
    await connectBudgetRowsToGroup(d1, member, {
      groupId,
      selectedNames: [aliasName],
      action: "add-alias-retrofit",
    });
  }
  return listBudgetNameManagement();
}

export async function deactivateStandardBudgetName(
  member: Member,
  groupIdInput: unknown,
) {
  const d1 = await ensureBudgetNamesReady();
  const groupId = Number(groupIdInput);
  const group = await readActiveBudgetGroup(d1, groupId);
  if (!group) throw new Error("비활성화할 표준 예산명을 찾을 수 없습니다.");
  await d1.batch([
    d1
      .prepare(
        `UPDATE budget_name_groups
         SET active = 0, disabled_at = CURRENT_TIMESTAMP,
             updated_by = ?, updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(member.id, member.displayName, groupId),
    d1
      .prepare(
        `UPDATE budget_name_aliases
         SET active = 0, disabled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE group_id = ? AND active = 1`,
      )
      .bind(groupId),
  ]);
  await writeBudgetEvent(d1, member, "deactivate", groupId, {
    group,
    summary: `표준 예산명 ‘${group.canonicalName}’ 비활성화`,
  });
  return listBudgetNameManagement();
}

export async function setStandardBudgetActive(
  member: Member,
  input: { groupId?: unknown; active?: unknown },
) {
  const requestedActive =
    input.active === true ||
    input.active === 1 ||
    String(input.active ?? "").toLowerCase() === "true";
  const requestedInactive =
    input.active === false ||
    input.active === 0 ||
    String(input.active ?? "").toLowerCase() === "false";
  if (!requestedActive && !requestedInactive) {
    throw new Error("활성 여부를 선택해 주세요.");
  }
  if (requestedInactive) {
    return deactivateStandardBudgetName(member, input.groupId);
  }

  const d1 = await ensureBudgetNamesReady();
  const groupId = Number(input.groupId);
  if (!Number.isInteger(groupId) || groupId < 1) {
    throw new Error("활성화할 표준 예산명을 선택해 주세요.");
  }
  const group = await d1
    .prepare(
      `SELECT id, canonical_name AS canonicalName,
              canonical_key AS canonicalKey, active
       FROM budget_name_groups
       WHERE id = ?`,
    )
    .bind(groupId)
    .first<{
      id: number;
      canonicalName: string;
      canonicalKey: string;
      active: number;
    }>();
  if (!group) {
    throw new Error("활성화할 표준 예산명을 찾을 수 없습니다.");
  }
  if (Number(group.active) === 1) {
    return listBudgetNameManagement();
  }

  await assertBudgetAliasAvailable(d1, group.canonicalName, groupId);
  const aliasesResult = await d1
    .prepare(
      `SELECT id, alias_name AS aliasName, alias_key AS aliasKey
       FROM budget_name_aliases
       WHERE group_id = ?
       ORDER BY id`,
    )
    .bind(groupId)
    .all<{ id: number; aliasName: string; aliasKey: string }>();
  const aliasesByKey = new Map<
    string,
    { id: number; aliasName: string; aliasKey: string }
  >();
  for (const alias of aliasesResult.results ?? []) {
    if (!aliasesByKey.has(alias.aliasKey)) {
      aliasesByKey.set(alias.aliasKey, alias);
    }
  }

  const reactivatedAliases: string[] = [];
  const skippedAliases: string[] = [];
  const aliasStatements: Array<ReturnType<D1Database["prepare"]>> = [];
  for (const alias of aliasesByKey.values()) {
    try {
      await assertBudgetAliasAvailable(d1, alias.aliasName, groupId);
      aliasStatements.push(
        d1
          .prepare(
            `UPDATE budget_name_aliases
             SET active = 1, disabled_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .bind(alias.id),
      );
      reactivatedAliases.push(alias.aliasName);
    } catch {
      if (alias.aliasKey === group.canonicalKey) {
        throw new Error(
          `"${group.canonicalName}" 이름이 다른 활성 표준 예산명에 사용 중이라 재활성화할 수 없습니다.`,
        );
      }
      skippedAliases.push(alias.aliasName);
    }
  }
  if (!aliasesByKey.has(group.canonicalKey)) {
    aliasStatements.push(
      d1
        .prepare(
          `INSERT INTO budget_name_aliases
            (group_id, alias_name, alias_key, active,
             created_by, created_by_name, disabled_at)
           VALUES (?, ?, ?, 1, ?, ?, NULL)`,
        )
        .bind(
          groupId,
          group.canonicalName,
          group.canonicalKey,
          member.id,
          member.displayName,
        ),
    );
    reactivatedAliases.push(group.canonicalName);
  }

  await runBudgetStatementsInChunks(d1, [
    d1
      .prepare(
        `UPDATE budget_name_groups
         SET active = 1, disabled_at = NULL,
             updated_by = ?, updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(member.id, member.displayName, groupId),
    ...aliasStatements,
  ]);
  await writeBudgetEvent(d1, member, "activate", groupId, {
    canonicalName: group.canonicalName,
    reactivatedAliases,
    skippedAliases,
    summary: `표준 예산명 "${group.canonicalName}" 재활성화`,
  });
  return listBudgetNameManagement();
}

export async function reorderStandardBudgetNames(
  member: Member,
  input: { groupId?: unknown; direction?: unknown },
) {
  const d1 = await ensureBudgetNamesReady();
  const groupId = Number(input.groupId);
  const direction = cleanBudgetName(input.direction) === "up" ? "up" : "down";
  const rows = await d1
    .prepare(
      `SELECT id, sort_order AS sortOrder
       FROM budget_name_groups WHERE active = 1
       ORDER BY sort_order, canonical_name, id`,
    )
    .all<{ id: number; sortOrder: number }>();
  const index = rows.results.findIndex((row) => Number(row.id) === groupId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= rows.results.length) {
    return listBudgetNameManagement();
  }
  const current = rows.results[index];
  const target = rows.results[targetIndex];
  await d1.batch([
    d1
      .prepare(
        `UPDATE budget_name_groups
         SET sort_order = ?, updated_by = ?, updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(target.sortOrder, member.id, member.displayName, current.id),
    d1
      .prepare(
        `UPDATE budget_name_groups
         SET sort_order = ?, updated_by = ?, updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(current.sortOrder, member.id, member.displayName, target.id),
  ]);
  await writeBudgetEvent(d1, member, "reorder", groupId, {
    direction,
    summary: "표준 예산명 표시 순서 변경",
  });
  return listBudgetNameManagement();
}

function uniqueBudgetNames(value: unknown) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map(cleanBudgetName)
        .filter(
          (name) =>
            name && !ignoredBudgetNames.has(normalizeBudgetNameKey(name)),
        ),
    ),
  );
}

async function readConnectableBudgetRows(
  d1: D1Database,
  input: {
    selectedNames?: string[];
    targets?: Array<{ entityType: BudgetEntityType; entityId: number }>;
  },
) {
  const targetActivityIds = (input.targets ?? [])
    .filter((target) => target.entityType === "activity")
    .map((target) => target.entityId);
  const targetProjectIds = (input.targets ?? [])
    .filter((target) => target.entityType === "equipment_project")
    .map((target) => target.entityId);
  const names = input.selectedNames ?? [];
  const activityFilter = targetActivityIds.length
    ? `a.id IN (${placeholders(targetActivityIds.length)})`
    : names.length
      ? `a.budget_type IN (${placeholders(names.length)})`
      : "0 = 1";
  const projectFilter = targetProjectIds.length
    ? `p.id IN (${placeholders(targetProjectIds.length)})`
    : names.length
      ? `p.budget_type IN (${placeholders(names.length)})`
      : "0 = 1";
  const [activities, projects] = await Promise.all([
    d1
      .prepare(
        `SELECT a.id, a.organization,
                a.activity_date AS activityDate,
                a.budget_type AS originalName,
                a.budget_original_name AS preservedOriginalName,
                a.budget_group_id AS budgetGroupId,
                a.budget_amount AS budgetAmount,
                a.budget_amount_override AS budgetAmountOverride,
                a.award_status AS awardStatus
         FROM activities a
         WHERE ${activityFilter}
           AND COALESCE(a.award_status, '미정')
             NOT IN ('협력사 수주', '타업체 수주')`,
      )
      .bind(...(targetActivityIds.length ? targetActivityIds : names))
      .all<Record<string, unknown>>(),
    d1
      .prepare(
        `SELECT p.id, p.organization,
                p.budget_type AS originalName,
                p.budget_original_name AS preservedOriginalName,
                p.budget_group_id AS budgetGroupId,
                COALESCE(a.award_status, '미정') AS awardStatus
         FROM equipment_projects p
         LEFT JOIN activities a ON a.id = p.activity_id
         WHERE ${projectFilter}
           AND (
             p.activity_id IS NULL
             OR COALESCE(a.award_status, '미정')
               NOT IN ('협력사 수주', '타업체 수주')
           )`,
      )
      .bind(...(targetProjectIds.length ? targetProjectIds : names))
      .all<Record<string, unknown>>(),
  ]);
  return {
    activities: activities.results ?? [],
    projects: projects.results ?? [],
  };
}

async function connectBudgetRowsToGroup(
  d1: D1Database,
  member: Member,
  input: {
    groupId: number;
    selectedNames?: string[];
    targets?: Array<{ entityType: BudgetEntityType; entityId: number }>;
    action: string;
    requestId?: string;
  },
) {
  const group = await readActiveBudgetGroup(d1, input.groupId);
  if (!group) throw new Error("연결할 표준 예산명을 찾을 수 없습니다.");
  const budgetKind = normalizeBudgetKind(group.budgetKind);
  const groupAmountMode = normalizeBudgetAmountMode(group.amountMode);
  const rows = await readConnectableBudgetRows(d1, input);
  const statements = [];
  for (const row of rows.activities) {
    const originalName =
      cleanBudgetName(row.preservedOriginalName) ||
      cleanBudgetName(row.originalName);
    const budgetAmount = meaningfulBudgetAmount(row.budgetAmount);
    const override = meaningfulBudgetAmount(row.budgetAmountOverride);
    const amountMode =
      budgetKind === "self" && !override && !budgetAmount
        ? groupAmountMode
        : "manual";
    const defaultBudgetAmount = standardDefaultBudgetAmount(group, amountMode);
    statements.push(
      d1
        .prepare(
          `UPDATE activities
           SET budget_type = ?,
               budget_original_name = CASE
                 WHEN TRIM(COALESCE(budget_original_name, '')) = ''
                   THEN ?
                 ELSE budget_original_name
               END,
               budget_group_id = ?,
               budget_match_status = 'auto',
               budget_match_method = 'admin',
               budget_request_id = COALESCE(?, budget_request_id),
               budget_kind = ?,
               budget_amount_mode = ?,
               budget_amount = CASE
                 WHEN ? <> ''
                   AND COALESCE(budget_amount, '') NOT GLOB '*[0-9]*'
                   AND COALESCE(budget_amount_override, '') NOT GLOB '*[0-9]*'
                   THEN ?
                 ELSE budget_amount
               END,
               budget_amount_override = CASE
                 WHEN ? = 'manual'
                   THEN COALESCE(NULLIF(TRIM(budget_amount_override), ''),
                                 NULLIF(TRIM(budget_amount), ''), '')
                 ELSE budget_amount_override
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          group.canonicalName,
          originalName,
          group.id,
          input.requestId ?? null,
          budgetKind,
          amountMode,
          defaultBudgetAmount,
          defaultBudgetAmount,
          amountMode,
          Number(row.id),
        ),
      d1
        .prepare(
          `INSERT INTO budget_name_members
            (group_id, entity_type, entity_id, original_name, alias_key, active,
             linked_at, unlinked_at)
           VALUES (?, 'activity', ?, ?, ?, 1, CURRENT_TIMESTAMP, NULL)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             group_id = excluded.group_id,
             original_name = excluded.original_name,
             alias_key = excluded.alias_key,
             active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL`,
        )
        .bind(
          group.id,
          Number(row.id),
          originalName,
          normalizeBudgetNameKey(originalName),
        ),
    );
  }
  for (const row of rows.projects) {
    const originalName =
      cleanBudgetName(row.preservedOriginalName) ||
      cleanBudgetName(row.originalName);
    statements.push(
      d1
        .prepare(
          `UPDATE equipment_projects
           SET budget_type = ?,
               budget_original_name = CASE
                 WHEN TRIM(COALESCE(budget_original_name, '')) = ''
                   THEN ?
                 ELSE budget_original_name
               END,
               budget_group_id = ?,
               budget_match_status = 'auto',
               budget_match_method = 'admin',
               budget_request_id = COALESCE(?, budget_request_id),
               budget_kind = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          group.canonicalName,
          originalName,
          group.id,
          input.requestId ?? null,
          budgetKind,
          Number(row.id),
        ),
      d1
        .prepare(
          `INSERT INTO budget_name_members
            (group_id, entity_type, entity_id, original_name, alias_key, active,
             linked_at, unlinked_at)
           VALUES (?, 'equipment_project', ?, ?, ?, 1, CURRENT_TIMESTAMP, NULL)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             group_id = excluded.group_id,
             original_name = excluded.original_name,
             alias_key = excluded.alias_key,
             active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL`,
        )
        .bind(
          group.id,
          Number(row.id),
          originalName,
          normalizeBudgetNameKey(originalName),
        ),
    );
  }
  await runBudgetStatementsInChunks(d1, statements);
  const batchKey = `budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeBudgetEvent(
    d1,
    member,
    input.action,
    group.id,
    {
      canonicalName: group.canonicalName,
      selectedNames: input.selectedNames ?? [],
      activityIds: rows.activities.map((row) => Number(row.id)),
      projectIds: rows.projects.map((row) => Number(row.id)),
      preservedManualAmounts: rows.activities
        .filter(
          (row) =>
            meaningfulBudgetAmount(row.budgetAmountOverride) ||
            meaningfulBudgetAmount(row.budgetAmount),
        )
        .map((row) => Number(row.id)),
      summary: `‘${group.canonicalName}’에 ${rows.activities.length + rows.projects.length}건 연결`,
    },
    { requestId: input.requestId, batchKey },
  );
  return {
    group,
    activityIds: rows.activities.map((row) => Number(row.id)),
    projectIds: rows.projects.map((row) => Number(row.id)),
  };
}

export async function connectExistingBudgetNames(
  member: Member,
  input: { groupId?: unknown; selectedNames?: unknown },
) {
  const d1 = await ensureBudgetNamesReady();
  const groupId = Number(input.groupId);
  const selectedNames = uniqueBudgetNames(input.selectedNames);
  if (!selectedNames.length) throw new Error("연결할 예산명을 선택해 주세요.");
  for (const name of selectedNames) {
    const { aliasName, aliasKey } = await assertBudgetAliasAvailable(
      d1,
      name,
      groupId,
    );
    await d1
      .prepare(
        `INSERT INTO budget_name_aliases
          (group_id, alias_name, alias_key, active, created_by, created_by_name)
         SELECT ?, ?, ?, 1, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM budget_name_aliases
           WHERE group_id = ? AND alias_key = ? AND active = 1
         )`,
      )
      .bind(
        groupId,
        aliasName,
        aliasKey,
        member.id,
        member.displayName,
        groupId,
        aliasKey,
      )
      .run();
  }
  await connectBudgetRowsToGroup(d1, member, {
    groupId,
    selectedNames,
    action: "connect-existing",
  });
  return listBudgetNameManagement();
}

export async function registerNewStandardBudgetName(
  member: Member,
  input: {
    selectedNames?: unknown;
    canonicalName?: unknown;
    budgetKind?: unknown;
    amountMode?: unknown;
  },
) {
  const selectedNames = uniqueBudgetNames(input.selectedNames);
  if (!selectedNames.length) throw new Error("연결할 예산명을 선택해 주세요.");
  const created = await createStandardBudgetName(member, input);
  const d1 = await ensureBudgetNamesReady();
  for (const name of selectedNames) {
    const normalized = await assertBudgetAliasAvailable(
      d1,
      name,
      created.groupId,
    );
    await d1
      .prepare(
        `INSERT INTO budget_name_aliases
          (group_id, alias_name, alias_key, active, created_by, created_by_name)
         SELECT ?, ?, ?, 1, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM budget_name_aliases
           WHERE group_id = ? AND alias_key = ? AND active = 1
         )`,
      )
      .bind(
        created.groupId,
        normalized.aliasName,
        normalized.aliasKey,
        member.id,
        member.displayName,
        created.groupId,
        normalized.aliasKey,
      )
      .run();
  }
  await connectBudgetRowsToGroup(d1, member, {
    groupId: created.groupId,
    selectedNames,
    action: "register-new",
  });
  return listBudgetNameManagement();
}

export async function keepBudgetNamesUnclassified(
  member: Member,
  selectedNamesInput: unknown,
) {
  const d1 = await ensureBudgetNamesReady();
  const selectedNames = uniqueBudgetNames(selectedNamesInput);
  if (!selectedNames.length) throw new Error("미분류로 유지할 이름을 선택해 주세요.");
  const rows = await readConnectableBudgetRows(d1, { selectedNames });
  const statements = [
    ...rows.activities.map((row) =>
      d1
        .prepare(
          `UPDATE activities
           SET budget_group_id = NULL, budget_match_status = 'unclassified',
               budget_match_method = 'admin', budget_kind = 'unclassified',
               updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(Number(row.id)),
    ),
    ...rows.projects.map((row) =>
      d1
        .prepare(
          `UPDATE equipment_projects
           SET budget_group_id = NULL, budget_match_status = 'unclassified',
               budget_match_method = 'admin', budget_kind = 'unclassified',
               updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(Number(row.id)),
    ),
  ];
  await runBudgetStatementsInChunks(d1, statements);
  await writeBudgetEvent(d1, member, "keep-unclassified", null, {
    selectedNames,
    activityIds: rows.activities.map((row) => Number(row.id)),
    projectIds: rows.projects.map((row) => Number(row.id)),
    summary: `${selectedNames.length}개 이름을 미분류로 유지`,
  });
  return listBudgetNameManagement();
}

export async function listActiveBudgetCatalog(member?: Member) {
  const d1 = await ensureBudgetNamesReady();
  const [groupsResult, aliasesResult, requestsResult] = await Promise.all([
    d1
      .prepare(
        `SELECT id, canonical_name AS canonicalName,
                budget_kind AS budgetKind, amount_mode AS amountMode,
                default_amount AS defaultAmount,
                sort_order AS sortOrder
         FROM budget_name_groups
         WHERE active = 1 AND budget_kind IN ('purpose', 'self')
         ORDER BY sort_order, canonical_name, id`,
      )
      .all<Record<string, unknown>>(),
    d1
      .prepare(
        `SELECT id, group_id AS groupId, alias_name AS aliasName
         FROM budget_name_aliases
         WHERE active = 1 ORDER BY group_id, id`,
      )
      .all<Record<string, unknown>>(),
    member
      ? d1
          .prepare(
            `SELECT r.id, r.requested_name AS requestedName,
                    r.expected_budget_kind AS expectedKind,
                    r.reason, r.status, r.decision_reason AS decisionReason,
                    r.created_at AS createdAt,
                    g.id AS resolvedGroupId,
                    g.canonical_name AS canonicalName,
                    g.budget_kind AS resolvedBudgetKind,
                    g.amount_mode AS resolvedAmountMode
             FROM budget_name_requests r
             LEFT JOIN budget_name_groups g ON g.id = r.resolved_group_id
             WHERE r.requester_member_id = ?
             ORDER BY r.created_at DESC LIMIT 100`,
          )
          .bind(member.id)
          .all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
  ]);
  const aliasesByGroup = new Map<number, Array<Record<string, unknown>>>();
  for (const alias of aliasesResult.results ?? []) {
    const groupId = Number(alias.groupId);
    const values = aliasesByGroup.get(groupId) ?? [];
    values.push({
      id: Number(alias.id),
      aliasName: String(alias.aliasName ?? ""),
    });
    aliasesByGroup.set(groupId, values);
  }
  const catalog = (groupsResult.results ?? []).map((group) => ({
    id: Number(group.id),
    canonicalName: String(group.canonicalName ?? ""),
    budgetKind: normalizeBudgetKind(group.budgetKind),
    amountMode: normalizeBudgetAmountMode(group.amountMode),
    defaultAmount:
      group.defaultAmount === null || group.defaultAmount === undefined
        ? null
        : Math.max(0, Number(group.defaultAmount) || 0),
    aliases: aliasesByGroup.get(Number(group.id)) ?? [],
    active: true,
  }));
  const myRequests = (requestsResult.results ?? []).map((request) => ({
    id: String(request.id),
    requestedName: String(request.requestedName ?? ""),
    expectedKind: normalizeBudgetKind(request.expectedKind),
    status: String(request.status ?? "pending"),
    reason: String(request.reason ?? ""),
    decisionReason: String(request.decisionReason ?? ""),
    canonicalName: String(request.canonicalName ?? ""),
    resolvedGroupId:
      Number(request.resolvedGroupId) > 0
        ? Number(request.resolvedGroupId)
        : null,
    budgetKind: normalizeBudgetKind(
      request.resolvedBudgetKind ?? request.expectedKind,
    ),
    amountMode: normalizeBudgetAmountMode(
      request.resolvedAmountMode,
      normalizeBudgetKind(
        request.resolvedBudgetKind ?? request.expectedKind,
      ) === "self"
        ? "quote_auto"
        : "manual",
    ),
    createdAt: String(request.createdAt ?? ""),
  }));
  return { catalog, groups: catalog, myRequests };
}

export async function findBudgetCatalogSuggestions(query: unknown) {
  const { catalog } = await listActiveBudgetCatalog();
  return rankBudgetCatalogCandidates(query, catalog);
}

export class BudgetRequestSuggestionError extends Error {
  suggestions: ReturnType<typeof rankBudgetCatalogCandidates>;

  constructor(
    message: string,
    suggestions: ReturnType<typeof rankBudgetCatalogCandidates>,
  ) {
    super(message);
    this.name = "BudgetRequestSuggestionError";
    this.suggestions = suggestions;
  }
}

export async function submitBudgetNameRequest(
  member: Member,
  input: {
    requestedName?: unknown;
    expectedKind?: unknown;
    reason?: unknown;
    organization?: unknown;
    activityId?: unknown;
    confirmNoExistingMatch?: unknown;
  },
) {
  const d1 = await ensureBudgetNamesReady();
  const requestedName = cleanBudgetName(input.requestedName);
  const requestedKey = normalizeBudgetNameKey(requestedName);
  const expectedKind = normalizeBudgetKind(input.expectedKind, "purpose");
  const reason = cleanBudgetText(input.reason, 1000);
  const organization = cleanBudgetName(input.organization);
  if (!requestedName || ignoredBudgetNames.has(requestedKey)) {
    throw new Error("신청할 새 예산명을 입력해 주세요.");
  }
  if (!reason) throw new Error("신청 사유 또는 확인 내용을 입력해 주세요.");
  const exact = await resolveCanonicalBudgetName(d1, requestedName);
  const { catalog } = await listActiveBudgetCatalog();
  const suggestions = rankBudgetCatalogCandidates(requestedName, catalog);
  if (exact.groupId) {
    throw new BudgetRequestSuggestionError(
      `이미 등록된 ‘${exact.canonicalName}’을 바로 선택할 수 있습니다.`,
      suggestions,
    );
  }
  if (exact.matchStatus === "review") {
    throw new BudgetRequestSuggestionError(
      "동일하게 정규화되는 표준 예산명이 여러 개입니다. 기존 예산명을 선택해 주세요.",
      exact.candidates.map((candidate) => ({
        ...candidate,
        matchedName: candidate.canonicalName,
        matchedSource: "canonical",
        score: 100,
      })),
    );
  }
  if (suggestions.length && input.confirmNoExistingMatch !== true) {
    throw new BudgetRequestSuggestionError(
      "유사한 기존 표준 예산명이 있습니다. 먼저 추천 항목을 확인해 주세요.",
      suggestions,
    );
  }
  const activityId = Number(input.activityId);
  if (Number.isInteger(activityId) && activityId > 0) {
    const activity = await d1
      .prepare(
        `SELECT id, organization, award_status AS awardStatus
         FROM activities WHERE id = ?`,
      )
      .bind(activityId)
      .first<{ id: number; organization: string; awardStatus: string }>();
    if (!activity) throw new Error("연결할 영업 기록을 찾을 수 없습니다.");
    if (!isBudgetEligibleAwardStatus(activity.awardStatus)) {
      throw new Error(
        "협력사 수주와 타업체 수주는 표준 예산명 신청 대상이 아닙니다.",
      );
    }
  }
  const requestId = crypto.randomUUID();
  await d1
    .prepare(
      `INSERT INTO budget_name_requests
        (id, requested_name, requested_key, expected_budget_kind, reason,
         organization, requester_member_id, requester_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .bind(
      requestId,
      requestedName,
      requestedKey,
      expectedKind,
      reason,
      organization,
      member.id,
      member.displayName,
    )
    .run();
  if (Number.isInteger(activityId) && activityId > 0) {
    await linkBudgetRequestRecord(d1, {
      requestId,
      entityType: "activity",
      entityId: activityId,
      originalName: requestedName,
      organization,
    });
    await d1
      .prepare(
        `UPDATE activities
         SET budget_type = ?, budget_original_name = ?,
             budget_group_id = NULL, budget_match_status = 'pending',
             budget_match_method = 'employee_request',
             budget_request_id = ?, budget_kind = ?,
             budget_amount_mode = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND COALESCE(award_status, '미정')
             NOT IN ('협력사 수주', '타업체 수주')`,
      )
      .bind(
        requestedName,
        requestedName,
        requestId,
        expectedKind,
        expectedKind === "self" ? "quote_auto" : "manual",
        activityId,
      )
      .run();
  }
  await writeBudgetEvent(
    d1,
    member,
    "submit-request",
    null,
    {
      requestedName,
      expectedKind,
      reason,
      organization,
      activityId:
        Number.isInteger(activityId) && activityId > 0 ? activityId : null,
      summary: `새 예산명 ‘${requestedName}’ 신청`,
    },
    { requestId },
  );
  return {
    request: {
      id: requestId,
      requestedName,
      expectedKind,
      reason,
      status: "pending",
      decisionReason: "",
      canonicalName: "",
      createdAt: new Date().toISOString(),
    },
    suggestions,
  };
}

export async function processBudgetNameRequest(
  member: Member,
  input: {
    requestId?: unknown;
    decision?: unknown;
    targetGroupId?: unknown;
    canonicalName?: unknown;
    budgetKind?: unknown;
    amountMode?: unknown;
    reason?: unknown;
  },
) {
  const d1 = await ensureBudgetNamesReady();
  const requestId = cleanBudgetName(input.requestId);
  const decision = cleanBudgetName(input.decision);
  const reason = cleanBudgetText(input.reason, 1000);
  const request = await d1
    .prepare(
      `SELECT id, requested_name AS requestedName,
              requested_key AS requestedKey,
              expected_budget_kind AS expectedKind, status
       FROM budget_name_requests WHERE id = ?`,
    )
    .bind(requestId)
    .first<{
      id: string;
      requestedName: string;
      requestedKey: string;
      expectedKind: string;
      status: BudgetRequestStatus;
    }>();
  if (!request) throw new Error("처리할 예산명 신청을 찾을 수 없습니다.");
  if (request.status === "approved" || request.status === "rejected") {
    throw new Error("이미 최종 처리된 신청입니다.");
  }
  const duplicates = await d1
    .prepare(
      `SELECT id FROM budget_name_requests
       WHERE requested_key = ? AND status IN ('pending', 'hold')`,
    )
    .bind(request.requestedKey)
    .all<{ id: string }>();
  const requestIds = duplicates.results.map((row) => String(row.id));
  if (decision === "reject" && !reason) {
    throw new Error("반려 사유를 입력해 주세요.");
  }
  if (decision === "hold" || decision === "reject") {
    await d1
      .prepare(
        `UPDATE budget_name_requests
         SET status = ?, decision_reason = ?, decided_by = ?,
             decided_by_name = ?, decided_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id IN (${placeholders(requestIds.length)})`,
      )
      .bind(
        decision === "hold" ? "hold" : "rejected",
        reason,
        member.id,
        member.displayName,
        ...requestIds,
      )
      .run();
    await writeBudgetEvent(
      d1,
      member,
      decision === "hold" ? "hold-request" : "reject-request",
      null,
      {
        requestedName: request.requestedName,
        requestIds,
        reason,
        summary:
          decision === "hold"
            ? `‘${request.requestedName}’ 신청 보류`
            : `‘${request.requestedName}’ 신청 반려`,
      },
      { requestId },
    );
    return listBudgetNameManagement();
  }

  let groupId = Number(input.targetGroupId);
  let resolutionType = "";
  if (decision === "approve-new") {
    const created = await createStandardBudgetName(member, {
      canonicalName: input.canonicalName || request.requestedName,
      budgetKind: input.budgetKind || request.expectedKind,
      amountMode: input.amountMode,
    });
    groupId = created.groupId;
    resolutionType = "new-standard";
  } else if (decision === "approve-alias") {
    if (!Number.isInteger(groupId) || groupId < 1) {
      throw new Error("별칭으로 연결할 표준 예산명을 선택해 주세요.");
    }
    await addBudgetAlias(member, {
      groupId,
      aliasName: request.requestedName,
      retrofitExisting: false,
    });
    resolutionType = "existing-alias";
  } else {
    throw new Error("지원하지 않는 신청 처리 방식입니다.");
  }
  const requestRecords = await d1
    .prepare(
      `SELECT entity_type AS entityType, entity_id AS entityId
       FROM budget_name_request_records
       WHERE request_id IN (${placeholders(requestIds.length)})`,
    )
    .bind(...requestIds)
    .all<{ entityType: BudgetEntityType; entityId: number }>();
  const uniqueTargetMap = new Map<
    string,
    { entityType: BudgetEntityType; entityId: number }
  >();
  for (const record of requestRecords.results) {
    uniqueTargetMap.set(`${record.entityType}:${record.entityId}`, {
      entityType: record.entityType,
      entityId: Number(record.entityId),
    });
  }
  const uniqueTargets = Array.from(uniqueTargetMap.values());
  if (uniqueTargets.length) {
    await connectBudgetRowsToGroup(d1, member, {
      groupId,
      targets: uniqueTargets,
      action: "approve-request-records",
      requestId,
    });
  }
  await d1
    .prepare(
      `UPDATE budget_name_requests
       SET status = 'approved', resolved_group_id = ?,
           resolution_type = ?, decision_reason = ?,
           decided_by = ?, decided_by_name = ?,
           decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders(requestIds.length)})`,
    )
    .bind(
      groupId,
      resolutionType,
      reason,
      member.id,
      member.displayName,
      ...requestIds,
    )
    .run();
  await writeBudgetEvent(
    d1,
    member,
    "approve-request",
    groupId,
    {
      requestedName: request.requestedName,
      requestIds,
      resolutionType,
      directlyLinkedRecords: uniqueTargets,
      summary: `‘${request.requestedName}’ 신청 승인`,
    },
    { requestId },
  );
  return listBudgetNameManagement();
}

export async function previewBudgetRetrofit(input: {
  groupId?: unknown;
  requestId?: unknown;
  originalName?: unknown;
}) {
  const d1 = await ensureBudgetNamesReady();
  const groupId = Number(input.groupId);
  const group = await readActiveBudgetGroup(d1, groupId);
  if (!group) throw new Error("소급 적용할 표준 예산명을 찾을 수 없습니다.");
  const originalName = cleanBudgetName(input.originalName);
  if (!originalName) throw new Error("소급 적용할 원래 예산명이 없습니다.");
  const requestId = cleanBudgetName(input.requestId);
  const excludedActivityIds = new Set<number>();
  const excludedProjectIds = new Set<number>();
  if (requestId) {
    const request = await d1
      .prepare(
        `SELECT requested_key AS requestedKey
         FROM budget_name_requests WHERE id = ?`,
      )
      .bind(requestId)
      .first<{ requestedKey: string }>();
    if (request) {
      const ids = await d1
        .prepare(
          `SELECT rr.entity_type AS entityType, rr.entity_id AS entityId
           FROM budget_name_request_records rr
           JOIN budget_name_requests r ON r.id = rr.request_id
           WHERE r.requested_key = ?`,
        )
        .bind(request.requestedKey)
        .all<{ entityType: BudgetEntityType; entityId: number }>();
      for (const row of ids.results) {
        if (row.entityType === "activity") {
          excludedActivityIds.add(Number(row.entityId));
        } else {
          excludedProjectIds.add(Number(row.entityId));
        }
      }
    }
  }
  const rows = await readConnectableBudgetRows(d1, {
    selectedNames: [originalName],
  });
  const retrofitPreview = [
    ...rows.activities
      .filter(
        (row) =>
          !excludedActivityIds.has(Number(row.id)) &&
          Number(row.budgetGroupId ?? 0) !== groupId,
      )
      .map((row) => ({
        entityType: "activity" as const,
        entityId: Number(row.id),
        organization: String(row.organization ?? ""),
        originalName:
          cleanBudgetName(row.preservedOriginalName) ||
          cleanBudgetName(row.originalName),
        activityDate: String(row.activityDate ?? ""),
        awardStatus: String(row.awardStatus ?? "미정"),
      })),
    ...rows.projects
      .filter((row) => !excludedProjectIds.has(Number(row.id)))
      .map((row) => ({
        entityType: "equipment_project" as const,
        entityId: Number(row.id),
        organization: String(row.organization ?? ""),
        originalName:
          cleanBudgetName(row.preservedOriginalName) ||
          cleanBudgetName(row.originalName),
        activityDate: "",
        awardStatus: String(row.awardStatus ?? "미정"),
      })),
  ];
  return {
    ...(await listBudgetNameManagement()),
    retrofitPreview,
  };
}

export async function applyBudgetRetrofit(
  member: Member,
  input: {
    groupId?: unknown;
    requestId?: unknown;
    targets?: unknown;
  },
) {
  const d1 = await ensureBudgetNamesReady();
  const groupId = Number(input.groupId);
  const targets = (Array.isArray(input.targets) ? input.targets : [])
    .map((target) => {
      const row = (target ?? {}) as Record<string, unknown>;
      const entityType =
        cleanBudgetName(row.entityType) === "equipment_project"
          ? "equipment_project"
          : "activity";
      return {
        entityType: entityType as BudgetEntityType,
        entityId: Number(row.entityId),
      };
    })
    .filter(
      (target) => Number.isInteger(target.entityId) && target.entityId > 0,
    );
  if (!targets.length) throw new Error("소급 적용할 기록을 선택해 주세요.");
  await connectBudgetRowsToGroup(d1, member, {
    groupId,
    targets,
    action: "apply-retrofit",
    requestId: cleanBudgetName(input.requestId) || undefined,
  });
  return listBudgetNameManagement();
}

export async function undoBudgetEvent(member: Member, eventIdInput: unknown) {
  const d1 = await ensureBudgetNamesReady();
  const eventId = Number(eventIdInput);
  const event = await d1
    .prepare(
      `SELECT id, group_id AS groupId, action, snapshot_json AS snapshotJson
       FROM budget_name_events WHERE id = ?`,
    )
    .bind(eventId)
    .first<{
      id: number;
      groupId: number | null;
      action: string;
      snapshotJson: string;
    }>();
  if (!event) throw new Error("되돌릴 변경 이력을 찾을 수 없습니다.");
  if (
    !event.groupId ||
    !["group", "register-new", "create-standard"].includes(event.action)
  ) {
    throw new Error(
      "이 작업은 일부 기록만 임의로 되돌릴 수 없습니다. 변경 이력을 확인해 주세요.",
    );
  }
  return undoBudgetGroup(member, Number(event.groupId));
}
