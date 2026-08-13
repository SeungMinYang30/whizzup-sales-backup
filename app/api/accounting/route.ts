import {
  accessErrorResponse,
  hasMemberPermission,
  requireApprovedMember,
  requireMemberPermission,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import {
  ensureAccountingReady,
  ensureLegacyReceiptLedgerMigration,
  linkEquipmentProjectsToWhizzupAwards,
} from "../../../lib/accounting-store";
import { calculateEquipmentFinance } from "../../../lib/equipment-finance";
import {
  ensureBudgetNamesReady,
  normalizeBudgetNameKey,
} from "../../../lib/budget-names";
import {
  analyticsBusinessRoundKey,
  completedWhizzupAwardRows,
} from "../../../lib/analytics-business-rounds";
import {
  calculateAwardSettlementProjection,
  calculateConstructionFinance,
} from "../../../lib/construction-finance";
import { PRODUCT_CATALOG } from "../../../lib/product-catalog";
import { ensureProductVendorLinksReady } from "../../../lib/product-vendor-links";
import {
  calculateRegisteredQuote,
  calculateRegisteredQuoteFromTotals,
  isRegisteredQuoteItemAmount,
} from "../../../lib/registered-quote";
import {
  activityBudgetsFromRecord,
  parseBudgetMoney,
} from "../../../lib/activity-budgets";
import {
  authoredQuotationFromRow,
  ensureAuthoredQuotationsReady,
  type AuthoredQuotation,
} from "../../../lib/authored-quotations";

export const dynamic = "force-dynamic";

type RawAccountingRow = Record<string, unknown>;

function mapAccountingRow(row: RawAccountingRow, finalQuotation?: AuthoredQuotation) {
  const registeredQuote = calculateRegisteredQuoteFromTotals({
    registeredItemAmount: Number(row.registered_item_quote_amount ?? 0),
    itemCount: Number(row.quote_item_count ?? 0),
    missingAmountItemCount: Number(row.quote_missing_amount_item_count ?? 0),
    registeredConstructionAmount: Number(
      row.registered_construction_quote_amount ?? 0,
    ),
    registeredConstructionCount: Number(
      row.quote_construction_count ?? 0,
    ),
  });
  const salesEnteredAmount = finalQuotation?.totalAmount ?? registeredQuote.contractAmount;
  const confirmedContractAmount = salesEnteredAmount;
  const manufacturerCommissionExpected =
    row.manufacturer_commission_expected === null ||
    row.manufacturer_commission_expected === undefined
      ? null
      : Number(row.manufacturer_commission_expected);
  const manufacturerCommissionReceived = Number(
    row.manufacturer_commission_received ?? 0,
  );
  const commissionReceivable = Number(row.commission_receivable ?? 0);
  const consortiumPaymentExpected =
    row.consortium_payment_expected === null ||
    row.consortium_payment_expected === undefined
      ? null
      : Number(row.consortium_payment_expected);
  const consortiumPaymentPaid = Number(row.consortium_payment_paid ?? 0);
  const consortiumPayable = Number(row.consortium_payable ?? 0);
  const netRevenue =
    row.net_revenue === null || row.net_revenue === undefined
      ? null
      : Number(row.net_revenue);
  return {
    activityId: Number(row.activity_id),
    businessKey: String(
      row.business_key ??
        analyticsBusinessRoundKey(row.organization, row.business_round),
    ),
    businessRound: Number(row.business_round ?? 1),
    groupedActivityIds: Array.isArray(row.grouped_activity_ids)
      ? row.grouped_activity_ids.map(Number)
      : [Number(row.activity_id)],
    activityDate: String(row.activity_date ?? ""),
    organization: String(row.organization ?? ""),
    region: String(row.region ?? ""),
    budgetType: String(row.budget_type ?? ""),
    salesEnteredAmount,
    quoteStatus: finalQuotation ? "complete" : registeredQuote.quoteStatus,
    quoteItemCount: finalQuotation?.items.length ?? registeredQuote.quoteItemCount,
    quoteMissingAmountItemCount:
      finalQuotation ? 0 : registeredQuote.quoteMissingAmountItemCount,
    awardStatus: String(row.award_status ?? ""),
    awardCompany: String(row.award_company ?? ""),
    executionType:
      finalQuotation?.executionType === "컨소" ||
      String(row.execution_type ?? "") === "컨소"
        ? "컨소"
        : "직영",
    consortiumCompany:
      finalQuotation?.consortiumCompany || String(row.consortium_company ?? ""),
    settlementId: row.settlement_id ? Number(row.settlement_id) : null,
    confirmedContractAmount,
    manufacturerCommissionExpected,
    manufacturerCommissionReceived,
    manufacturerCommissionReceivedDate: String(
      row.manufacturer_commission_received_date ?? "",
    ),
    commissionReceivable,
    consortiumPaymentExpected,
    consortiumPaymentPaid,
    consortiumPaymentDate: String(row.consortium_payment_date ?? ""),
    consortiumPayable,
    otherCost: Number(row.other_cost ?? 0),
    netRevenue,
    suggestedManufacturerCommission: Number(
      row.suggested_manufacturer_commission ?? 0,
    ),
    suggestedConsortiumPayment: Number(row.suggested_consortium_payment ?? 0),
    paidAmount: manufacturerCommissionReceived,
    outstandingAmount: commissionReceivable,
    recognizedDate: String(row.recognized_date ?? ""),
    invoiceStatus: String(row.invoice_status ?? "미발행"),
    invoiceDate: String(row.invoice_date ?? ""),
    settlementStatus: String(row.settlement_status ?? "확인 필요"),
    accountingNote: String(row.accounting_note ?? ""),
    confirmed: Number(row.confirmed ?? 0) === 1,
  };
}

const awardAccountingQuery = `
  WITH equipment_totals AS (
    SELECT
      ep.activity_id,
      SUM(
        CASE
          WHEN ei.price_status IN (
            '무상 제공',
            '계약금액에 포함',
            '서비스 품목'
          ) THEN 0
          WHEN ei.price_status = '금액 미입력'
            OR ei.catalog_unit_price IS NULL
            OR ei.catalog_unit_price = 0
            OR (
              COALESCE(ei.proposed_qty, 0) <= 0
              AND COALESCE(ei.awarded_qty, 0) <= 0
              AND COALESCE(ei.installed_qty, 0) <= 0
            )
          THEN 0
          ELSE
            COALESCE(
              NULLIF(ei.proposed_qty, 0),
              NULLIF(ei.awarded_qty, 0),
              NULLIF(ei.installed_qty, 0),
              1
            ) * COALESCE(ei.catalog_unit_price, 0)
            + CAST(
                (
                  GREATEST(
                    0,
                    COALESCE(
                      NULLIF(ei.proposed_qty, 0),
                      NULLIF(ei.awarded_qty, 0),
                      NULLIF(ei.installed_qty, 0),
                      1
                    ) * COALESCE(ei.catalog_unit_price, 0)
                  ) * GREATEST(0, COALESCE(ei.procurement_fee_rate, 0))
                ) / 10
                AS INTEGER
              ) * 10
        END
      ) AS registered_item_quote_amount,
      COUNT(ei.id) AS quote_item_count,
      SUM(
        CASE
          WHEN ei.price_status IN (
            '무상 제공',
            '계약금액에 포함',
            '서비스 품목'
          ) THEN 0
          WHEN ei.price_status = '금액 미입력'
            OR ei.catalog_unit_price IS NULL
            OR ei.catalog_unit_price = 0
            OR (
              COALESCE(ei.proposed_qty, 0) <= 0
              AND COALESCE(ei.awarded_qty, 0) <= 0
              AND COALESCE(ei.installed_qty, 0) <= 0
            )
          THEN 1
          ELSE 0
        END
      )
        AS quote_missing_amount_item_count,
      SUM(
        CASE
          WHEN COALESCE(ei.supply_type, 'partner') = 'direct' THEN 0
          ELSE CAST(
            (COALESCE(NULLIF(ei.proposed_qty, 0), NULLIF(ei.awarded_qty, 0), NULLIF(ei.installed_qty, 0), 1) * GREATEST(0, COALESCE(ei.catalog_unit_price, 0)) *
              GREATEST(0, LEAST(1, COALESCE(ei.commission_rate, 0)))) / 10
            AS INTEGER
          ) * 10
        END
      ) AS suggested_manufacturer_commission,
      SUM(
        CASE
          WHEN ei.execution_type <> '컨소' THEN 0
          WHEN ei.commission_input_type = 'amount'
            THEN GREATEST(0, COALESCE(ei.consortium_payment_amount, 0))
          ELSE CAST(
            (COALESCE(NULLIF(ei.proposed_qty, 0), NULLIF(ei.awarded_qty, 0), NULLIF(ei.installed_qty, 0), 1) * GREATEST(0, COALESCE(ei.catalog_unit_price, 0)) *
              GREATEST(0, LEAST(1, COALESCE(ei.consortium_commission_rate, 0)))) / 10
            AS INTEGER
          ) * 10
        END
      ) AS suggested_consortium_payment
    FROM equipment_projects ep
    JOIN equipment_items ei ON ei.project_id = ep.id
    WHERE ep.activity_id IS NOT NULL
    GROUP BY ep.activity_id
  ),
  construction_totals AS (
    SELECT
      ep.activity_id,
      SUM(
        CASE
          WHEN construction_amount IS NULL THEN 0
          ELSE construction_amount
        END
      ) AS registered_construction_quote_amount,
      SUM(CASE WHEN construction_amount IS NULL THEN 0 ELSE 1 END)
        AS quote_construction_count
    FROM equipment_projects ep
    WHERE ep.activity_id IS NOT NULL
    GROUP BY ep.activity_id
  )
  SELECT
    a.id AS activity_id,
    a.activity_date,
    a.award_completed_date,
    a.business_round,
    a.organization,
    a.region,
    a.budget_type,
    a.award_status,
    a.award_stage,
    a.award_company,
    a.execution_type,
    a.consortium_company,
    a.progress_manager,
    s.id AS settlement_id,
    s.confirmed_contract_amount,
    s.deposit_amount,
    s.interim_amount,
    s.balance_amount,
    s.paid_amount,
    s.actual_cost,
    s.confirmed_commission,
    s.confirmed_margin,
    s.manufacturer_commission_expected,
    s.manufacturer_commission_received,
    s.manufacturer_commission_received_date,
    s.consortium_payment_expected,
    s.consortium_payment_paid,
    s.consortium_payment_date,
    s.other_cost,
    s.commission_receivable,
    s.consortium_payable,
    s.net_revenue,
    s.recognized_date,
    s.invoice_status,
    s.invoice_date,
    s.settlement_status,
    s.accounting_note,
    s.confirmed,
    s.updated_by_name,
    s.updated_at,
    COALESCE(et.suggested_manufacturer_commission, 0) AS suggested_manufacturer_commission,
    COALESCE(et.suggested_consortium_payment, 0) AS suggested_consortium_payment,
    COALESCE(et.registered_item_quote_amount, 0)
      AS registered_item_quote_amount,
    COALESCE(et.quote_item_count, 0) AS quote_item_count,
    COALESCE(et.quote_missing_amount_item_count, 0)
      AS quote_missing_amount_item_count,
    COALESCE(ct.registered_construction_quote_amount, 0)
      AS registered_construction_quote_amount,
    COALESCE(ct.quote_construction_count, 0)
      AS quote_construction_count
  FROM activities a
  LEFT JOIN accounting_settlements s ON s.activity_id = a.id
  LEFT JOIN equipment_totals et ON et.activity_id = a.id
  LEFT JOIN construction_totals ct ON ct.activity_id = a.id
  WHERE a.award_status IN ('위즈업 수주', '협력사 수주', '타업체 수주')`;

async function buildAnalyticsPayload() {
  const d1 = await ensureAccountingReady();
  await ensureBudgetNamesReady();
  await ensureAuthoredQuotationsReady();
  await linkEquipmentProjectsToWhizzupAwards(d1);
  await ensureLegacyReceiptLedgerMigration(d1);
  await ensureProductVendorLinksReady();
  const [
    awardResult,
    receiptResult,
    productResult,
    constructionResult,
    unlinkedProjectResult,
    linked2025ProjectResult,
    budgetAliasResult,
    catalogSetting,
    finalQuotationResult,
  ] = await Promise.all([
    d1.prepare(`
      WITH entry_totals AS (
        SELECT
          e.activity_id,
          COUNT(DISTINCT e.id) AS entry_count,
          CASE WHEN COALESCE(SUM(r.amount), 0) > 0 THEN 0 ELSE 1 END
            AS unconfirmed_entries,
          MAX(NULLIF(r.collection_date, '')) AS recognized_date,
          COALESCE(SUM(r.amount), 0) AS commission_collected_amount,
          COALESCE(MAX(e.receivable_balance), 0) AS receivable_balance,
          COALESCE(MAX(e.consortium_paid_amount), 0)
            AS consortium_paid_amount,
          COALESCE(MAX(e.contribution_margin), 0)
            AS contribution_margin
        FROM accounting_commission_entries e
        JOIN activities entry_activity ON entry_activity.id = e.activity_id
        LEFT JOIN accounting_collection_receipts r
          ON r.entry_id = e.id
         AND EXISTS (
           SELECT 1
           FROM activities receipt_activity
           WHERE receipt_activity.id = r.activity_id
             AND receipt_activity.award_status = '위즈업 수주'
         )
        WHERE e.manufacturer_key = 'award-total'
          AND entry_activity.award_status = '위즈업 수주'
        GROUP BY e.activity_id
      )
      SELECT
        a.id AS activity_id,
        a.activity_date,
        a.business_round,
        a.award_completed_date,
        a.award_status,
        a.award_company,
        a.organization,
        a.region,
        a.budget_type,
        a.budgets_json,
        a.execution_type,
        a.award_stage,
        a.progress_manager,
        a.summary,
        a.next_action,
        a.progress_schedule,
        a.updated_at,
        COALESCE(et.entry_count, 0) AS entry_count,
        COALESCE(et.unconfirmed_entries, 0) AS unconfirmed_entries,
        et.recognized_date,
        COALESCE(et.commission_collected_amount, 0)
          AS commission_collected_amount,
        COALESCE(et.receivable_balance, 0) AS receivable_balance,
        COALESCE(et.consortium_paid_amount, 0) AS consortium_paid_amount,
        COALESCE(et.contribution_margin, 0) AS contribution_margin,
        COALESCE(s.confirmed, 0) AS legacy_confirmed,
        s.confirmed_contract_amount AS legacy_contract_amount,
        COALESCE(s.commission_receivable, 0)
          AS legacy_receivable_balance,
        COALESCE(s.consortium_payment_paid, 0)
          AS legacy_consortium_paid_amount,
        COALESCE(s.net_revenue, 0) AS legacy_contribution_margin
      FROM activities a
      LEFT JOIN entry_totals et ON et.activity_id = a.id
      LEFT JOIN accounting_settlements s ON s.activity_id = a.id
      WHERE a.award_status IN ('위즈업 수주', '협력사 수주', '타업체 수주')
      ORDER BY a.activity_date DESC, a.id DESC
    `).all<RawAccountingRow>(),
    d1.prepare(`
      SELECT
        r.id AS receipt_id,
        r.activity_id,
        e.activity_id AS entry_activity_id,
        r.collection_date,
        r.amount,
        r.note,
        a.organization,
        a.business_round,
        a.region,
        a.budget_type
      FROM accounting_collection_receipts r
      JOIN accounting_commission_entries e ON e.id = r.entry_id
      JOIN activities entry_activity ON entry_activity.id = e.activity_id
      JOIN activities a ON a.id = r.activity_id
      WHERE e.manufacturer_key = 'award-total'
        AND entry_activity.award_status = '위즈업 수주'
        AND a.award_status = '위즈업 수주'
        AND r.amount > 0
      ORDER BY r.collection_date DESC, r.id DESC
    `).all<Record<string, unknown>>(),
    d1.prepare(`
      SELECT
        a.id AS activity_id,
        a.activity_date,
        ep.id AS project_id,
        ei.id AS item_id,
        ep.organization,
        ep.business_round,
        ep.name AS project_name,
        ep.budget_group_id AS project_budget_group_id,
        ep.budget_original_name AS project_budget_original_name,
        ep.budget_match_status AS project_budget_match_status,
        ep.created_by AS project_created_by,
        a.progress_manager,
        ei.product_name,
        ei.catalog_item_id,
        ei.proposed_qty AS quote_proposed_qty,
        ei.awarded_qty AS quote_awarded_qty,
        ei.installed_qty AS quote_installed_qty,
        COALESCE(NULLIF(ei.proposed_qty, 0), NULLIF(ei.awarded_qty, 0), NULLIF(ei.installed_qty, 0), 1) AS awarded_qty,
        ei.catalog_unit_price,
        ei.price_status,
        ei.commission_rate,
        ei.supply_type,
        ei.margin_rate,
        ei.procurement_fee_rate,
        ei.execution_type,
        ei.commission_input_type,
        ei.consortium_commission_rate,
        ei.consortium_payment_amount,
        ei.updated_at AS item_updated_at,
        COALESCE(
          NULLIF(ei.supplier_vendor_name, ''),
          NULLIF(v.company_name, ''),
          NULLIF(pvl.vendor_name_snapshot, ''),
          ''
        ) AS supplier_vendor_name,
        COALESCE(ei.supplier_vendor_id, pvl.vendor_id) AS supplier_vendor_id,
        COALESCE(NULLIF(item_member.display_name, ''), NULLIF(project_member.display_name, ''), '') AS item_created_by_name,
        COALESCE(NULLIF(update_member.display_name, ''), NULLIF(item_member.display_name, ''), NULLIF(project_member.display_name, ''), '') AS item_updated_by_name
      FROM equipment_items ei
      JOIN equipment_projects ep ON ep.id = ei.project_id
      JOIN activities a ON a.id = ep.activity_id
      LEFT JOIN product_vendor_links pvl ON pvl.product_id = ei.catalog_item_id
      LEFT JOIN award_vendors v
        ON v.id = COALESCE(ei.supplier_vendor_id, pvl.vendor_id)
       AND v.is_active = 1
      LEFT JOIN members item_member ON item_member.id = ei.created_by
      LEFT JOIN members update_member ON update_member.id = ei.updated_by
      LEFT JOIN members project_member ON project_member.id = ep.created_by
      WHERE a.award_status = '위즈업 수주'
    `).all<Record<string, unknown>>(),
    d1.prepare(`
      SELECT
        a.id AS activity_id,
        a.activity_date,
        ep.id AS project_id,
        ep.organization,
        ep.business_round,
        ep.name AS project_name,
        ep.construction_amount,
        ep.actual_construction_cost
      FROM equipment_projects ep
      JOIN activities a ON a.id = ep.activity_id
      WHERE a.award_status = '위즈업 수주'
      ORDER BY ep.id
    `).all<Record<string, unknown>>(),
    d1.prepare(`
      SELECT
        ep.id AS project_id,
        ep.organization,
        ep.business_round,
        ep.name AS project_name,
        ep.status,
        ep.updated_at,
        COALESCE(SUM(
          CASE
            WHEN ei.proposed_qty > 0 THEN ei.proposed_qty
            WHEN ei.awarded_qty > 0 THEN ei.awarded_qty
            WHEN ei.installed_qty > 0 THEN ei.installed_qty
            ELSE 1
          END
        ), 0)
          AS awarded_quantity
      FROM equipment_projects ep
      JOIN equipment_items ei ON ei.project_id = ep.id
      WHERE ep.activity_id IS NULL
      GROUP BY
        ep.id,
        ep.organization,
        ep.business_round,
        ep.name,
        ep.status,
        ep.updated_at
      ORDER BY ep.updated_at DESC, ep.id DESC
    `).all<Record<string, unknown>>(),
    d1.prepare(`
      SELECT
        ep.id AS project_id,
        ep.organization,
        ep.business_round,
        ep.name AS project_name,
        ep.status,
        a.activity_date,
        ep.updated_at
      FROM equipment_projects ep
      JOIN activities a ON a.id = ep.activity_id
      WHERE a.activity_date LIKE '2025%'
      ORDER BY a.activity_date DESC, ep.updated_at DESC, ep.id DESC
    `).all<Record<string, unknown>>(),
    d1.prepare(`
      SELECT a.alias_key, g.canonical_name
      FROM budget_name_aliases a
      JOIN budget_name_groups g ON g.id = a.group_id
      WHERE a.active = 1 AND g.active = 1
    `).all<{ alias_key: string; canonical_name: string }>(),
    d1
      .prepare("SELECT value FROM app_settings WHERE key = 'product_catalog_v1'")
      .first<{ value: string }>(),
    d1.prepare(`
      SELECT * FROM authored_quotations
      WHERE status = 'final' AND deleted_at = ''
      ORDER BY quote_date DESC, revision_number DESC, id DESC
      LIMIT 2000
    `).all<Record<string, unknown>>(),
  ]);
  const canonicalBudgetNames = new Map<string, string>(
    budgetAliasResult.results.map(
      (row: { alias_key: string; canonical_name: string }) => [
      row.alias_key,
      row.canonical_name,
      ],
    ),
  );
  const canonicalBudgetName = (value: unknown): string => {
    const original = String(value ?? "").trim();
    return canonicalBudgetNames.get(normalizeBudgetNameKey(original)) || original;
  };
  const groupedAwardRows = completedWhizzupAwardRows(awardResult.results);
  const latestFinalQuotationByBusiness = new Map<string, AuthoredQuotation>();
  finalQuotationResult.results.forEach((row) => {
    const quotation = authoredQuotationFromRow(row);
    const businessKey = analyticsBusinessRoundKey(
      quotation.organization,
      quotation.businessRound,
    );
    if (!latestFinalQuotationByBusiness.has(businessKey)) {
      latestFinalQuotationByBusiness.set(businessKey, quotation);
    }
  });
  const eligibleActivityIds = new Set(
    groupedAwardRows.flatMap((row) =>
      Array.isArray(row.grouped_activity_ids)
        ? row.grouped_activity_ids.map(Number)
        : [Number(row.activity_id)],
    ),
  );
  const awardDateByBusinessKey = new Map(
    groupedAwardRows.map((row) => [
      String(row.business_key ?? ""),
      String(row.activity_date ?? "").slice(0, 10),
    ]),
  );
  const awardsBase = groupedAwardRows.map((row: RawAccountingRow) => {
    const hasEntries = Number(row.entry_count ?? 0) > 0;
    const confirmed = String(row.award_stage ?? "") === "납품 완료";
    const consolidatedBudgets = new Map<
      string,
      { name: string; enteredAmount: number }
    >();
    activityBudgetsFromRecord(row).forEach((budget) => {
      const name = canonicalBudgetName(budget.budgetType) || "미분류";
      const existing = consolidatedBudgets.get(name) ?? {
        name,
        enteredAmount: 0,
      };
      existing.enteredAmount += parseBudgetMoney(budget.budgetAmount);
      consolidatedBudgets.set(name, existing);
    });
    const budgets = [...consolidatedBudgets.values()];
    return {
      activityId: Number(row.activity_id),
      businessKey: String(row.business_key ?? ""),
      businessRound: Number(row.business_round ?? 1),
      activityDate: String(row.activity_date || "").slice(0, 10),
      organization: String(row.organization ?? ""),
      region: String(row.region ?? ""),
      budgetType: canonicalBudgetName(row.budget_type) || "미분류",
      budgets: budgets.length
        ? budgets
        : [
            {
              name: canonicalBudgetName(row.budget_type) || "미분류",
              enteredAmount: 0,
            },
          ],
      executionType:
        String(row.execution_type ?? "") === "컨소" ? "컨소" : "직영",
      awardStage: String(row.award_stage ?? "미정"),
      progressManager: String(row.progress_manager ?? ""),
      summary: String(row.summary ?? ""),
      nextAction: String(row.next_action ?? ""),
      progressSchedule: String(row.progress_schedule ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      confirmed,
      confirmedAmount: 0,
      quoteStatus: "missing" as const,
      quoteItemCount: 0,
      quoteMissingAmountItemCount: 0,
      expectedCommission: 0,
      manufacturerCommissionReceived: confirmed
        ? Number(row.commission_collected_amount ?? 0)
        : 0,
      commissionReceivable: 0,
      consortiumPaymentPaid: confirmed
        ? Number(
            hasEntries
              ? row.consortium_paid_amount
              : row.legacy_consortium_paid_amount,
          )
        : 0,
      netRevenue: 0,
    };
  });
  let activeCatalog = PRODUCT_CATALOG;
  if (catalogSetting?.value) {
    try {
      const parsed = JSON.parse(catalogSetting.value) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (item): item is (typeof PRODUCT_CATALOG)[number] =>
            Boolean(
              item &&
                typeof item === "object" &&
                "id" in item &&
                "name" in item &&
                String(item.id).trim() &&
                String(item.name).trim(),
            ),
        );
        if (valid.length) activeCatalog = valid;
      }
    } catch {
      activeCatalog = PRODUCT_CATALOG;
    }
  }
  const activeCatalogById = new Map(
    activeCatalog.map((item) => [item.id, item]),
  );
  const eligibleBusinessKeys = new Set(
    awardsBase.map((award) => award.businessKey),
  );
  const products = productResult.results.flatMap((row: Record<string, unknown>) => {
    const businessKey = analyticsBusinessRoundKey(
      row.organization,
      row.business_round,
    );
    if (
      !eligibleBusinessKeys.has(businessKey) ||
      !eligibleActivityIds.has(Number(row.activity_id))
    ) {
      return [];
    }
    const quantity = Math.max(0, Number(row.awarded_qty ?? 0));
    const parsedUnitPrice = Number(row.catalog_unit_price ?? 0);
    const unitPrice = Number.isFinite(parsedUnitPrice) ? parsedUnitPrice : 0;
    const amountValue = quantity * unitPrice;
    const supplyType =
      String(row.supply_type ?? "") === "direct" ? "direct" : "partner";
    const finance = calculateEquipmentFinance({
      unitPrice,
      quantity,
      supplyType,
      commissionRate:
        supplyType === "partner" ? Number(row.commission_rate ?? 0) : null,
      marginRate:
        supplyType === "direct" ? Number(row.margin_rate ?? 0) : null,
      procurementFeeRate:
        row.procurement_fee_rate === null ||
        row.procurement_fee_rate === undefined
          ? null
          : Number(row.procurement_fee_rate),
      executionType:
        String(row.execution_type ?? "") === "컨소" ? "컨소" : "직영",
      commissionInputType:
        String(row.commission_input_type ?? "") === "amount"
          ? "amount"
          : "rate",
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
    const commission = finance.expectedPartnerCommission;
    const directMargin = finance.expectedDirectMargin;
    const directSalesCollection =
      supplyType === "direct" ? finance.quotationAmount : 0;
    const consortiumPayment = finance.consortiumPayment;
    const catalogItemId = String(row.catalog_item_id ?? "");
    const catalogProduct = activeCatalogById.get(catalogItemId);
    const unitPriceStatus = String(row.price_status ?? "");
    const quoteAmountRegistered = isRegisteredQuoteItemAmount({
      priceStatus: unitPriceStatus,
      unitPrice:
        row.catalog_unit_price === null ||
        row.catalog_unit_price === undefined
          ? null
          : unitPrice,
      proposedQty: Number(row.quote_proposed_qty ?? 0),
      awardedQty: Number(row.quote_awarded_qty ?? 0),
      installedQty: Number(row.quote_installed_qty ?? 0),
    });
    return [{
      activityId: Number(row.activity_id),
      businessKey,
      businessRound: Number(row.business_round ?? 1),
      activityDate:
        awardDateByBusinessKey.get(businessKey) ||
        String(row.activity_date ?? "").slice(0, 10),
      projectId: Number(row.project_id),
      itemId: Number(row.item_id),
      organization: String(row.organization ?? ""),
      projectName: String(row.project_name ?? ""),
      budgetGroupId: String(row.project_budget_group_id ?? ""),
      budgetName:
        canonicalBudgetName(row.project_budget_original_name) ||
        canonicalBudgetName(row.project_name) ||
        "예산 미지정",
      budgetOriginalName: String(row.project_budget_original_name ?? ""),
      budgetMatchStatus: String(row.project_budget_match_status ?? ""),
      productName: catalogProduct?.name ||
        String(row.product_name ?? "미등록 제품"),
      sourceProductName: String(row.product_name ?? "미등록 제품"),
      catalogItemId,
      isCatalogProduct: Boolean(catalogProduct),
      quantity,
      amount: amountValue,
      quotationAmount: finance.quotationAmount,
      quoteAmountRegistered,
      unitPrice,
      supplyType,
      priceStatus:
        unitPriceStatus ||
        (unitPrice > 0 ? "입력 완료" : "금액 미입력"),
      estimatedMargin: Math.max(
        0,
        commission + directMargin - consortiumPayment,
      ),
      estimatedCommission: commission,
      estimatedPartnerCommission: commission,
      estimatedDirectSalesCollection: directSalesCollection,
      estimatedDirectMargin: directMargin,
      estimatedRevenue: commission + directMargin,
      estimatedConsortiumPayment: consortiumPayment,
      supplierVendorId: row.supplier_vendor_id === null ||
        row.supplier_vendor_id === undefined
        ? null
        : Number(row.supplier_vendor_id),
      supplierVendorName: String(row.supplier_vendor_name ?? ""),
      progressManager: String(row.progress_manager ?? ""),
      createdByName: String(row.item_created_by_name ?? ""),
      updatedByName: String(row.item_updated_by_name ?? ""),
      updatedAt: String(row.item_updated_at ?? ""),
      commissionMissing:
        supplyType === "direct"
          ? row.margin_rate === null || row.margin_rate === undefined
          : row.commission_rate === null ||
            row.commission_rate === undefined,
    }];
  });
  const awardByBusinessKey = new Map(
    awardsBase.map((award) => [award.businessKey, award]),
  );
  const receipts = receiptResult.results.flatMap(
    (row: Record<string, unknown>) => {
      const businessKey = analyticsBusinessRoundKey(
        row.organization,
        row.business_round,
      );
      const award = awardByBusinessKey.get(businessKey);
      if (
        !award ||
        !eligibleActivityIds.has(Number(row.activity_id)) ||
        !eligibleActivityIds.has(Number(row.entry_activity_id))
      ) {
        return [];
      }
      return [{
        id: Number(row.receipt_id),
        activityId: award?.activityId ?? Number(row.activity_id),
        businessKey,
        businessRound: Number(row.business_round ?? 1),
        organization: award?.organization || String(row.organization ?? ""),
        region: award?.region || String(row.region ?? ""),
        budgetType:
          award?.budgetType ||
          canonicalBudgetName(row.budget_type) ||
          "미분류",
        collectionDate: String(row.collection_date ?? "").slice(0, 10),
        amount: Math.max(0, Number(row.amount ?? 0)),
        note: String(row.note ?? ""),
      }];
    },
  );
  const collectedByBusiness = new Map<string, number>();
  receipts.forEach((receipt) => {
    collectedByBusiness.set(
      receipt.businessKey,
      (collectedByBusiness.get(receipt.businessKey) ?? 0) + receipt.amount,
    );
  });
  const productTotalsByBusiness = new Map<
    string,
    {
      partnerCommission: number;
      directSalesCollection: number;
      directMargin: number;
      consortium: number;
      margin: number;
    }
  >();
  products.forEach(
    (product: {
      businessKey: string;
      estimatedPartnerCommission: number;
      estimatedDirectSalesCollection: number;
      estimatedDirectMargin: number;
      estimatedConsortiumPayment: number;
      estimatedMargin: number;
    }) => {
    const current = productTotalsByBusiness.get(product.businessKey) ?? {
      partnerCommission: 0,
      directSalesCollection: 0,
      directMargin: 0,
      consortium: 0,
      margin: 0,
    };
    current.partnerCommission += product.estimatedPartnerCommission;
    current.directSalesCollection += product.estimatedDirectSalesCollection;
    current.directMargin += product.estimatedDirectMargin;
    current.consortium += product.estimatedConsortiumPayment;
    current.margin += product.estimatedMargin;
    productTotalsByBusiness.set(product.businessKey, current);
    },
  );
  const constructionMarginByBusiness = new Map<string, number>();
  const constructionQuotesByBusiness = new Map<
    string,
    Array<{ quotationAmount: number; amountRegistered: boolean }>
  >();
  constructionResult.results.forEach((row: Record<string, unknown>) => {
    const businessKey = analyticsBusinessRoundKey(
      row.organization,
      row.business_round,
    );
    if (
      !eligibleBusinessKeys.has(businessKey) ||
      !eligibleActivityIds.has(Number(row.activity_id))
    ) {
      return;
    }
    const finance = calculateConstructionFinance({
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
    constructionMarginByBusiness.set(
      businessKey,
      (constructionMarginByBusiness.get(businessKey) ?? 0) +
        finance.constructionMargin,
    );
    const constructionQuotes =
      constructionQuotesByBusiness.get(businessKey) ?? [];
    constructionQuotes.push({
      quotationAmount: finance.constructionAmount,
      amountRegistered:
        row.construction_amount !== null &&
        row.construction_amount !== undefined,
    });
    constructionQuotesByBusiness.set(businessKey, constructionQuotes);
  });
  const itemQuotesByBusiness = new Map<
    string,
    Array<{ quotationAmount: number; amountRegistered: boolean }>
  >();
  products.forEach(
    (product: {
      businessKey: string;
      quotationAmount: number;
      quoteAmountRegistered: boolean;
    }) => {
      const itemQuotes = itemQuotesByBusiness.get(product.businessKey) ?? [];
      itemQuotes.push({
        quotationAmount: product.quotationAmount,
        amountRegistered: product.quoteAmountRegistered,
      });
      itemQuotesByBusiness.set(product.businessKey, itemQuotes);
    },
  );
  const awards = awardsBase.map((award) => {
    const finalQuotation = latestFinalQuotationByBusiness.get(
      award.businessKey,
    );
    const executionType =
      finalQuotation?.executionType === "컨소" || award.executionType === "컨소"
        ? "컨소" as const
        : "직영" as const;
    const registeredQuote = calculateRegisteredQuote({
      items: itemQuotesByBusiness.get(award.businessKey) ?? [],
      constructions:
        constructionQuotesByBusiness.get(award.businessKey) ?? [],
    });
    if (!award.confirmed) {
      return {
        ...award,
        executionType,
        confirmedAmount: 0,
        quoteStatus: finalQuotation ? "complete" as const : registeredQuote.quoteStatus,
        quoteItemCount: finalQuotation?.items.length ?? registeredQuote.quoteItemCount,
        quoteMissingAmountItemCount:
          finalQuotation ? 0 : registeredQuote.quoteMissingAmountItemCount,
      };
    }
    const source = productTotalsByBusiness.get(award.businessKey) ?? {
      partnerCommission: 0,
      directSalesCollection: 0,
      directMargin: 0,
      consortium: 0,
      margin: 0,
    };
    const expectedConstructionMargin =
      constructionMarginByBusiness.get(award.businessKey) ?? 0;
    const finalQuotationPartnerEarning = finalQuotation?.items
      .filter((item) => item.supplyType !== "direct")
      .reduce((sum, item) => sum + item.expectedEarning, 0);
    const finalQuotationDirectEarning = finalQuotation?.items
      .filter((item) => item.supplyType === "direct")
      .reduce((sum, item) => sum + item.expectedEarning, 0);
    const finalQuotationDirectSales = finalQuotation?.items
      .filter((item) => item.supplyType === "direct" && !item.complimentary)
      .reduce((sum, item) => sum + item.amount, 0);
    const projection = calculateAwardSettlementProjection({
      expectedPartnerCommission: source.partnerCommission,
      expectedDirectSalesCollection: source.directSalesCollection,
      expectedDirectMargin: source.directMargin,
      expectedConstructionMargin,
      expectedConsortiumSettlement: source.consortium,
    });
    const collectedAmount =
      collectedByBusiness.get(award.businessKey) ?? 0;
    return {
      ...award,
      executionType,
      confirmedAmount:
        finalQuotation
          ? finalQuotation.totalAmount
          : registeredQuote.quoteStatus === "complete"
          ? registeredQuote.contractAmount
          : 0,
      quoteStatus: finalQuotation ? "complete" as const : registeredQuote.quoteStatus,
      quoteItemCount: finalQuotation?.items.length ?? registeredQuote.quoteItemCount,
      quoteMissingAmountItemCount:
        finalQuotation ? 0 : registeredQuote.quoteMissingAmountItemCount,
      expectedCommission:
        finalQuotationPartnerEarning ?? source.partnerCommission,
      expectedPartnerCommission:
        finalQuotationPartnerEarning ?? source.partnerCommission,
      expectedDirectSalesCollection:
        finalQuotationDirectSales ?? source.directSalesCollection,
      expectedDirectMargin:
        finalQuotationDirectEarning ?? source.directMargin,
      expectedConstructionMargin,
      rawExpectedCollectionTotal: projection.rawExpectedCollectionTotal,
      expectedCollectionTotal: projection.expectedCollectionTotal,
      expectedSettlementDeficit: projection.expectedSettlementDeficit,
      expectedProfit: projection.expectedProfit,
      manufacturerCommissionReceived: collectedAmount,
      commissionReceivable: Math.max(
        0,
        projection.expectedCollectionTotal - collectedAmount,
      ),
      netRevenue: finalQuotation?.marginAmount ?? projection.expectedProfit,
    };
  });
  const unlinkedProjects = unlinkedProjectResult.results.filter(
    (row: Record<string, unknown>) =>
      eligibleBusinessKeys.has(
        analyticsBusinessRoundKey(row.organization, row.business_round),
      ),
  );
  const linked2025Projects = linked2025ProjectResult.results.filter(
    (row: Record<string, unknown>) =>
      eligibleBusinessKeys.has(
        analyticsBusinessRoundKey(row.organization, row.business_round),
      ),
  );
  return {
    awards,
    receipts,
    products,
    dataQuality: {
      unconfirmedAwards: awards.filter(
        (award) =>
          award.confirmed && award.manufacturerCommissionReceived <= 0,
      ).length,
      unlinkedProductProjects: unlinkedProjects.length,
      missingCommissionItems: products.filter(
        (product: { commissionMissing: boolean }) =>
          product.commissionMissing,
      ).length,
      linked2025Projects: linked2025Projects.length,
    },
    qualityDetails: {
      unlinkedProjects: unlinkedProjects.slice(0, 200).map(
        (row: Record<string, unknown>) => ({
        projectId: Number(row.project_id),
        organization: String(row.organization ?? ""),
        projectName: String(row.project_name ?? ""),
        status: String(row.status ?? ""),
        activityDate: "",
        awardedQuantity: Number(row.awarded_quantity ?? 0),
        }),
      ),
      linked2025Projects: linked2025Projects.slice(0, 200).map(
        (row: Record<string, unknown>) => ({
        projectId: Number(row.project_id),
        organization: String(row.organization ?? ""),
        projectName: String(row.project_name ?? ""),
        status: String(row.status ?? ""),
        activityDate: String(row.activity_date ?? "").slice(0, 10),
        awardedQuantity: 0,
        }),
      ),
    },
  };
}

async function analyticsResponse() {
  await requireMemberPermission("analytics:view");
  return Response.json(await buildAnalyticsPayload());
}

async function ownerPerformanceResponse() {
  await requirePrimaryOwner();
  return Response.json(await buildAnalyticsPayload());
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("mode") === "analytics") return analyticsResponse();
    if (params.get("mode") === "owner-performance") {
      return ownerPerformanceResponse();
    }
    const member = await requireApprovedMember();
    const d1 = await ensureAccountingReady();
    await ensureAuthoredQuotationsReady();
    const historyActivityId = Number(params.get("historyActivityId"));
    if (Number.isInteger(historyActivityId) && historyActivityId > 0) {
      await requireMemberPermission("accounting:manage");
      const result = await d1
        .prepare(`
          SELECT id, snapshot_json, changed_fields_json, changed_by_name, created_at
          FROM accounting_settlement_history
          WHERE activity_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 100
        `)
        .bind(historyActivityId)
        .all<Record<string, unknown>>();
      return Response.json({
        history: result.results.map((row: Record<string, unknown>) => ({
          id: Number(row.id),
          snapshot: JSON.parse(String(row.snapshot_json ?? "{}")),
          changedFields: JSON.parse(String(row.changed_fields_json ?? "[]")),
          changedByName: String(row.changed_by_name ?? ""),
          createdAt: String(row.created_at ?? ""),
        })),
      });
    }

    const canSeeAll =
      hasMemberPermission(member, "accounting:manage") ||
      hasMemberPermission(member, "analytics:view");
    if (params.get("scope") !== "visible" && !hasMemberPermission(member, "accounting:manage")) {
      return Response.json({ error: "수금·채권 관리 권한이 필요합니다." }, { status: 403 });
    }
    const [result, quotationResult] = await Promise.all([
      d1.prepare(
        `${awardAccountingQuery} ORDER BY a.activity_date DESC, a.id DESC`,
      ).all<RawAccountingRow>(),
      d1.prepare(`
        SELECT * FROM authored_quotations
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
    const latestRows = completedWhizzupAwardRows(result.results);
    return Response.json({
      rows: latestRows
        .filter(
          (row) =>
            canSeeAll ||
            String(row.progress_manager ?? "") === member.displayName,
        )
        .map((row) => mapAccountingRow(
          row,
          latestQuotationByBusiness.get(
            analyticsBusinessRoundKey(row.organization, row.business_round),
          ),
        )),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT() {
  return Response.json(
    {
      error:
        "구형 회계 정산 저장 기능은 종료되었습니다. 실제 수금은 신규 수금 원장에서 등록해 주세요.",
    },
    {
      status: 405,
      headers: { Allow: "GET" },
    },
  );
}
