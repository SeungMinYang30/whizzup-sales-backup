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
import {
  isPartnerOnlyProduct,
  normalizeProductSupplyType,
} from "../../../../lib/product-supply-classification";

export const dynamic = "force-dynamic";

const ACCOUNTING_TOTAL_KEY = "award-total";
const D1_SAFE_IN_CHUNK_SIZE = 50;
const EXCLUDED_ENTRY_RECEIPT_ERROR =
  "íšŒê³„ ê´€ë¦¬ì—ì„œ ì œì™¸ëœ ê¸°ë¡ì…ë‹ˆë‹¤. ìˆ˜ê¸ˆ ë‚´ì—­ì„ ë³€ê²½í•˜ë ¤ë©´ ë¨¼ì € ì‘ì—…ëª©ë¡ì— ë³µì›í•´ ì£¼ì„¸ìš”.";
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
  executionType: "ì§ì˜" | "ì»¨ì†Œ";
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
  executionType: "ì§ì˜" | "ì»¨ì†Œ";
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
    throw new Error("ìˆ˜ê¸ˆì•¡ì€ 1ì› ì´ìƒ 1,000ì–µì› ì´í•˜ë¡œ ì…ë ¥í•´ ì£¼ì„¸ìš”.");
  }
  return parsed;
}

