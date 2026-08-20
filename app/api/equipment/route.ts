import {
  accessErrorResponse,
  requireApprovedMember,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import { ensureCampaignsReady } from "../../../lib/campaign-store";
import {
  ensureEquipmentReady,
  reconcileEquipmentProjectsForBusiness,
  syncEquipmentItemsFromProgressSchedule,
} from "../../../lib/equipment-store";
import { ensureMapReady } from "../../../lib/map-store";
import { clean, ensureRecordsReady } from "../../../lib/records-store";
import {
  readProductSupplySettingMap,
  readProductVendorLinkMap,
  type ProductSupplySetting,
  type ProductVendorLink,
} from "../../../lib/product-vendor-links";
import {
  ensureBudgetNamesReady,
  linkBudgetRequestRecord,
  linkBudgetNameEntity,
  normalizeBudgetNameKey,
  resolveBudgetRecordMetadata,
} from "../../../lib/budget-names";
import {
  isCompletedAwardStage,
  normalizeAwardStage,
} from "../../../lib/sales-taxonomy";
import {
  analyticsBusinessRoundKey,
} from "../../../lib/analytics-business-rounds";
import {
  calculateEquipmentFinance,
  equipmentSettlementQuantity,
  resolveEquipmentSnapshotRate,
} from "../../../lib/equipment-finance";
import {
  calculateRegisteredQuote,
  isRegisteredQuoteItemAmount,
} from "../../../lib/registered-quote";
import {
  PRODUCT_CATALOG,
  type ProductCatalogItem,
} from "../../../lib/product-catalog";
import { resolveProcurementFeeRate } from "../../../lib/procurement-product";
import {
  isPartnerOnlyProduct,
  normalizeProductSupplyType,
} from "../../../lib/product-supply-classification";

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
const priceStatuses = [
  "금액 미입력",
  "입력 완료",
  "무상 제공",
  "계약금액에 포함",
  "서비스 품목",
];

async function readCanonicalProductMap(
  d1: Awaited<ReturnType<typeof ensureEquipmentReady>>,
) {
  let products: ProductCatalogItem[] = PRODUCT_CATALOG;
  try {
    const row = await d1
      .prepare("SELECT value FROM app_settings WHERE key = 'product_catalog_v1'")
      .first<{ value: string }>();
    const stored = row?.value ? JSON.parse(row.value) : null;
    if (Array.isArray(stored) && stored.length) {
      products = stored
        .filter(
          (item): item is ProductCatalogItem =>
            Boolean(
              item &&
                typeof item === "object" &&
                clean((item as Record<string, unknown>).id) &&
                clean((item as Record<string, unknown>).name),
            ),
        )
        .map((item) => ({
          ...item,
          id: clean(item.id),
          name: clean(item.name),
        }));
    }
  } catch {
    products = PRODUCT_CATALOG;
  }
  return new Map(products.map((product) => [product.id, product]));
}

function cleanStatus(value: unknown, values: string[], fallback: string) {
  const requested = clean(value);
  return values.includes(requested) ? requested : fallback;
}

function cleanQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(999_999, Math.max(0, Math.round(quantity)));
}

function cleanSignedAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.min(100_000_000_000, Math.max(-100_000_000_000, Math.round(amount)));
}

function cleanProcurementFeeRate(
  value: unknown,
  source?: Record<string, unknown>,
  catalogProduct?: ProductCatalogItem,
) {
  return resolveProcurementFeeRate(
    value,
    source?.productName,
    source?.specification,
    source?.catalogNote,
    source?.notes,
    catalogProduct?.name,
    catalogProduct?.specification,
    catalogProduct?.note,
    catalogProduct?.reference,
  );
}

function cleanPriceStatus(value: unknown, unitPrice: number | null) {
  const requested = cleanStatus(value, priceStatuses, "");
  if (requested) return requested;
  return Number(unitPrice ?? 0) > 0 ? "입력 완료" : "금액 미입력";
}

function cleanConsortiumSettlement(payload: Record<string, unknown>) {
  const executionType = clean(payload.executionType) === "컨소" ? "컨소" : "직영";
  const commissionInputType =
    clean(payload.commissionInputType) === "amount" ? "amount" : "rate";
  const optionalNumber = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const requestedRate = optionalNumber(payload.commissionRate);
  const requestedConsortiumRate = optionalNumber(
    payload.consortiumCommissionRate,
  );
  const requestedAmount = optionalNumber(payload.consortiumPaymentAmount);
  return {
    executionType,
    commissionInputType,
    commissionRate:
      requestedRate !== null
        ? Math.min(1, Math.max(0, requestedRate))
        : null,
    consortiumCommissionRate:
      executionType === "컨소" && commissionInputType === "rate" &&
      requestedConsortiumRate !== null
        ? Math.min(1, Math.max(0, requestedConsortiumRate))
        : null,
    consortiumPaymentAmount:
      executionType === "컨소" && commissionInputType === "amount" &&
      requestedAmount !== null
        ? Math.min(100_000_000_000, Math.max(0, Math.round(requestedAmount)))
        : null,
  };
}

