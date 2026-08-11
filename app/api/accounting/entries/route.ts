import {
  accessErrorResponse,
  hasMemberPermission,
  requireApprovedMember,
  requireMemberPermission,
} from "../../../../lib/collaboration";
import {
  ensureAccountingReady,
  ensureLegacyReceiptLedgerMigration,
  linkEquipmentProjectsToWhizzupAwards,
} from "../../../../lib/accounting-store";
import {
  calculateEquipmentFinance,
  equipmentSettlementQuantity,
} from "../../../../lib/equipment-finance";
import {
  calculateAwardSettlementProjection,
  calculateConstructionFinance,
} from "../../../../lib/construction-finance";
import {
  analyticsBusinessRoundKey,
  completedWhizzupAwardRows,
  normalizeBusinessRound,
  upcomingWhizzupAwardRows,
} from "../../../../lib/analytics-business-rounds";
import { automaticCollectionStatus } from "../../../../lib/collection-analytics";
import { groupAccountingJointProjects } from "../../../../lib/accounting-joint-projects";
import { ensureJointProjectsReady } from "../../../../lib/joint-projects";
import {
  calculateRegisteredQuote,
  isRegisteredQuoteItemAmount,
  type RegisteredQuoteComponent,
  type RegisteredQuoteStatus,
} from "../../../../lib/registered-quote";
import {
  authoredQuotationFromRow,
  ensureAuthoredQuotationsReady,
  type AuthoredQuotation,
} from "../../../../lib/authored-quotations";

export const dynamic = "force-dynamic";

const ACCOUNTING_TOTAL_KEY = "award-total";
const D1_SAFE_IN_CHUNK_SIZE = 50;
const EXCLUDED_ENTRY_RECEIPT_ERROR =
  "회계 관리에서 제외된 기록입니다. 수금 내역을 변경하려면 먼저 작업목록에 복원해 주세요.";
type D1Database = Awaited<ReturnType<typeof ensureAccountingReady>>;

type SourceItem = {
  id: number;
  projectId: number;
  projectName: string;
  productName: string;
  specification: string;
  quantity: number;
  unitPrice: number;
  supplyType: "partner" | "direct";
  commissionRate: number | null;
  marginRate: number | null;
  expectedPartnerCommission: number;
  expectedDirectSalesCollection: number;
  expectedDirectMargin: number;
  expectedCommission: number;
  expectedConsortiumSettlement: number;
  executionType: "직영" | "컨소";
  supplierVendorId: number | null;
  supplierVendorName: string;
};

type SourceProject = {
  id: number;
  name: string;
  constructionAmount: number;
  actualConstructionCost: number;
  constructionMargin: number;
};

type ActivitySource = {
  activityId: number;
  businessKey: string;
  businessRound: number;
  groupedActivityIds: number[];
  activityDate: string;
  awardStage: string;
  organization: string;
  region: string;
  budgetType: string;
  progressManager: string;
  contractAmount: number;
  estimatedContractAmount: number;
  executionType: "직영" | "컨소";
  consortiumCompany: string;
  projects: Map<number, SourceProject>;
  items: SourceItem[];
  quoteItems: RegisteredQuoteComponent[];
  quoteConstructions: RegisteredQuoteComponent[];
  quoteStatus: RegisteredQuoteStatus;
  quoteItemCount: number;
  quoteMissingAmountItemCount: number;
  expectedPartnerCommission: number;
  expectedDirectSalesCollection: number;
  expectedDirectMargin: number;
  expectedConstructionMargin: number;
  expectedCollectionTotal: number;
  expectedSettlementDeficit: number;
  expectedProfit: number;
  expectedCommission: number;
  expectedConsortiumSettlement: number;
  jointProjectId: number | null;
  jointProjectName: string;
  jointProjectSponsor: string;
  jointProjectSponsorKey: string;
  jointProjectRole: "sponsor" | "site" | "";
  jointProjectBudgetType: string;
  jointProjectYear: number | null;
  jointProjectRound: number | null;
  finalQuotation: AuthoredQuotation | null;
};

type Receipt = {
  id: number;
  entryId: number;
  amount: number;
  collectionDate: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  legacy: boolean;
};

function parseAmount(value: unknown) {
  const parsed = Math.round(Number(String(value ?? "").replace(/[^\d.-]/g, "")));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100_000_000_000) {
    throw new Error("수금액은 1원 이상 1,000억원 이하로 입력해 주세요.");
  }
  return parsed;
}

function parseDate(value: unknown) {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("수금일을 확인해 주세요.");
  }
  return date;
}

function linkedItemQuantity(row: Record<string, unknown>) {
  return equipmentSettlementQuantity({
    proposedQty: Number(row.proposed_qty ?? 0),
    awardedQty: Number(row.awarded_qty ?? 0),
    installedQty: Number(row.installed_qty ?? 0),
  });
}

