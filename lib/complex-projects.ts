import { getD1, isPostgresDatabase } from "../db";
import type { Member } from "./collaboration";
import { ensureBudgetNamesReady, linkBudgetNameEntity, normalizeBudgetNameKey } from "./budget-names";
import { ensureEquipmentReady } from "./equipment-store";
import {
  ensureOrganizationSchedulesReady,
  refreshOrganizationScheduleMirror,
} from "./organization-schedules";
import { ensureRecordsReady } from "./records-store";
import { ensureMapReady } from "./map-store";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS complex_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '준비',
    total_budget INTEGER,
    source_type TEXT NOT NULL DEFAULT 'whizzup',
    source_award_status TEXT NOT NULL DEFAULT '위즈업 수주',
    manager_member_id INTEGER,
    manager_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization, business_round)
  )`,
  `CREATE INDEX IF NOT EXISTS complex_projects_active_idx
   ON complex_projects (active, status, updated_at, id)`,
  `CREATE INDEX IF NOT EXISTS complex_projects_source_idx
   ON complex_projects (source_type, active, organization, business_round)`,
  `CREATE TABLE IF NOT EXISTS complex_project_budget_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complex_project_id INTEGER NOT NULL,
    equipment_project_id INTEGER NOT NULL,
    allocated_amount INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (complex_project_id, equipment_project_id)
  )`,
  `CREATE INDEX IF NOT EXISTS complex_project_budget_links_project_idx
   ON complex_project_budget_links (complex_project_id, sort_order, id)`,
  `CREATE TABLE IF NOT EXISTS complex_project_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complex_project_id INTEGER NOT NULL,
    building TEXT NOT NULL DEFAULT '',
    floor TEXT NOT NULL DEFAULT '',
    room TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS complex_project_zones_project_idx
   ON complex_project_zones (complex_project_id, sort_order, id)`,
  `CREATE TABLE IF NOT EXISTS complex_project_item_details (
    equipment_item_id INTEGER PRIMARY KEY,
    complex_project_id INTEGER NOT NULL,
    zone_id INTEGER,
    item_category TEXT NOT NULL DEFAULT '기자재',
    procurement_method TEXT NOT NULL DEFAULT '',
    procurement_identifier TEXT NOT NULL DEFAULT '',
    delivery_location TEXT NOT NULL DEFAULT '',
    selection_round TEXT NOT NULL DEFAULT '',
    selection_status TEXT NOT NULL DEFAULT '',
    change_reason TEXT NOT NULL DEFAULT '',
    electrical_requirements TEXT NOT NULL DEFAULT '',
    network_requirements TEXT NOT NULL DEFAULT '',
    protection_vendor_name TEXT NOT NULL DEFAULT '',
    protection_state TEXT NOT NULL DEFAULT '신청 필요',
    protection_expires_at TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS complex_project_item_details_project_idx
   ON complex_project_item_details (complex_project_id, zone_id, equipment_item_id)`,
  `CREATE TABLE IF NOT EXISTS complex_project_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complex_project_id INTEGER NOT NULL,
    equipment_item_id INTEGER NOT NULL,
    schedule_id INTEGER,
    kind TEXT NOT NULL DEFAULT '납품',
    planned_qty INTEGER NOT NULL DEFAULT 0,
    completed_qty INTEGER NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    vendor_name TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '일정 미정',
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS complex_project_deliveries_project_idx
   ON complex_project_deliveries (complex_project_id, start_date, id)`,
  `CREATE INDEX IF NOT EXISTS complex_project_deliveries_item_idx
   ON complex_project_deliveries (equipment_item_id, status, id)`,
  `CREATE TABLE IF NOT EXISTS complex_project_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complex_project_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS complex_project_events_project_idx
   ON complex_project_events (complex_project_id, created_at, id)`,
];

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

function clean(value: unknown, length = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function nullableMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validDate(value: unknown) {
  const date = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

async function initializeComplexProjects() {
  // Vercel/Postgres applies the versioned schema once in db/index.ts. Running
  // every subsystem migration and the historical item backfill on each cold
  // start made institution search and the first mutation unnecessarily slow.
  if (isPostgresDatabase()) return getD1();
  await Promise.all([
    ensureRecordsReady(),
    ensureEquipmentReady(),
    ensureBudgetNamesReady(),
    ensureOrganizationSchedulesReady(),
    ensureMapReady(),
  ]);
  const d1 = getD1();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  const projectColumns = await d1
    .prepare("PRAGMA table_info(complex_projects)")
    .all<{ name: string }>();
  if (!projectColumns.results.some((column) => column.name === "manager_member_id")) {
    await d1.prepare("ALTER TABLE complex_projects ADD COLUMN manager_member_id INTEGER").run();
  }
  if (!projectColumns.results.some((column) => column.name === "source_type")) {
    await d1.prepare("ALTER TABLE complex_projects ADD COLUMN source_type TEXT NOT NULL DEFAULT 'whizzup'").run();
  }
  if (!projectColumns.results.some((column) => column.name === "source_award_status")) {
    await d1.prepare("ALTER TABLE complex_projects ADD COLUMN source_award_status TEXT NOT NULL DEFAULT '위즈업 수주'").run();
  }
  const detailColumns = await d1
    .prepare("PRAGMA table_info(complex_project_item_details)")
    .all<{ name: string }>();
  const detailMigrations = [
    ["selection_round", "ALTER TABLE complex_project_item_details ADD COLUMN selection_round TEXT NOT NULL DEFAULT ''"],
    ["selection_status", "ALTER TABLE complex_project_item_details ADD COLUMN selection_status TEXT NOT NULL DEFAULT ''"],
    ["change_reason", "ALTER TABLE complex_project_item_details ADD COLUMN change_reason TEXT NOT NULL DEFAULT ''"],
    ["electrical_requirements", "ALTER TABLE complex_project_item_details ADD COLUMN electrical_requirements TEXT NOT NULL DEFAULT ''"],
    ["network_requirements", "ALTER TABLE complex_project_item_details ADD COLUMN network_requirements TEXT NOT NULL DEFAULT ''"],
    ["protection_vendor_name", "ALTER TABLE complex_project_item_details ADD COLUMN protection_vendor_name TEXT NOT NULL DEFAULT ''"],
    ["protection_state", "ALTER TABLE complex_project_item_details ADD COLUMN protection_state TEXT NOT NULL DEFAULT '신청 필요'"],
    ["protection_expires_at", "ALTER TABLE complex_project_item_details ADD COLUMN protection_expires_at TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [column, sql] of detailMigrations) {
    if (!detailColumns.results.some((entry) => entry.name === column)) {
      await d1.prepare(sql).run();
    }
  }
  const scheduleColumns = await d1
    .prepare("PRAGMA table_info(organization_schedules)")
    .all<{ name: string }>();
  if (!scheduleColumns.results.some((column: { name: string }) => column.name === "complex_delivery_id")) {
    await d1.prepare("ALTER TABLE organization_schedules ADD COLUMN complex_delivery_id INTEGER").run();
  }
  await d1.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS organization_schedules_complex_delivery_idx
     ON organization_schedules (complex_delivery_id)
     WHERE complex_delivery_id IS NOT NULL`,
  ).run();
  await d1.prepare(
    `INSERT OR IGNORE INTO complex_project_item_details
       (equipment_item_id, complex_project_id, item_category, updated_by_name)
     SELECT item.id, link.complex_project_id, '기자재', ''
     FROM complex_project_budget_links link
     JOIN equipment_items item ON item.project_id = link.equipment_project_id`,
  ).run();
  return d1;
}