function cleanSupplySettlement(
  payload: Record<string, unknown>,
  catalogSupply?: ProductSupplySetting,
  existing?: Record<string, unknown>,
  productIdentity?: { catalogItemId?: unknown; productName?: unknown },
) {
  const settlement = cleanConsortiumSettlement(payload);
  const hasRequestedSupplyType = Object.prototype.hasOwnProperty.call(
    payload,
    "supplyType",
  );
  const requestedSupplyType =
    (hasRequestedSupplyType
      ? clean(payload.supplyType) === "direct"
      : catalogSupply
        ? catalogSupply.supplyType === "direct"
        : clean(existing?.supply_type) === "direct")
      ? "direct"
      : "partner";
  const supplyType = normalizeProductSupplyType({
    ...productIdentity,
    supplyType: requestedSupplyType,
  });
  const partnerOnly = isPartnerOnlyProduct(productIdentity ?? {});
  const requestedMargin = optionalRate(payload.marginRate);
  const existingMargin = optionalRate(existing?.margin_rate);
  const hasRequestedMarginRate = Object.prototype.hasOwnProperty.call(
    payload,
    "marginRate",
  );
  const hasRequestedCommissionRate = Object.prototype.hasOwnProperty.call(
    payload,
    "commissionRate",
  );
  const marginRate =
    supplyType === "direct"
      ? resolveEquipmentSnapshotRate({
          requestedProvided: hasRequestedMarginRate,
          requestedRate: requestedMargin,
          catalogRate: catalogSupply?.marginRate,
          existingRate: existingMargin,
        })
      : null;
  const commissionRate =
    supplyType === "partner"
      ? resolveEquipmentSnapshotRate({
          requestedProvided: hasRequestedCommissionRate,
          requestedRate: settlement.commissionRate,
          existingRate:
            optionalRate(existing?.commission_rate) ??
            (partnerOnly
              ? optionalRate(existing?.margin_rate) ?? catalogSupply?.marginRate
              : null),
        })
      : null;
  return {
    ...settlement,
    supplyType,
    commissionRate,
    marginRate,
  };
}

