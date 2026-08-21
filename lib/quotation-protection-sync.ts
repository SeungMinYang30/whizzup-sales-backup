import type { Member } from "./collaboration";
import type { AuthoredQuotation, AuthoredQuotationItem } from "./authored-quotations";
import { ensureEquipmentReady } from "./equipment-store";

const CONSTRUCTION_PRODUCT_ID = "__construction_cost__";
const NON_PRODUCT_NAME_PATTERN =
  /(?:공사비|시공비|설치비|철거비|운송비|배송비|인건비|용역비|제경비)/u;

export type QuotationProtectionSyncResult = {
  status: "synced" | "not_applicable";
  added: number;
  linked: number;
  skipped: number;
  projectId: number | null;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizedKey(value: unknown) {
  return cleanText(value, 500)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/gu, "");
}

function safeRate(value: unknown) {
  const rate = Number(value);
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : null;
}

function safeAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? Math.min(100_000_000_000, Math.max(-100_000_000_000, Math.round(amount)))
    : null;
}

function safeQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity)
    ? Math.min(999_999, Math.max(0, Math.round(quantity)))
    : 0;
}

export function isQuotationProtectionItem(item: AuthoredQuotationItem) {
  const name = cleanText(item.name, 180);
  if (!name || item.productId === CONSTRUCTION_PRODUCT_ID) return false;
  // A linked catalog product and an equipment kit are explicit products. For
  // manual rows, exclude the common non-product cost labels conservatively.
  if (cleanText(item.productId, 180) || item.equipmentKit) return true;
  return !NON_PRODUCT_NAME_PATTERN.test(name.replace(/\s+/gu, ""));
}

export function quotationProtectionCandidates(items: AuthoredQuotationItem[]) {
  const occurrences = new Map<string, number>();
  return items.flatMap((item, index) => {
    if (!isQuotationProtectionItem(item)) return [];
    const base =
      cleanText(item.id, 200) ||
      cleanText(item.productId, 180) ||
      `${normalizedKey(item.name)}|${normalizedKey(item.specification)}` ||
      `line-${index + 1}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return [{ item, key: occurrence === 1 ? base : `${base}#${occurrence}` }];
  });
}

function projectIdentity(value: unknown) {
  return normalizedKey(value);
}

async function ensureProtectionLinkTable(
  d1: Awaited<ReturnType<typeof ensureEquipmentReady>>,
) {
  await d1
    .prepare(
      `CREATE TABLE IF NOT EXISTS quotation_equipment_item_links (
        quotation_id BIGINT NOT NULL,
        quotation_item_key TEXT NOT NULL,
        equipment_item_id BIGINT NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (quotation_id, quotation_item_key)
      )`,
    )
    .run();
  await d1
    .prepare(
      "CREATE INDEX IF NOT EXISTS quotation_equipment_item_links_item_idx ON quotation_equipment_item_links (equipment_item_id)",
    )
    .run();
}

