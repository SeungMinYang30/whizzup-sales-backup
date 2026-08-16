import { getD1, isPostgresDatabase } from "../db";
import { ensureCollaborationReady } from "./collaboration";
import {
  koreaTodayValue,
  parseProgressScheduleEntries,
  readCanonicalBusinessRoundBudgets,
} from "./records-store";
import type { ActivityBudgetAllocation } from "./activity-budgets";
import { PRODUCT_CATALOG } from "./product-catalog";
import {
  DEFAULT_PROCUREMENT_FEE_RATE,
  hasProcurementSignal,
} from "./procurement-product";
import {
  ensureBudgetNamesReady,
  linkBudgetNameEntity,
  normalizeBudgetNameKey,
  resolveBudgetRecordMetadata,
} from "./budget-names";
import { parseImportedEquipmentItems } from "./imported-equipment";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS equipment_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '제안',
    budget_type TEXT NOT NULL DEFAULT '',
    budget_original_name TEXT NOT NULL DEFAULT '',
    budget_group_id INTEGER,
    budget_match_status TEXT NOT NULL DEFAULT 'unclassified',
    budget_match_method TEXT NOT NULL DEFAULT 'legacy',
    budget_request_id TEXT,
    budget_kind TEXT NOT NULL DEFAULT 'unclassified',
    budget_amount TEXT,
    budget_amount_source TEXT NOT NULL DEFAULT 'missing',
    notes TEXT NOT NULL DEFAULT '',
    construction_amount INTEGER,
    actual_construction_cost INTEGER,
    activity_id INTEGER,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS equipment_projects_org_round_name_idx ON equipment_projects (organization, business_round, name)",
  "CREATE INDEX IF NOT EXISTS equipment_projects_org_idx ON equipment_projects (organization, updated_at)",
  `CREATE TABLE IF NOT EXISTS equipment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    specification TEXT NOT NULL DEFAULT '',
    proposed_qty INTEGER NOT NULL DEFAULT 0,
    awarded_qty INTEGER NOT NULL DEFAULT 0,
    installed_qty INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '대',
    status TEXT NOT NULL DEFAULT '제안',
    notes TEXT NOT NULL DEFAULT '',
    catalog_item_id TEXT NOT NULL DEFAULT '',
    catalog_unit_price INTEGER,
    price_status TEXT NOT NULL DEFAULT '금액 미입력',
    catalog_note TEXT NOT NULL DEFAULT '',
    execution_type TEXT NOT NULL DEFAULT '직영',
    commission_input_type TEXT NOT NULL DEFAULT 'rate',
    commission_rate REAL,
    supply_type TEXT NOT NULL DEFAULT 'partner',
    margin_rate REAL,
    procurement_fee_rate REAL,
    consortium_commission_rate REAL,
    consortium_payment_amount INTEGER,
    supplier_vendor_id INTEGER,
    supplier_vendor_name TEXT NOT NULL DEFAULT '',
    protection_status TEXT NOT NULL DEFAULT '신청 필요',
    protection_completed_at TEXT,
    created_by INTEGER,
    updated_by INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS equipment_items_project_idx ON equipment_items (project_id, sort_order, id)",
];

let equipmentReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

const equipmentBudgetRetrofitKey =
  "retrofit:equipment_projects_by_canonical_budget:v1";

type EquipmentProjectRow = Record<string, unknown> & {
  id: number;
  organization: string;
  business_round: number;
  name: string;
  budget_type: string;
  budget_original_name: string;
  budget_group_id: number | null;
};

function equipmentBudgetIdentity(budget: ActivityBudgetAllocation) {
  return budget.budgetGroupId
    ? `group:${budget.budgetGroupId}`
    : `name:${normalizeBudgetNameKey(
        budget.budgetOriginalName || budget.budgetType,
      )}`;
}

function projectMatchesBudget(
  project: EquipmentProjectRow,
  budget: ActivityBudgetAllocation,
) {
  if (
    budget.budgetGroupId &&
    Number(project.budget_group_id ?? 0) === budget.budgetGroupId
  ) {
    return true;
  }
  const targetNames = new Set(
    [budget.budgetType, budget.budgetOriginalName]
      .map(normalizeBudgetNameKey)
      .filter(Boolean),
  );
  return [project.budget_type, project.budget_original_name, project.name]
    .map(normalizeBudgetNameKey)
    .some((name) => Boolean(name) && targetNames.has(name));
}

function canonicalProjectName(
  budget: ActivityBudgetAllocation,
  index: number,
) {
  return (
    cleanEquipmentText(
      budget.budgetType || budget.budgetOriginalName,
      160,
    ) || `표준 예산 ${index + 1}`
  );
}

async function reconcileEquipmentProjectsForBusinessRaw(
  d1: ReturnType<typeof getD1>,
  organization: string,
  businessRound: number,
) {
  const canonicalBudgets = await readCanonicalBusinessRoundBudgets(
    d1,
    organization,
    businessRound,
  );
  if (!canonicalBudgets.length) return { changed: false, projectCount: 0 };

  const projectResult = await d1
    .prepare(
      `SELECT *
       FROM equipment_projects
       WHERE organization = ? AND business_round = ?
       ORDER BY updated_at DESC, id DESC`,
    )
    .bind(organization, businessRound)
    .all<EquipmentProjectRow>();
  const projects = projectResult.results ?? [];
  const itemResult = projects.length
    ? await d1
        .prepare(
          `SELECT *
           FROM equipment_items
           WHERE project_id IN (${projects.map(() => "?").join(",")})
           ORDER BY project_id, sort_order, id`,
        )
        .bind(...projects.map((project) => Number(project.id)))
        .all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const items = itemResult.results ?? [];
  const itemsByProject = new Map<number, Record<string, unknown>[]>();
  for (const item of items) {
    const projectId = Number(item.project_id);
    const rows = itemsByProject.get(projectId) ?? [];
    rows.push(item);
    itemsByProject.set(projectId, rows);
  }

  const assigned = new Set<number>();
  const statements: ReturnType<typeof d1.prepare>[] = [];
  const keepers: Array<{
    projectId: number;
    budget: ActivityBudgetAllocation;
    name: string;
  }> = [];

  // Free the unique organization/round/name constraint before canonical names
  // are applied. The whole mutation is committed through one D1 batch below.
  for (const project of projects) {
    statements.push(
      d1
        .prepare(
          "UPDATE equipment_projects SET name = ? WHERE id = ?",
        )
        .bind(`__budget_reconcile_${project.id}`, Number(project.id)),
    );
  }

  for (const [index, budget] of canonicalBudgets.entries()) {
    const matches = projects
      .filter(
        (project) =>
          !assigned.has(Number(project.id)) &&
          projectMatchesBudget(project, budget),
      )
      .sort((left, right) => {
        const leftItems = itemsByProject.get(Number(left.id))?.length ?? 0;
        const rightItems = itemsByProject.get(Number(right.id))?.length ?? 0;
        const leftGroup =
          budget.budgetGroupId &&
          Number(left.budget_group_id ?? 0) === budget.budgetGroupId
            ? 1
            : 0;
        const rightGroup =
          budget.budgetGroupId &&
          Number(right.budget_group_id ?? 0) === budget.budgetGroupId
            ? 1
            : 0;
        return rightGroup - leftGroup || rightItems - leftItems || Number(left.id) - Number(right.id);
      });
    let keeper = matches[0];
    if (!keeper) {
      const inserted = await d1
        .prepare(
          `INSERT INTO equipment_projects (
             organization, business_round, name, status, budget_type,
             budget_original_name, budget_group_id, budget_match_status,
             budget_match_method, budget_request_id, budget_kind, notes,
             created_by
           ) VALUES (?, ?, ?, '제안', ?, ?, ?, ?, ?, ?, ?,
                     '표준 예산에 맞춰 자동 생성된 품목 카드', 0)
           RETURNING *`,
        )
        .bind(
          organization,
          businessRound,
          `__budget_reconcile_new_${Date.now()}_${index}`,
          budget.budgetType,
          budget.budgetOriginalName || budget.budgetType,
          budget.budgetGroupId,
          budget.budgetMatchStatus,
          budget.budgetMatchMethod,
          budget.budgetRequestId,
          budget.budgetKind,
        )
        .first<EquipmentProjectRow>();
      if (!inserted) throw new Error("표준 예산 품목 카드를 만들지 못했습니다.");
      keeper = inserted;
      projects.push(inserted);
      itemsByProject.set(Number(inserted.id), []);
    }
    const keeperId = Number(keeper.id);
    assigned.add(keeperId);
    keepers.push({
      projectId: keeperId,
      budget,
      name: canonicalProjectName(budget, index),
    });

    for (const duplicate of matches.slice(1)) {
      const duplicateId = Number(duplicate.id);
      assigned.add(duplicateId);
      const keeperItems = itemsByProject.get(keeperId) ?? [];
      for (const item of itemsByProject.get(duplicateId) ?? []) {
        const same = keeperItems.find(
          (candidate) =>
            normalizeBudgetNameKey(String(candidate.product_name ?? "")) ===
              normalizeBudgetNameKey(String(item.product_name ?? "")) &&
            normalizeBudgetNameKey(String(candidate.specification ?? "")) ===
              normalizeBudgetNameKey(String(item.specification ?? "")),
        );
        if (same) {
          statements.push(
            d1
              .prepare(
                `UPDATE equipment_items
                 SET proposed_qty = GREATEST(proposed_qty, ?),
                     awarded_qty = GREATEST(awarded_qty, ?),
                     installed_qty = GREATEST(installed_qty, ?),
                     catalog_unit_price = COALESCE(catalog_unit_price, ?),
                     notes = CASE WHEN notes = '' THEN ? ELSE notes END,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              )
              .bind(
                Number(item.proposed_qty ?? 0),
                Number(item.awarded_qty ?? 0),
                Number(item.installed_qty ?? 0),
                item.catalog_unit_price ?? null,
                String(item.notes ?? ""),
                Number(same.id),
              ),
          );
          statements.push(
            d1.prepare("DELETE FROM equipment_items WHERE id = ?").bind(Number(item.id)),
          );
        } else {
          statements.push(
            d1
              .prepare(
                "UPDATE equipment_items SET project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
              )
              .bind(keeperId, Number(item.id)),
          );
          keeperItems.push(item);
        }
      }
      statements.push(
        d1
          .prepare(
            `UPDATE equipment_projects
             SET construction_amount = GREATEST(COALESCE(construction_amount, 0), ?),
                 actual_construction_cost = GREATEST(COALESCE(actual_construction_cost, 0), ?),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .bind(
            Number(duplicate.construction_amount ?? 0),
            Number(duplicate.actual_construction_cost ?? 0),
            keeperId,
          ),
      );
      statements.push(
        d1.prepare("DELETE FROM budget_name_members WHERE entity_type = 'equipment_project' AND entity_id = ?").bind(duplicateId),
      );
      statements.push(
        d1.prepare("DELETE FROM equipment_projects WHERE id = ?").bind(duplicateId),
      );
    }
  }

  const unassigned = projects.filter(
    (project) => !assigned.has(Number(project.id)),
  );
  const unassignedWithData = unassigned.filter((project) => {
    return (
      (itemsByProject.get(Number(project.id))?.length ?? 0) > 0 ||
      Number(project.construction_amount ?? 0) > 0 ||
      Number(project.actual_construction_cost ?? 0) > 0
    );
  });
  const unmappedKeeper = unassignedWithData[0];
  if (unmappedKeeper) {
    const keeperId = Number(unmappedKeeper.id);
    for (const duplicate of unassignedWithData.slice(1)) {
      const duplicateId = Number(duplicate.id);
      statements.push(
        d1.prepare("UPDATE equipment_items SET project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?").bind(keeperId, duplicateId),
      );
      statements.push(
        d1.prepare("DELETE FROM budget_name_members WHERE entity_type = 'equipment_project' AND entity_id = ?").bind(duplicateId),
      );
      statements.push(d1.prepare("DELETE FROM equipment_projects WHERE id = ?").bind(duplicateId));
    }
    statements.push(
      d1
        .prepare(
          `UPDATE equipment_projects
           SET name = '예산 미지정', budget_type = '예산 미지정',
               budget_original_name = '예산 미지정', budget_group_id = NULL,
               budget_match_status = 'unclassified', budget_match_method = 'reconcile',
               budget_request_id = NULL, budget_kind = 'unclassified',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(keeperId),
    );
  }
  for (const project of unassigned) {
    if (unmappedKeeper && Number(project.id) === Number(unmappedKeeper.id)) continue;
    if (unassignedWithData.some((row) => Number(row.id) === Number(project.id))) continue;
    statements.push(
      d1.prepare("DELETE FROM budget_name_members WHERE entity_type = 'equipment_project' AND entity_id = ?").bind(Number(project.id)),
    );
    statements.push(
      d1.prepare("DELETE FROM equipment_projects WHERE id = ?").bind(Number(project.id)),
    );
  }

  for (const keeper of keepers) {
    const { budget } = keeper;
    statements.push(
      d1
        .prepare(
          `UPDATE equipment_projects
           SET name = ?, budget_type = ?, budget_original_name = ?,
               budget_group_id = ?, budget_match_status = ?,
               budget_match_method = ?, budget_request_id = ?, budget_kind = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          keeper.name,
          budget.budgetType,
          budget.budgetOriginalName || budget.budgetType,
          budget.budgetGroupId,
          budget.budgetMatchStatus,
          budget.budgetMatchMethod,
          budget.budgetRequestId,
          budget.budgetKind,
          keeper.projectId,
        ),
    );
  }
  if (statements.length) await d1.batch(statements);

  for (const keeper of keepers) {
    await linkBudgetNameEntity(d1, {
      entityType: "equipment_project",
      entityId: keeper.projectId,
      groupId: keeper.budget.budgetGroupId,
      originalName:
        keeper.budget.budgetOriginalName || keeper.budget.budgetType,
      aliasKey: normalizeBudgetNameKey(
        keeper.budget.budgetOriginalName || keeper.budget.budgetType,
      ),
    });
  }
  return {
    changed: statements.length > 0,
    projectCount: keepers.length + (unmappedKeeper ? 1 : 0),
  };
}

async function retrofitEquipmentProjectsByCanonicalBudget(
  d1: ReturnType<typeof getD1>,
) {
  const applied = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(equipmentBudgetRetrofitKey)
    .first<{ value: string }>();
  if (applied?.value) return;
  const candidates = await d1
    .prepare(
      `SELECT organization, business_round
       FROM equipment_projects
       GROUP BY organization, business_round
       HAVING COUNT(*) > 1
       UNION
       SELECT organization, business_round
       FROM activities
       WHERE json_valid(COALESCE(budgets_json, ''))
         AND json_array_length(budgets_json) > 1
       GROUP BY organization, business_round`,
    )
    .all<{ organization: string; business_round: number }>();
  for (const candidate of candidates.results ?? []) {
    await reconcileEquipmentProjectsForBusinessRaw(
      d1,
      candidate.organization,
      Number(candidate.business_round || 1),
    );
  }
  await d1
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                      updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(equipmentBudgetRetrofitKey, new Date().toISOString())
    .run();
}

async function initializeEquipment() {
  const d1 = getD1();
  if (isPostgresDatabase()) {
    await d1.prepare("SELECT 1").all();
    return d1;
  }
  await ensureCollaborationReady();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  const columns = await d1
    .prepare("PRAGMA table_info(equipment_items)")
    .all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const upgrades = [
    ["catalog_item_id", "ALTER TABLE equipment_items ADD COLUMN catalog_item_id TEXT NOT NULL DEFAULT ''"],
    ["catalog_unit_price", "ALTER TABLE equipment_items ADD COLUMN catalog_unit_price INTEGER"],
    ["price_status", "ALTER TABLE equipment_items ADD COLUMN price_status TEXT NOT NULL DEFAULT '금액 미입력'"],
    ["catalog_note", "ALTER TABLE equipment_items ADD COLUMN catalog_note TEXT NOT NULL DEFAULT ''"],
    ["execution_type", "ALTER TABLE equipment_items ADD COLUMN execution_type TEXT NOT NULL DEFAULT '직영'"],
    ["commission_input_type", "ALTER TABLE equipment_items ADD COLUMN commission_input_type TEXT NOT NULL DEFAULT 'rate'"],
    ["commission_rate", "ALTER TABLE equipment_items ADD COLUMN commission_rate REAL"],
    ["supply_type", "ALTER TABLE equipment_items ADD COLUMN supply_type TEXT NOT NULL DEFAULT 'partner'"],
    ["margin_rate", "ALTER TABLE equipment_items ADD COLUMN margin_rate REAL"],
    ["procurement_fee_rate", "ALTER TABLE equipment_items ADD COLUMN procurement_fee_rate REAL"],
    ["consortium_commission_rate", "ALTER TABLE equipment_items ADD COLUMN consortium_commission_rate REAL"],
    ["consortium_payment_amount", "ALTER TABLE equipment_items ADD COLUMN consortium_payment_amount INTEGER"],
    ["supplier_vendor_id", "ALTER TABLE equipment_items ADD COLUMN supplier_vendor_id INTEGER"],
    ["supplier_vendor_name", "ALTER TABLE equipment_items ADD COLUMN supplier_vendor_name TEXT NOT NULL DEFAULT ''"],
    ["protection_status", "ALTER TABLE equipment_items ADD COLUMN protection_status TEXT NOT NULL DEFAULT '신청 필요'"],
    ["protection_completed_at", "ALTER TABLE equipment_items ADD COLUMN protection_completed_at TEXT"],
    ["created_by", "ALTER TABLE equipment_items ADD COLUMN created_by INTEGER"],
    ["updated_by", "ALTER TABLE equipment_items ADD COLUMN updated_by INTEGER"],
  ] as const;
  const pending = upgrades
    .filter(([column]) => !existing.has(column))
    .map(([, statement]) => d1.prepare(statement));
  if (pending.length) await d1.batch(pending);
  await d1
    .prepare(
      `UPDATE equipment_items
       SET price_status = '입력 완료'
       WHERE COALESCE(catalog_unit_price, 0) > 0
         AND (price_status = '' OR price_status = '금액 미입력')`,
    )
    .run();

  const projectColumns = await d1
    .prepare("PRAGMA table_info(equipment_projects)")
    .all<{ name: string }>();
  const existingProjectColumns = new Set(
    projectColumns.results.map((column) => column.name),
  );
  const projectUpgrades = [
    ["budget_amount", "ALTER TABLE equipment_projects ADD COLUMN budget_amount TEXT"],
    ["budget_amount_source", "ALTER TABLE equipment_projects ADD COLUMN budget_amount_source TEXT NOT NULL DEFAULT 'missing'"],
    ["construction_amount", "ALTER TABLE equipment_projects ADD COLUMN construction_amount INTEGER"],
    ["actual_construction_cost", "ALTER TABLE equipment_projects ADD COLUMN actual_construction_cost INTEGER"],
    ["activity_id", "ALTER TABLE equipment_projects ADD COLUMN activity_id INTEGER"],
    ["business_round", "ALTER TABLE equipment_projects ADD COLUMN business_round INTEGER NOT NULL DEFAULT 1"],
  ] as const;
  const pendingProjectUpgrades = projectUpgrades
    .filter(([column]) => !existingProjectColumns.has(column))
    .map(([, statement]) => d1.prepare(statement));
  if (pendingProjectUpgrades.length) await d1.batch(pendingProjectUpgrades);
  await d1
    .prepare("CREATE INDEX IF NOT EXISTS equipment_projects_activity_idx ON equipment_projects (activity_id, updated_at)")
    .run();

  const storedCatalog = await d1
    .prepare("SELECT value FROM app_settings WHERE key = 'product_catalog_v1'")
    .first<{ value: string }>();
  let catalog: Array<{
    id?: unknown;
    name?: unknown;
    specification?: unknown;
    commissionRate?: unknown;
    note?: unknown;
    reference?: unknown;
  }> = PRODUCT_CATALOG;
  if (storedCatalog?.value) {
    try {
      const parsed = JSON.parse(storedCatalog.value);
      if (Array.isArray(parsed) && parsed.length) catalog = parsed;
    } catch {
      // Keep the built-in product catalog when an older setting is malformed.
    }
  }
  const commissionByCatalogId = new Map(
    catalog.flatMap((product) => {
      const id = String(product.id ?? "");
      const rate = Number(product.commissionRate);
      return id && Number.isFinite(rate) && rate >= 0 && rate <= 1
        ? [[id, rate] as const]
        : [];
    }),
  );
  const missingCommissionItems = await d1
    .prepare(
      `SELECT id, catalog_item_id
       FROM equipment_items
       WHERE commission_rate IS NULL AND catalog_item_id <> ''`,
    )
    .all<{ id: number; catalog_item_id: string }>();
  const commissionBackfills = missingCommissionItems.results.flatMap((item) => {
    const rate = commissionByCatalogId.get(item.catalog_item_id);
    return rate === undefined
      ? []
      : [
          d1
            .prepare("UPDATE equipment_items SET commission_rate = ? WHERE id = ?")
            .bind(rate, item.id),
        ];
  });
  if (commissionBackfills.length) await d1.batch(commissionBackfills);

  const procurementCatalogIds = new Set(
    catalog.flatMap((product) => {
      const id = String(product.id ?? "");
      return id &&
        hasProcurementSignal(
          product.name,
          product.specification,
          product.note,
          product.reference,
        )
        ? [id]
        : [];
    }),
  );
  const missingProcurementFeeItems = await d1
    .prepare(
      `SELECT id, product_name, specification, notes, catalog_item_id, catalog_note
       FROM equipment_items
       WHERE procurement_fee_rate IS NULL`,
    )
    .all<{
      id: number;
      product_name: string;
      specification: string;
      notes: string;
      catalog_item_id: string;
      catalog_note: string;
    }>();
  const procurementFeeBackfills = missingProcurementFeeItems.results.flatMap(
    (item) =>
      procurementCatalogIds.has(item.catalog_item_id) ||
      hasProcurementSignal(
        item.product_name,
        item.specification,
        item.catalog_note,
        item.notes,
      )
        ? [
            d1
              .prepare(
                "UPDATE equipment_items SET procurement_fee_rate = ? WHERE id = ?",
              )
              .bind(DEFAULT_PROCUREMENT_FEE_RATE, item.id),
          ]
        : [],
  );
  if (procurementFeeBackfills.length) {
    await d1.batch(procurementFeeBackfills);
  }
  await ensureBudgetNamesReady();
  await retrofitEquipmentProjectsByCanonicalBudget(d1);
  return d1;
}

export function ensureEquipmentReady() {
  if (!equipmentReadyPromise) {
    equipmentReadyPromise = initializeEquipment().catch((error) => {
      equipmentReadyPromise = null;
      throw error;
    });
  }
  return equipmentReadyPromise;
}

export async function reconcileEquipmentProjectsForBusiness(
  organizationValue: string,
  businessRoundValue = 1,
) {
  const organization = cleanEquipmentText(organizationValue, 120);
  const businessRound = Math.max(1, Number(businessRoundValue) || 1);
  if (!organization) return { changed: false, projectCount: 0 };
  const d1 = await ensureEquipmentReady();
  return reconcileEquipmentProjectsForBusinessRaw(
    d1,
    organization,
    businessRound,
  );
}

type PlannedEquipmentProduct = {
  name: string;
  reason?: string;
};

function cleanEquipmentText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function compactProposalText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

export function hasConfirmedProposalSignal(value: string) {
  const text = value.normalize("NFKC");
  return [
    /제안서.{0,30}(?:발송(?:했|함|완료|하였)|송부(?:했|함|완료)|제출(?:했|함|완료)|전달(?:했|함|완료|드렸)|공유(?:했|함|완료|드렸)|보냈|보냄)/,
    /제안.{0,20}(?:메일|이메일).{0,20}(?:발송(?:했|함|완료)|전달(?:했|함|완료)|보냈|보냄)/,
    /(?:메일|이메일|통화|전화|미팅|회의|방문).{0,40}제안(?:했|드렸|완료|함)/,
    /(?:제품|품목|물품|장비).{0,30}제안(?:했|드렸|완료|함)/,
    /제안(?:하고|하여|해서).{0,20}(?:자료|브로셔|제안서).{0,20}(?:전달|발송|공유)(?:했|함|완료|드렸)/,
    /제안(?:했|드렸|완료|함)/,
  ].some((pattern) => pattern.test(text));
}

export async function saveAiSelectedEquipmentAsPlanned(input: {
  organization: string;
  businessRound?: number;
  budgetType?: string;
  projectName?: string;
  products: PlannedEquipmentProduct[];
  createdBy: number;
}) {
  const organization = cleanEquipmentText(input.organization, 120);
  const budgetType = cleanEquipmentText(input.budgetType, 120);
  const projectName =
    cleanEquipmentText(input.projectName, 160) ||
    budgetType ||
    "AI 추천 제안";
  const products = input.products
    .map((product) => ({
      name: cleanEquipmentText(product.name, 180),
      reason: cleanEquipmentText(product.reason, 800),
    }))
    .filter((product) => product.name);
  if (!organization || !products.length) return 0;
  const businessRound = Math.max(1, Number(input.businessRound) || 1);

  const d1 = await ensureEquipmentReady();
  await ensureBudgetNamesReady();
  const budgetMetadata = await resolveBudgetRecordMetadata(d1, {
    budgetType,
    budgetOriginalName: budgetType,
    awardStatus: "미정",
  });
  let project = await d1
    .prepare(
      `SELECT *
       FROM equipment_projects
       WHERE organization = ? AND business_round = ? AND name = ?
       LIMIT 1`,
    )
    .bind(organization, businessRound, projectName)
    .first<Record<string, unknown>>();
  if (!project && budgetType) {
    project = await d1
      .prepare(
        `SELECT *
         FROM equipment_projects
         WHERE organization = ? AND business_round = ?
           AND (budget_group_id = ? OR budget_type = ?)
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .bind(
        organization,
        businessRound,
        budgetMetadata.budgetGroupId,
        budgetMetadata.storedName,
      )
      .first<Record<string, unknown>>();
  }
  if (!project) {
    project = await d1
      .prepare(
        `INSERT INTO equipment_projects (
          organization, business_round, name, status, budget_type, notes, created_by,
          budget_original_name, budget_group_id, budget_match_status,
          budget_match_method, budget_request_id, budget_kind
        ) VALUES (?, ?, ?, '제안', ?, 'AI 대응에서 선택한 제안 예정 품목', ?,
                  ?, ?, ?, ?, ?, ?)
        RETURNING *`,
      )
      .bind(
        organization,
        businessRound,
        projectName,
        budgetMetadata.storedName,
        input.createdBy,
        budgetMetadata.budgetOriginalName,
        budgetMetadata.budgetGroupId,
        budgetMetadata.budgetMatchStatus,
        budgetMetadata.budgetMatchMethod,
        budgetMetadata.budgetRequestId,
        budgetMetadata.budgetKind,
      )
      .first<Record<string, unknown>>();
  }
  if (!project) throw new Error("AI 추천 품목을 연결할 사업을 만들지 못했습니다.");

  let changed = 0;
  for (const [index, product] of products.entries()) {
    const existing = await d1
      .prepare(
        `SELECT *
         FROM equipment_items
         WHERE project_id = ? AND lower(product_name) = lower(?)
         ORDER BY id ASC
         LIMIT 1`,
      )
      .bind(Number(project.id), product.name)
      .first<Record<string, unknown>>();
    const note = product.reason
      ? `AI 제안 예정 · ${product.reason}`
      : "AI 제안 예정";
    if (existing) {
      const currentStatus = String(existing.status ?? "");
      const existingReason = [
        String(existing.specification ?? ""),
        String(existing.notes ?? ""),
      ].join(" ");
      const appearsToBePreviousAiImport =
        currentStatus === "제안" &&
        Number(existing.awarded_qty ?? 0) === 0 &&
        Number(existing.installed_qty ?? 0) === 0 &&
        Boolean(product.reason) &&
        compactProposalText(existingReason).includes(
          compactProposalText(product.reason),
        );
      await d1
        .prepare(
          `UPDATE equipment_items
           SET proposed_qty = CASE
                 WHEN status = '제안 예정' OR ? = 1 THEN 0
                 ELSE proposed_qty
               END,
               status = CASE
                 WHEN status = '제안 예정' OR ? = 1 THEN '제안 예정'
                 ELSE status
               END,
               notes = CASE
                 WHEN notes = '' OR notes LIKE 'AI 제안 예정%' THEN ?
                 ELSE notes
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          appearsToBePreviousAiImport ? 1 : 0,
          appearsToBePreviousAiImport ? 1 : 0,
          note,
          Number(existing.id),
        )
        .run();
    } else {
      await d1
        .prepare(
          `INSERT INTO equipment_items (
            project_id, product_name, specification, proposed_qty, awarded_qty,
            installed_qty, unit, status, notes, sort_order
          ) VALUES (?, ?, '', 0, 0, 0, '대', '제안 예정', ?, ?)`,
        )
        .bind(Number(project.id), product.name, note, index)
        .run();
    }
    changed += 1;
  }
  await d1
    .prepare(
      `UPDATE equipment_projects
       SET budget_type = ?, budget_original_name = ?,
           budget_group_id = ?, budget_match_status = ?,
           budget_match_method = ?, budget_request_id = ?,
           budget_kind = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      budgetMetadata.storedName,
      budgetMetadata.budgetOriginalName,
      budgetMetadata.budgetGroupId,
      budgetMetadata.budgetMatchStatus,
      budgetMetadata.budgetMatchMethod,
      budgetMetadata.budgetRequestId,
      budgetMetadata.budgetKind,
      Number(project.id),
    )
    .run();
  await linkBudgetNameEntity(d1, {
    entityType: "equipment_project",
    entityId: Number(project.id),
    groupId: budgetMetadata.budgetGroupId,
    originalName: budgetMetadata.budgetOriginalName,
    aliasKey:
      budgetMetadata.resolution?.aliasKey ??
      normalizeBudgetNameKey(budgetMetadata.budgetOriginalName),
  });
  await reconcileEquipmentProjectsForBusinessRaw(
    d1,
    organization,
    businessRound,
  );
  return changed;
}

export async function removeUnselectedLegacyAiEquipment(
  organizationValue: string,
) {
  const organization = cleanEquipmentText(organizationValue, 120);
  if (!organization) return 0;

  const d1 = await ensureEquipmentReady();
  const recommendationTable = await d1
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = 'ai_recommendations'
       LIMIT 1`,
    )
    .first<{ name: string }>();
  if (!recommendationTable) return 0;

  const recommendations = await d1
    .prepare(
      `SELECT recommended_products_json, applied_products_json
       FROM ai_recommendations
       WHERE organization = ?`,
    )
    .bind(organization)
    .all<{
      recommended_products_json: string;
      applied_products_json: string;
    }>();
  if (!recommendations.results.length) return 0;

  const appliedProductNames = new Set<string>();
  const recommendationReasons = new Map<string, string[]>();
  recommendations.results.forEach((row) => {
    try {
      const applied = JSON.parse(String(row.applied_products_json || "[]"));
      if (Array.isArray(applied)) {
        applied.forEach((name) => {
          const normalizedName = compactProposalText(String(name || ""));
          if (normalizedName) appliedProductNames.add(normalizedName);
        });
      }
    } catch {
      // 이전 데이터의 JSON 형식이 잘못된 경우 해당 값만 건너뜁니다.
    }
    try {
      const products = JSON.parse(
        String(row.recommended_products_json || "[]"),
      );
      if (!Array.isArray(products)) return;
      products.forEach((product) => {
        if (!product || typeof product !== "object") return;
        const source = product as Record<string, unknown>;
        const normalizedName = compactProposalText(String(source.name || ""));
        const normalizedReason = compactProposalText(
          String(source.reason || ""),
        );
        if (!normalizedName || normalizedReason.length < 8) return;
        const reasons = recommendationReasons.get(normalizedName) ?? [];
        reasons.push(normalizedReason);
        recommendationReasons.set(normalizedName, reasons);
      });
    } catch {
      // 이전 데이터의 JSON 형식이 잘못된 경우 해당 값만 건너뜁니다.
    }
  });
  if (!recommendationReasons.size) return 0;

  const candidates = await d1
    .prepare(
      `SELECT
         i.id, i.product_name, i.specification, i.notes,
         i.proposed_qty, i.awarded_qty, i.installed_qty
       FROM equipment_items i
       JOIN equipment_projects p ON p.id = i.project_id
       WHERE p.organization = ?
         AND p.notes = 'AI 기록에서 자동 생성'
         AND i.status = '제안'
         AND i.awarded_qty = 0
         AND i.installed_qty = 0
         AND i.notes NOT LIKE 'AI 제안 예정%'`,
    )
    .bind(organization)
    .all<Record<string, unknown>>();

  const deleteIds = candidates.results
    .filter((item) => {
      const normalizedName = compactProposalText(
        String(item.product_name || ""),
      );
      if (!normalizedName || appliedProductNames.has(normalizedName)) {
        return false;
      }
      const reasons = recommendationReasons.get(normalizedName);
      if (!reasons?.length) return false;
      const evidence = compactProposalText(
        `${String(item.specification || "")} ${String(item.notes || "")}`,
      );
      return reasons.some((reason) => evidence.includes(reason));
    })
    .map((item) => Number(item.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!deleteIds.length) return 0;
  await d1.batch(
    deleteIds.map((id) =>
      d1.prepare("DELETE FROM equipment_items WHERE id = ?").bind(id),
    ),
  );
  return deleteIds.length;
}

export async function promotePlannedEquipmentFromActivity(input: {
  organization: string;
  businessRound?: number;
  budgetType?: string;
  activityText: string;
}) {
  const organization = cleanEquipmentText(input.organization, 120);
  const budgetType = cleanEquipmentText(input.budgetType, 120);
  const activityText = cleanEquipmentText(input.activityText, 8_000);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  if (
    !organization ||
    !activityText ||
    !hasConfirmedProposalSignal(activityText)
  ) {
    return 0;
  }

  const d1 = await ensureEquipmentReady();
  const pending = await d1
    .prepare(
      `SELECT i.id, i.project_id, i.product_name
       FROM equipment_items i
       JOIN equipment_projects p ON p.id = i.project_id
       WHERE p.organization = ?
         AND p.business_round = ?
         AND i.status = '제안 예정'
         AND (? = '' OR p.budget_type = ?)
       ORDER BY p.updated_at DESC, i.sort_order ASC, i.id ASC`,
    )
    .bind(organization, businessRound, budgetType, budgetType)
    .all<{ id: number; project_id: number; product_name: string }>();
  if (!pending.results.length) return 0;

  const compactActivity = compactProposalText(activityText);
  const namedItems = pending.results.filter((item) =>
    compactActivity.includes(compactProposalText(item.product_name)),
  );
  const targets = namedItems.length ? namedItems : pending.results;
  await d1.batch(
    targets.map((item) =>
      d1
        .prepare(
          `UPDATE equipment_items
           SET proposed_qty = CASE WHEN proposed_qty < 1 THEN 1 ELSE proposed_qty END,
               status = '제안',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = '제안 예정'`,
        )
        .bind(item.id),
    ),
  );
  const projectIds = [...new Set(targets.map((item) => item.project_id))];
  await d1.batch(
    projectIds.map((projectId) =>
      d1
        .prepare(
          `UPDATE equipment_projects
           SET updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(projectId),
    ),
  );
  return targets.length;
}

function compactEquipmentName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(
      /설치\s*완료|시공\s*완료|납품\s*완료|설치|시공|납품|교체|철거|작업|예정|완료|공사/g,
      "",
    )
    .replace(/[^0-9a-z가-힣]/g, "");
}