async function loadActivitySources(
  d1: D1Database,
  scope: "completed" | "upcoming" = "completed",
) {
  await ensureJointProjectsReady();
  await ensureAuthoredQuotationsReady();
  const [activityResult, projectResult, jointProjectResult, quotationResult] = await Promise.all([
    d1.prepare(`
      SELECT
        a.id AS activity_id,
        a.activity_date,
        a.award_completed_date,
        a.award_status,
        a.award_stage,
        a.organization,
        a.business_round,
        a.region,
        a.budget_type,
        a.progress_manager,
        a.execution_type,
        a.consortium_company
      FROM activities a
      WHERE a.award_status IN ('위즈업 수주', '협력사 수주', '타업체 수주')
      ORDER BY a.activity_date DESC, a.id DESC
    `).all<Record<string, unknown>>(),
    d1.prepare(`
      SELECT
        ep.id AS project_id,
        ep.activity_id AS project_activity_id,
        ep.organization,
        ep.business_round,
        ep.name AS project_name,
        ep.construction_amount,
        ep.actual_construction_cost,
        ei.id AS item_id,
        ei.product_name,
        ei.specification,
        ei.proposed_qty,
        ei.awarded_qty,
        ei.installed_qty,
        ei.catalog_unit_price,
        ei.price_status,
        ei.procurement_fee_rate,
        ei.execution_type AS item_execution_type,
        ei.commission_input_type,
        ei.commission_rate,
        ei.supply_type,
        ei.margin_rate,
        ei.consortium_commission_rate,
        ei.consortium_payment_amount,
        ei.supplier_vendor_id,
        ei.supplier_vendor_name,
        linked_activity.award_status AS project_award_status
      FROM equipment_projects ep
      LEFT JOIN equipment_items ei
        ON ei.project_id = ep.id
      LEFT JOIN activities linked_activity
        ON linked_activity.id = ep.activity_id
      ORDER BY ep.id, ei.sort_order, ei.id
    `).all<Record<string, unknown>>(),
    d1.prepare(`
      SELECT
        jpm.activity_id,
        jpm.role,
        jp.id AS joint_project_id,
        jp.name AS joint_project_name,
        jp.sponsor_organization AS joint_project_sponsor,
        jp.budget_type AS joint_project_budget_type,
        jp.project_year AS joint_project_year,
        jp.joint_round AS joint_project_round,
        sponsor.institution_key AS joint_project_sponsor_key
      FROM joint_project_members jpm
      JOIN joint_projects jp ON jp.id = jpm.project_id
      LEFT JOIN joint_project_members sponsor
        ON sponsor.project_id = jp.id
       AND sponsor.role = 'sponsor'
      WHERE jp.status = 'active'
        AND jpm.activity_id IS NOT NULL
      ORDER BY jp.id DESC, jpm.id DESC
    `).all<Record<string, unknown>>(),
    d1.prepare(`
      SELECT *
      FROM authored_quotations
      WHERE status = 'final' AND deleted_at = ''
      ORDER BY quote_date DESC, revision_number DESC, id DESC
      LIMIT 1000
    `).all<Record<string, unknown>>(),
  ]);

  const latestQuotationByBusiness = new Map<string, AuthoredQuotation>();
  quotationResult.results.forEach((row) => {
    const quotation = authoredQuotationFromRow(row);
    const businessKey = analyticsBusinessRoundKey(
      quotation.organization,
      quotation.businessRound,
    );
    if (!latestQuotationByBusiness.has(businessKey)) {
      latestQuotationByBusiness.set(businessKey, quotation);
    }
  });

  const jointProjectsByActivityId = new Map<
    number,
    Record<string, unknown>[]
  >();
  jointProjectResult.results.forEach((row) => {
    const activityId = Number(row.activity_id ?? 0);
    if (!activityId) return;
    const rows = jointProjectsByActivityId.get(activityId) ?? [];
    rows.push(row);
    jointProjectsByActivityId.set(activityId, rows);
  });

  const sources = new Map<number, ActivitySource>();
  const sourcesByBusinessKey = new Map<string, ActivitySource>();
  const authoritativeActivityCountByBusiness = new Map<string, number>();
  activityResult.results.forEach((row: Record<string, unknown>) => {
    const businessKey = analyticsBusinessRoundKey(
      row.organization,
      row.business_round,
    );
    authoritativeActivityCountByBusiness.set(
      businessKey,
      (authoritativeActivityCountByBusiness.get(businessKey) ?? 0) + 1,
    );
  });
  const authorityBoundaryBusinessKeys = new Set<string>();
  const groupedRows =
    scope === "upcoming"
      ? upcomingWhizzupAwardRows(activityResult.results)
      : completedWhizzupAwardRows(activityResult.results);
  for (const row of groupedRows) {
    const activityId = Number(row.activity_id);
    const businessKey = String(
      row.business_key ??
        analyticsBusinessRoundKey(row.organization, row.business_round),
    );
    const groupedActivityIds = Array.isArray(row.grouped_activity_ids)
      ? row.grouped_activity_ids.map(Number).filter(Number.isInteger)
      : [activityId];
    const jointProject =
      jointProjectsByActivityId.get(activityId)?.[0] ??
      groupedActivityIds.flatMap(
        (id) => jointProjectsByActivityId.get(id) ?? [],
      )[0];
    if (
      (authoritativeActivityCountByBusiness.get(businessKey) ?? 0) >
      groupedActivityIds.length
    ) {
      authorityBoundaryBusinessKeys.add(businessKey);
    }
    const source: ActivitySource = {
      activityId,
      businessKey,
      businessRound: normalizeBusinessRound(row.business_round),
      groupedActivityIds,
      activityDate: String(row.activity_date ?? "").slice(0, 10),
      awardStage: String(row.award_stage ?? "미정"),
      organization: String(row.organization ?? ""),
      region: String(row.region ?? ""),
      budgetType: String(row.budget_type ?? ""),
      progressManager: String(row.progress_manager ?? ""),
      contractAmount: 0,
      estimatedContractAmount: 0,
      executionType:
        String(row.execution_type ?? "") === "컨소" ? "컨소" : "직영",
      consortiumCompany: String(row.consortium_company ?? ""),
      projects: new Map(),
      items: [],
      quoteItems: [],
      quoteConstructions: [],
      quoteStatus: "missing",
      quoteItemCount: 0,
      quoteMissingAmountItemCount: 0,
      expectedPartnerCommission: 0,
      expectedDirectSalesCollection: 0,
      expectedDirectMargin: 0,
      expectedConstructionMargin: 0,
      expectedCollectionTotal: 0,
      expectedSettlementDeficit: 0,
      expectedProfit: 0,
      expectedCommission: 0,
      expectedConsortiumSettlement: 0,
      jointProjectId: jointProject
        ? Number(jointProject.joint_project_id)
        : null,
      jointProjectName: String(jointProject?.joint_project_name ?? ""),
      jointProjectSponsor: String(
        jointProject?.joint_project_sponsor ?? "",
      ),
      jointProjectSponsorKey: String(
        jointProject?.joint_project_sponsor_key ?? "",
      ),
      jointProjectRole:
        String(jointProject?.role ?? "") === "sponsor"
          ? "sponsor"
          : String(jointProject?.role ?? "") === "site"
            ? "site"
            : "",
      jointProjectBudgetType: String(
        jointProject?.joint_project_budget_type ?? "",
      ),
      jointProjectYear: jointProject
        ? Number(jointProject.joint_project_year) || null
        : null,
      jointProjectRound: jointProject
        ? normalizeBusinessRound(jointProject.joint_project_round)
        : null,
      finalQuotation: latestQuotationByBusiness.get(businessKey) ?? null,
    };
    sourcesByBusinessKey.set(businessKey, source);
    groupedActivityIds.forEach((id) => sources.set(id, source));
  }

  for (const row of projectResult.results) {
    const source = sourcesByBusinessKey.get(
      analyticsBusinessRoundKey(row.organization, row.business_round),
    );
    if (!source) continue;
    const projectActivityId = Number(row.project_activity_id ?? 0);
    if (
      (projectActivityId === 0 &&
        authorityBoundaryBusinessKeys.has(source.businessKey)) ||
      (projectActivityId > 0 &&
        (!source.groupedActivityIds.includes(projectActivityId) ||
          String(row.project_award_status ?? "") !== "위즈업 수주"))
    ) {
      continue;
    }
    const projectId = Number(row.project_id ?? 0);
    if (projectId && !source.projects.has(projectId)) {
      const constructionFinance = calculateConstructionFinance({
        constructionAmount:
          row.construction_amount === null ||
          row.construction_amount === undefined
            ? null
            : Number(row.construction_amount),
        actualConstructionCost:
          row.actual_construction_cost === null ||
          row.actual_construction_cost === undefined
            ? null
            : Number(row.actual_construction_cost),
      });
      source.projects.set(projectId, {
        id: projectId,
        name: String(row.project_name ?? ""),
        ...constructionFinance,
      });
      source.quoteConstructions.push({
        quotationAmount: constructionFinance.constructionAmount,
        amountRegistered:
          row.construction_amount !== null &&
          row.construction_amount !== undefined,
      });
      source.expectedConstructionMargin +=
        constructionFinance.constructionMargin;
    }

    const itemId = Number(row.item_id ?? 0);
    if (!itemId) continue;
    const quantity = linkedItemQuantity(row);
    const parsedUnitPrice = Number(row.catalog_unit_price ?? 0);
    const unitPrice = Number.isFinite(parsedUnitPrice) ? parsedUnitPrice : 0;
    const supplyType =
      String(row.supply_type ?? "") === "direct" ? "direct" : "partner";
    const parsedRate = Number(row.commission_rate);
    const commissionRate =
      row.commission_rate === null || row.commission_rate === undefined
        ? null
        : Number.isFinite(parsedRate)
          ? parsedRate
          : null;
    const parsedMarginRate = Number(row.margin_rate);
    const marginRate =
      row.margin_rate === null || row.margin_rate === undefined
        ? null
        : Number.isFinite(parsedMarginRate)
          ? parsedMarginRate
          : null;
    const executionType =
      String(row.item_execution_type ?? "") === "컨소" ? "컨소" : "직영";
    const itemFinance = calculateEquipmentFinance({
      unitPrice,
      quantity,
      supplyType,
      commissionRate,
      marginRate,
      procurementFeeRate:
        row.procurement_fee_rate === null ||
        row.procurement_fee_rate === undefined
          ? null
          : Number(row.procurement_fee_rate),
      executionType,
      commissionInputType:
        String(row.commission_input_type ?? "") === "amount" ? "amount" : "rate",
      consortiumCommissionRate:
        row.consortium_commission_rate === null ||
        row.consortium_commission_rate === undefined
          ? null
          : Number(row.consortium_commission_rate),
      consortiumPaymentAmount:
        row.consortium_payment_amount === null ||
        row.consortium_payment_amount === undefined
          ? null
          : Number(row.consortium_payment_amount),
    });
    const itemExpectedPartnerCommission =
      itemFinance.expectedPartnerCommission;
    const itemExpectedDirectMargin = itemFinance.expectedDirectMargin;
    const itemExpectedConsortium = itemFinance.consortiumPayment;
    const itemExpectedDirectSalesCollection =
      supplyType === "direct" ? itemFinance.quotationAmount : 0;
    const itemAmountRegistered = isRegisteredQuoteItemAmount({
      priceStatus: String(row.price_status ?? ""),
      unitPrice:
        row.catalog_unit_price === null ||
        row.catalog_unit_price === undefined
          ? null
          : Number(row.catalog_unit_price),
      proposedQty: Number(row.proposed_qty ?? 0),
      awardedQty: Number(row.awarded_qty ?? 0),
      installedQty: Number(row.installed_qty ?? 0),
    });
    source.quoteItems.push({
      quotationAmount: itemFinance.quotationAmount,
      amountRegistered: itemAmountRegistered,
    });
    source.items.push({
      id: itemId,
      projectId,
      projectName: String(row.project_name ?? ""),
      productName: String(row.product_name ?? "품목 미등록"),
      specification: String(row.specification ?? ""),
      quantity,
      unitPrice,
      supplyType,
      commissionRate,
      marginRate,
      expectedPartnerCommission: itemExpectedPartnerCommission,
      expectedDirectSalesCollection: itemExpectedDirectSalesCollection,
      expectedDirectMargin: itemExpectedDirectMargin,
      expectedCommission: itemExpectedPartnerCommission,
      expectedConsortiumSettlement: itemExpectedConsortium,
      executionType,
      supplierVendorId:
        row.supplier_vendor_id === null ||
        row.supplier_vendor_id === undefined
          ? null
          : Number(row.supplier_vendor_id),
      supplierVendorName: String(row.supplier_vendor_name ?? ""),
    });
    source.expectedPartnerCommission += itemExpectedPartnerCommission;
    source.expectedDirectSalesCollection +=
      itemExpectedDirectSalesCollection;
    source.expectedDirectMargin += itemExpectedDirectMargin;
    source.expectedConsortiumSettlement += itemExpectedConsortium;
    if (executionType === "컨소") source.executionType = "컨소";
  }
  for (const source of sourcesByBusinessKey.values()) {
    const quotation = source.finalQuotation;
    if (!quotation) continue;
    const projectName = quotation.budgets
      .map((budget) => budget.name)
      .filter(Boolean)
      .join(" + ") || quotation.projectTitle || "최종 견적";
    source.items = quotation.items.map((item, index) => ({
      id: -(index + 1),
      projectId: 0,
      projectName,
      productName: item.name,
      specification: item.specification,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      supplyType: item.supplyType,
      commissionRate: item.supplyType === "partner" ? item.earningRate : null,
      marginRate: item.supplyType === "direct" ? item.earningRate : null,
      expectedPartnerCommission:
        item.supplyType === "partner" ? item.expectedEarning : 0,
      expectedDirectSalesCollection:
        item.supplyType === "direct" ? item.amount + item.procurementFee : 0,
      expectedDirectMargin:
        item.supplyType === "direct" ? item.expectedEarning : 0,
      expectedCommission:
        item.supplyType === "partner" ? item.expectedEarning : 0,
      expectedConsortiumSettlement: item.consortiumPayment,
      executionType: quotation.executionType,
      supplierVendorId: null,
      supplierVendorName: "",
    }));
    source.quoteItems = quotation.items.map((item) => ({
      quotationAmount: item.amount + item.procurementFee,
      amountRegistered: true,
    }));
    source.quoteConstructions = [];
    source.projects = new Map();
    source.expectedPartnerCommission = quotation.items.reduce(
      (sum, item) =>
        sum + (item.supplyType === "partner" ? item.expectedEarning : 0),
      0,
    );
    source.expectedDirectSalesCollection = quotation.items.reduce(
      (sum, item) =>
        sum + (item.supplyType === "direct" ? item.amount + item.procurementFee : 0),
      0,
    );
    source.expectedDirectMargin = quotation.items.reduce(
      (sum, item) =>
        sum + (item.supplyType === "direct" ? item.expectedEarning : 0),
      0,
    );
    source.expectedConstructionMargin = -Math.max(
      0,
      quotation.additionalInternalConstructionCost,
    );
    source.expectedConsortiumSettlement = quotation.consortiumPayment;
    source.executionType = quotation.executionType;
    source.consortiumCompany = quotation.consortiumCompany;
  }
  for (const source of sourcesByBusinessKey.values()) {
    const registeredQuote = calculateRegisteredQuote({
      items: source.quoteItems,
      constructions: source.quoteConstructions,
    });
    source.contractAmount = source.finalQuotation?.totalAmount ?? registeredQuote.contractAmount;
    source.estimatedContractAmount = source.contractAmount;
    source.quoteStatus = source.finalQuotation ? "complete" : registeredQuote.quoteStatus;
    source.quoteItemCount = source.finalQuotation?.items.length ?? registeredQuote.quoteItemCount;
    source.quoteMissingAmountItemCount = source.finalQuotation
      ? 0
      : registeredQuote.quoteMissingAmountItemCount;
    const projection = calculateAwardSettlementProjection({
      expectedPartnerCommission: source.expectedPartnerCommission,
      expectedDirectSalesCollection: source.expectedDirectSalesCollection,
      expectedDirectMargin: source.expectedDirectMargin,
      expectedConstructionMargin: source.expectedConstructionMargin,
      expectedConsortiumSettlement: source.expectedConsortiumSettlement,
    });
    source.expectedCollectionTotal = projection.expectedCollectionTotal;
    source.expectedSettlementDeficit = projection.expectedSettlementDeficit;
    source.expectedProfit = projection.expectedProfit;
    source.expectedCommission = source.expectedPartnerCommission;
  }
  return sources;
}

