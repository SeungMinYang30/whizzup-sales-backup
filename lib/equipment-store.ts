import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";
import {
  koreaTodayValue,
  parseProgressScheduleEntries,
} from "./records-store";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS equipment_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '제안',
    budget_type TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS equipment_projects_org_name_idx ON equipment_projects (organization, name)",
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
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS equipment_items_project_idx ON equipment_items (project_id, sort_order, id)",
];

let equipmentReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeEquipment() {
  const d1 = getD1();
  await ensureCollaborationReady();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  return d1;
}

export function ensureEquipmentReady() {
  return Promise.resolve(getD1());
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

  const d1 = await ensureEquipmentReady();
  let project = await d1
    .prepare(
      `SELECT *
       FROM equipment_projects
       WHERE organization = ? AND name = ?
       LIMIT 1`,
    )
    .bind(organization, projectName)
    .first<Record<string, unknown>>();
  if (!project && budgetType) {
    project = await d1
      .prepare(
        `SELECT *
         FROM equipment_projects
         WHERE organization = ? AND budget_type = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .bind(organization, budgetType)
      .first<Record<string, unknown>>();
  }
  if (!project) {
    project = await d1
      .prepare(
        `INSERT INTO equipment_projects (
          organization, name, status, budget_type, notes, created_by
        ) VALUES (?, ?, '제안', ?, 'AI 대응에서 선택한 제안 예정 품목', ?)
        RETURNING *`,
      )
      .bind(organization, projectName, budgetType, input.createdBy)
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
       SET updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(Number(project.id))
    .run();
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
  budgetType?: string;
  activityText: string;
}) {
  const organization = cleanEquipmentText(input.organization, 120);
  const budgetType = cleanEquipmentText(input.budgetType, 120);
  const activityText = cleanEquipmentText(input.activityText, 8_000);
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
         AND i.status = '제안 예정'
         AND (? = '' OR p.budget_type = ?)
       ORDER BY p.updated_at DESC, i.sort_order ASC, i.id ASC`,
    )
    .bind(organization, budgetType, budgetType)
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
       WHERE p.organization = ?`,
    )
    .bind(organization.trim())
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