export async function syncImportedAwardEquipment(input: {
  projectId: number;
  installedProducts: unknown;
  memberId: number;
}) {
  const projectId = Number(input.projectId);
  const items = parseImportedEquipmentItems(input.installedProducts);
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !items.length) return 0;
  const d1 = await ensureEquipmentReady();
  const existing = await d1
    .prepare(
      `SELECT id, product_name
       FROM equipment_items
       WHERE project_id = ?
       ORDER BY sort_order, id`,
    )
    .bind(projectId)
    .all<{ id: number; product_name: string }>();
  const existingByName = new Map(
    existing.results.map((item) => [
      compactEquipmentName(item.product_name),
      item,
    ]),
  );
  let insertedCount = 0;
  let nextSortOrder = existing.results.length;
  for (const item of items) {
    const matched = existingByName.get(compactEquipmentName(item.productName));
    if (matched) {
      await d1
        .prepare(
          `UPDATE equipment_items
           SET proposed_qty = GREATEST(proposed_qty, ?),
               awarded_qty = GREATEST(awarded_qty, ?),
               installed_qty = GREATEST(installed_qty, ?),
               unit = CASE WHEN unit = '' THEN ? ELSE unit END,
               status = '설치 완료',
               updated_by = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          item.quantity,
          item.quantity,
          item.quantity,
          item.unit,
          input.memberId,
          matched.id,
        )
        .run();
      continue;
    }
    const inserted = await d1
      .prepare(
        `INSERT INTO equipment_items (
          project_id, product_name, proposed_qty, awarded_qty, installed_qty,
          unit, status, notes, price_status, created_by, updated_by, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, '설치 완료', ?, '금액 미입력', ?, ?, ?)`,
      )
      .bind(
        projectId,
        item.productName,
        item.quantity,
        item.quantity,
        item.quantity,
        item.unit,
        "설치 완료 수주 일괄등록",
        input.memberId,
        input.memberId,
        nextSortOrder,
      )
      .run();
    const insertedId = Number(inserted.meta.last_row_id);
    if (insertedId > 0) {
      insertedCount += 1;
      nextSortOrder += 1;
      existingByName.set(compactEquipmentName(item.productName), {
        id: insertedId,
        product_name: item.productName,
      });
    }
  }
  await d1
    .prepare(
      `UPDATE equipment_projects
       SET status = '설치 완료', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status NOT IN ('보류', '취소')`,
    )
    .bind(projectId)
    .run();
  return insertedCount;
}

function scheduleMatchesEquipment(label: string, productName: string) {
  const scheduleName = compactEquipmentName(label);
  const equipmentName = compactEquipmentName(productName);
  if (scheduleName.length < 2 || equipmentName.length < 2) return false;
  return (
    equipmentName.includes(scheduleName) ||
    scheduleName.includes(equipmentName)
  );
}

export async function syncEquipmentItemsFromProgressSchedule(
  organization: string,
  progressSchedule: string,
  businessRound = 1,
  todayValue = koreaTodayValue(),
) {
  const entries = parseProgressScheduleEntries(progressSchedule);
  if (!organization.trim() || !entries.length) return 0;
  const d1 = await ensureEquipmentReady();
  const items = await d1
    .prepare(
      `SELECT i.id, i.project_id, i.product_name, i.status
       FROM equipment_items i
       JOIN equipment_projects p ON p.id = i.project_id
       WHERE p.organization = ? AND p.business_round = ?`,
    )
    .bind(organization.trim(), businessRound)
    .all<{
      id: number;
      project_id: number;
      product_name: string;
      status: string;
    }>();

  const updates = items.results.flatMap((item) => {
    if (["미수주", "취소"].includes(item.status)) return [];
    const matched = entries.filter((entry) =>
      scheduleMatchesEquipment(entry.label, item.product_name),
    );
    if (!matched.length) return [];
    const hasCurrentOrFutureSchedule = matched.some(
      (entry) => entry.date >= todayValue,
    );
    const latestPassed = matched
      .filter((entry) => entry.date < todayValue)
      .at(-1);
    const completed =
      !hasCurrentOrFutureSchedule &&
      Boolean(latestPassed) &&
      !/철거|목공|전기|배선|준비/.test(latestPassed?.label ?? "");
    const status = completed ? "설치 완료" : "설치 중";
    if (status === item.status) return [];
    return [
      d1
        .prepare(
          `UPDATE equipment_items
           SET status = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(status, item.id),
    ];
  });
  if (updates.length) await d1.batch(updates);

  const projectIds = [...new Set(items.results.map((item) => item.project_id))];
  for (const projectId of projectIds) {
    const summary = await d1
      .prepare(
        `SELECT
          COUNT(*) AS item_count,
          SUM(CASE WHEN status = '설치 완료' THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN status = '설치 중' THEN 1 ELSE 0 END) AS installing_count
         FROM equipment_items
         WHERE project_id = ?`,
      )
      .bind(projectId)
      .first<{
        item_count: number;
        completed_count: number;
        installing_count: number;
      }>();
    const itemCount = Number(summary?.item_count ?? 0);
    const completedCount = Number(summary?.completed_count ?? 0);
    const installingCount = Number(summary?.installing_count ?? 0);
    const projectStatus =
      itemCount > 0 && completedCount === itemCount
        ? "설치 완료"
        : completedCount > 0 || installingCount > 0
          ? "설치 중"
          : "";
    if (projectStatus) {
      await d1
        .prepare(
          `UPDATE equipment_projects
           SET status = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status NOT IN ('보류', '취소')`,
        )
        .bind(projectStatus, projectId)
        .run();
    }
  }
  return updates.length;
}