async function syncTotalEntries(
  d1: D1Database,
  sources: Map<number, ActivitySource>,
) {
  const activityIds = [
    ...new Set([...sources.values()].map((source) => source.activityId)),
  ];
  if (!activityIds.length) return;
  const statements: ReturnType<typeof d1.prepare>[] = [];
  for (
    let index = 0;
    index < activityIds.length;
    index += D1_SAFE_IN_CHUNK_SIZE
  ) {
    const batchIds = activityIds.slice(
      index,
      index + D1_SAFE_IN_CHUNK_SIZE,
    );
    statements.push(
      d1
        .prepare(`
      INSERT OR IGNORE INTO accounting_commission_entries (
        activity_id, manufacturer_key, manufacturer_name
      )
      SELECT a.id, ?, '수주 전체'
      FROM activities a
      WHERE a.id IN (${batchIds.map(() => "?").join(", ")})
        AND a.award_status = '위즈업 수주'
        AND a.award_stage = '납품 완료'
    `)
        .bind(ACCOUNTING_TOTAL_KEY, ...batchIds),
    );
  }
  await d1.batch(statements);
}

async function consolidateEntriesByBusinessRound(
  d1: D1Database,
  sources: Map<number, ActivitySource>,
) {
  const entryResult = await d1
    .prepare(`
      SELECT
        e.id,
        e.activity_id,
        e.workflow_excluded,
        e.workflow_excluded_at,
        e.workflow_excluded_by,
        e.workflow_excluded_by_name,
        e.updated_at
      FROM accounting_commission_entries e
      JOIN activities a ON a.id = e.activity_id
      WHERE e.manufacturer_key = ?
        AND a.award_status = '위즈업 수주'
      ORDER BY e.updated_at DESC, e.id DESC
    `)
    .bind(ACCOUNTING_TOTAL_KEY)
    .all<Record<string, unknown>>();
  const entriesByBusiness = new Map<string, Record<string, unknown>[]>();
  for (const row of entryResult.results) {
    const source = sources.get(Number(row.activity_id));
    if (!source) continue;
    const current = entriesByBusiness.get(source.businessKey) ?? [];
    current.push(row);
    entriesByBusiness.set(source.businessKey, current);
  }

  for (const source of new Set(sources.values())) {
    const groupedEntries = entriesByBusiness.get(source.businessKey) ?? [];
    const representative = groupedEntries.find(
      (entry) => Number(entry.activity_id) === source.activityId,
    );
    if (!representative || groupedEntries.length < 2) continue;
    const entryIds = groupedEntries.map((entry) => Number(entry.id));
    const excluded = groupedEntries.find(
      (entry) => Number(entry.workflow_excluded ?? 0) === 1,
    );
    const updates: ReturnType<typeof d1.prepare>[] = [];
    for (
      let index = 0;
      index < entryIds.length;
      index += D1_SAFE_IN_CHUNK_SIZE
    ) {
      const chunkIds = entryIds.slice(
        index,
        index + D1_SAFE_IN_CHUNK_SIZE,
      );
      const placeholders = chunkIds.map(() => "?").join(", ");
      updates.push(
        d1
          .prepare(`
          UPDATE accounting_collection_receipts
          SET entry_id = ?,
              activity_id = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE entry_id IN (${placeholders})
          AND EXISTS (
            SELECT 1
            FROM activities receipt_activity
            WHERE receipt_activity.id = accounting_collection_receipts.activity_id
              AND receipt_activity.award_status = '위즈업 수주'
          )
          AND EXISTS (
            SELECT 1
            FROM accounting_commission_entries current_entry
            JOIN activities entry_activity
              ON entry_activity.id = current_entry.activity_id
            WHERE current_entry.id = accounting_collection_receipts.entry_id
              AND entry_activity.award_status = '위즈업 수주'
          )
        `)
          .bind(
            Number(representative.id),
            source.activityId,
            ...chunkIds,
          ),
      );
      updates.push(
        d1
          .prepare(`
            UPDATE accounting_commission_entries
            SET workflow_excluded = ?,
                workflow_excluded_at = ?,
                workflow_excluded_by = ?,
                workflow_excluded_by_name = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (${placeholders})
          `)
          .bind(
            excluded ? 1 : 0,
            excluded?.workflow_excluded_at ?? null,
            excluded?.workflow_excluded_by ?? null,
            excluded?.workflow_excluded_by_name ?? null,
            ...chunkIds,
          ),
      );
    }
    for (
      let index = 0;
      index < updates.length;
      index += D1_SAFE_IN_CHUNK_SIZE
    ) {
      await d1.batch(
        updates.slice(index, index + D1_SAFE_IN_CHUNK_SIZE),
      );
    }
    await syncEntryAggregate(
      d1,
      Number(representative.id),
      source,
    );
  }
}

