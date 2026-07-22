import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import { ensureCampaignsReady } from "../../../lib/campaign-store";
import {
  ensureEquipmentReady,
  removeUnselectedLegacyAiEquipment,
  syncEquipmentItemsFromProgressSchedule,
} from "../../../lib/equipment-store";
import { ensureMapReady } from "../../../lib/map-store";
import { clean, ensureRecordsReady } from "../../../lib/records-store";

export const dynamic = "force-dynamic";

const projectStatuses = [
  "제안",
  "견적",
  "수주",
  "발주",
  "설치 중",
  "설치 완료",
  "보류",
  "취소",
];
const itemStatuses = [
  "제안 예정",
  "제안",
  "견적",
  "수주",
  "발주",
  "설치 중",
  "설치 완료",
  "미수주",
  "취소",
];
const protectionStatuses = ["신청 필요", "신청 완료"];

function cleanStatus(value: unknown, values: string[], fallback: string) {
  const requested = clean(value);
  return values.includes(requested) ? requested : fallback;
}

function cleanQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(999_999, Math.max(0, Math.round(quantity)));
}

function cleanUnitPrice(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.min(100_000_000_000, Math.round(amount));
}

function cleanConsortiumSettlement(payload: Record<string, unknown>) {
  const executionType = clean(payload.executionType) === "컨소" ? "컨소" : "직영";
  const commissionInputType =
    clean(payload.commissionInputType) === "amount" ? "amount" : "rate";
  const requestedRate = Number(payload.commissionRate);
  const requestedConsortiumRate = Number(payload.consortiumCommissionRate);
  const requestedAmount = Number(payload.consortiumPaymentAmount);
  return {
    executionType,
    commissionInputType,
    commissionRate:
      Number.isFinite(requestedRate)
        ? Math.min(1, Math.max(0, requestedRate))
        : null,
    consortiumCommissionRate:
      executionType === "컨소" && commissionInputType === "rate" &&
      Number.isFinite(requestedConsortiumRate)
        ? Math.min(1, Math.max(0, requestedConsortiumRate))
        : null,
    consortiumPaymentAmount:
      executionType === "컨소" && commissionInputType === "amount" &&
      Number.isFinite(requestedAmount)
        ? Math.min(100_000_000_000, Math.max(0, Math.round(requestedAmount)))
        : null,
  };
}

function inferItemStatus(item: Record<string, unknown>) {
  const requested = cleanStatus(item.status, itemStatuses, "");
  if (requested) return requested;
  const awardedQty = cleanQuantity(item.awardedQty);
  const installedQty = cleanQuantity(item.installedQty);
  if (installedQty > 0 && awardedQty > 0) {
    return installedQty >= awardedQty ? "설치 완료" : "설치 중";
  }
  if (installedQty > 0) return "설치 중";
  if (awardedQty > 0) return "수주";
  return "제안";
}

function inferProjectStatus(items: Record<string, unknown>[]) {
  const statuses = items.map(inferItemStatus);
  if (statuses.length && statuses.every((status) => status === "설치 완료")) {
    return "설치 완료";
  }
  if (statuses.includes("설치 중")) return "설치 중";
  if (statuses.includes("발주")) return "발주";
  if (statuses.includes("수주") || items.some((item) => cleanQuantity(item.awardedQty) > 0)) {
    return "수주";
  }
  if (statuses.includes("견적")) return "견적";
  return "제안";
}

function inferProjectStatusFromRecord(
  payload: Record<string, unknown>,
  items: Record<string, unknown>[],
) {
  const requested = cleanStatus(payload.projectStatus, projectStatuses, "");
  if (requested) return requested;

  const awardStage = clean(payload.awardStage);
  const awardStatus = clean(payload.awardStatus);
  const text = [
    payload.topic,
    payload.summary,
    payload.nextAction,
    payload.progressSchedule,
    payload.notes,
  ]
    .map(clean)
    .filter(Boolean)
    .join(" ");

  if (/취소|무산/.test(text)) return "취소";
  if (/보류|잠정 중단/.test(text)) return "보류";
  if (
    /설치 완료|공사 완료|완공|검수 완료|교육 완료/.test(text) ||
    ["완공", "검수", "교육"].includes(awardStage)
  ) {
    return "설치 완료";
  }
  if (/설치 중|공사 중|시공 중|목공|시스템 작업/.test(text)) {
    return "설치 중";
  }
  if (/발주/.test(text)) return "발주";
  if (
    awardStatus === "위즈업 수주" ||
    /수주|계약/.test(text) ||
    ["계약", "일정 조율"].includes(awardStage)
  ) {
    return "수주";
  }
  if (/견적/.test(text)) return "견적";
  return items.length ? inferProjectStatus(items) : "제안";
}