function parseDate(value: unknown) {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("ìˆ˜ê¸ˆì¼ì„ í™•ì¸í•´ ì£¼ì„¸ìš”.");
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
      WHERE a.award_status IN ('ìœ„ì¦ˆì—… ìˆ˜ì£¼', 'í˜‘ë ¥ì‚¬ ìˆ˜ì£¼', 'íƒ€ì—…ì²´ ìˆ˜ì£¼')
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
        ei.catalog_item_id,
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
      awardStage: String(row.award_stage ?? "ë¯¸ì •"),
      organization: String(row.organization ?? ""),
      region: String(row.region ?? ""),
      budgetType: String(row.budget_type ?? ""),
      progressManager: String(row.progress_manager ?? ""),
      contractAmount: 0,
      estimatedContractAmount: 0,
      executionType:
        String(row.execution_type ?? "") === "ì»¨ì†Œ" ? "ì»¨ì†Œ" : "ì§ì˜",
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
          String(row.project_award_status ?? "") !== "ìœ„ì¦ˆì—… ìˆ˜ì£¼"))
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
    const partnerOnly = isPartnerOnlyProduct({
      catalogItemId: row.catalog_item_id,
      productName: row.product_name,
    });
    const supplyType = normalizeProductSupplyType({
      catalogItemId: row.catalog_item_id,
      productName: row.product_name,
      supplyType: row.supply_type,
    });
    const parsedRate = Number(row.commission_rate);
    const commissionRate =
      row.commission_rate === null || rïº¶‰ËkºwµçQ•‘µ½Õ¹Ğè•¹ÑÉä¹½µµ¥ÍÍ¥½¹½±±•Ñ•‘µ½Õ¹Ğ°4(€€€€€É••¥Ù…‰±•	…±…¹”è•¹ÑÉä¹É••¥Ù…‰±•	…±…¹”°4(€€€€€…½Õ¹Ñ¥¹MÑ…ÑÕÌè•¹ÑÉä¹…½Õ¹Ñ¥¹MÑ…ÑÕÌ°4(€€€ô¤¤ì4)ô4(4)…Íå¹Œ™Õ¹Ñ¥½¸É•…‘UÁ½µ¥¹¹ÑÉ¥•Ì ¤ì4(€½¹ÍĞÄ€ô…İ…¥Ğ•¹ÍÕÉ•½Õ¹Ñ¥¹I•…‘ä ¤ì4(€…İ…¥Ğ•¹ÍÕÉ•1•…åI••¥ÁÑ1•‘•É5¥É…Ñ¥½¸¡Ä¤ì4(€½¹ÍĞÍ½ÕÉ•Ì€ô…İ…¥Ğ±½…‘Ñ¥Ù¥ÑåM½ÕÉ•Ì¡Ä°€‰ÕÁ½µ¥¹œˆ¤ì4(€½¹ÍĞÕ¹¥ÅÕ•M½ÕÉ•Ì€ôl¸¸¹¹•ÜM•Ğ¡Í½ÕÉ•Ì¹Ù…±Õ•Ì ¤¥tì4(€½¹ÍĞÕÁ½µ¥¹¹ÑÉ¥•Ì€ôÕ¹¥ÅÕ•M½ÕÉ•Ì¹µ…À ¡Í½ÕÉ”¤€ôø€¡ì4(€€€…Ñ¥Ù¥Ñå%èÍ½ÕÉ”¹…Ñ¥Ù¥Ñå%°4(€€€‰ÕÍ¥¹•ÍÍ-•äèÍ½ÕÉ”¹‰ÕÍ¥¹•ÍÍ-•ä°4(€€€‰ÕÍ¥¹•ÍÍI½Õ¹èÍ½ÕÉ”¹‰ÕÍ¥¹•ÍÍI½Õ¹°4(€€€…Ñ¥Ù¥Ñå…Ñ”èÍ½ÕÉ”¹…Ñ¥Ù¥Ñå…Ñ”°4(€€€½É…¹¥é…Ñ¥½¸èÍ½ÕÉ”¹½É…¹¥é…Ñ¥½¸°4(€€€É•¥½¸èÍ½ÕÉ”¹É•¥½¸°4(€€€‰Õ‘•ÑQåÁ”èÍ½ÕÉ”¹‰Õ‘•ÑQåÁ”°4(€€€ÁÉ½É•ÍÍ5…¹…•ÈèÍ½ÕÉ”¹ÁÉ½É•ÍÍ5…¹…•È°4(€€€…İ…É‘MÑ…”èÍ½ÕÉ”¹…İ…É‘MÑ…”°4(€€€½¹ÑÉ…Ñµ½Õ¹ÑI•™•É•¹”èÍ½ÕÉ”¹½¹ÑÉ…Ñµ½Õ¹Ğ°4(€€€ÅÕ½Ñ•MÑ…ÑÕÌèÍ½ÕÉ”¹ÅÕ½Ñ•MÑ…ÑÕÌ°4(€€€ÅÕ½Ñ•%Ñ•µ½Õ¹ĞèÍ½ÕÉ”¹ÅÕ½Ñ•%Ñ•µ½Õ¹Ğ°4(€€€ÅÕ½Ñ•5¥ÍÍ¥¹µ½Õ¹Ñ%Ñ•µ½Õ¹ĞèÍ½ÕÉ”¹ÅÕ½Ñ•5¥ÍÍ¥¹µ½Õ¹Ñ%Ñ•µ½Õ¹Ğ°4(€€€•áÁ•Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸èÍ½ÕÉ”¹•áÁ•Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸°4(€€€•áÁ•Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸èÍ½ÕÉ”¹•áÁ•Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸°4(€€€•áÁ•Ñ•‘¥É•Ñ5…É¥¸èÍ½ÕÉ”¹•áÁ•Ñ•‘¥É•Ñ5…É¥¸°4(€€€•áÁ•Ñ•‘½¹ÍÑÉÕÑ¥½¹5…É¥¸èÍ½ÕÉ”¹•áÁ•Ñ•‘½¹ÍÑÉÕÑ¥½¹5…É¥¸°4(€€€•áÁ•Ñ•‘½¹Í½ÉÑ¥ÕµM•ÑÑ±•µ•¹ĞèÍ½ÕÉ”¹•áÁ•Ñ•‘½¹Í½ÉÑ¥ÕµM•ÑÑ±•µ•¹Ğ°4(€€€•áÁ•Ñ•‘AÉ½™¥ĞèÍ½ÕÉ”¹•áÁ•Ñ•‘AÉ½™¥Ğ°4(€€€•áÁ•Ñ•‘½¹ÑÉ¥‰ÕÑ¥½¹5…É¥¸èÍ½ÕÉ”¹•áÁ•Ñ•‘AÉ½™¥Ğ°4(€€€•áÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°èÍ½ÕÉ”¹•áÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°°4(€€€•áÁ•Ñ•‘M•ÑÑ±•µ•¹Ñ•™¥¥ĞèÍ½ÕÉ”¹•áÁ•Ñ•‘M•ÑÑ±•µ•¹Ñ•™¥¥Ğ°4(€€€Í½ÕÉ•%Ñ•µÌèÍ½ÕÉ”¹¥Ñ•µÌ°4(€€€Í½ÕÉ•AÉ½©•ÑÌèl¸¸¹Í½ÕÉ”¹ÁÉ½©•ÑÌ¹Ù…±Õ•Ì ¥t°4(€€€©½¥¹ÑAÉ½©•Ñ%èÍ½ÕÉ”¹©½¥¹ÑAÉ½©•Ñ%°4(€€€©½¥¹ÑAÉ½©•Ñ9…µ”èÍ½ÕÉ”¹©½¥¹ÑAÉ½©•Ñ9…µ”°4(€€€©½¥¹ÑAÉ½©•ÑMÁ½¹Í½ÈèÍ½ÕÉ”¹©½¥¹ÑAÉ½©•ÑMÁ½¹Í½È°4(€€€©½¥¹ÑAÉ½©•ÑMÁ½¹Í½É-•äèÍ½ÕÉ”¹©½¥¹ÑAÉ½©•ÑMÁ½¹Í½É-•ä°4(€€€©½¥¹ÑAÉ½©•ÑI½±”èÍ½ÕÉ”¹©½¥¹ÑAÉ½©•ÑI½±”°4(€€€©½¥¹ÑAÉ½©•Ñ	Õ‘•ÑQåÁ”èÍ½ÕÉ”¹©½¥¹ÑAÉ½©•Ñ	Õ‘•ÑQåÁ”°4(€€€©½¥¹ÑAÉ½©•Ñe•…ÈèÍ½ÕÉ”¹©½¥¹ÑAÉ½©•Ñe•…È°4(€€€©½¥¹ÑAÉ½©•ÑI½Õ¹èÍ½ÕÉ”¹©½¥¹ÑAÉ½©•ÑI½Õ¹°4(€ô¤¤ì4(€½¹ÍĞÉ½ÕÁ•‘UÁ½µ¥¹¹ÑÉ¥•Ì€ôÉ½ÕÁ½Õ¹Ñ¥¹)½¥¹ÑAÉ½©•ÑÌ¡ÕÁ½µ¥¹¹ÑÉ¥•Ì¤¹µ…À 4(€€€€¡É½ÕÀ¤€ôøÉ½ÕÀ¹É•ÁÉ•Í•¹Ñ…Ñ¥Ù”°4(€€¤ì4(€½¹ÍĞÕÁ½µ¥¹MÕµµ…Éä€ôÉ½ÕÁ•‘UÁ½µ¥¹¹ÑÉ¥•Ì¹É•‘Õ” 4(€€€€¡ÍÕµµ…Éä°•¹ÑÉä¤€ôøì4(€€€€€ÍÕµµ…Éä¹•áÁ•Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸€¬ô•¹ÑÉä¹•áÁ•Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸ì4(€€€€€ÍÕµµ…Éä¹•áÁ•Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸€¬ô4(€€€€€€€•¹ÑÉä¹•áÁ•Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸ì4(€€€€€ÍÕµµ…Éä¹•áÁ•Ñ•‘¥É•Ñ5…É¥¸€¬ô•¹ÑÉä¹•áÁ•Ñ•‘¥É•Ñ5…É¥¸ì4(€€€€€ÍÕµµ…Éä¹•áÁ•Ñ•‘½¹ÍÑÉÕÑ¥½¹5…É¥¸€¬ô4(€€€€€€€•¹ÑÉä¹•áÁ•Ñ•‘½¹ÍÑÉÕÑ¥½¹5…É¥¸ì4(€€€€€ÍÕµµ…Éä¹•áÁ•Ñ•‘½¹Í½ÉÑ¥ÕµM•ÑÑ±•µ•¹Ğ€¬ô4(€€€€€€€•¹ÑÉä¹•áÁ•Ñ•‘½¹Í½ÉÑ¥ÕµM•ÑÑ±•µ•¹Ğì4(€€€€€ÍÕµµ…Éä¹•áÁ•Ñ•‘AÉ½™¥Ğ€¬ô•¹ÑÉä¹•áÁ•Ñ•‘AÉ½™¥Ğì4(€€€€€ÍÕµµ…Éä¹•áÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°€¬ô•¹ÑÉä¹•áÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°ì4(€€€€€ÍÕµµ…Éä¹•áÁ•Ñ•‘M•ÑÑ±•µ•¹Ñ•™¥¥Ğ€¬ô4(€€€€€€€•¹ÑÉä¹•áÁ•Ñ•‘M•ÑÑ±•µ•¹Ñ•™¥¥Ğì4(€€€€€É•ÑÕÉ¸ÍÕµµ…Éäì4(€€€ô°4(€€€ì4(€€€€€½É…¹¥é…Ñ¥½¹½Õ¹Ğè¹•ÜM•Ğ 4(€€€€€€€É½ÕÁ•‘UÁ½µ¥¹¹ÑÉ¥•Ì¹µ…À ¡•¹ÑÉä¤€ôø4(€€€€€€€€€…¹…±åÑ¥Í	ÕÍ¥¹•ÍÍI½Õ¹‘-•ä¡•¹ÑÉä¹½É…¹¥é…Ñ¥½¸°€Ä¤¹ÍÁ±¥Ğ ‰qÔÀÀÅ˜ˆ¥lÁt°4(€€€€€€€€¤°4(€€€€€€¤¹Í¥é”°4(€€€€€‰ÕÍ¥¹•ÍÍ½Õ¹ĞèÉ½ÕÁ•‘UÁ½µ¥¹¹ÑÉ¥•Ì¹±•¹Ñ °4(€€€€€•áÁ•Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸è€À°4(€€€€€•áÁ•Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸è€À°4(€€€€€•áÁ•Ñ•‘¥É•Ñ5…É¥¸è€À°4(€€€€€•áÁ•Ñ•‘½¹ÍÑÉÕÑ¥½¹5…É¥¸è€À°4(€€€€€•áÁ•Ñ•‘½¹Í½ÉÑ¥ÕµM•ÑÑ±•µ•¹Ğè€À°4(€€€€€•áÁ•Ñ•‘AÉ½™¥Ğè€À°4(€€€€€•áÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°è€À°4(€€€€€•áÁ•Ñ•‘M•ÑÑ±•µ•¹Ñ•™¥¥Ğè€À°4(€€€ô°4(€€¤ì4(€É•ÑÕÉ¸ìÕÁ½µ¥¹¹ÑÉ¥•Ì°ÕÁ½µ¥¹MÕµµ…Éäôì4)ô4(4)™Õ¹Ñ¥½¸•ÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½ÈèÕ¹­¹½İ¸¤ì4(€¥˜€¡•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€˜˜€¿²"cªâ#²V…ó²"cªâ#²vğ¼¹Ñ•ÍĞ¡•ÉÉ½È¹µ•ÍÍ…”¤¤ì4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”ô°ìÍÑ…ÑÕÌè€ĞÀÀô¤ì4(€ô4(€É•ÑÕÉ¸…•ÍÍÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4)ô4(4)™Õ¹Ñ¥½¸•á±Õ‘•‘¹ÑÉåI••¥ÁÑI•ÍÁ½¹Í” ¤ì4(€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€ì•ÉÉ½Èèa1U}9QIe}I%AQ}II=Hô°4(€€€ìÍÑ…ÑÕÌè€ĞÀäô°4(€€¤ì4)ô4(4)•áÁ½ÉĞ…Íå¹Œ™Õ¹Ñ¥½¸P¡É•ÅÕ•ÍĞèI•ÅÕ•ÍĞ¤ì4(€ÑÉäì4(€€€½¹ÍĞÍ½Á”€ô¹•ÜUI0¡É•ÅÕ•ÍĞ¹ÕÉ°¤¹Í•…É¡A…É…µÌ¹•Ğ ‰Í½Á”ˆ¤ì4(€€€¥˜€¡Í½Á”€ôôô€‰Ù¥Í¥‰±”ˆ¤ì4(€€€€€½¹ÍĞµ•µ‰•È€ô…İ…¥ĞÉ•ÅÕ¥É•ÁÁÉ½Ù•‘5•µ‰•È ¤ì4(€€€€€½¹ÍĞ…¹M••±°€ô4(€€€€€€€¡…Í5•µ‰•ÉA•Éµ¥ÍÍ¥½¸¡µ•µ‰•È°€‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤ñğ4(€€€€€€€¡…Í5•µ‰•ÉA•Éµ¥ÍÍ¥½¸¡µ•µ‰•È°€‰…¹…±åÑ¥ÌéÙ¥•Üˆ¤ì4(€€€€€½¹ÍĞ•¹ÑÉ¥•Ì€ô…İ…¥ĞÉ•…‘Y¥Í¥‰±•¹ÑÉ¥•Ì ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€€€•¹ÑÉ¥•Ìè…¹M••±°4(€€€€€€€€€€ü•¹ÑÉ¥•Ì4(€€€€€€€€€€è•¹ÑÉ¥•Ì¹™¥±Ñ•È 4(€€€€€€€€€€€€€€¡•¹ÑÉä¤€ôø•¹ÑÉä¹ÁÉ½É•ÍÍ5…¹…•È€ôôôµ•µ‰•È¹‘¥ÍÁ±…å9…µ”°4(€€€€€€€€€€€€¤°4(€€€€€ô¤ì4(€€€ô4(€€€…İ…¥ĞÉ•ÅÕ¥É•5•µ‰•ÉA•Éµ¥ÍÍ¥½¸ ‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤ì4(€€€¥˜€¡Í½Á”€ôôô€‰ÕÁ½µ¥¹œˆ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡…İ…¥ĞÉ•…‘UÁ½µ¥¹¹ÑÉ¥•Ì ¤¤ì4(€€€ô4(€€€½¹ÍĞì•¹ÑÉ¥•Ìô€ô…İ…¥ĞÉ•…‘¹ÑÉ¥•Ì ¤ì4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•¹ÑÉ¥•Ìô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€É•ÑÕÉ¸•ÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(4)•áÁ½ÉĞ…Íå¹Œ™Õ¹Ñ¥½¸AUP¡É•ÅÕ•ÍĞèI•ÅÕ•ÍĞ¤ì4(€ÑÉäì4(€€€½¹ÍĞ…Ñ½È€ô…İ…¥ĞÉ•ÅÕ¥É•5•µ‰•ÉA•Éµ¥ÍÍ¥½¸ ‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤ì4(€€€½¹ÍĞÁ…å±½…€ô€¡…İ…¥ĞÉ•ÅÕ•ÍĞ¹©Í½¸ ¤¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½İ¸øì4(€€€½¹ÍĞ…Ñ¥½¸€ôÁ…å±½…¹…Ñ¥½¸€ôôô€‰É•ÍÑ½É”ˆ€ü€‰É•ÍÑ½É”ˆ€è€‰•á±Õ‘”ˆì4(€€€½¹ÍĞ•¹ÑÉå%‘Ì€ôl4(€€€€€€¸¸¹¹•ÜM•Ğ 4(€€€€€€€€¡ÉÉ…ä¹¥ÍÉÉ…ä¡Á…å±½…¹•¹ÑÉå%‘Ì¤€üÁ…å±½…¹•¹ÑÉå%‘Ì€èmt¤4(€€€€€€€€€€¹µ…À¡9Õµ‰•È¤4(€€€€€€€€€€¹™¥±Ñ•È ¡¥¤€ôø9Õµ‰•È¹¥Í%¹Ñ••È¡¥¤€˜˜¥€ø€À¤°4(€€€€€€¤°4(€€€t¹Í±¥” À°€ÔÀÀ¤ì4(€€€¥˜€ …•¹ÑÉå%‘Ì¹±•¹Ñ ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹²Êc®š³¶V€ƒ²"cªâ ƒ¶V·®ª§²vƒ²ƒ¶w¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ĞÀÀô°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞìÄ°•¹ÑÉ¥•Ìô€ô…İ…¥ĞÉ•…‘¹ÑÉ¥•Ì ¤ì4(€€€½¹ÍĞ…Ñ¥Ù¥Ñå%‘Ì€ôl4(€€€€€€¸¸¹¹•ÜM•Ğ 4(€€€€€€€•¹ÑÉ¥•Ì4(€€€€€€€€€€¹™¥±Ñ•È ¡•¹ÑÉä¤€ôø•¹ÑÉå%‘Ì¹¥¹±Õ‘•Ì¡•¹ÑÉä¹¥¤¤4(€€€€€€€€€€¹™±…Ñ5…À ¡•¹ÑÉä¤€ôø•¹ÑÉä¹É½ÕÁ•‘Ñ¥Ù¥Ñå%‘Ì¤°4(€€€€€€¤°4(€€€tì4(€€€¥˜€ ……Ñ¥Ù¥Ñå%‘Ì¹±•¹Ñ ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹²Êc®š³¶V€ƒ²"cªâ ƒ¶V·®ª§²vƒ²Âû² ƒ®ªï¶Z#²*×®.#®.¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ĞÀĞô°4(€€€€€€¤ì4(€€€ô4(€€€±•ĞÕÁ‘…Ñ•€ô€Àì4(€€€™½È€ 4(€€€€€±•Ğ¥¹‘•à€ô€Àì4(€€€€€¥¹‘•à€ğ…Ñ¥Ù¥Ñå%‘Ì¹±•¹Ñ ì4(€€€€€¥¹‘•à€¬ôÅ}M}%9}!U9-}M%i4(€€€€¤ì4(€€€€€½¹ÍĞ¡Õ¹­%‘Ì€ô…Ñ¥Ù¥Ñå%‘Ì¹Í±¥” 4(€€€€€€€¥¹‘•à°4(€€€€€€€¥¹‘•à€¬Å}M}%9}!U9-}M%i°4(€€€€€€¤ì4(€€€€€½¹ÍĞÁ±…•¡½±‘•ÉÌ€ô¡Õ¹­%‘Ì¹µ…À  ¤€ôø€ˆüˆ¤¹©½¥¸ ˆ°€ˆ¤ì4(€€€€€½¹ÍĞÉ•ÍÕ±Ğ€ô4(€€€€€€€…Ñ¥½¸€ôôô€‰É•ÍÑ½É”ˆ4(€€€€€€€€€€ü…İ…¥ĞÄ4(€€€€€€€€€€€€€€¹ÁÉ•Á…É”¡€4(€€€€€€€€€€€€€UAQ…½Õ¹Ñ¥¹}½µµ¥ÍÍ¥½¹}•¹ÑÉ¥•Ì4(€€€€€€€€€€€€€MPİ½É­™±½İ}•á±Õ‘•€ô€À°4(€€€€€€€€€€€€€€€€€İ½É­™±½İ}•á±Õ‘•‘}…Ğ€ô9U10°4(€€€€€€€€€€€€€€€€€İ½É­™±½İ}•á±Õ‘•‘}‰ä€ô9U10°4(€€€€€€€€€€€€€€€€€İ½É­™±½İ}•á±Õ‘•‘}‰å}¹…µ”€ô9U10°4(€€€€€€€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ğ€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€€€€]!I…Ñ¥Ù¥Ñå}¥%8€ ‘íÁ±…•¡½±‘•ÉÍô¤4(€€€€€€€€€€€€€€€9µ…¹Õ™…ÑÕÉ•É}­•ä€ô€ü4(€€€€€€€€€€€€€€€9a%MQL€ 4(€€€€€€€€€€€€€€€€€M1P€Ä4(€€€€€€€€€€€€€€€€€I=4…Ñ¥Ù¥Ñ¥•Ì„4(€€€€€€€€€€€€€€€€€]!I„¹¥€ô…½Õ¹Ñ¥¹}½µµ¥ÍÍ¥½¹}•¹ÑÉ¥•Ì¹…Ñ¥Ù¥Ñå}¥4(€€€€€€€€€€€€€€€€€€€9„¹…İ…É‘}ÍÑ…ÑÕÌ€ô€Ÿ²r²š#²^ƒ²"c²ğœ4(€€€€€€€€€€€€€€€€€€€9„¹…İ…É‘}ÍÑ…”€ô€Ÿ®
§¶J ƒ²f®0œ4(€€€€€€€€€€€€€€€€¤4(€€€€€€€€€€€€¤4(€€€€€€€€€€€€€€¹‰¥¹ ¸¸¹¡Õ¹­%‘Ì°=U9Q%9}Q=Q1}-d¤4(€€€€€€€€€€€€€€¹ÉÕ¸ ¤4(€€€€€€€€€€è…İ…¥ĞÄ4(€€€€€€€€€€€€€€¹ÁÉ•Á…É”¡€4(€€€€€€€€€€€€€UAQ…½Õ¹Ñ¥¹}½µµ¥ÍÍ¥½¹}•¹ÑÉ¥•Ì4(€€€€€€€€€€€€€MPİ½É­™±½İ}•á±Õ‘•€ô€Ä°4(€€€€€€€€€€€€€€€€€İ½É­™±½İ}•á±Õ‘•‘}…Ğ€ôUII9Q}Q%5MQ5@°4(€€€€€€€€€€€€€€€€€İ½É­™±½İ}•á±Õ‘•‘}‰ä€ô€ü°4(€€€€€€€€€€€€€€€€€İ½É­™±½İ}•á±Õ‘•‘}‰å}¹…µ”€ô€ü°4(€€€€€€€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ğ€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€€€€]!I…Ñ¥Ù¥Ñå}¥%8€ ‘íÁ±…•¡½±‘•ÉÍô¤4(€€€€€€€€€€€€€€€9µ…¹Õ™…ÑÕÉ•É}­•ä€ô€ü4(€€€€€€€€€€€€€€€9a%MQL€ 4(€€€€€€€€€€€€€€€€€M1P€Ä4(€€€€€€€€€€€€€€€€€I=4…Ñ¥Ù¥Ñ¥•Ì„4(€€€€€€€€€€€€€€€€€]!I„¹¥€ô…½Õ¹Ñ¥¹}½µµ¥ÍÍ¥½¹}•¹ÑÉ¥•Ì¹…Ñ¥Ù¥Ñå}¥4(€€€€€€€€€€€€€€€€€€€9„¹…İ…É‘}ÍÑ…ÑÕÌ€ô€Ÿ²r²š#²^ƒ²"c²ğœ4(€€€€€€€€€€€€€€€€€€€9„¹…İ…É‘}ÍÑ…”€ô€Ÿ®
§¶J ƒ²f®0œ4(€€€€€€€€€€€€€€€€¤4(€€€€€€€€€€€€¤4(€€€€€€€€€€€€€€¹‰¥¹ 4(€€€€€€€€€€€€€€€…Ñ½È¹¥°4(€€€€€€€€€€€€€€€…Ñ½È¹‘¥ÍÁ±…å9…µ”°4(€€€€€€€€€€€€€€€€¸¸¹¡Õ¹­%‘Ì°4(€€€€€€€€€€€€€€€=U9Q%9}Q=Q1}-d°4(€€€€€€€€€€€€€€¤4(€€€€€€€€€€€€€€¹ÉÕ¸ ¤ì4(€€€€€ÕÁ‘…Ñ•€¬ô9Õµ‰•È¡É•ÍÕ±Ğ¹µ•Ñ„ü¹¡…¹•Ì€üü¡Õ¹­%‘Ì¹±•¹Ñ ¤ì4(€€€ô4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€ÕÁ‘…Ñ•°4(€€€€€…Ñ¥½¸°4(€€€ô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€É•ÑÕÉ¸•ÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(4)•áÁ½ÉĞ…Íå¹Œ™Õ¹Ñ¥½¸A=MP¡É•ÅÕ•ÍĞèI•ÅÕ•ÍĞ¤ì4(€ÑÉäì4(€€€½¹ÍĞ…Ñ½È€ô…İ…¥ĞÉ•ÅÕ¥É•5•µ‰•ÉA•Éµ¥ÍÍ¥½¸ ‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤ì4(€€€½¹ÍĞÁ…å±½…€ô€¡…İ…¥ĞÉ•ÅÕ•ÍĞ¹©Í½¸ ¤¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½İ¸øì4(€€€½¹ÍĞ•¹ÑÉå%€ô9Õµ‰•È¡Á…å±½…¹•¹ÑÉå%¤ì4(€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡•¹ÑÉå%¤ñğ•¹ÑÉå%€ğ€Ä¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹²"cªâ#¶V€ƒ²"c²ó®–ğƒ®.“².pƒ²ƒ¶w¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ĞÀÀô°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞ…µ½Õ¹Ğ€ôÁ…ÉÍ•µ½Õ¹Ğ¡Á…å±½…¹…µ½Õ¹Ğ¤ì4(€€€½¹ÍĞ½±±•Ñ¥½¹…Ñ”€ôÁ…ÉÍ•…Ñ”¡Á…å±½…¹½±±•Ñ¥½¹…Ñ”¤ì4(€€€½¹ÍĞ¹½Ñ”€ôMÑÉ¥¹œ¡Á…å±½…¹¹½Ñ”€üü€ˆˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€ÔÀÀ¤ì4(€€€½¹ÍĞìÄ°Í½ÕÉ•Ì°•¹ÑÉ¥•Ìô€ô…İ…¥ĞÉ•…‘¹ÑÉ¥•Ì ¤ì4(€€€½¹ÍĞ•±¥¥‰±•¹ÑÉä€ô•¹ÑÉ¥•Ì¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥€ôôô•¹ÑÉå%¤ì4(€€€¥˜€¡•±¥¥‰±•¹ÑÉäü¹İ½É­™±½İá±Õ‘•¤ì4(€€€€€É•ÑÕÉ¸•á±Õ‘•‘¹ÑÉåI••¥ÁÑI•ÍÁ½¹Í” ¤ì4(€€€ô4(€€€½¹ÍĞÕÉÉ•¹Ğ€ô•±¥¥‰±•¹ÑÉä4(€€€€€€üì4(€€€€€€€€€¥è•±¥¥‰±•¹ÑÉä¹¥°4(€€€€€€€€€…Ñ¥Ù¥Ñå}¥è•±¥¥‰±•¹ÑÉä¹…Ñ¥Ù¥Ñå%°4(€€€€€€€ô4(€€€€€€è¹Õ±°ì4(€€€¥˜€ …ÕÉÉ•¹Ğ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹®
§¶J ƒ²f®0ƒ²Êc®š³®Bpƒ²r²š#²^ƒ²"cªâ ƒ¶V·®ª§²vƒ²Âû² ƒ®ªï¶Z#²*×®.#®.¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ĞÀĞô°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞ¥¹Í•ÉÑI•ÍÕ±Ğ€ô…İ…¥ĞÄ4(€€€€€€¹ÁÉ•Á…É”¡€4(€€€€€€€%9MIP%9Q<…½Õ¹Ñ¥¹}½±±•Ñ¥½¹}É••¥ÁÑÌ€ 4(€€€€€€€€€•¹ÑÉå}¥°…Ñ¥Ù¥Ñå}¥°…µ½Õ¹Ğ°½±±•Ñ¥½¹}‘…Ñ”°¹½Ñ”°4(€€€€€€€€€É•…Ñ•‘}‰ä°É•…Ñ•‘}‰å}¹…µ”4(€€€€€€€€¤4(€€€€€€€M1P€ü°€ü°€ü°€ü°€ü°€ü°€ü4(€€€€€€€]!Ia%MQL€ 4(€€€€€€€€€M1P€Ä4(€€€€€€€€€I=4…½Õ¹Ñ¥¹}½µµ¥ÍÍ¥½¹}•¹ÑÉ¥•Ì”4(€€€€€€€€€]!I”¹¥€ô€ü4(€€€€€€€€€€€9=1M¡”¹İ½É­™±½İ}•á±Õ‘•°€À¤€ô€À4(€€€€€€€€¤4(€€€€€€¤4(€€€€€€¹‰¥¹ 4(€€€€€€€•¹ÑÉå%°4(€€€€€€€9Õµ‰•È¡ÕÉÉ•¹Ğ¹…Ñ¥Ù¥Ñå}¥¤°4(€€€€€€€…µ½Õ¹Ğ°4(€€€€€€€½±±•Ñ¥½¹…Ñ”°4(€€€€€€€¹½Ñ”°4(€€€€€€€…Ñ½È¹¥°4(€€€€€€€…Ñ½È¹‘¥ÍÁ±…å9…µ”°4(€€€€€€€•¹ÑÉå%°4(€€€€€€¤4(€€€€€€¹ÉÕ¸ ¤ì4(€€€¥˜€¡¥¹Í•ÉÑI•ÍÕ±Ğ¹µ•Ñ„ü¹¡…¹•Ì€ôôô€À¤ì4(€€€€€É•ÑÕÉ¸•á±Õ‘•‘¹ÑÉåI••¥ÁÑI•ÍÁ½¹Í” ¤ì4(€€€ô4(€€€½¹ÍĞÍ½ÕÉ”€ôÍ½ÕÉ•Ì¹•Ğ¡9Õµ‰•È¡ÕÉÉ•¹Ğ¹…Ñ¥Ù¥Ñå}¥¤¤ì4(€€€¥˜€¡Í½ÕÉ”¤…İ…¥ĞÍå¹¹ÑÉåÉ•…Ñ”¡Ä°•¹ÑÉå%°Í½ÕÉ”¤ì4(€€€½¹ÍĞÉ•™É•Í¡•€ô…İ…¥ĞÉ•…‘¹ÑÉ¥•Ì ¤ì4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€•¹ÑÉäèÉ•™É•Í¡•¹•¹ÑÉ¥•Ì¹™¥¹ ¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥€ôôô•¹ÑÉå%¤°4(€€€ô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€É•ÑÕÉ¸•ÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(4)•áÁ½ÉĞ…Íå¹Œ™Õ¹Ñ¥½¸AQ ¡É•ÅÕ•ÍĞèI•ÅÕ•ÍĞ¤ì4(€ÑÉäì4(€€€…İ…¥ĞÉ•ÅÕ¥É•5•µ‰•ÉA•Éµ¥ÍÍ¥½¸ ‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤ì4(€€€½¹ÍĞÁ…å±½…€ô€¡…İ…¥ĞÉ•ÅÕ•ÍĞ¹©Í½¸ ¤¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½İ¸øì4(€€€½¹ÍĞÉ••¥ÁÑ%€ô9Õµ‰•È¡Á…å±½…¹É••¥ÁÑ%¤ì4(€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡É••¥ÁÑ%¤ñğÉ••¥ÁÑ%€ğ€Ä¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹²"c²‚W¶V€ƒ²"cªâ ƒ®
Ó²^·²vƒ®.“².pƒ²ƒ¶w¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ĞÀÀô°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞ…µ½Õ¹Ğ€ôÁ…ÉÍ•µ½Õ¹Ğ¡Á…å±½…¹…µ½Õ¹Ğ¤ì4(€€€½¹ÍĞ½±±•Ñ¥½¹…Ñ”€ôÁ…ÉÍ•…Ñ”¡Á…å±½…¹½±±•Ñ¥½¹…Ñ”¤ì4(€€€½¹ÍĞ¹½Ñ”€ôMÑÉ¥¹œ¡Á…å±½…¹¹½Ñ”€üü€ˆˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€ÔÀÀ¤ì4(€€€½¹ÍĞìÄ°Í½ÕÉ•Ì°•¹ÑÉ¥•Ìô€ô…İ…¥ĞÉ•…‘¹ÑÉ¥•Ì ¤ì4(€€€½¹ÍĞ•±¥¥‰±•¹ÑÉä€ô•¹ÑÉ¥•Ì¹™¥¹ ¡•¹ÑÉä¤€ôø4(€€€€€•¹ÑÉä¹É••¥ÁÑÌ¹Í½µ” ¡É••¥ÁĞèI••¥ÁĞ¤€ôøÉ••¥ÁĞ¹¥€ôôôÉ••¥ÁÑ%¤°4(€€€€¤ì4(€€€¥˜€¡•±¥¥‰±•¹ÑÉäü¹İ½É­™±½İá±Õ‘•¤ì4(€€€€€É•ÑÕÉ¸•á±Õ‘•‘¹ÑÉåI••¥ÁÑI•ÍÁ½¹Í” ¤ì4(€€€ô4(€€€½¹ÍĞÕÉÉ•¹Ğ€ô•±¥¥‰±•¹ÑÉä4(€€€€€€üì4(€€€€€€€€€•¹ÑÉå}¥è•±¥¥‰±•¹ÑÉä¹¥°4(€€€€€€€€€…Ñ¥Ù¥Ñå}¥è•±¥¥‰±•¹ÑÉä¹…Ñ¥Ù¥Ñå%°4(€€€€€€€ô4(€€€€€€è¹Õ±°ì4(€€€¥˜€ …ÕÉÉ•¹Ğ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹²"c²‚W¶V€ƒ²"cªâ ƒ®
Ó²^·²vƒ²Âû² ƒ®ªï¶Z#²*×®.#®.¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ĞÀĞô°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞÕÁ‘…Ñ•I•ÍÕ±Ğ€ô…İ…¥ĞÄ4(€€€€€€¹ÁÉ•Á…É”¡€4(€€€€€€€UAQ…½Õ¹Ñ¥¹}½±±•Ñ¥½¹}É••¥ÁÑÌ4(€€€€€€€MP…µ½Õ¹Ğ€ô€ü°4(€€€€€€€€€€€½±±•Ñ¥½¹}‘…Ñ”€ô€ü°4(€€€€€€€€€€€¹½Ñ”€ô€ü°4(€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ğ€ôUII9Q}Q%5MQ5@4(€€€€€€€]!I¥€ô€ü4(€€€€€€€€€9a%MQL€ 4(€€€€€€€€€€€M1P€Ä4(€€€€€€€€€€€I=4…½Õ¹Ñ¥¹}½µµ¥ÍÍ¥½¹}•¹ÑÉ¥•Ì”4(€€€€€€€€€€€]!I”¹¥€ô…½Õ¹Ñ¥¹}½±±•Ñ¥½¹}É••¥ÁÑÌ¹•¹ÑÉå}¥4(€€€€€€€€€€€€€9=1M¡”¹İ½É­™±½İ}•á±Õ‘•°€À¤€ô€À4(€€€€€€€€€€¤4(€€€€€€¤4(€€€€€€¹‰¥¹¡…µ½Õ¹Ğ°½±±•Ñ¥½¹…Ñ”°¹½Ñ”°É••¥ÁÑ%¤4(€€€€€€¹ÉÕ¸ ¤ì4(€€€¥˜€¡ÕÁ‘…Ñ•I•ÍÕ±Ğ¹µ•Ñ„ü¹¡…¹•Ì€ôôô€À¤ì4(€€€€€É•ÑÕÉ¸•á±Õ‘•‘¹ÑÉåI••¥ÁÑI•ÍÁ½¹Í” ¤ì4(€€€ô4(€€€½¹ÍĞÍ½ÕÉ”€ôÍ½ÕÉ•Ì¹•Ğ¡9Õµ‰•È¡ÕÉÉ•¹Ğ¹…Ñ¥Ù¥Ñå}¥¤¤ì4(€€€¥˜€¡Í½ÕÉ”¤ì4(€€€€€…İ…¥ĞÍå¹¹ÑÉåÉ•…Ñ” 4(€€€€€€€Ä°4(€€€€€€€9Õµ‰•È¡ÕÉÉ•¹Ğ¹•¹ÑÉå}¥¤°4(€€€€€€€Í½ÕÉ”°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞÉ•™É•Í¡•€ô…İ…¥ĞÉ•…‘¹ÑÉ¥•Ì ¤ì4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€•¹ÑÉäèÉ•™É•Í¡•¹•¹ÑÉ¥•Ì¹™¥¹ 4(€€€€€€€€¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥€ôôô9Õµ‰•È¡ÕÉÉ•¹Ğ¹•¹ÑÉå}¥¤°4(€€€€€€¤°4(€€€ô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€É•ÑÕÉ¸•ÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(4)•áÁ½ÉĞ…Íå¹Œ™Õ¹Ñ¥½¸1Q¡É•ÅÕ•ÍĞèI•ÅÕ•ÍĞ¤ì4(€ÑÉäì4(€€€…İ…¥ĞÉ•ÅÕ¥É•5•µ‰•ÉA•Éµ¥ÍÍ¥½¸ ‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤ì4(€€€½¹ÍĞÁ…å±½…€ô€¡…İ…¥ĞÉ•ÅÕ•ÍĞ¹©Í½¸ ¤¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½İ¸øì4(€€€½¹ÍĞÉ••¥ÁÑ%€ô9Õµ‰•È¡Á…å±½…¹É••¥ÁÑ%¤ì4(€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡É••¥ÁÑ%¤ñğÉ••¥ÁÑ%€ğ€Ä¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹²
·²‚s¶V€ƒ²"cªâ ƒ®
Ó²^·²vƒ®.“².pƒ²ƒ¶w¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ĞÀÀô°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞìÄ°Í½ÕÉ•Ì°•¹ÑÉ¥•Ìô€ô…İ…¥ĞÉ•…‘¹ÑÉ¥•Ì ¤ì4(€€€½¹ÍĞ•±¥¥‰±•¹ÑÉä€ô•¹ÑÉ¥•Ì¹™¥¹ ¡•¹ÑÉä¤€ôø4(€€€€€•¹ÑÉä¹É••¥ÁÑÌ¹Í½µ” ¡É••¥ÁĞèI••¥ÁĞ¤€ôøÉ••¥ÁĞ¹¥€ôôôÉ••¥ÁÑ%¤°4(€€€€¤ì4(€€€¥˜€¡•±¥¥‰±•¹ÑÉäü¹İ½É­™±½İá±Õ‘•¤ì4(€€€€€É•ÑÕÉ¸•á±Õ‘•‘¹ÑÉåI••¥ÁÑI•ÍÁ½¹Í” ¤ì4(€€€ô4(€€€½¹ÍĞÕÉÉ•¹Ğ€ô•±¥¥‰±•¹ÑÉä4(€€€€€€üì4(€€€€€€€€€•¹ÑÉå}¥è•±¥¥‰±•¹ÑÉä¹¥°4(€€€€€€€€€…Ñ¥Ù¥Ñå}¥è•±¥¥‰±•¹ÑÉä¹…Ñ¥Ù¥Ñå%°4(€€€€€€€ô4(€€€€€€è¹Õ±°ì4(€€€¥˜€ …ÕÉÉ•¹Ğ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹²
·²‚s¶V€ƒ²"cªâ ƒ®
Ó²^·²vƒ²Âû² ƒ®ªï¶Z#²*×®.#®.¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ĞÀĞô°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞ‘•±•Ñ•I•ÍÕ±Ğ€ô…İ…¥ĞÄ4(€€€€€€¹ÁÉ•Á…É”¡€4(€€€€€€€1QI=4…½Õ¹Ñ¥¹}½±±•Ñ¥½¹}É••¥ÁÑÌ]!I¥€ô€ü4(€€€€€€€€€9a%MQL€ 4(€€€€€€€€€€€M1P€Ä4(€€€€€€€€€€€I=4…½Õ¹Ñ¥¹}½µµ¥ÍÍ¥½¹}•¹ÑÉ¥•Ì”4(€€€€€€€€€€€]!I”¹¥€ô…½Õ¹Ñ¥¹}½±±•Ñ¥½¹}É••¥ÁÑÌ¹•¹ÑÉå}¥4(€€€€€€€€€€€€€9=1M¡”¹İ½É­™±½İ}•á±Õ‘•°€À¤€ô€À4(€€€€€€€€€€¤4(€€€€€€¤4(€€€€€€¹‰¥¹¡É••¥ÁÑ%¤4(€€€€€€¹ÉÕ¸ ¤ì4(€€€¥˜€¡‘•±•Ñ•I•ÍÕ±Ğ¹µ•Ñ„ü¹¡…¹•Ì€ôôô€À¤ì4(€€€€€É•ÑÕÉ¸•á±Õ‘•‘¹ÑÉåI••¥ÁÑI•ÍÁ½¹Í” ¤ì4(€€€ô4(€€€½¹ÍĞÍ½ÕÉ”€ôÍ½ÕÉ•Ì¹•Ğ¡9Õµ‰•È¡ÕÉÉ•¹Ğ¹…Ñ¥Ù¥Ñå}¥¤¤ì4(€€€¥˜€¡Í½ÕÉ”¤ì4(€€€€€…İ…¥ĞÍå¹¹ÑÉåÉ•…Ñ” 4(€€€€€€€Ä°4(€€€€€€€9Õµ‰•È¡ÕÉÉ•¹Ğ¹•¹ÑÉå}¥¤°4(€€€€€€€Í½ÕÉ”°4(€€€€€€¤ì4(€€€ô4(€€€½¹ÍĞÉ•™É•Í¡•€ô…İ…¥ĞÉ•…‘¹ÑÉ¥•Ì ¤ì4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€•¹ÑÉäèÉ•™É•Í¡•¹•¹ÑÉ¥•Ì¹™¥¹ 4(€€€€€€€€¡•¹ÑÉä¤€ôø•¹ÑÉä¹¥€ôôô9Õµ‰•È¡ÕÉÉ•¹Ğ¹•¹ÑÉå}¥¤°4(€€€€€€¤°4(€€€ô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€É•ÑÕÉ¸•ÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(