function optionalRate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(1, parsed);
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

  const awardStage = normalizeAwardStage(payload.awardStage, payload.awardStatus);
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
    /설치 완료|공사 완료|완공|납품 완료|검수 완료|교육 완료/.test(text) ||
    awardStage === "검수·교육 진행" ||
    isCompletedAwardStage(awardStage)
  ) {
    return "설치 완료";
  }
  if (/설치 중|공사 중|시공 중|목공|시스템 작업/.test(text)) {
    return "설치 중";
  }
  if (/발주/.test(text)) return "발주";
  if (
    ["위즈업 수주", "협력사 수주"].includes(awardStatus) ||
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

async function readProjects(organization: string, businessRound = 1) {
  const d1 = await ensureEquipmentReady();
  await reconcileEquipmentProjectsForBusiness(organization, businessRound);
  const projects = await d1
    .prepare(
      `SELECT p.*, COALESCE(m.display_name, '등록자') AS created_by_name
       FROM equipment_projects p
       LEFT JOIN members m ON m.id = p.created_by
       WHERE p.organization = ? AND p.business_round = ?
       ORDER BY p.updated_at DESC, p.id DESC`,
    )
    .bind(organization, businessRound)
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
  const canonicalProducts = await readCanonicalProductMap(d1);
  items.results.forEach((item: Record<string, unknown>) => {
    const projectId = Number(item.project_id);
    const current = itemsByProject.get(projectId) ?? [];
    const canonical = canonicalProducts.get(clean(item.catalog_item_id));
    const productName = canonical?.name ?? clean(item.product_name);
    const supplyType = normalizeProductSupplyType({
      catalogItemId: item.catalog_item_id,
      productName,
      supplyType: item.supply_type,
    });
    current.push({
      ...item,
      product_name: productName,
      supply_type: supplyType,
      margin_rate: supplyType === "direct" ? item.margin_rate : null,
      commission_rate:
        supplyType === "partner" && isPartnerOnlyProduct({
          catalogItemId: item.catalog_item_id,
          productName,
        })
          ? item.commission_rate ?? item.margin_rate ?? canonical?.commissionRate ?? null
          : item.commission_rate,
    });
    itemsByProject.set(projectId, current);
  });
  return projects.results.map((project: Record<string, unknown>) => ({
    ...project,
    items: itemsByProject.get(Number(project.id)) ?? [],
  }));
}

async function syncOrganizationEquipmentSchedule(
  organization: string,
  businessRound = 1,
) {
  if (!organization) return;
  const d1 = await ensureRecordsReady();
  const latestSchedule = await d1
    .prepare(
      `SELECT progress_schedule, source_chat
       FROM activities
       WHERE organization = ? AND business_round = ? AND progress_schedule <> ''
       ORDER BY COALESCE(activity_date, '') DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization, businessRound)
    .first<{ progress_schedule: string; source_chat: string }>();
  if (
    latestSchedule?.progress_schedule &&
    clean(latestSchedule.source_chat) !== "사이트 AI 입력"
  ) {
    await syncEquipmentItemsFromProgressSchedule(
      organization,
      latestSchedule.progress_schedule,
      businessRound,
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
      await ensureRecordsReady();
      const d1 = await ensureEquipmentReady();
      const [projects, items] = await Promise.all([
        d1
        .prepare(
          `SELECT
            p.id, p.activity_id, p.organization, p.business_round,
            p.construction_amount,
            COALESCE(a.award_status, '미정') AS linked_award_status
           FROM equipment_projects p
           LEFT JOIN activities a ON a.id = p.activity_id
           ORDER BY p.organization, p.business_round, p.id`,
        )
          .all<Record<string, unknown>>(),
        d1
          .prepare(
            `SELECT
              i.*,
              p.organization,
              p.business_round
             FROM equipment_items i
             JOIN equipment_projects p ON p.id = i.project_id
             ORDER BY p.organization, p.business_round, p.id, i.sort_order, i.id`,
          )
          .all<Record<string, unknown>>(),
      ]);
      type EquipmentSummaryAccumulator = {
        organization: string;
        businessRound: number;
        projectCount: number;
        itemCount: number;
        proposedKinds: number;
        awardedKinds: number;
        installedKinds: number;
        quoteItems: {
          quotationAmount: number;
          amountRegistered: boolean;
        }[];
        quoteConstructions: {
          quotationAmount: number;
          amountRegistered: boolean;
        }[];
      };
      const summariesByBusiness = new Map<
        string,
        EquipmentSummaryAccumulator
      >();
      const summaryKey = (organization: unknown, businessRound: unknown) =>
        analyticsBusinessRoundKey(organization, businessRound);
      const ensureSummary = (
        organizationValue: unknown,
        businessRoundValue: unknown,
      ) => {
        const organization = clean(organizationValue);
        const businessRound = Math.max(1, Number(businessRoundValue) || 1);
        const key = summaryKey(organization, businessRound);
        const existing = summariesByBusiness.get(key);
        if (existing) return existing;
        const next: EquipmentSummaryAccumulator = {
          organization,
          businessRound,
          projectCount: 0,
          itemCount: 0,
          proposedKinds: 0,
          awardedKinds: 0,
          installedKinds: 0,
          quoteItems: [],
          quoteConstructions: [],
        };
        summariesByBusiness.set(key, next);
        return next;
      };
      const eligibleProjectIds = new Set<number>();
      projects.results.forEach((project) => {
        const projectActivityId = Number(project.activity_id ?? 0);
        if (
          projectActivityId > 0 &&
          ["협력사 수주", "타업체 수주"].includes(
            clean(project.linked_award_status),
          )
        ) {
          return;
        }
        const projectId = Number(project.id);
        if (!Number.isInteger(projectId) || projectId < 1) return;
        eligibleProjectIds.add(projectId);
        const summary = ensureSummary(
          project.organization,
          project.business_round,
        );
        summary.projectCount += 1;
        const constructionAmount = project.construction_amount;
        summary.quoteConstructions.push({
          quotationAmount: Number(constructionAmount ?? 0),
          amountRegistered:
            constructionAmount !== null &&
            constructionAmount !== undefined &&
            constructionAmount !== "",
        });
      });
      items.results.forEach((item) => {
        if (!eligibleProjectIds.has(Number(item.project_id))) return;
        const summary = ensureSummary(item.organization, item.business_round);
        summary.itemCount += 1;
        if (Number(item.proposed_qty) > 0) summary.proposedKinds += 1;
        if (Number(item.awarded_qty) > 0) summary.awardedKinds += 1;
        if (Number(item.installed_qty) > 0) summary.installedKinds += 1;
        const amountRegistered = isRegisteredQuoteItemAmount({
          priceStatus: clean(item.price_status),
          unitPrice:
            item.catalog_unit_price === null ||
            item.catalog_unit_price === undefined ||
            item.catalog_unit_price === ""
              ? null
              : Number(item.catalog_unit_price),
          proposedQty: Number(item.proposed_qty),
          awardedQty: Number(item.awarded_qty),
          installedQty: Number(item.installed_qty),
        });
        const finance = calculateEquipmentFinance({
          unitPrice:
            item.catalog_unit_price === null ||
            item.catalog_unit_price === undefined ||
            item.catalog_unit_price === ""
              ? null
              : Number(item.catalog_unit_price),
          quantity: equipmentSettlementQuantity({
            proposedQty: Number(item.proposed_qty),
            awardedQty: Number(item.awarded_qty),
            installedQty: Number(item.installed_qty),
          }),
          executionType: clean(item.execution_type),
          commissionInputType: clean(item.commission_input_type),
          commissionRate:
            item.commission_rate === null ? null : Number(item.commission_rate),
          supplyType: normalizeProductSupplyType({
            catalogItemId: item.catalog_item_id,
            productName: item.product_name,
            supplyType: item.supply_type,
          }),
          marginRate:
            item.margin_rate === null ? null : Number(item.margin_rate),
          procurementFeeRate:
            item.procurement_fee_rate === null
              ? null
              : Number(item.procurement_fee_rate),
          consortiumCommissionRate:
            item.consortium_commission_rate === null
              ? null
              : Number(item.consortium_commission_rate),
          consortiumPaymentAmount:
            item.consortium_payment_amount === null
              ? null
              : Number(item.consortium_payment_amount),
        });
        summary.quoteItems.push({
          quotationAmount: finance.quotationAmount,
          amountRegistered,
        });
      });
      const summaries = [...summariesByBusiness.values()]
        .map((summary) => {
          const quote = calculateRegisteredQuote({
            items: summary.quoteItems,
            constructions: summary.quoteConstructions,
          });
          return {
            organization: summary.organization,
            businessRound: summary.businessRound,
            business_round: summary.businessRound,
            project_count: summary.projectCount,
            item_count: summary.itemCount,
            proposed_kinds: summary.proposedKinds,
            awarded_kinds: summary.awardedKinds,
            installed_kinds: summary.installedKinds,
            contractAmountReference: quote.contractAmount,
            quoteStatus: quote.quoteStatus,
            quoteItemCount: quote.quoteItemCount,
            quoteMissingAmountItemCount: quote.quoteMissingAmountItemCount,
            quoteConstructionCount: quote.quoteConstructionCount,
          };
        })
        .sort(
          (left, right) =>
            left.organization.localeCompare(right.organization, "ko-KR") ||
            left.businessRound - right.businessRound,
        );
      return Response.json({ summaries });
    }
    const organization = clean(searchParams.get("organization"));
    const businessRound = Math.max(
      1,
      Math.min(99, Number(searchParams.get("businessRound")) || 1),
    );
    if (!organization) {
      return Response.json({ error: "기관명이 필요합니다." }, { status: 400 });
    }
    return Response.json({
      organization,
      projects: await readProjects(organization, businessRound),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requirePrimaryOwner();
    const payload = (await request.json()) as Record<string, unknown>;
    const kind = clean(payload.kind);
    if (kind.startsWith("ai-") && kind.endsWith("import")) {
      return Response.json({ ok: true, disabled: true });
    }
    const d1 = await ensureEquipmentReady();

    if (kind === "project") {
      const organization = clean(payload.organization);
      const businessRound = Math.max(
        1,
        Math.min(99, Number(payload.businessRound) || 1),
      );
      const name = clean(payload.name);
      if (!organization || !name) {
        return Response.json(
          { error: "기관명과 사업명을 입력해 주세요." },
          { status: 400 },
        );
      }
      await ensureBudgetNamesReady();
      const activityId = Number(payload.activityId);
      const linkedActivity = Number.isInteger(activityId) && activityId > 0
        ? await d1
            .prepare(
              `SELECT award_status AS awardStatus
               FROM activities WHERE id = ?`,
            )
            .bind(activityId)
            .first<{ awardStatus: string }>()
        : null;
      const budgetMetadata = await resolveBudgetRecordMetadata(d1, {
        ...payload,
        budgetOriginalName: payload.budgetOriginalName ?? payload.budgetType,
        awardStatus: linkedActivity?.awardStatus ?? payload.awardStatus ?? "미정",
      });
      const project = await d1
        .prepare(
          `INSERT INTO equipment_projects (
            organization, business_round, name, status, budget_type, notes,
            created_by, activity_id, budget_original_name, budget_group_id,
            budget_match_status, budget_match_method, budget_request_id,
            budget_kind
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *`,
        )
        .bind(
          organization.slice(0, 120),
          businessRound,
          name.slice(0, 160),
          cleanStatus(payload.status, projectStatuses, "제안"),
          budgetMetadata.storedName,
          clean(payload.notes).slice(0, 2_000),
          member.id,
          Number.isInteger(activityId) && activityId > 0 ? activityId : null,
          budgetMetadata.budgetOriginalName,
          budgetMetadata.budgetGroupId,
          budgetMetadata.budgetMatchStatus,
          budgetMetadata.budgetMatchMethod,
          budgetMetadata.budgetRequestId,
          budgetMetadata.budgetKind,
        )
        .first<Record<string, unknown>>();
      if (project) {
        await linkBudgetNameEntity(d1, {
          entityType: "equipment_project",
          entityId: Number(project.id),
          groupId: budgetMetadata.budgetGroupId,
          originalName: budgetMetadata.budgetOriginalName,
          aliasKey:
            budgetMetadata.resolution?.aliasKey ??
            normalizeBudgetNameKey(budgetMetadata.budgetOriginalName),
        });
        if (budgetMetadata.budgetRequestId) {
          await linkBudgetRequestRecord(d1, {
            requestId: budgetMetadata.budgetRequestId,
            entityType: "equipment_project",
            entityId: Number(project.id),
            originalName: budgetMetadata.budgetOriginalName,
            organization,
          });
        }
      }
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
      const unitPrice = cleanSignedAmount(payload.catalogUnitPrice);
      const catalogItemId = clean(payload.catalogItemId).slice(0, 160);
      const canonicalProduct = catalogItemId
        ? (await readCanonicalProductMap(d1)).get(catalogItemId)
        : undefined;
      const productSupplyMap = await readProductSupplySettingMap();
      const settlement = cleanSupplySettlement(
        payload,
        productSupplyMap.get(catalogItemId),
        undefined,
        { catalogItemId, productName: canonicalProduct?.name ?? payload.productName },
      );
      const supplierLink: ProductVendorLink | undefined = catalogItemId
        ? (
            (await readProductVendorLinkMap()) as Map<
              string,
              ProductVendorLink
            >
          ).get(catalogItemId)
        : undefined;
      const supplierVendorId =
        settlement.supplyType === "partner"
          ? supplierLink?.supplierVendorId ?? null
          : null;
      const supplierVendorName =
        settlement.supplyType === "partner"
          ? supplierLink?.supplierVendorName ?? ""
          : "";
      const item = await d1
        .prepare(
          `INSERT INTO equipment_items (
            project_id, product_name, specification, proposed_qty, awarded_qty,
            installed_qty, unit, status, notes, catalog_item_id,
            catalog_unit_price, price_status, catalog_note, execution_type,
            commission_input_type, commission_rate, supply_type, margin_rate,
            procurement_fee_rate,
            consortium_commission_rate,
            consortium_payment_amount,
            supplier_vendor_id, supplier_vendor_name,
            created_by, updated_by, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          catalogItemId,
          unitPrice,
          cleanPriceStatus(payload.priceStatus, unitPrice),
          clean(payload.catalogNote).slice(0, 1_000),
          settlement.executionType,
          settlement.commissionInputType,
          settlement.commissionRate,
          settlement.supplyType,
          settlement.marginRate,
          cleanProcurementFeeRate(
            payload.procurementFeeRate,
            payload,
            canonicalProduct,
          ),
          settlement.consortiumCommissionRate,
          settlement.consortiumPaymentAmount,
          supplierVendorId,
          supplierVendorName,
          member.id,
          member.id,
          Number(sortOrder?.next_order ?? 0),
        )
        .first();
      await d1
        .prepare(
          "UPDATE equipment_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(projectId)
        .run();
      const projectRound = await d1
        .prepare("SELECT business_round FROM equipment_projects WHERE id = ?")
        .bind(projectId)
        .first<{ business_round: number }>();
      await syncOrganizationEquipmentSchedule(
        project.organization,
        Math.max(1, Number(projectRound?.business_round) || 1),
      );
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
      const productVendorLinkMap = (await readProductVendorLinkMap()) as Map<
        string,
        ProductVendorLink
      >;
      const productSupplyMap = await readProductSupplySettingMap();
      const canonicalProductMap = await readCanonicalProductMap(d1);
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
        const settlement = cleanSupplySettlement(
          source,
          productSupplyMap.get(catalogItemId),
          undefined,
          { catalogItemId, productName },
        );
        const unitPrice = cleanSignedAmount(source.catalogUnitPrice);
        const supplierLink: ProductVendorLink | undefined =
          productVendorLinkMap.get(catalogItemId);
        const supplierVendorId =
          settlement.supplyType === "partner"
            ? supplierLink?.supplierVendorId ?? null
            : null;
        const supplierVendorName =
          settlement.supplyType === "partner"
            ? supplierLink?.supplierVendorName ?? ""
            : "";
        await d1
          .prepare(
            `INSERT INTO equipment_items (
              project_id, product_name, specification, proposed_qty, awarded_qty,
              installed_qty, unit, status, notes, catalog_item_id,
              catalog_unit_price, price_status, catalog_note, execution_type,
              commission_input_type, commission_rate, supply_type, margin_rate,
              procurement_fee_rate,
              consortium_commission_rate,
              consortium_payment_amount, supplier_vendor_id,
              supplier_vendor_name, protection_status, created_by, updated_by, sort_order
            ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '신청 필요', ?, ?, ?)`,
          )
          .bind(
            projectId,
            productName,
            specification,
            Math.max(1, cleanQuantity(source.proposedQty)),
            clean(source.unit).slice(0, 20) || "대",
            cleanStatus(source.status, itemStatuses, "제안 예정"),
            catalogItemId,
            unitPrice,
            cleanPriceStatus(source.priceStatus, unitPrice),
            clean(source.catalogNote).slice(0, 1_000),
            settlement.executionType,
            settlement.commissionInputType,
            settlement.commissionRate,
            settlement.supplyType,
            settlement.marginRate,
            cleanProcurementFeeRate(
              source.procurementFeeRate,
              source,
              canonicalProductMap.get(catalogItemId),
            ),
            settlement.consortiumCommissionRate,
            settlement.consortiumPaymentAmount,
            supplierVendorId,
            supplierVendorName,
            member.id,
            member.id,
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
      const businessRound = Math.max(
        1,
        Math.min(99, Number(payload.businessRound) || 1),
      );
      await ensureBudgetNamesReady();
      const budgetMetadata = await resolveBudgetRecordMetadata(d1, {
        ...payload,
        budgetOriginalName: payload.budgetOriginalName ?? payload.budgetType,
        awardStatus: payload.awardStatus ?? "미정",
      });
      const budgetType = budgetMetadata.storedName;
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
          "SELECT * FROM equipment_projects WHERE organization = ? AND business_round = ? AND name = ?",
        )
        .bind(organization, businessRound, projectName)
        .first<Record<string, unknown>>();
      if (!project) {
        const candidates = await d1
          .prepare(
            `SELECT * FROM equipment_projects
             WHERE organization = ?
               AND business_round = ?
               AND (? = '' OR budget_type = ?)
             ORDER BY updated_at DESC, id DESC
             LIMIT 2`,
          )
          .bind(organization, businessRound, budgetType, budgetType)
          .all<Record<string, unknown>>();
        if (candidates.results.length === 1) {
          project = candidates.results[0];
        }
      }
      if (!project) {
        project = await d1
          .prepare(
            `INSERT INTO equipment_projects (
              organization, business_round, name, status, budget_type, notes,
              created_by, budget_original_name, budget_group_id,
              budget_match_status, budget_match_method, budget_request_id,
              budget_kind
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING *`,
          )
          .bind(
            organization,
            businessRound,
            projectName,
            inferredStatus,
            budgetType,
            "AI 기록에서 자동 생성",
            member.id,
            budgetMetadata.budgetOriginalName,
            budgetMetadata.budgetGroupId,
            budgetMetadata.budgetMatchStatus,
            budgetMetadata.budgetMatchMethod,
            budgetMetadata.budgetRequestId,
            budgetMetadata.budgetKind,
          )
          .first<Record<string, unknown>>();
      }
      if (!project) throw new Error("품목 사업을 만들지 못했습니다.");
      await linkBudgetNameEntity(d1, {
        entityType: "equipment_project",
        entityId: Number(project.id),
        groupId: budgetMetadata.budgetGroupId,
        originalName: budgetMetadata.budgetOriginalName,
        aliasKey:
          budgetMetadata.resolution?.aliasKey ??
          normalizeBudgetNameKey(budgetMetadata.budgetOriginalName),
      });
      if (budgetMetadata.budgetRequestId) {
        await linkBudgetRequestRecord(d1, {
          requestId: budgetMetadata.budgetRequestId,
          entityType: "equipment_project",
          entityId: Number(project.id),
          originalName: budgetMetadata.budgetOriginalName,
          organization,
        });
      }

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
                unit = ?, status = ?, notes = ?, updated_by = ?,
                updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
            )
            .bind(
              proposedQty || Number(existing.proposed_qty ?? 0),
              awardedQty || Number(existing.awarded_qty ?? 0),
              installedQty || Number(existing.installed_qty ?? 0),
              clean(item.unit).slice(0, 20) || String(existing.unit ?? "대"),
              inferItemStatus(item),
              clean(item.notes).slice(0, 1_000) || String(existing.notes ?? ""),
              member.id,
              Number(existing.id),
            )
            .run();
        } else {
          await d1
            .prepare(
              `INSERT INTO equipment_items (
                project_id, product_name, specification, proposed_qty, awarded_qty,
                installed_qty, unit, status, notes, price_status,
                created_by, updated_by, sort_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '금액 미입력', ?, ?, ?)`,
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
              member.id,
              member.id,
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
               budget_original_name = ?,
               budget_group_id = ?, budget_match_status = ?,
               budget_match_method = ?, budget_request_id = ?,
               budget_kind = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          projectName,
          projectName,
          progressiveProjectStatus(project.status, inferredStatus),
          budgetType,
          budgetType,
          budgetMetadata.budgetOriginalName,
          budgetMetadata.budgetGroupId,
          budgetMetadata.budgetMatchStatus,
          budgetMetadata.budgetMatchMethod,
          budgetMetadata.budgetRequestId,
          budgetMetadata.budgetKind,
          Number(project.id),
        )
        .run();
      await syncEquipmentItemsFromProgressSchedule(
        organization,
        clean(payload.progressSchedule),
        businessRound,
      );
      return Response.json({
        ok: true,
        projects: await readProjects(organization, businessRound),
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

function optionalPositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function PUT(request: Request) {
  try {
    const member = await requirePrimaryOwner();
    const payload = (await request.json()) as Record<string, unknown>;
    const kind = clean(payload.kind);
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "수정할 항목을 확인해 주세요." }, { status: 400 });
    }
    const d1 = await ensureEquipmentReady();

    if (kind === "project-costs") {
      const project = await d1
        .prepare(
          `UPDATE equipment_projects SET
            construction_amount = ?, actual_construction_cost = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
           RETURNING *`,
        )
        .bind(
          cleanSignedAmount(payload.constructionAmount),
          cleanSignedAmount(payload.actualConstructionCost),
          id,
        )
        .first();
      if (!project) {
        return Response.json({ error: "사업을 찾지 못했습니다." }, { status: 404 });
      }
      return Response.json({ project });
    }

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
        .prepare(
          `SELECT p.*, COALESCE(a.award_status, '미정') AS linkedAwardStatus
           FROM equipment_projects p
           LEFT JOIN activities a ON a.id = p.activity_id
           WHERE p.id = ?`,
        )
        .bind(id)
        .first<Record<string, unknown>>();
      if (!previous) {
        return Response.json({ error: "사업을 찾지 못했습니다." }, { status: 404 });
      }
      await ensureBudgetNamesReady();
      const budgetMetadata = await resolveBudgetRecordMetadata(d1, {
        budgetType: payload.budgetType ?? previous.budget_type,
        budgetOriginalName:
          payload.budgetOriginalName ??
          previous.budget_original_name ??
          payload.budgetType ??
          previous.budget_type,
        budgetGroupId: payload.budgetGroupId ?? previous.budget_group_id,
        budgetMatchStatus:
          payload.budgetMatchStatus ?? previous.budget_match_status,
        budgetMatchMethod:
          payload.budgetMatchMethod ?? previous.budget_match_method,
        budgetRequestId:
          payload.budgetRequestId ??
          payload.budgetNameRequestId ??
          previous.budget_request_id,
        budgetKind: payload.budgetKind ?? previous.budget_kind,
        awardStatus: previous.linkedAwardStatus ?? payload.awardStatus ?? "미정",
      });
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
            budget_original_name = ?, budget_group_id = ?,
            budget_match_status = ?, budget_match_method = ?,
            budget_request_id = ?, budget_kind = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
           RETURNING *`,
        )
        .bind(
          organization.slice(0, 120),
          name.slice(0, 160),
          cleanStatus(payload.status, projectStatuses, "제안"),
          budgetMetadata.storedName,
          clean(payload.notes).slice(0, 2_000),
          budgetMetadata.budgetOriginalName,
          budgetMetadata.budgetGroupId,
          budgetMetadata.budgetMatchStatus,
          budgetMetadata.budgetMatchMethod,
          budgetMetadata.budgetRequestId,
          budgetMetadata.budgetKind,
          id,
        )
        .first<Record<string, unknown>>();
      if (!project) {
        return Response.json({ error: "사업을 찾지 못했습니다." }, { status: 404 });
      }
      await linkBudgetNameEntity(d1, {
        entityType: "equipment_project",
        entityId: Number(project.id),
        groupId: budgetMetadata.budgetGroupId,
        originalName: budgetMetadata.budgetOriginalName,
        aliasKey:
          budgetMetadata.resolution?.aliasKey ??
          normalizeBudgetNameKey(budgetMetadata.budgetOriginalName),
      });
      if (budgetMetadata.budgetRequestId) {
        await linkBudgetRequestRecord(d1, {
          requestId: budgetMetadata.budgetRequestId,
          entityType: "equipment_project",
          entityId: Number(project.id),
          originalName: budgetMetadata.budgetOriginalName,
          organization,
        });
      }
      return Response.json({
        project,
        renamedOrganization:
          previousOrganization !== organization ? organization : null,
      });
    }

    if (kind === "item") {
      let productName = clean(payload.productName);
      if (!productName) {
        return Response.json({ error: "품목명을 입력해 주세요." }, { status: 400 });
      }
      const unitPrice = cleanSignedAmount(payload.catalogUnitPrice);
      const catalogItemId = clean(payload.catalogItemId).slice(0, 160);
      const canonicalProduct = (await readCanonicalProductMap(d1)).get(
        catalogItemId,
      );
      if (canonicalProduct) productName = canonicalProduct.name;
      const existingItem = await d1
        .prepare("SELECT * FROM equipment_items WHERE id = ?")
        .bind(id)
        .first<Record<string, unknown>>();
      if (!existingItem) {
        return Response.json({ error: "품목을 찾지 못했습니다." }, { status: 404 });
      }
      const productSupplyMap = await readProductSupplySettingMap();
      const preservesExistingCatalog =
        clean(existingItem.catalog_item_id) === catalogItemId;
      const settlement = cleanSupplySettlement(
        payload,
        productSupplyMap.get(catalogItemId),
        preservesExistingCatalog ? existingItem : undefined,
        { catalogItemId, productName },
      );
      const supplierLink: ProductVendorLink | undefined = catalogItemId
        ? (
            (await readProductVendorLinkMap()) as Map<
              string,
              ProductVendorLink
            >
          ).get(catalogItemId)
        : undefined;
      const supplierVendorId =
        settlement.supplyType === "partner"
          ? supplierLink?.supplierVendorId ??
            (preservesExistingCatalog
              ? optionalPositiveInteger(existingItem.supplier_vendor_id)
              : null)
          : null;
      const supplierVendorName =
        settlement.supplyType === "partner"
          ? supplierLink?.supplierVendorName ??
            (preservesExistingCatalog
              ? clean(existingItem.supplier_vendor_name).slice(0, 300)
              : "")
          : "";
      const item = await d1
        .prepare(
          `UPDATE equipment_items SET
            product_name = ?, specification = ?, proposed_qty = ?, awarded_qty = ?,
            installed_qty = ?, unit = ?, status = ?, notes = ?, catalog_item_id = ?,
            catalog_unit_price = ?, price_status = ?, catalog_note = ?,
            execution_type = ?,
            commission_input_type = ?, commission_rate = ?,
            supply_type = ?, margin_rate = ?, procurement_fee_rate = ?,
            consortium_commission_rate = ?,
            consortium_payment_amount = ?,
            supplier_vendor_id = ?, supplier_vendor_name = ?,
            updated_by = ?,
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
          catalogItemId,
          unitPrice,
          cleanPriceStatus(payload.priceStatus, unitPrice),
          clean(payload.catalogNote).slice(0, 1_000),
          settlement.executionType,
          settlement.commissionInputType,
          settlement.commissionRate,
          settlement.supplyType,
          settlement.marginRate,
          cleanProcurementFeeRate(
            payload.procurementFeeRate,
            payload,
            canonicalProduct,
          ),
          settlement.consortiumCommissionRate,
          settlement.consortiumPaymentAmount,
          supplierVendorId,
          supplierVendorName,
          member.id,
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
    await requirePrimaryOwner();
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