function progressiveProjectStatus(previous: unknown, next: string) {
  if (next === "보류" || next === "취소") return next;
  const rank = new Map(
    ["제안", "견적", "수주", "발주", "설치 중", "설치 완료"].map(
      (status, index) => [status, index],
    ),
  );
  const current = clean(previous);
  if (!rank.has(current)) return next;
  return (rank.get(next) ?? -1) >= (rank.get(current) ?? -1)
    ? next
    : current;
}

async function readProjects(organization: string) {
  const d1 = await ensureEquipmentReady();
  const projects = await d1
    .prepare(
      `SELECT p.*, COALESCE(m.display_name, '등록자') AS created_by_name
       FROM equipment_projects p
       LEFT JOIN members m ON m.id = p.created_by
       WHERE p.organization = ?
       ORDER BY p.updated_at DESC, p.id DESC`,
    )
    .bind(organization)
    .all<Record<string, unknown>>();
  if (!projects.results.length) return [];

  const projectIds = projects.results.map(
    (project: Record<string, unknown>) => Number(project.id),
  );
  const placeholders = projectIds.map(() => "?").join(", ");
  const items = await d1
    .prepare(
      `SELECT *
       FROM equipment_items
       WHERE project_id IN (${placeholders})
       ORDER BY sort_order ASC, id ASC`,
    )
    .bind(...projectIds)
    .all<Record<string, unknown>>();
  const itemsByProject = new Map<number, Record<string, unknown>[]>();
  items.results.forEach((item: Record<string, unknown>) => {
    const projectId = Number(item.project_id);
    const current = itemsByProject.get(projectId) ?? [];
    current.push(item);
    itemsByProject.set(projectId, current);
  });
  return projects.results.map((project: Record<string, unknown>) => ({
    ...project,
    items: itemsByProject.get(Number(project.id)) ?? [],
  }));
}