export async function syncFinalQuotationProtectionItems(
  quotation: AuthoredQuotation,
  member: Pick<Member, "id" | "displayName">,
): Promise<QuotationProtectionSyncResult> {
  const candidates = quotationProtectionCandidates(quotation.items);
  if (quotation.status !== "final" || !candidates.length) {
    return {
      status: "not_applicable",
      added: 0,
      linked: 0,
      skipped: quotation.items.length,
      projectId: null,
    };
  }

  const organization = cleanText(quotation.organization, 120);
  if (!organization) throw new Error("영업보호를 연결할 기관명이 없습니다.");
  const businessRound = Math.max(1, Number(quotation.businessRound) || 1);
  const d1 = await ensureEquipmentReady();
  await ensureProtectionLinkTable(d1);

  return d1.transaction(async (transaction) => {
    const projects = await transaction
      .prepare(
        `SELECT id, name, budget_type
         FROM equipment_projects
         WHERE organization = ? AND business_round = ?
         ORDER BY updated_at DESC, id DESC`,
      )
      .bind(organization, businessRound)
      .all<{ id: number; name: string; budget_type: string }>();
    const targetIdentity = projectIdentity(quotation.projectTitle);
    let project: { id: number; name: string; budget_type: string } | undefined = projects.results.find((candidate) =>
      [candidate.name, candidate.budget_type]
        .map(projectIdentity)
        .some((identity) => Boolean(identity) && identity === targetIdentity),
    ) ?? (projects.results.length === 1 ? projects.results[0] : undefined);

    if (!project) {
      const latestActivity = await transaction
        .prepare(
          `SELECT id FROM activities
           WHERE organization = ? AND business_round = ?
           ORDER BY COALESCE(activity_date, '') DESC, id DESC
           LIMIT 1`,
        )
        .bind(organization, businessRound)
        .first<{ id: number }>();
      const projectName =
        cleanText(quotation.projectTitle, 160) ||
        cleanText(quotation.budgets[0]?.name, 160) ||
        "견적 품목";
      const inserted = await transaction
        .prepare(
          `INSERT INTO equipment_projects (
             organization, business_round, name, status, budget_type, notes,
             activity_id, created_by, updated_at
           ) VALUES (?, ?, ?, '견적', ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (organization, business_round, name) DO NOTHING
           RETURNING id, name, budget_type`,
        )
        .bind(
          organization,
          businessRound,
          projectName,
          cleanText(quotation.budgets[0]?.name, 120),
          `${quotation.quoteNumber} 최종 견적 영업보호 자동 연결`,
          Number(latestActivity?.id) || null,
          member.id,
        )
        .first<{ id: number; name: string; budget_type: string }>();
      project = inserted ?? await transaction
        .prepare(
          `SELECT id, name, budget_type FROM equipment_projects
           WHERE organization = ? AND business_round = ? AND name = ?
           LIMIT 1`,
        )
        .bind(organization, businessRound, projectName)
        .first<{ id: number; name: string; budget_type: string }>() ?? undefined;
    }
    const projectId = Number(project?.id);
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      throw new Error("영업보호를 연결할 기관 품목 사업을 준비하지 못했습니다.");
    }

    let added = 0;
    let linked = 0;
    let skipped = quotation.items.length - candidates.length;
    for (const { item, key } of candidates) {
      const reservation = await transaction
        .prepare(
          `INSERT INTO quotation_equipment_item_links (
             quotation_id, quotation_item_key, equipment_item_id, updated_at
           ) VALUES (?, ?, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (quotation_id, quotation_item_key) DO NOTHING
           RETURNING quotation_item_key`,
        )
        .bind(quotation.id, key)
        .first<{ quotation_item_key: string }>();
      if (!reservation) {
        const existingLink = await transaction
          .prepare(
            `SELECT equipment_item_id FROM quotation_equipment_item_links
             WHERE quotation_id = ? AND quotation_item_key = ?`,
          )
          .bind(quotation.id, key)
          .first<{ equipment_item_id: number }>();
        if (Number(existingLink?.equipment_item_id) > 0) linked += 1;
        else skipped += 1;
        continue;
      }

      const productId = cleanText(item.productId, 180);
      const productName = cleanText(item.name, 180);
      const specification = cleanText(item.specification, 500);
      const existingItem = await transaction
        .prepare(
          `SELECT id FROM equipment_items
           WHERE project_id = ?
             AND (
               (? <> '' AND catalog_item_id = ?)
               OR (
                 lower(trim(product_name)) = lower(trim(?))
                 AND lower(trim(specification)) = lower(trim(?))
               )
             )
           ORDER BY id DESC LIMIT 1`,
        )
        .bind(projectId, productId, productId, productName, specification)
        .first<{ id: number }>();

      let equipmentItemId = Number(existingItem?.id) || 0;
      if (equipmentItemId > 0) {
        linked += 1;
      } else {
        const sort = await transaction
          .prepare(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM equipment_items WHERE project_id = ?",
          )
          .bind(projectId)
          .first<{ next_order: number }>();
        const catalogNote = [
          cleanText(item.note, 1000),
          item.procurement
            ? [cleanText(item.procurementChannel, 80), cleanText(item.procurementNumber, 120)]
                .filter(Boolean)
                .join(" ")
            : "",
        ].filter(Boolean).join(" · ");
        const insertedItem = await transaction
          .prepare(
            `INSERT INTO equipment_items (
               project_id, product_name, specification, proposed_qty, unit,
               status, notes, catalog_item_id, catalog_unit_price, price_status,
               catalog_note, execution_type, commission_input_type,
               commission_rate, supply_type, margin_rate, procurement_fee_rate,
               consortium_commission_rate, consortium_payment_amount,
               supplier_vendor_id, supplier_vendor_name, protection_status,
               created_by, updated_by, sort_order, updated_at
             ) VALUES (
               ?, ?, ?, ?, ?, '견적', ?, ?, ?, ?, ?, ?, 'rate', ?, ?, ?, ?, ?, ?,
               ?, ?, '신청 필요', ?, ?, ?, CURRENT_TIMESTAMP
             ) RETURNING id`,
          )
          .bind(
            projectId,
            productName,
            specification,
            safeQuantity(item.quantity),
            cleanText(item.unit, 40) || "대",
            cleanText(item.note, 1000),
            productId,
            safeAmount(item.unitPrice),
            item.complimentary ? "무상 제공" : item.unitPrice > 0 ? "입력 완료" : "금액 미입력",
            catalogNote,
            quotation.executionType === "컨소" ? "컨소" : "직영",
            item.supplyType === "direct" ? null : safeRate(item.earningRate),
            item.supplyType === "direct" ? "direct" : "partner",
            item.supplyType === "direct" ? safeRate(item.earningRate) : null,
            safeRate(item.procurementFeeRate),
            quotation.executionType === "컨소" ? safeRate(item.consortiumRate) : null,
            quotation.executionType === "컨소" ? safeAmount(item.consortiumPayment) : null,
            Number.isSafeInteger(Number(item.supplierVendorId)) && Number(item.supplierVendorId) > 0
              ? Number(item.supplierVendorId)
              : null,
            cleanText(item.supplierVendorName, 180),
            member.id,
            member.id,
            Math.max(0, Number(sort?.next_order) || 0),
          )
          .first<{ id: number }>();
        equipmentItemId = Number(insertedItem?.id) || 0;
        if (!equipmentItemId) {
          throw new Error(`${productName} 품목의 영업보호 연결 번호를 확인하지 못했습니다.`);
        }
        added += 1;
      }

      await transaction
        .prepare(
          `UPDATE quotation_equipment_item_links
           SET equipment_item_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE quotation_id = ? AND quotation_item_key = ?`,
        )
        .bind(equipmentItemId, quotation.id, key)
        .run();
    }

    return { status: "synced", added, linked, skipped, projectId };
  });
}