async function loadReceipts(d1: D1Database) {
  const result = await d1
    .prepare(`
      SELECT r.*
      FROM accounting_collection_receipts r
      JOIN accounting_commission_entries e ON e.id = r.entry_id
      JOIN activities a ON a.id = e.activity_id
      JOIN activities receipt_activity ON receipt_activity.id = r.activity_id
      WHERE e.manufacturer_key = ?
        AND a.award_status = '위즈업 수주'
        AND receipt_activity.award_status = '위즈업 수주'
      ORDER BY r.collection_date DESC, r.id DESC
    `)
    .bind(ACCOUNTING_TOTAL_KEY)
    .all<Record<string, unknown>>();
  const byEntry = new Map<number, Receipt[]>();
  result.results.forEach((row: Record<string, unknown>) => {
    const receipt: Receipt = {
      id: Number(row.id),
      entryId: Number(row.entry_id),
      amount: Number(row.amount ?? 0),
      collectionDate: String(row.collection_date ?? ""),
      note: String(row.note ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      legacy:
        row.legacy_source_entry_id !== null &&
        row.legacy_source_entry_id !== undefined,
    };
    const rows = byEntry.get(receipt.entryId) ?? [];
    rows.push(receipt);
    byEntry.set(receipt.entryId, rows);
  });
  return byEntry;
}

function entryAmounts(source: ActivitySource, receipts: Receipt[]) {
  const collectedAmount = receipts.reduce(
    (total, receipt) => total + receipt.amount,
    0,
  );
  return {
    collectedAmount,
    receivableBalance: Math.max(
      0,
      source.expectedCollectionTotal - collectedAmount,
    ),
    contributionMargin: source.expectedProfit,
  };
}

function mapEntry(
  row: Record<string, unknown>,
  source: ActivitySource,
  receipts: Receipt[],
) {
  const amounts = entryAmounts(source, receipts);
  const workflowExcluded = Number(row.workflow_excluded ?? 0) === 1;
  const accountingStatus = workflowExcluded
    ? "사이트 도입 전 기록"
    : source.expectedSettlementDeficit > 0
      ? "지급 검토"
      : automaticCollectionStatus(
          source.expectedCollectionTotal,
          amounts.collectedAmount,
        );
  return {
    id: Number(row.id),
    activityId: Number(row.activity_id),
    businessKey: source.businessKey,
    businessRound: source.businessRound,
    groupedActivityIds: source.groupedActivityIds,
    activityDate: source.activityDate,
    organization: source.organization,
    region: source.region,
    budgetType: source.budgetType,
    progressManager: source.progressManager,
    contractAmountReference: source.contractAmount,
    quoteStatus: source.quoteStatus,
    quoteItemCount: source.quoteItemCount,
    quoteMissingAmountItemCount: source.quoteMissingAmountItemCount,
    executionType: source.executionType,
    consortiumCompany: source.consortiumCompany,
    sourceItems: source.items,
    sourceProjects: [...source.projects.values()],
    expectedPartnerCommission: source.expectedPartnerCommission,
    expectedDirectSalesCollection: source.expectedDirectSalesCollection,
    expectedDirectMargin: source.expectedDirectMargin,
    expectedConstructionMargin: source.expectedConstructionMargin,
    expectedCollectionTotal: source.expectedCollectionTotal,
    expectedSettlementDeficit: source.expectedSettlementDeficit,
    expectedProfit: source.expectedProfit,
    expectedCommission: source.expectedCommission,
    expectedConsortiumSettlement: source.expectedConsortiumSettlement,
    jointProjectId: source.jointProjectId,
    jointProjectName: source.jointProjectName,
    jointProjectSponsor: source.jointProjectSponsor,
    jointProjectSponsorKey: source.jointProjectSponsorKey,
    jointProjectRole: source.jointProjectRole,
    jointProjectBudgetType: source.jointProjectBudgetType,
    jointProjectYear: source.jointProjectYear,
    jointProjectRound: source.jointProjectRound,
    expectedContributionMargin: amounts.contributionMargin,
    commissionCollectedAmount: amounts.collectedAmount,
    receivableBalance: amounts.receivableBalance,
    collectionDate: receipts[0]?.collectionDate ?? "",
    workflowExcluded,
    workflowExcludedAt: String(row.workflow_excluded_at ?? ""),
    confirmed: workflowExcluded || amounts.collectedAmount > 0,
    accountingStatus,
    needsCollection:
      !workflowExcluded &&
      source.expectedCollectionTotal > 0 &&
      amounts.collectedAmount === 0,
    receipts,
  };
}

async function syncEntryAggregate(
  d1: D1Database,
  entryId: number,
  source: ActivitySource,
) {
  const totals = await d1
    .prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS collected_amount,
        MAX(collection_date) AS latest_collection_date
      FROM accounting_collection_receipts
      WHERE entry_id = ?
    `)
    .bind(entryId)
    .first<Record<string, unknown>>();
  const collectedAmount = Number(totals?.collected_amount ?? 0);
  const receivableBalance = Math.max(
    0,
    source.expectedCollectionTotal - collectedAmount,
  );
  const contributionMargin = source.expectedProfit;
  await d1
    .prepare(`
      UPDATE accounting_commission_entries
      SET commission_collected_amount = ?,
          collection_date = ?,
          receivable_balance = ?,
          contribution_margin = ?,
          accounting_status = ?,
          confirmed = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND activity_id = ? AND manufacturer_key = ?
    `)
    .bind(
      collectedAmount,
      totals?.latest_collection_date ?? null,
      receivableBalance,
      contributionMargin,
      source.expectedSettlementDeficit > 0
        ? "지급 검토"
        : automaticCollectionStatus(
            source.expectedCollectionTotal,
            collectedAmount,
          ),
      collectedAmount > 0 ? 1 : 0,
      entryId,
      source.activityId,
      ACCOUNTING_TOTAL_KEY,
    )
    .run();
}

async function readEntries() {
  const d1 = await ensureAccountingReady();
  await linkEquipmentProjectsToWhizzupAwards(d1);
  await ensureLegacyReceiptLedgerMigration(d1);
  const sources = await loadActivitySources(d1);
  await syncTotalEntries(d1, sources);
  await consolidateEntriesByBusinessRound(d1, sources);
  const receipts = await loadReceipts(d1);
  const result = await d1
    .prepare(`
      SELECT e.*
      FROM accounting_commission_entries e
      JOIN activities a ON a.id = e.activity_id
      WHERE e.manufacturer_key = ?
        AND a.award_status = '위즈업 수주'
      ORDER BY e.updated_at DESC, e.id DESC
    `)
    .bind(ACCOUNTING_TOTAL_KEY)
    .all<Record<string, unknown>>();
  const entries: ReturnType<typeof mapEntry>[] = result.results.flatMap(
    (row: Record<string, unknown>) => {
      const source = sources.get(Number(row.activity_id));
      return source && source.activityId === Number(row.activity_id)
        ? [mapEntry(row, source, receipts.get(Number(row.id)) ?? [])]
        : [];
    },
  );
  return {
    d1,
    sources,
    entries,
  };
}

async function readVisibleEntries() {
  const d1 = await ensureAccountingReady();
  await ensureLegacyReceiptLedgerMigration(d1);
  const sources = await loadActivitySources(d1);
  const [entryResult, receipts] = await Promise.all([
    d1
      .prepare(`
        SELECT e.*
        FROM accounting_commission_entries e
        JOIN activities a ON a.id = e.activity_id
        WHERE e.manufacturer_key = ?
          AND a.award_status = '위즈업 수주'
        ORDER BY e.updated_at DESC, e.id DESC
      `)
      .bind(ACCOUNTING_TOTAL_KEY)
      .all<Record<string, unknown>>(),
    loadReceipts(d1),
  ]);
  const entryRowsByBusiness = new Map<
    string,
    Record<string, unknown>[]
  >();
  entryResult.results.forEach((row: Record<string, unknown>) => {
    const source = sources.get(Number(row.activity_id));
    if (!source) return;
    const rows = entryRowsByBusiness.get(source.businessKey) ?? [];
    rows.push(row);
    entryRowsByBusiness.set(source.businessKey, rows);
  });

  const visibleEntries = [...new Set(sources.values())].map((source) => {
    const groupedRows = entryRowsByBusiness.get(source.businessKey) ?? [];
    const representative =
      groupedRows.find(
        (row) => Number(row.activity_id) === source.activityId,
      ) ??
      groupedRows[0] ??
      {
        id: 0,
        activity_id: source.activityId,
        workflow_excluded: 0,
      };
    const excluded = groupedRows.find(
      (row) => Number(row.workflow_excluded ?? 0) === 1,
    );
    const representativeRow = excluded
      ? {
          ...representative,
          workflow_excluded: 1,
          workflow_excluded_at: excluded.workflow_excluded_at,
        }
      : representative;
    const receiptById = new Map<number, Receipt>();
    groupedRows.forEach((row) => {
      (receipts.get(Number(row.id)) ?? []).forEach((receipt: Receipt) => {
        receiptById.set(receipt.id, receipt);
      });
    });
    return mapEntry(
      representativeRow,
      source,
      [...receiptById.values()].sort(
        (left, right) =>
          right.collectionDate.localeCompare(left.collectionDate) ||
          right.id - left.id,
      ),
    );
  });
  return visibleEntries
    .filter((entry) => !entry.workflowExcluded)
    .map((entry) => ({
      id: entry.id,
      activityId: entry.activityId,
      businessKey: entry.businessKey,
      businessRound: entry.businessRound,
      organization: entry.organization,
      progressManager: entry.progressManager,
      confirmed: entry.confirmed,
      expectedConstructionMargin: entry.expectedConstructionMargin,
      expectedSettlementDeficit: entry.expectedSettlementDeficit,
      commissionCollectedAmount: entry.commissionCollectedAmount,
      receivableBalance: entry.receivableBalance,
      accountingStatus: entry.accountingStatus,
    }));
}

async function readUpcomingEntries() {
  const d1 = await ensureAccountingReady();
  await ensureLegacyReceiptLedgerMigration(d1);
  const sources = await loadActivitySources(d1, "upcoming");
  const uniqueSources = [...new Set(sources.values())];
  const upcomingEntries = uniqueSources.map((source) => ({
    activityId: source.activityId,
    businessKey: source.businessKey,
    businessRound: source.businessRound,
    activityDate: source.activityDate,
    organization: source.organization,
    region: source.region,
    budgetType: source.budgetType,
    progressManager: source.progressManager,
    awardStage: source.awardStage,
    contractAmountReference: source.contractAmount,
    quoteStatus: source.quoteStatus,
    quoteItemCount: source.quoteItemCount,
    quoteMissingAmountItemCount: source.quoteMissingAmountItemCount,
    expectedPartnerCommission: source.expectedPartnerCommission,
    expectedDirectSalesCollection: source.expectedDirectSalesCollection,
    expectedDirectMargin: source.expectedDirectMargin,
    expectedConstructionMargin: source.expectedConstructionMargin,
    expectedConsortiumSettlement: source.expectedConsortiumSettlement,
    expectedProfit: source.expectedProfit,
    expectedContributionMargin: source.expectedProfit,
    expectedCollectionTotal: source.expectedCollectionTotal,
    expectedSettlementDeficit: source.expectedSettlementDeficit,
    sourceItems: source.items,
    sourceProjects: [...source.projects.values()],
    jointProjectId: source.jointProjectId,
    jointProjectName: source.jointProjectName,
    jointProjectSponsor: source.jointProjectSponsor,
    jointProjectSponsorKey: source.jointProjectSponsorKey,
    jointProjectRole: source.jointProjectRole,
    jointProjectBudgetType: source.jointProjectBudgetType,
    jointProjectYear: source.jointProjectYear,
    jointProjectRound: source.jointProjectRound,
  }));
  const groupedUpcomingEntries = groupAccountingJointProjects(upcomingEntries).map(
    (group) => group.representative,
  );
  const upcomingSummary = groupedUpcomingEntries.reduce(
    (summary, entry) => {
      summary.expectedPartnerCommission += entry.expectedPartnerCommission;
      summary.expectedDirectSalesCollection +=
        entry.expectedDirectSalesCollection;
      summary.expectedDirectMargin += entry.expectedDirectMargin;
      summary.expectedConstructionMargin +=
        entry.expectedConstructionMargin;
      summary.expectedConsortiumSettlement +=
        entry.expectedConsortiumSettlement;
      summary.expectedProfit += entry.expectedProfit;
      summary.expectedCollectionTotal += entry.expectedCollectionTotal;
      summary.expectedSettlementDeficit +=
        entry.expectedSettlementDeficit;
      return summary;
    },
    {
      organizationCount: new Set(
        groupedUpcomingEntries.map((entry) =>
          analyticsBusinessRoundKey(entry.organization, 1).split("\u001f")[0],
        ),
      ).size,
      businessCount: groupedUpcomingEntries.length,
      expectedPartnerCommission: 0,
      expectedDirectSalesCollection: 0,
      expectedDirectMargin: 0,
      expectedConstructionMargin: 0,
      expectedConsortiumSettlement: 0,
      expectedProfit: 0,
      expectedCollectionTotal: 0,
      expectedSettlementDeficit: 0,
    },
  );
  return { upcomingEntries, upcomingSummary };
}

function errorResponse(error: unknown) {
  if (error instanceof Error && /수금액|수금일/.test(error.message)) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return accessErrorResponse(error);
}

function excludedEntryReceiptResponse() {
  return Response.json(
    { error: EXCLUDED_ENTRY_RECEIPT_ERROR },
    { status: 409 },
  );
}

export async function GET(request: Request) {
  try {
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope === "visible") {
      const member = await requireApprovedMember();
      const canSeeAll =
        hasMemberPermission(member, "accounting:manage") ||
        hasMemberPermission(member, "analytics:view");
      const entries = await readVisibleEntries();
      return Response.json({
        entries: canSeeAll
          ? entries
          : entries.filter(
              (entry) => entry.progressManager === member.displayName,
            ),
      });
    }
    await requireMemberPermission("accounting:manage");
    if (scope === "upcoming") {
      return Response.json(await readUpcomingEntries());
    }
    const { entries } = await readEntries();
    return Response.json({ entries });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireMemberPermission("accounting:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const action = payload.action === "restore" ? "restore" : "exclude";
    const entryIds = [
      ...new Set(
        (Array.isArray(payload.entryIds) ? payload.entryIds : [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ].slice(0, 500);
    if (!entryIds.length) {
      return Response.json(
        { error: "처리할 수금 항목을 선택해 주세요." },
        { status: 400 },
      );
    }
    const { d1, entries } = await readEntries();
    const activityIds = [
      ...new Set(
        entries
          .filter((entry) => entryIds.includes(entry.id))
          .flatMap((entry) => entry.groupedActivityIds),
      ),
    ];
    if (!activityIds.length) {
      return Response.json(
        { error: "처리할 수금 항목을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    let updated = 0;
    for (
      let index = 0;
      index < activityIds.length;
      index += D1_SAFE_IN_CHUNK_SIZE
    ) {
      const chunkIds = activityIds.slice(
        index,
        index + D1_SAFE_IN_CHUNK_SIZE,
      );
      const placeholders = chunkIds.map(() => "?").join(", ");
      const result =
        action === "restore"
          ? await d1
              .prepare(`
              UPDATE accounting_commission_entries
              SET workflow_excluded = 0,
                  workflow_excluded_at = NULL,
                  workflow_excluded_by = NULL,
                  workflow_excluded_by_name = NULL,
                  updated_at = CURRENT_TIMESTAMP
              WHERE activity_id IN (${placeholders})
                AND manufacturer_key = ?
                AND EXISTS (
                  SELECT 1
                  FROM activities a
                  WHERE a.id = accounting_commission_entries.activity_id
                    AND a.award_status = '위즈업 수주'
                    AND a.award_stage = '납품 완료'
                )
            `)
              .bind(...chunkIds, ACCOUNTING_TOTAL_KEY)
              .run()
          : await d1
              .prepare(`
              UPDATE accounting_commission_entries
              SET workflow_excluded = 1,
                  workflow_excluded_at = CURRENT_TIMESTAMP,
                  workflow_excluded_by = ?,
                  workflow_excluded_by_name = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE activity_id IN (${placeholders})
                AND manufacturer_key = ?
                AND EXISTS (
                  SELECT 1
                  FROM activities a
                  WHERE a.id = accounting_commission_entries.activity_id
                    AND a.award_status = '위즈업 수주'
                    AND a.award_stage = '납품 완료'
                )
            `)
              .bind(
                actor.id,
                actor.displayName,
                ...chunkIds,
                ACCOUNTING_TOTAL_KEY,
              )
              .run();
      updated += Number(result.meta?.changes ?? chunkIds.length);
    }
    return Response.json({
      updated,
      action,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireMemberPermission("accounting:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const entryId = Number(payload.entryId);
    if (!Number.isInteger(entryId) || entryId < 1) {
      return Response.json(
        { error: "수금할 수주를 다시 선택해 주세요." },
        { status: 400 },
      );
    }
    const amount = parseAmount(payload.amount);
    const collectionDate = parseDate(payload.collectionDate);
    const note = String(payload.note ?? "").trim().slice(0, 500);
    const { d1, sources, entries } = await readEntries();
    const eligibleEntry = entries.find((entry) => entry.id === entryId);
    if (eligibleEntry?.workflowExcluded) {
      return excludedEntryReceiptResponse();
    }
    const current = eligibleEntry
      ? {
          id: eligibleEntry.id,
          activity_id: eligibleEntry.activityId,
        }
      : null;
    if (!current) {
      return Response.json(
        { error: "납품 완료 처리된 위즈업 수금 항목을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    const insertResult = await d1
      .prepare(`
        INSERT INTO accounting_collection_receipts (
          entry_id, activity_id, amount, collection_date, note,
          created_by, created_by_name
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM accounting_commission_entries e
          WHERE e.id = ?
            AND COALESCE(e.workflow_excluded, 0) = 0
        )
      `)
      .bind(
        entryId,
        Number(current.activity_id),
        amount,
        collectionDate,
        note,
        actor.id,
        actor.displayName,
        entryId,
      )
      .run();
    if (insertResult.meta?.changes === 0) {
      return excludedEntryReceiptResponse();
    }
    const source = sources.get(Number(current.activity_id));
    if (source) await syncEntryAggregate(d1, entryId, source);
    const refreshed = await readEntries();
    return Response.json({
      entry: refreshed.entries.find((entry) => entry.id === entryId),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireMemberPermission("accounting:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const receiptId = Number(payload.receiptId);
    if (!Number.isInteger(receiptId) || receiptId < 1) {
      return Response.json(
        { error: "수정할 수금 내역을 다시 선택해 주세요." },
        { status: 400 },
      );
    }
    const amount = parseAmount(payload.amount);
    const collectionDate = parseDate(payload.collectionDate);
    const note = String(payload.note ?? "").trim().slice(0, 500);
    const { d1, sources, entries } = await readEntries();
    const eligibleEntry = entries.find((entry) =>
      entry.receipts.some((receipt: Receipt) => receipt.id === receiptId),
    );
    if (eligibleEntry?.workflowExcluded) {
      return excludedEntryReceiptResponse();
    }
    const current = eligibleEntry
      ? {
          entry_id: eligibleEntry.id,
          activity_id: eligibleEntry.activityId,
        }
      : null;
    if (!current) {
      return Response.json(
        { error: "수정할 수금 내역을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    const updateResult = await d1
      .prepare(`
        UPDATE accounting_collection_receipts
        SET amount = ?,
            collection_date = ?,
            note = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM accounting_commission_entries e
            WHERE e.id = accounting_collection_receipts.entry_id
              AND COALESCE(e.workflow_excluded, 0) = 0
          )
      `)
      .bind(amount, collectionDate, note, receiptId)
      .run();
    if (updateResult.meta?.changes === 0) {
      return excludedEntryReceiptResponse();
    }
    const source = sources.get(Number(current.activity_id));
    if (source) {
      await syncEntryAggregate(
        d1,
        Number(current.entry_id),
        source,
      );
    }
    const refreshed = await readEntries();
    return Response.json({
      entry: refreshed.entries.find(
        (entry) => entry.id === Number(current.entry_id),
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireMemberPermission("accounting:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const receiptId = Number(payload.receiptId);
    if (!Number.isInteger(receiptId) || receiptId < 1) {
      return Response.json(
        { error: "삭제할 수금 내역을 다시 선택해 주세요." },
        { status: 400 },
      );
    }
    const { d1, sources, entries } = await readEntries();
    const eligibleEntry = entries.find((entry) =>
      entry.receipts.some((receipt: Receipt) => receipt.id === receiptId),
    );
    if (eligibleEntry?.workflowExcluded) {
      return excludedEntryReceiptResponse();
    }
    const current = eligibleEntry
      ? {
          entry_id: eligibleEntry.id,
          activity_id: eligibleEntry.activityId,
        }
      : null;
    if (!current) {
      return Response.json(
        { error: "삭제할 수금 내역을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    const deleteResult = await d1
      .prepare(`
        DELETE FROM accounting_collection_receipts WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM accounting_commission_entries e
            WHERE e.id = accounting_collection_receipts.entry_id
              AND COALESCE(e.workflow_excluded, 0) = 0
          )
      `)
      .bind(receiptId)
      .run();
    if (deleteResult.meta?.changes === 0) {
      return excludedEntryReceiptResponse();
    }
    const source = sources.get(Number(current.activity_id));
    if (source) {
      await syncEntryAggregate(
        d1,
        Number(current.entry_id),
        source,
      );
    }
    const refreshed = await readEntries();
    return Response.json({
      entry: refreshed.entries.find(
        (entry) => entry.id === Number(current.entry_id),
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