export function ensureComplexProjectsReady() {
  if (!readyPromise) {
    readyPromise = initializeComplexProjects().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

async function writeEvent(
  d1: ReturnType<typeof getD1>,
  projectId: number,
  action: string,
  detail: unknown,
  member: Member,
) {
  await d1.prepare(
    `INSERT INTO complex_project_events
       (complex_project_id, action, detail_json, changed_by, changed_by_name)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(projectId, action, JSON.stringify(detail ?? {}), member.id, member.displayName).run();
}

async function requireProject(d1: ReturnType<typeof getD1>, projectId: number) {
  const project = await d1.prepare("SELECT * FROM complex_projects WHERE id = ? AND active = 1")
    .bind(projectId).first<Record<string, unknown>>();
  if (!project) throw new Error("복합사업을 찾지 못했습니다.");
  return project;
}

async function syncBudgetLinks(d1: ReturnType<typeof getD1>, projectId: number) {
  const project = await requireProject(d1, projectId);
  if (clean(project.source_type, 30) !== "whizzup") return;
  await d1.prepare(
    `INSERT INTO complex_project_budget_links
       (complex_project_id, equipment_project_id, sort_order)
     SELECT ?, ep.id,
            COALESCE((SELECT MAX(sort_order) + 1 FROM complex_project_budget_links WHERE complex_project_id = ?), 0)
              + ROW_NUMBER() OVER (ORDER BY ep.id) - 1
     FROM equipment_projects ep
     JOIN activities activity ON activity.id = ep.activity_id
     WHERE ep.organization = ? AND ep.business_round = ?
       AND activity.award_status = '위즈업 수주'
       AND NOT EXISTS (
         SELECT 1 FROM complex_project_budget_links link
         WHERE link.complex_project_id = ? AND link.equipment_project_id = ep.id
       )
     ON CONFLICT(complex_project_id, equipment_project_id) DO NOTHING`,
  ).bind(
    projectId,
    projectId,
    String(project.organization),
    Number(project.business_round),
    projectId,
  ).run();
  await d1.prepare(
    `INSERT OR IGNORE INTO complex_project_item_details
       (equipment_item_id, complex_project_id, item_category, updated_by_name)
     SELECT item.id, ?, '기자재', ''
     FROM equipment_items item
     JOIN complex_project_budget_links link ON link.equipment_project_id = item.project_id
     WHERE link.complex_project_id = ?`,
  ).bind(projectId, projectId).run();
}

export async function listComplexProjects() {
  const d1 = await ensureComplexProjectsReady();
  const [projectResult, budgetResult, zoneResult, itemResult, deliveryResult, groupResult, memberResult] = await d1.batch([
    d1.prepare(
      `SELECT * FROM complex_projects WHERE active = 1
       ORDER BY CASE status WHEN '진행' THEN 0 WHEN '준비' THEN 1 WHEN '완료' THEN 2 ELSE 3 END,
                updated_at DESC, id DESC`,
    ),
    d1.prepare(
      `SELECT link.*, ep.organization, ep.business_round, ep.name, ep.status,
              ep.budget_type, ep.budget_original_name, ep.budget_group_id,
              ep.construction_amount, ep.actual_construction_cost
       FROM complex_project_budget_links link
       JOIN equipment_projects ep ON ep.id = link.equipment_project_id
       ORDER BY link.complex_project_id, link.sort_order, link.id`,
    ),
    d1.prepare("SELECT * FROM complex_project_zones ORDER BY complex_project_id, sort_order, id"),
    d1.prepare(
      `SELECT link.complex_project_id, item.id AS equipment_item_id,
              detail.zone_id,
              COALESCE(detail.item_category, '기자재') AS item_category,
              COALESCE(detail.procurement_method, '') AS procurement_method,
              COALESCE(detail.procurement_identifier, '') AS procurement_identifier,
              COALESCE(detail.delivery_location, '') AS delivery_location,
              COALESCE(detail.selection_round, '') AS selection_round,
              COALESCE(detail.selection_status, '') AS selection_status,
              COALESCE(detail.change_reason, '') AS change_reason,
              COALESCE(detail.electrical_requirements, '') AS electrical_requirements,
              COALESCE(detail.network_requirements, '') AS network_requirements,
              COALESCE(detail.protection_vendor_name, '') AS protection_vendor_name,
              COALESCE(detail.protection_state, item.protection_status, '신청 필요') AS protection_state,
              COALESCE(detail.protection_expires_at, '') AS protection_expires_at,
              detail.updated_by, detail.updated_by_name, detail.updated_at,
              item.project_id, item.product_name, item.specification,
              item.proposed_qty, item.awarded_qty, item.installed_qty, item.unit,
              item.status, item.notes, item.catalog_unit_price, item.price_status,
              item.supplier_vendor_name, item.protection_status,
              ep.name AS budget_name, ep.budget_group_id
       FROM complex_project_budget_links link
       JOIN equipment_items item ON item.project_id = link.equipment_project_id
       LEFT JOIN complex_project_item_details detail ON detail.equipment_item_id = item.id
       JOIN equipment_projects ep ON ep.id = item.project_id
       ORDER BY link.complex_project_id, item.sort_order, item.id`,
    ),
    d1.prepare("SELECT * FROM complex_project_deliveries ORDER BY complex_project_id, start_date, id"),
    d1.prepare(
      `SELECT id, canonical_name, budget_kind, amount_mode, default_amount
       FROM budget_name_groups WHERE active = 1
       ORDER BY sort_order, canonical_name COLLATE NOCASE, id`,
    ),
    d1.prepare(
      `SELECT id, display_name, email
       FROM members
       WHERE status = 'approved' AND is_sales = 1
       ORDER BY display_name COLLATE NOCASE, id`,
    ),
  ]);

  const budgetsByProject = new Map<number, Record<string, unknown>[]>();
  budgetResult.results.forEach((row: Record<string, unknown>) => {
    const id = Number(row.complex_project_id);
    budgetsByProject.set(id, [...(budgetsByProject.get(id) ?? []), row]);
  });
  const zonesByProject = new Map<number, Record<string, unknown>[]>();
  zoneResult.results.forEach((row: Record<string, unknown>) => {
    const id = Number(row.complex_project_id);
    zonesByProject.set(id, [...(zonesByProject.get(id) ?? []), row]);
  });
  const deliveriesByItem = new Map<number, Record<string, unknown>[]>();
  deliveryResult.results.forEach((row: Record<string, unknown>) => {
    const id = Number(row.equipment_item_id);
    deliveriesByItem.set(id, [...(deliveriesByItem.get(id) ?? []), row]);
  });
  const itemsByProject = new Map<number, Record<string, unknown>[]>();
  itemResult.results.forEach((row: Record<string, unknown>) => {
    const projectId = Number(row.complex_project_id);
    const awardedQty = integer(row.awarded_qty);
    const deliveries = deliveriesByItem.get(Number(row.equipment_item_id)) ?? [];
    const activeDeliveries = deliveries.filter((entry) => String(entry.status) !== "취소");
    const plannedQty = activeDeliveries.reduce((sum, entry) => sum + integer(entry.planned_qty), 0);
    const completedQty = activeDeliveries.reduce((sum, entry) => sum + integer(entry.completed_qty), 0);
    itemsByProject.set(projectId, [
      ...(itemsByProject.get(projectId) ?? []),
      {
        ...row,
        deliveries,
        planned_delivery_qty: plannedQty,
        completed_delivery_qty: completedQty,
        schedule_state: !activeDeliveries.some((entry) => clean(entry.start_date))
          ? "일정 미정"
          : plannedQty < awardedQty
            ? "수량 미배정"
            : plannedQty > awardedQty
              ? "수량 초과"
              : completedQty >= awardedQty && awardedQty > 0
                ? "납품 완료"
                : "일정 등록",
      },
    ]);
  });

  return {
    projects: projectResult.results.map((project: Record<string, unknown>) => {
      const id = Number(project.id);
      const budgets = budgetsByProject.get(id) ?? [];
      const items = itemsByProject.get(id) ?? [];
      const allocated = budgets.reduce((sum, row) => sum + integer(row.allocated_amount), 0);
      const quoted = items.reduce((sum, row) => sum + integer(row.awarded_qty) * integer(row.catalog_unit_price), 0)
        + budgets.reduce((sum, row) => sum + integer(row.construction_amount), 0);
      return {
        ...project,
        budgets,
        zones: zonesByProject.get(id) ?? [],
        items,
        summary: {
          allocated_amount: allocated,
          quote_amount: quoted,
          item_count: items.length,
          unscheduled_count: items.filter((row) => row.schedule_state === "일정 미정" || row.schedule_state === "수량 미배정").length,
          protection_needed_count: items.filter((row) => {
            const state = clean(row.protection_state || row.protection_status);
            return !["신청 완료", "승인", "보호 중", "해당 없음"].includes(state);
          }).length,
          quantity_issue_count: items.filter((row) => row.schedule_state === "수량 초과").length,
          price_missing_count: items.filter((row) => row.catalog_unit_price === null || row.catalog_unit_price === undefined).length,
          selection_pending_count: items.filter((row) => {
            const status = clean(row.selection_status);
            return Boolean(status) && !["선정 완료", "확정"].includes(status);
          }).length,
          budget_unassigned_count: items.filter((row) => !Number(row.budget_group_id)).length,
          remaining_budget: project.total_budget === null || project.total_budget === undefined
            ? null
            : integer(project.total_budget) - quoted,
        },
      };
    }),
    budgetGroups: groupResult.results,
    members: memberResult.results,
    candidates: [],
  };
}

export async function searchComplexProjectCandidates(value: unknown) {
  const query = clean(value, 80);
  if (query.replace(/\s+/g, "").length < 2) return [];
  // Candidate search only needs the already-versioned Postgres schema. Avoid
  // waiting for the full complex-project page initialization on every search.
  const d1 = getD1();
  const like = `%${query.toLocaleLowerCase("ko-KR")}%`;
  const result = await d1.prepare(
    `WITH latest AS (
       SELECT a.*,
              ROW_NUMBER() OVER (
                PARTITION BY a.organization, a.business_round
                ORDER BY a.activity_date DESC, a.id DESC
              ) AS row_number
       FROM activities a
       WHERE a.award_status = '위즈업 수주'
         AND (
           LOWER(a.organization) LIKE ?
           OR LOWER(COALESCE(a.region, '')) LIKE ?
         )
     )
     SELECT latest.organization, latest.business_round, latest.region,
            latest.progress_manager,
            CASE WHEN latest.award_status = '위즈업 수주' THEN 1 ELSE 0 END AS whizzup_award,
            latest.award_status, latest.activity_date AS latest_date,
            COALESCE(location.road_address, location.address, '') AS address,
            existing.id AS complex_project_id,
            existing.name AS complex_project_name
     FROM latest
     LEFT JOIN organization_locations location
       ON location.organization = latest.organization
     LEFT JOIN complex_projects existing
       ON existing.organization = latest.organization
      AND existing.business_round = latest.business_round
      AND existing.active = 1
     WHERE latest.row_number = 1
     ORDER BY latest.activity_date DESC, latest.organization COLLATE NOCASE
     LIMIT 30`,
  ).bind(like, like).all<Record<string, unknown>>();
  return result.results;
}

export async function createComplexProject(payload: Record<string, unknown>, member: Member) {
  const d1 = await ensureComplexProjectsReady();
  const organization = clean(payload.organization, 120);
  const businessRound = Math.max(1, integer(payload.businessRound, 1));
  const sourceType = clean(payload.sourceType, 30) === "external" ? "external" : "whizzup";
  if (!organization) throw new Error("복합사업 기관을 선택해 주세요.");
  const activity = sourceType === "whizzup" ? await d1.prepare(
    `SELECT id, award_status FROM activities WHERE organization = ? AND business_round = ?
       AND award_status = '위즈업 수주'
     ORDER BY activity_date DESC, id DESC LIMIT 1`,
  ).bind(organization, businessRound).first<{ id: number; award_status: string }>() : null;
  if (sourceType === "whizzup" && !activity) {
    throw new Error("위즈업 수주로 확정된 기관·사업 차수를 찾지 못했습니다.");
  }
  const existingSource = await d1.prepare(
    `SELECT id, source_type FROM complex_projects
     WHERE organization = ? AND business_round = ? LIMIT 1`,
  ).bind(organization, businessRound).first<{ id: number; source_type: string }>();
  if (existingSource && clean(existingSource.source_type, 30) !== sourceType) {
    throw new Error("같은 기관·차수에 다른 출처의 복합사업이 이미 있습니다. 기존 사업을 열어 확인해 주세요.");
  }
  const name = clean(payload.name, 160) || `${organization} 복합사업`;
  const requestedManagerId = integer(payload.managerMemberId) || null;
  const requestedManager = requestedManagerId
    ? await d1.prepare(
        `SELECT id, display_name FROM members
         WHERE id = ? AND status = 'approved' AND is_sales = 1`,
      ).bind(requestedManagerId).first<{ id: number; display_name: string }>()
    : null;
  if (requestedManagerId && !requestedManager) {
    throw new Error("승인된 영업담당자를 선택해 주세요.");
  }
  const managerName = requestedManager?.display_name || clean(payload.managerName, 120);
  let savedProjectId = 0;
  await d1.transaction(async (transaction) => {
    await transaction.prepare(
      `INSERT INTO complex_projects
         (organization, business_round, name, status, total_budget, source_type, source_award_status,
          manager_member_id, manager_name, notes,
          created_by, created_by_name, updated_by, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization, business_round) DO UPDATE SET
         name = excluded.name, status = excluded.status,
         total_budget = COALESCE(excluded.total_budget, complex_projects.total_budget),
         source_type = excluded.source_type,
         source_award_status = excluded.source_award_status,
         manager_member_id = COALESCE(excluded.manager_member_id, complex_projects.manager_member_id),
         manager_name = CASE WHEN excluded.manager_name <> '' THEN excluded.manager_name ELSE complex_projects.manager_name END,
         notes = excluded.notes, active = 1,
         updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      organization,
      businessRound,
      name,
      clean(payload.status, 30) || "준비",
      nullableMoney(payload.totalBudget),
      sourceType,
      sourceType === "whizzup" ? "위즈업 수주" : clean(payload.sourceAwardStatus, 40) || "외부 사업",
      requestedManager?.id ?? null,
      managerName,
      clean(payload.notes, 1000),
      member.id,
      member.displayName,
      member.id,
      member.displayName,
    ).run();
    const project = await transaction.prepare(
      "SELECT id FROM complex_projects WHERE organization = ? AND business_round = ?",
    ).bind(organization, businessRound).first<{ id: number }>();
    if (!project) throw new Error("복합사업을 저장하지 못했습니다.");
    savedProjectId = Number(project.id);
    await syncBudgetLinks(transaction, project.id);
    await transaction.prepare(
      `INSERT INTO construction_schedule_projects
         (organization, business_round, work_summary, work_summary_mode, completed,
          created_by, created_by_name, updated_by, updated_by_name)
       VALUES (?, ?, ?, 'manual', 0, ?, ?, ?, ?)
       ON CONFLICT(organization, business_round) DO UPDATE SET
         work_summary = CASE
           WHEN TRIM(construction_schedule_projects.work_summary) = ''
             THEN excluded.work_summary
           ELSE construction_schedule_projects.work_summary
         END,
         hidden_at = '', updated_by = excluded.updated_by,
         updated_by_name = excluded.updated_by_name, updated_at = CURRENT_TIMESTAMP`,
    ).bind(organization, businessRound, name, member.id, member.displayName, member.id, member.displayName).run();
    await writeEvent(transaction, project.id, "create_or_enable", { organization, businessRound, name, sourceType }, member);
  });
  return { projectId: savedProjectId };
}