async function syncOrganizationEquipmentSchedule(organization: string) {
  if (!organization) return;
  const d1 = await ensureRecordsReady();
  const latestSchedule = await d1
    .prepare(
      `SELECT progress_schedule
       FROM activities
       WHERE organization = ? AND progress_schedule <> ''
       ORDER BY COALESCE(activity_date, '') DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization)
    .first<{ progress_schedule: string }>();
  if (latestSchedule?.progress_schedule) {
    await syncEquipmentItemsFromProgressSchedule(
      organization,
      latestSchedule.progress_schedule,
    );
  }
}

export async function GET(request: Request) {
  try {
    const member = await requireApprovedMember();
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("protection") === "1") {
      await ensureRecordsReady();
      const d1 = await ensureEquipmentReady();
      const items = await d1
        .prepare(
          `WITH latest_activities AS (
             SELECT organization, progress_manager,
                    ROW_NUMBER() OVER (
                      PARTITION BY organization
                      ORDER BY COALESCE(activity_date, '') DESC, id DESC
                    ) AS row_number
             FROM activities
           )
           SELECT i.*, p.organization, p.name AS project_name,
                  COALESCE(a.progress_manager, '') AS progress_manager
           FROM equipment_items i
           JOIN equipment_projects p ON p.id = i.project_id
           LEFT JOIN latest_activities a
             ON a.organization = p.organization AND a.row_number = 1
           WHERE COALESCE(i.protection_status, '신청 필요') <> '신청 완료'
             AND (
               trim(COALESCE(a.progress_manager, '')) = trim(?)
               OR (trim(COALESCE(a.progress_manager, '')) = '' AND p.created_by = ?)
             )
           ORDER BY p.updated_at DESC, i.updated_at DESC, i.id DESC`,
        )
        .bind(member.displayName, member.id)
        .all();
      return Response.json({ items: items.results });
    }
    if (searchParams.get("summary") === "1") {
      const d1 = await ensureEquipmentReady();
      const summaries = await d1
        .prepare(
          `SELECT
            p.organization,
            COUNT(DISTINCT p.id) AS project_count,
            COUNT(i.id) AS item_count,
            COALESCE(SUM(CASE WHEN i.proposed_qty > 0 THEN 1 ELSE 0 END), 0) AS proposed_kinds,
            COALESCE(SUM(CASE WHEN i.awarded_qty > 0 THEN 1 ELSE 0 END), 0) AS awarded_kinds,
            COALESCE(SUM(CASE WHEN i.installed_qty > 0 THEN 1 ELSE 0 END), 0) AS installed_kinds
           FROM equipment_projects p
           LEFT JOIN equipment_items i ON i.project_id = p.id
           GROUP BY p.organization
           ORDER BY p.organization`,
        )
        .all();
      return Response.json({ summaries: summaries.results });
    }
    const organization = clean(searchParams.get("organization"));
    if (!organization) {
      return Response.json({ error: "기관명이 필요합니다." }, { status: 400 });
    }
    await removeUnselectedLegacyAiEquipment(organization);
    await syncOrganizationEquipmentSchedule(organization);
    return Response.json({
      organization,
      projects: await readProjects(organization),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const kind = clean(payload.kind);
    const d1 = await ensureEquipmentReady();

    if (kind === "project") {
      const organization = clean(payload.organization);
      const name = clean(payload.name);
      if (!organization || !name) {
        return Response.json(
          { error: "기관명과 사업명을 입력해 주세요." },
          { status: 400 },
        );
      }
      const project = await d1
        .prepare(
          `INSERT INTO equipment_projects (
            organization, name, status, budget_type, notes, created_by
          ) VALUES (?, ?, ?, ?, ?, ?)
          RETURNING *`,
        )
        .bind(
          organization.slice(0, 120),
          name.slice(0, 160),
          cleanStatus(payload.status, projectStatuses, "제안"),
          clean(payload.budgetType).slice(0, 120),
          clean(payload.notes).slice(0, 2_000),
          member.id,
        )
        .first();
      return Response.json({ project }, { status: 201 });
    }

    if (kind === "item") {
      const projectId = Number(payload.projectId);
      const productName = clean(payload.productName);
      if (!Number.isInteger(projectId) || projectId < 1 || !productName) {
        return Response.json(
          { error: "사업과 품목명을 확인해 주세요." },
          { status: 400 },
        );
      }
      const project = await d1
        .prepare("SELECT id, organization FROM equipment_projects WHERE id = ?")
        .bind(projectId)
        .first<{ id: number; organization: string }>();
      if (!project) {
        return Response.json({ error: "사업을 찾지 못했습니다." }, { status: 404 });
      }
      const sortOrder = await d1
        .prepare(
          "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM equipment_items WHERE project_id = ?",
        )
        .bind(projectId)
        .first<{ next_order: number }>();
      const settlement = cleanConsortiumSettlement(payload);
      const item = await d1
        .prepare(
          `INSERT INTO equipment_items (
            project_id, product_name, specification, proposed_qty, awarded_qty,
            installed_qty, unit, status, notes, catalog_unit_price, execution_type,
            commission_input_type, commission_rate, consortium_commission_rate,
            consortium_payment_amount,
            sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *`,
        )
        .bind(
          projectId,
          productName.slice(0, 180),
          clean(payload.specification).slice(0, 180),
          cleanQuantity(payload.proposedQty),
          cleanQuantity(payload.awardedQty),
          cleanQuantity(payload.installedQty),
          clean(payload.unit).slice(0, 20) || "대",
          inferItemStatus(payload),
          clean(payload.notes).slice(0, 1_000),
          cleanUnitPrice(payload.catalogUnitPrice),
          settlement.executionType,
          settlement.commissionInputType,
          settlement.commissionRate,
          settlement.consortiumCommissionRate,
          settlement.consortiumPaymentAmount,
          Number(sortOrder?.next_order ?? 0),
        )
        .first();
      await d1
        .prepare(
          "UPDATE equipment_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(projectId)
        .run();
      await syncOrganizationEquipmentSchedule(project.organization);
      return Response.json({ item }, { status: 201 });
    }

    if (kind === "catalog-items") {
      const projectId = Number(payload.projectId);
      const requestedItems = Array.isArray(payload.items)
        ? payload.items
            .filter((item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object"),
            )
            .slice(0, 100)
        : [];
      if (!Number.isInteger(projectId) || projectId < 1 || !requestedItems.length) {
        return Response.json(
          { error: "사업과 추가할 제품을 확인해 주세요." },
          { status: 400 },
        );
      }
      const project = await d1
        .prepare("SELECT id, organization FROM equipment_projects WHERE id = ?")
        .bind(projectId)
        .first<{ id: number; organization: string }>();
      if (!project) {
        return Response.json({ error: "사업을 찾지 못했습니다." }, { status: 404 });
      }
      const sortOrder = await d1
        .prepare(
          "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM equipment_items WHERE project_id = ?",
        )
        .bind(projectId)
        .first<{ next_order: number }>();
      let added = 0;
      let skipped = 0;
      for (const [index, source] of requestedItems.entries()) {
        const productName = clean(source.productName).slice(0, 180);
        const specification = clean(source.specification).slice(0, 180);
        const catalogItemId = clean(source.catalogItemId).slice(0, 160);
        if (!productName) {
          skipped += 1;
          continue;
        }
        const existing = await d1
          .prepare(
            `SELECT id FROM equipment_items
             WHERE project_id = ?
               AND (
                 (? <> '' AND catalog_item_id = ?)
                 OR (lower(product_name) = lower(?) AND specification = ?)
               )
             LIMIT 1`,
          )
          .bind(
            projectId,
            catalogItemId,
            catalogItemId,
            productName,
            specification,
          )
          .first();
        if (existing) {
          skipped += 1;
          continue;
        }
        const settlement = cleanConsortiumSettlement(source);
        await d1
          .prepare(
            `INSERT INTO equipment_items (
              project_id, product_name, specification, proposed_qty, awarded_qty,
              installed_qty, unit, status, notes, catalog_item_id,
              catalog_unit_price, catalog_note, execution_type,
              commission_input_type, commission_rate, consortium_commission_rate,
              consortium_payment_amount, protection_status, sort_order
            ) VALUES (?, ?, ?, 0, 0, 0, '대', '제안 예정', '', ?, ?, ?, ?, ?, ?, ?, ?, '신청 필요', ?)`,
          )
          .bind(
            projectId,
            productName,
            specification,
            catalogItemId,
            cleanUnitPrice(source.catalogUnitPrice),
            clean(source.catalogNote).slice(0, 1_000),
            settlement.executionType,
            settlement.commissionInputType,
            settlement.commissionRate,
            settlement.consortiumCommissionRate,
            settlement.consortiumPaymentAmount,
            Number(sortOrder?.next_order ?? 0) + index,
          )
          .run();
        added += 1;
      }
      if (added) {
        await d1
          .prepare(
            "UPDATE equipment_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(projectId)
          .run();
      }
      return Response.json({ ok: true, added, skipped }, { status: 201 });
    }

    if (kind === "ai-import") {
      const organization = clean(payload.organization).slice(0, 120);
      const budgetType = clean(payload.budgetType).slice(0, 120);
      const requestedProjectName = clean(payload.projectName).slice(0, 160);
      const projectName = (budgetType || requestedProjectName).slice(0, 160);
      const rawItems = Array.isArray(payload.items)
        ? payload.items
            .filter((item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object"),
            )
            .slice(0, 100)
        : [];
      const items = rawItems.filter((item) => clean(item.productName));
      if (!organization) {
        return Response.json(
          { error: "기관명이 필요합니다." },
          { status: 400 },
        );
      }
      const inferredStatus = inferProjectStatusFromRecord(payload, items);

      let project = await d1
        .prepare(
          "SELECT * FROM equipment_projects WHERE organization = ? AND name = ?",
        )
        .bind(organization, projectName)
        .first<Record<string, unknown>>();
      if (!project) {
        const candidates = await d1
          .prepare(
            `SELECT * FROM equipment_projects
             WHERE organization = ?
               AND (? = '' OR budget_type = ?)
             ORDER BY updated_at DESC, id DESC
             LIMIT 2`,
          )
          .bind(organization, budgetType, budgetType)
          .all<Record<string, unknown>>();
        if (candidates.results.length === 1) {
          project = candidates.results[0];
        }
      }
      if (!project) {
        project = await d1
          .prepare(
            `INSERT INTO equipment_projects (
              organization, name, status, budget_type, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?)
            RETURNING *`,
          )
          .bind(
            organization,
            projectName,
            inferredStatus,
            budgetType,
            "AI 기록에서 자동 생성",
            member.id,
          )
          .first<Record<string, unknown>>();
      }
      if (!project) throw new Error("품목 사업을 만들지 못했습니다.");

      for (const [index, item] of items.entries()) {
        const productName = clean(item.productName).slice(0, 180);
        const specification = clean(item.specification).slice(0, 180);
        const existing = await d1
          .prepare(
            `SELECT * FROM equipment_items
             WHERE project_id = ? AND lower(product_name) = lower(?) AND specification = ?
             LIMIT 1`,
          )
          .bind(Number(project.id), productName, specification)
          .first<Record<string, unknown>>();
        const proposedQty = cleanQuantity(item.proposedQty);
        const awardedQty = cleanQuantity(item.awardedQty);
        const installedQty = cleanQuantity(item.installedQty);
        if (existing) {
          await d1
            .prepare(
              `UPDATE equipment_items SET
                proposed_qty = ?, awarded_qty = ?, installed_qty = ?,
                unit = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
            )
            .bind(
              proposedQty || Number(existing.proposed_qty ?? 0),
              awardedQty || Number(existing.awarded_qty ?? 0),
              installedQty || Number(existing.installed_qty ?? 0),
              clean(item.unit).slice(0, 20) || String(existing.unit ?? "대"),
              inferItemStatus(item),
              clean(item.notes).slice(0, 1_000) || String(existing.notes ?? ""),
              Number(existing.id),
            )
            .run();
        } else {
          await d1
            .prepare(
              `INSERT INTO equipment_items (
                project_id, product_name, specification, proposed_qty, awarded_qty,
                installed_qty, unit, status, notes, sort_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              Number(project.id),
              productName,
              specification,
              proposedQty,
              awardedQty,
              installedQty,
              clean(item.unit).slice(0, 20) || "대",
              inferItemStatus(item),
              clean(item.notes).slice(0, 1_000),
              index,
            )
            .run();
        }
      }
      await d1
        .prepare(
          `UPDATE equipment_projects
           SET name = CASE WHEN ? = '' THEN name ELSE ? END,
               status = ?, budget_type = CASE WHEN ? = '' THEN budget_type ELSE ? END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          projectName,
          projectName,
          progressiveProjectStatus(project.status, inferredStatus),
          budgetType,
          budgetType,
          Number(project.id),
        )
        .run();
      await syncEquipmentItemsFromProgressSchedule(
        organization,
        clean(payload.progressSchedule),
      );
      return Response.json({
        ok: true,
        projects: await readProjects(organization),
      });
    }

    return Response.json({ error: "저장 종류를 확인해 주세요." }, { status: 400 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      return Response.json(
        { error: "같은 기관에 동일한 사업명이 이미 있습니다." },
        { status: 409 },
      );
    }
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const kind = clean(payload.kind);
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "수정할 항목을 확인해 주세요." }, { status: 400 });
    }
    const d1 = await ensureEquipmentReady();

    if (kind === "project") {
      const organization = clean(payload.organization);
      const name = clean(payload.name);
      if (!organization || !name) {
        return Response.json(
          { error: "기관명과 사업명을 입력해 주세요." },
          { status: 400 },
        );
      }
      const previous = await d1
        .prepare("SELECT organization FROM equipment_projects WHERE id = ?")
        .bind(id)
        .first<{ organization: string }>();
      if (!previous) {
        return Response.json({ error: "사업을 찾지 못했습니다." }, { status: 404 });
      }
      const previousOrganization = clean(previous.organization);
      if (
        payload.syncOrganization === true &&
        previousOrganization &&
        previousOrganization !== organization
      ) {
        await ensureRecordsReady();
        await ensureMapReady();
        await ensureCampaignsReady();
        await d1.batch([
          d1
            .prepare(
              `UPDATE activities
               SET organization = ?, updated_at = CURRENT_TIMESTAMP
               WHERE organization = ?`,
            )
            .bind(organization.slice(0, 120), previousOrganization),
          d1
            .prepare(
              `DELETE FROM organization_locations
               WHERE organization = ?
                 AND EXISTS (
                   SELECT 1 FROM organization_locations WHERE organization = ?
                 )`,
            )
            .bind(previousOrganization, organization),
          d1
            .prepare(
              `UPDATE organization_locations
               SET organization = ?, updated_at = CURRENT_TIMESTAMP
               WHERE organization = ?`,
            )
            .bind(organization.slice(0, 120), previousOrganization),
          d1
            .prepare(
              `DELETE FROM sales_campaign_targets
               WHERE organization = ?
                 AND campaign_id IN (
                   SELECT campaign_id
                   FROM sales_campaign_targets
                   WHERE organization = ?
                 )`,
            )
            .bind(previousOrganization, organization),
          d1
            .prepare(
              `UPDATE sales_campaign_targets
               SET organization = ?, updated_at = CURRENT_TIMESTAMP
               WHERE organization = ?`,
            )
            .bind(organization.slice(0, 120), previousOrganization),
          d1
            .prepare(
              `UPDATE equipment_projects
               SET organization = ?, updated_at = CURRENT_TIMESTAMP
               WHERE organization = ?`,
            )
            .bind(organization.slice(0, 120), previousOrganization),
        ]);
      }
      const project = await d1
        .prepare(
          `UPDATE equipment_projects SET
            organization = ?, name = ?, status = ?, budget_type = ?, notes = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
           RETURNING *`,
        )
        .bind(
          organization.slice(0, 120),
          name.slice(0, 160),
          cleanStatus(payload.status, projectStatuses, "제안"),
          clean(payload.budgetType).slice(0, 120),
          clean(payload.notes).slice(0, 2_000),
          id,
        )
        .first();
      if (!project) {
        return Response.json({ error: "사업을 찾지 못했습니다." }, { status: 404 });
      }
      return Response.json({
        project,
        renamedOrganization:
          previousOrganization !== organization ? organization : null,
      });
    }

    if (kind === "item") {
      const productName = clean(payload.productName);
      if (!productName) {
        return Response.json({ error: "품목명을 입력해 주세요." }, { status: 400 });
      }
      const settlement = cleanConsortiumSettlement(payload);
      const item = await d1
        .prepare(
          `UPDATE equipment_items SET
            product_name = ?, specification = ?, proposed_qty = ?, awarded_qty = ?,
            installed_qty = ?, unit = ?, status = ?, notes = ?, catalog_unit_price = ?,
            execution_type = ?,
            commission_input_type = ?, commission_rate = ?,
            consortium_commission_rate = ?,
            consortium_payment_amount = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
           RETURNING *`,
        )
        .bind(
          productName.slice(0, 180),
          clean(payload.specification).slice(0, 180),
          cleanQuantity(payload.proposedQty),
          cleanQuantity(payload.awardedQty),
          cleanQuantity(payload.installedQty),
          clean(payload.unit).slice(0, 20) || "대",
          inferItemStatus(payload),
          clean(payload.notes).slice(0, 1_000),
          cleanUnitPrice(payload.catalogUnitPrice),
          settlement.executionType,
          settlement.commissionInputType,
          settlement.commissionRate,
          settlement.consortiumCommissionRate,
          settlement.consortiumPaymentAmount,
          id,
        )
        .first<Record<string, unknown>>();
      if (!item) {
        return Response.json({ error: "품목을 찾지 못했습니다." }, { status: 404 });
      }
      await d1
        .prepare(
          "UPDATE equipment_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(Number(item.project_id))
        .run();
      const project = await d1
        .prepare("SELECT organization FROM equipment_projects WHERE id = ?")
        .bind(Number(item.project_id))
        .first<{ organization: string }>();
      if (project?.organization) {
        await syncOrganizationEquipmentSchedule(project.organization);
      }
      return Response.json({ item });
    }

    if (kind === "protection") {
      const protectionStatus = cleanStatus(
        payload.protectionStatus,
        protectionStatuses,
        "신청 필요",
      );
      const item = await d1
        .prepare(
          `UPDATE equipment_items SET
             protection_status = ?,
             protection_completed_at = CASE WHEN ? = '신청 완료'
               THEN CURRENT_TIMESTAMP ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
           RETURNING *`,
        )
        .bind(protectionStatus, protectionStatus, id)
        .first<Record<string, unknown>>();
      if (!item) {
        return Response.json({ error: "품목을 찾지 못했습니다." }, { status: 404 });
      }
      return Response.json({ item });
    }

    return Response.json({ error: "수정 종류를 확인해 주세요." }, { status: 400 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const kind = clean(payload.kind);
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "삭제할 항목을 확인해 주세요." }, { status: 400 });
    }
    const d1 = await ensureEquipmentReady();

    if (kind === "project") {
      await d1.batch([
        d1.prepare("DELETE FROM equipment_items WHERE project_id = ?").bind(id),
        d1.prepare("DELETE FROM equipment_projects WHERE id = ?").bind(id),
      ]);
      return Response.json({ ok: true });
    }
    if (kind === "item") {
      await d1.prepare("DELETE FROM equipment_items WHERE id = ?").bind(id).run();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "삭제 종류를 확인해 주세요." }, { status: 400 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