export async function updateComplexProject(payload: Record<string, unknown>, member: Member) {
  const d1 = await ensureComplexProjectsReady();
  const projectId = integer(payload.projectId);
  const requestedManagerId = integer(payload.managerMemberId) || null;
  await d1.transaction(async (transaction) => {
    await requireProject(transaction, projectId);
    const requestedManager = requestedManagerId
      ? await transaction.prepare(
          `SELECT id, display_name FROM members
           WHERE id = ? AND status = 'approved' AND is_sales = 1`,
        ).bind(requestedManagerId).first<{ id: number; display_name: string }>()
      : null;
    if (requestedManagerId && !requestedManager) throw new Error("승인된 영업담당자를 선택해 주세요.");
    await transaction.prepare(
      `UPDATE complex_projects SET name = ?, status = ?, total_budget = ?, manager_member_id = ?, manager_name = ?, notes = ?,
         updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(
      clean(payload.name, 160), clean(payload.status, 30) || "준비",
      nullableMoney(payload.totalBudget), requestedManager?.id ?? null,
      requestedManager?.display_name || clean(payload.managerName, 120), clean(payload.notes, 1000),
      member.id, member.displayName, projectId,
    ).run();
    await writeEvent(transaction, projectId, "update_project", payload, member);
  });
  return { projectId };
}

export async function addComplexBudget(payload: Record<string, unknown>, member: Member) {
  const d1 = await ensureComplexProjectsReady();
  const projectId = integer(payload.projectId);
  const groupId = integer(payload.budgetGroupId);
  let equipmentProjectId = 0;
  await d1.transaction(async (transaction) => {
    const project = await requireProject(transaction, projectId);
    const group = await transaction.prepare(
      `SELECT id, canonical_name, canonical_key, budget_kind
       FROM budget_name_groups WHERE id = ? AND active = 1`,
    ).bind(groupId).first<Record<string, unknown>>();
    if (!group) throw new Error("등록된 표준 예산명을 선택해 주세요.");
    const isExternal = clean(project.source_type, 30) === "external";
    const existing = await transaction.prepare(
      `SELECT ep.id FROM equipment_projects ep
       LEFT JOIN activities activity ON activity.id = ep.activity_id
       WHERE ep.organization = ? AND ep.business_round = ? AND ep.budget_group_id = ?
         AND (
           (? = 1 AND ep.activity_id IS NULL)
           OR (? = 0 AND activity.award_status = '위즈업 수주')
         )
       LIMIT 1`,
    ).bind(
      String(project.organization), Number(project.business_round), groupId,
      isExternal ? 1 : 0, isExternal ? 1 : 0,
    ).first<{ id: number }>();
    equipmentProjectId = Number(existing?.id ?? 0);
    if (!equipmentProjectId) {
      const activity = isExternal ? null : await transaction.prepare(
        `SELECT id FROM activities WHERE organization = ? AND business_round = ?
           AND award_status = '위즈업 수주'
         ORDER BY activity_date DESC, id DESC LIMIT 1`,
      ).bind(String(project.organization), Number(project.business_round)).first<{ id: number }>();
      const inserted = await transaction.prepare(
        `INSERT INTO equipment_projects
          (organization, business_round, name, status, budget_type, budget_original_name,
           budget_group_id, budget_match_status, budget_match_method, budget_kind, notes,
           activity_id, created_by)
         VALUES (?, ?, ?, '수주', ?, ?, ?, 'auto', 'admin', ?, '', ?, ?)
         RETURNING id`,
      ).bind(
        String(project.organization), Number(project.business_round), String(group.canonical_name),
        String(group.canonical_name), String(group.canonical_name), groupId,
        String(group.budget_kind), activity?.id ?? null, member.id,
      ).first<{ id: number }>();
      equipmentProjectId = Number(inserted?.id ?? 0);
      if (!equipmentProjectId) throw new Error("예산별 품목 카드를 만들지 못했습니다.");
      await linkBudgetNameEntity(transaction, {
        entityType: "equipment_project",
        entityId: equipmentProjectId,
        groupId,
        originalName: String(group.canonical_name),
        aliasKey: normalizeBudgetNameKey(String(group.canonical_name)),
      });
    }
    await transaction.prepare(
      `INSERT INTO complex_project_budget_links
         (complex_project_id, equipment_project_id, allocated_amount, sort_order)
       VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM complex_project_budget_links WHERE complex_project_id = ?), 0))
       ON CONFLICT(complex_project_id, equipment_project_id) DO UPDATE SET
         allocated_amount = excluded.allocated_amount, updated_at = CURRENT_TIMESTAMP`,
    ).bind(projectId, equipmentProjectId, nullableMoney(payload.allocatedAmount), projectId).run();
    await transaction.prepare(
      `INSERT OR IGNORE INTO complex_project_item_details
         (equipment_item_id, complex_project_id, item_category, updated_by_name)
       SELECT id, ?, '기자재', '' FROM equipment_items WHERE project_id = ?`,
    ).bind(projectId, equipmentProjectId).run();
    await writeEvent(transaction, projectId, "add_budget", { groupId, equipmentProjectId, allocatedAmount: payload.allocatedAmount }, member);
  });
  return { projectId, equipmentProjectId };
}

export async function saveComplexZone(payload: Record<string, unknown>, member: Member) {
  const d1 = await ensureComplexProjectsReady();
  const projectId = integer(payload.projectId);
  const zoneId = integer(payload.zoneId);
  const name = clean(payload.name, 120);
  if (!name) throw new Error("공간명을 입력해 주세요.");
  let savedZoneId = zoneId;
  await d1.transaction(async (transaction) => {
    await requireProject(transaction, projectId);
    if (zoneId) {
      await transaction.prepare(
        `UPDATE complex_project_zones SET building = ?, floor = ?, room = ?, name = ?, notes = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ? AND complex_project_id = ?`,
      ).bind(clean(payload.building, 80), clean(payload.floor, 40), clean(payload.room, 80), name, clean(payload.notes, 500), zoneId, projectId).run();
    } else {
      const inserted = await transaction.prepare(
        `INSERT INTO complex_project_zones
         (complex_project_id, building, floor, room, name, notes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM complex_project_zones WHERE complex_project_id = ?), 0))
         RETURNING id`,
      ).bind(projectId, clean(payload.building, 80), clean(payload.floor, 40), clean(payload.room, 80), name, clean(payload.notes, 500), projectId).first<{ id: number }>();
      savedZoneId = Number(inserted?.id ?? 0);
      if (!savedZoneId) throw new Error("공간을 저장하지 못했습니다.");
    }
    await writeEvent(transaction, projectId, zoneId ? "update_zone" : "add_zone", { zoneId: savedZoneId, name }, member);
  });
  return { projectId, zoneId: savedZoneId };
}

export async function saveComplexItem(payload: Record<string, unknown>, member: Member) {
  const d1 = await ensureComplexProjectsReady();
  const projectId = integer(payload.projectId);
  let savedId = 0;
  await d1.transaction(async (transaction) => {
  await requireProject(transaction, projectId);
  const budgetLink = await transaction.prepare(
    `SELECT equipment_project_id FROM complex_project_budget_links
     WHERE complex_project_id = ? AND equipment_project_id = ?`,
  ).bind(projectId, integer(payload.equipmentProjectId)).first<{ equipment_project_id: number }>();
  if (!budgetLink) throw new Error("품목을 연결할 예산을 선택해 주세요.");
  const itemId = integer(payload.itemId);
  const productName = clean(payload.productName, 180);
  if (!productName) throw new Error("품목명을 입력해 주세요.");
  const proposedQty = integer(payload.proposedQty ?? payload.awardedQty);
  const awardedQty = integer(payload.awardedQty);
  const installedQty = integer(payload.installedQty);
  const unitPrice = nullableMoney(payload.unitPrice);
  const protectionDetail = clean(payload.protectionStatus, 30) || "신청 필요";
  const protectionResolved = ["신청 완료", "승인", "보호 중", "해당 없음"].includes(protectionDetail);
  const protectionStatus = protectionResolved ? "신청 완료" : "신청 필요";
  const zoneId = integer(payload.zoneId) || null;
  if (zoneId) {
    const zone = await transaction.prepare("SELECT id FROM complex_project_zones WHERE id = ? AND complex_project_id = ?")
      .bind(zoneId, projectId).first<{ id: number }>();
    if (!zone) throw new Error("선택한 설치 공간을 찾지 못했습니다.");
  }
  savedId = itemId;
  if (itemId) {
    const linkedItem = await transaction.prepare(
      `SELECT item.id AS equipment_item_id
       FROM equipment_items item
       JOIN complex_project_budget_links link ON link.equipment_project_id = item.project_id
       WHERE item.id = ? AND link.complex_project_id = ?`,
    ).bind(itemId, projectId).first<{ equipment_item_id: number }>();
    if (!linkedItem) throw new Error("수정할 복합사업 품목을 찾지 못했습니다.");
    await transaction.prepare(
      `UPDATE equipment_items SET project_id = ?, product_name = ?, specification = ?, proposed_qty = ?, awarded_qty = ?,
       installed_qty = ?, unit = ?, status = ?, notes = ?, catalog_unit_price = ?, price_status = ?,
       supplier_vendor_name = ?, protection_status = ?, protection_completed_at = ?, updated_by = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(
      Number(budgetLink.equipment_project_id), productName, clean(payload.specification, 400), proposedQty, awardedQty, installedQty,
      clean(payload.unit, 20) || "대", clean(payload.status, 30) || "수주", clean(payload.notes, 1000),
      unitPrice, unitPrice === null ? "금액 미입력" : "입력 완료", clean(payload.supplierName, 160),
      protectionStatus, protectionResolved ? new Date().toISOString() : null,
      member.id, itemId,
    ).run();
  } else {
    const inserted = await transaction.prepare(
      `INSERT INTO equipment_items
       (project_id, product_name, specification, proposed_qty, awarded_qty, installed_qty, unit,
        status, notes, catalog_unit_price, price_status, supplier_vendor_name, protection_status,
        protection_completed_at, created_by, updated_by, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         COALESCE((SELECT MAX(sort_order) + 1 FROM equipment_items WHERE project_id = ?), 0))
       RETURNING id`,
    ).bind(
      Number(budgetLink.equipment_project_id), productName, clean(payload.specification, 400), proposedQty,
      awardedQty, installedQty, clean(payload.unit, 20) || "대", clean(payload.status, 30) || "수주",
      clean(payload.notes, 1000), unitPrice, unitPrice === null ? "금액 미입력" : "입력 완료",
      clean(payload.supplierName, 160), protectionStatus,
      protectionResolved ? new Date().toISOString() : null,
      member.id, member.id, Number(budgetLink.equipment_project_id),
    ).first<{ id: number }>();
    savedId = Number(inserted?.id ?? 0);
  }
  if (!savedId) throw new Error("품목을 저장하지 못했습니다.");
  await transaction.prepare(
    `INSERT INTO complex_project_item_details
       (equipment_item_id, complex_project_id, zone_id, item_category, procurement_method,
        procurement_identifier, delivery_location, selection_round, selection_status,
        change_reason, electrical_requirements, network_requirements,
        protection_vendor_name, protection_state, protection_expires_at, updated_by, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(equipment_item_id) DO UPDATE SET
       complex_project_id = excluded.complex_project_id, zone_id = excluded.zone_id,
       item_category = excluded.item_category, procurement_method = excluded.procurement_method,
       procurement_identifier = excluded.procurement_identifier,
       delivery_location = excluded.delivery_location,
       selection_round = excluded.selection_round,
       selection_status = excluded.selection_status,
       change_reason = excluded.change_reason,
       electrical_requirements = excluded.electrical_requirements,
       network_requirements = excluded.network_requirements,
       protection_vendor_name = excluded.protection_vendor_name,
       protection_state = excluded.protection_state,
       protection_expires_at = excluded.protection_expires_at,
       updated_by = excluded.updated_by,
       updated_by_name = excluded.updated_by_name, updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    savedId, projectId, zoneId, clean(payload.itemCategory, 40) || "기자재",
    clean(payload.procurementMethod, 80), clean(payload.procurementIdentifier, 120),
    clean(payload.deliveryLocation, 160), clean(payload.selectionRound, 40),
    clean(payload.selectionStatus, 40), clean(payload.changeReason, 500),
    clean(payload.electricalRequirements, 500), clean(payload.networkRequirements, 500),
    clean(payload.protectionVendorName, 160) || clean(payload.supplierName, 160),
    protectionDetail, validDate(payload.protectionExpiresAt), member.id, member.displayName,
  ).run();
  await transaction.prepare("UPDATE equipment_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(Number(budgetLink.equipment_project_id)).run();
  await writeEvent(transaction, projectId, itemId ? "update_item" : "add_item", { itemId: savedId, productName }, member);
  });
  return { projectId, itemId: savedId };
}

async function syncDeliverySchedule(
  d1: ReturnType<typeof getD1>,
  deliveryId: number,
  project: Record<string, unknown>,
  item: Record<string, unknown>,
  payload: Record<string, unknown>,
  member: Member,
) {
  const startDate = validDate(payload.startDate);
  const endDate = validDate(payload.endDate) || startDate;
  const existing = await d1.prepare("SELECT schedule_id FROM complex_project_deliveries WHERE id = ?")
    .bind(deliveryId).first<{ schedule_id: number | null }>();
  if (!startDate || clean(payload.status, 30) === "일정 미정" || clean(payload.status, 30) === "취소") {
    if (existing?.schedule_id) {
      await d1.prepare(
        `UPDATE organization_schedules SET deleted_at = CURRENT_TIMESTAMP,
         sync_status = CASE WHEN TRIM(COALESCE(google_event_id, '')) <> '' THEN 'pending' ELSE 'local_only' END,
         sync_operation = CASE WHEN TRIM(COALESCE(google_event_id, '')) <> '' THEN 'delete' ELSE 'unlink' END,
         updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(member.id, member.displayName, existing.schedule_id).run();
      await d1.prepare("UPDATE complex_project_deliveries SET schedule_id = NULL WHERE id = ?").bind(deliveryId).run();
    }
    return;
  }
  const kind = clean(payload.kind, 40) || "납품";
  const productName = clean(item.product_name, 120);
  const label = `${kind} · ${productName}`.slice(0, 120);
  const completed = clean(payload.status, 30) === "완료" ? 1 : 0;
  if (existing?.schedule_id) {
    await d1.prepare(
      `UPDATE organization_schedules SET organization = ?, business_round = ?, label = ?, scheduled_date = ?,
       category = 'construction', stage = ?, end_date = ?, vendor_name = ?, details = ?, completed = ?,
       deleted_at = '', sync_status = 'pending', sync_operation = 'upsert', sync_error = '',
       updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(
      String(project.organization), Number(project.business_round), label, startDate, kind, endDate,
      clean(payload.vendorName, 160), clean(payload.notes, 500), completed,
      member.id, member.displayName, existing.schedule_id,
    ).run();
    return;
  }
  const schedule = await d1.prepare(
    `INSERT INTO organization_schedules
     (organization, business_round, label, scheduled_date, category, stage, end_date, vendor_name,
      details, completed, complex_delivery_id, created_by, created_by_name, updated_by, updated_by_name,
      sync_status, sync_operation)
     VALUES (?, ?, ?, ?, 'construction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'upsert')
     RETURNING id`,
  ).bind(
    String(project.organization), Number(project.business_round), label, startDate, kind, endDate,
    clean(payload.vendorName, 160), clean(payload.notes, 500), completed, deliveryId,
    member.id, member.displayName, member.id, member.displayName,
  ).first<{ id: number }>();
  if (schedule?.id) {
    await d1.prepare("UPDATE complex_project_deliveries SET schedule_id = ? WHERE id = ?")
      .bind(schedule.id, deliveryId).run();
  }
}

async function refreshDeliveredQuantity(
  d1: ReturnType<typeof getD1>,
  itemId: number,
  memberId: number,
) {
  const completed = await d1.prepare(
    `SELECT COALESCE(SUM(completed_qty), 0) AS qty FROM complex_project_deliveries
     WHERE equipment_item_id = ? AND status <> '취소'`,
  ).bind(itemId).first<{ qty: number }>();
  const completedQty = integer(completed?.qty);
  await d1.prepare(
    `UPDATE equipment_items SET installed_qty = ?,
     status = CASE
       WHEN awarded_qty > 0 AND ? >= awarded_qty THEN '설치 완료'
       WHEN status = '설치 완료' THEN '설치 중'
       ELSE status
     END,
     updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(completedQty, completedQty, memberId, itemId).run();
}

export async function saveComplexDelivery(payload: Record<string, unknown>, member: Member) {
  const d1 = await ensureComplexProjectsReady();
  const projectId = integer(payload.projectId);
  const project = await requireProject(d1, projectId);
  const itemId = integer(payload.itemId);
  const deliveryId = integer(payload.deliveryId);
  const plannedQty = integer(payload.plannedQty);
  const completedQty = Math.min(plannedQty, integer(payload.completedQty));
  const status = clean(payload.status, 30) || (validDate(payload.startDate) ? "예정" : "일정 미정");
  let savedId = deliveryId;
  await d1.transaction(async (transaction) => {
    await requireProject(transaction, projectId);
    const item = await transaction.prepare(
      `SELECT item.* FROM equipment_items item
       JOIN complex_project_budget_links link ON link.equipment_project_id = item.project_id
       WHERE item.id = ? AND link.complex_project_id = ?`,
    ).bind(itemId, projectId).first<Record<string, unknown>>();
    if (!item) throw new Error("일정을 연결할 품목을 찾지 못했습니다.");
    if (deliveryId) {
      await transaction.prepare(
        `UPDATE complex_project_deliveries SET kind = ?, planned_qty = ?, completed_qty = ?,
         start_date = ?, end_date = ?, vendor_name = ?, location = ?, status = ?, notes = ?,
         updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND complex_project_id = ? AND equipment_item_id = ?`,
      ).bind(
        clean(payload.kind, 40) || "납품", plannedQty, completedQty, validDate(payload.startDate),
        validDate(payload.endDate), clean(payload.vendorName, 160), clean(payload.location, 160), status,
        clean(payload.notes, 500), member.id, member.displayName, deliveryId, projectId, itemId,
      ).run();
    } else {
      const inserted = await transaction.prepare(
        `INSERT INTO complex_project_deliveries
         (complex_project_id, equipment_item_id, kind, planned_qty, completed_qty, start_date, end_date,
          vendor_name, location, status, notes, created_by, created_by_name, updated_by, updated_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      ).bind(
        projectId, itemId, clean(payload.kind, 40) || "납품", plannedQty, completedQty,
        validDate(payload.startDate), validDate(payload.endDate), clean(payload.vendorName, 160),
        clean(payload.location, 160), status, clean(payload.notes, 500),
        member.id, member.displayName, member.id, member.displayName,
      ).first<{ id: number }>();
      savedId = Number(inserted?.id ?? 0);
    }
    if (!savedId) throw new Error("납품 일정을 저장하지 못했습니다.");
    await syncDeliverySchedule(transaction, savedId, project, item, payload, member);
    await refreshDeliveredQuantity(transaction, itemId, member.id);
    await writeEvent(transaction, projectId, deliveryId ? "update_delivery" : "add_delivery", { deliveryId: savedId, itemId }, member);
  });
  await refreshOrganizationScheduleMirror(project.organization, project.business_round);
  return { projectId, deliveryId: savedId };
}

export async function deleteComplexEntity(payload: Record<string, unknown>, member: Member) {
  const d1 = await ensureComplexProjectsReady();
  const projectId = integer(payload.projectId);
  const project = await requireProject(d1, projectId);
  const entity = clean(payload.entity, 30);
  const id = integer(payload.id);
  await d1.transaction(async (transaction) => {
    await requireProject(transaction, projectId);
    if (entity === "delivery") {
      const delivery = await transaction.prepare(
        "SELECT schedule_id, equipment_item_id FROM complex_project_deliveries WHERE id = ? AND complex_project_id = ?",
      ).bind(id, projectId).first<{ schedule_id: number | null; equipment_item_id: number }>();
      if (delivery?.schedule_id) {
        await transaction.prepare(
          `UPDATE organization_schedules SET deleted_at = CURRENT_TIMESTAMP,
           sync_status = CASE WHEN TRIM(COALESCE(google_event_id, '')) <> '' THEN 'pending' ELSE 'local_only' END,
           sync_operation = CASE WHEN TRIM(COALESCE(google_event_id, '')) <> '' THEN 'delete' ELSE 'unlink' END,
           updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).bind(member.id, member.displayName, delivery.schedule_id).run();
      }
      await transaction.prepare("DELETE FROM complex_project_deliveries WHERE id = ? AND complex_project_id = ?")
        .bind(id, projectId).run();
      if (delivery?.equipment_item_id) {
        await refreshDeliveredQuantity(transaction, Number(delivery.equipment_item_id), member.id);
      }
    } else if (entity === "zone") {
      await transaction.prepare("UPDATE complex_project_item_details SET zone_id = NULL WHERE zone_id = ? AND complex_project_id = ?")
        .bind(id, projectId).run();
      await transaction.prepare("DELETE FROM complex_project_zones WHERE id = ? AND complex_project_id = ?")
        .bind(id, projectId).run();
    } else {
      throw new Error("삭제할 항목을 확인해 주세요.");
    }
    await writeEvent(transaction, projectId, `delete_${entity}`, { id }, member);
  });
  if (entity === "delivery" && project) {
    await refreshOrganizationScheduleMirror(project.organization, project.business_round);
  }
  return { projectId, entity, id };
}
