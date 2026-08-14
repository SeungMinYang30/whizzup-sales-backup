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
import {
  isPartnerOnlyProduct,
  normalizeProductSupplyType,
} from "../../../lib/product-supply-classification";

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
      finalQuotation?.executionType === "ì»¨ì†Œ" ||
      String(row.execution_type ?? "") === "ì»¨ì†Œ"
        ? "ì»¨ì†Œ"
        : "ì§ì˜",
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
    invoiceStatus: String(row.invoice_status ?? "ë¯¸ë°œí–‰"),
    invoiceDate: String(row.invoice_date ?? ""),
    settlementStatus: String(row.settlement_status ?? "í™•ì¸ í•„ìš”"),
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
            'ë¬´ìƒ ì œê³µ',
            'ê³„ì•½ê¸ˆì•¡ì— í¬í•¨',
            'ì„œë¹„ìŠ¤ í’ˆëª©'
          ) THEN 0
          WHEN ei.price_status = 'ê¸ˆì•¡ ë¯¸ìž…ë ¥'
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
            'ë¬´ìƒ ì œê³µ',
            'ê³„ì•½ê¸ˆì•¡ì— í¬í•¨',
            'ì„œë¹„ìŠ¤ í’ˆëª©'
          ) THEN 0
          WHEN ei.price_status = 'ê¸ˆì•¡ ë¯¸ìž…ë ¥'
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
          WHEN ei.execution_type <> 'ì»¨ì†Œ' THEN 0
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
  WHERE a.award_status IN ('ìœ„ì¦ˆì—… ìˆ˜ì£¼', 'í˜‘ë ¥ì‚¬ ìˆ˜ì£¼', 'íƒ€ì—…ì²´ ìˆ˜ì£¼')`;

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
             AND receipt_activity.award_status = 'ìœ„ì¦ˆì—… ìˆ˜ì£¼'
         )
        WHERE e.manufacturer_key = 'award-total'
          AND entry_activity.award_status = 'ìœ„ì¦ˆì—… ìˆ˜ì£¼'
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
      WHERE a.award_status IN ('ìœ„ì¦ˆì—… ìˆ˜ì£¼', 'í˜‘ë ¥ì‚¬ ìˆ˜ì£¼', 'íƒ€ì—…ì²´ ìˆ˜ì£¼')
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
      JOIN activities entry_activity ON entry_activity.id =ã¿}¶‰žËkºwµçq•Í½±±•Ñ¥½¸°4(€€€€€•ÍÑ¥µ…Ñ•‘¥É•Ñ5…É¥¸è‘¥É•Ñ5…É¥¸°4(€€€€€•ÍÑ¥µ…Ñ•‘I•Ù•¹Õ”è½µµ¥ÍÍ¥½¸€¬‘¥É•Ñ5…É¥¸°4(€€€€€•ÍÑ¥µ…Ñ•‘½¹Í½ÉÑ¥ÕµA…åµ•¹Ðè½¹Í½ÉÑ¥ÕµA…åµ•¹Ð°4(€€€€€ÍÕÁÁ±¥•ÉY•¹‘½É%èÉ½Ü¹ÍÕÁÁ±¥•É}Ù•¹‘½É}¥€ôôô¹Õ±°ñð4(€€€€€€€É½Ü¹ÍÕÁÁ±¥•É}Ù•¹‘½É}¥€ôôôÕ¹‘•™¥¹•4(€€€€€€€€ü¹Õ±°4(€€€€€€€€è9Õµ‰•È¡É½Ü¹ÍÕÁÁ±¥•É}Ù•¹‘½É}¥¤°4(€€€€€ÍÕÁÁ±¥•ÉY•¹‘½É9…µ”èMÑÉ¥¹œ¡É½Ü¹ÍÕÁÁ±¥•É}Ù•¹‘½É}¹…µ”€üü€ˆˆ¤°4(€€€€€ÁÉ½É•ÍÍ5…¹…•ÈèMÑÉ¥¹œ¡É½Ü¹ÁÉ½É•ÍÍ}µ…¹…•È€üü€ˆˆ¤°4(€€€€€É•…Ñ•‘	å9…µ”èMÑÉ¥¹œ¡É½Ü¹¥Ñ•µ}É•…Ñ•‘}‰å}¹…µ”€üü€ˆˆ¤°4(€€€€€ÕÁ‘…Ñ•‘	å9…µ”èMÑÉ¥¹œ¡É½Ü¹¥Ñ•µ}ÕÁ‘…Ñ•‘}‰å}¹…µ”€üü€ˆˆ¤°4(€€€€€ÕÁ‘…Ñ•‘ÐèMÑÉ¥¹œ¡É½Ü¹¥Ñ•µ}ÕÁ‘…Ñ•‘}…Ð€üü€ˆˆ¤°4(€€€€€½µµ¥ÍÍ¥½¹5¥ÍÍ¥¹œè4(€€€€€€€ÍÕÁÁ±åQåÁ”€ôôô€‰‘¥É•Ðˆ4(€€€€€€€€€€üÉ½Ü¹µ…É¥¹}É…Ñ”€ôôô¹Õ±°ñðÉ½Ü¹µ…É¥¹}É…Ñ”€ôôôÕ¹‘•™¥¹•4(€€€€€€€€€€èÉ½Ü¹½µµ¥ÍÍ¥½¹}É…Ñ”€ôôô¹Õ±°ñð4(€€€€€€€€€€€É½Ü¹½µµ¥ÍÍ¥½¹}É…Ñ”€ôôôÕ¹‘•™¥¹•°4(€€€õtì4(€ô¤ì4(€½¹ÍÐ…Ý…É‘	å	ÕÍ¥¹•ÍÍ-•ä€ô¹•Ü5…À 4(€€€…Ý…É‘Í	…Í”¹µ…À ¡…Ý…É¤€ôøm…Ý…É¹‰ÕÍ¥¹•ÍÍ-•ä°…Ý…É‘t¤°4(€€¤ì4(€½¹ÍÐÉ••¥ÁÑÌ€ôÉ••¥ÁÑI•ÍÕ±Ð¹É•ÍÕ±ÑÌ¹™±…Ñ5…À 4(€€€€¡É½ÜèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤€ôøì4(€€€€€½¹ÍÐ‰ÕÍ¥¹•ÍÍ-•ä€ô…¹…±åÑ¥Í	ÕÍ¥¹•ÍÍI½Õ¹‘-•ä 4(€€€€€€€É½Ü¹½É…¹¥é…Ñ¥½¸°4(€€€€€€€É½Ü¹‰ÕÍ¥¹•ÍÍ}É½Õ¹°4(€€€€€€¤ì4(€€€€€½¹ÍÐ…Ý…É€ô…Ý…É‘	å	ÕÍ¥¹•ÍÍ-•ä¹•Ð¡‰ÕÍ¥¹•ÍÍ-•ä¤ì4(€€€€€¥˜€ 4(€€€€€€€€……Ý…Éñð4(€€€€€€€€…•±¥¥‰±•Ñ¥Ù¥Ñå%‘Ì¹¡…Ì¡9Õµ‰•È¡É½Ü¹…Ñ¥Ù¥Ñå}¥¤¤ñð4(€€€€€€€€…•±¥¥‰±•Ñ¥Ù¥Ñå%‘Ì¹¡…Ì¡9Õµ‰•È¡É½Ü¹•¹ÑÉå}…Ñ¥Ù¥Ñå}¥¤¤4(€€€€€€¤ì4(€€€€€€€É•ÑÕÉ¸mtì4(€€€€€ô4(€€€€€É•ÑÕÉ¸mì4(€€€€€€€¥è9Õµ‰•È¡É½Ü¹É••¥ÁÑ}¥¤°4(€€€€€€€…Ñ¥Ù¥Ñå%è…Ý…Éü¹…Ñ¥Ù¥Ñå%€üü9Õµ‰•È¡É½Ü¹…Ñ¥Ù¥Ñå}¥¤°4(€€€€€€€‰ÕÍ¥¹•ÍÍ-•ä°4(€€€€€€€‰ÕÍ¥¹•ÍÍI½Õ¹è9Õµ‰•È¡É½Ü¹‰ÕÍ¥¹•ÍÍ}É½Õ¹€üü€Ä¤°4(€€€€€€€½É…¹¥é…Ñ¥½¸è…Ý…Éü¹½É…¹¥é…Ñ¥½¸ñðMÑÉ¥¹œ¡É½Ü¹½É…¹¥é…Ñ¥½¸€üü€ˆˆ¤°4(€€€€€€€É•¥½¸è…Ý…Éü¹É•¥½¸ñðMÑÉ¥¹œ¡É½Ü¹É•¥½¸€üü€ˆˆ¤°4(€€€€€€€‰Õ‘•ÑQåÁ”è4(€€€€€€€€€…Ý…Éü¹‰Õ‘•ÑQåÁ”ñð4(€€€€€€€€€…¹½¹¥…±	Õ‘•Ñ9…µ”¡É½Ü¹‰Õ‘•Ñ}ÑåÁ”¤ñð4(€€€€€€€€€€‹®¾ã®Ú®–`ˆ°4(€€€€€€€½±±•Ñ¥½¹…Ñ”èMÑÉ¥¹œ¡É½Ü¹½±±•Ñ¥½¹}‘…Ñ”€üü€ˆˆ¤¹Í±¥” À°€ÄÀ¤°4(€€€€€€€…µ½Õ¹Ðè5…Ñ ¹µ…à À°9Õµ‰•È¡É½Ü¹…µ½Õ¹Ð€üü€À¤¤°4(€€€€€€€¹½Ñ”èMÑÉ¥¹œ¡É½Ü¹¹½Ñ”€üü€ˆˆ¤°4(€€€€€õtì4(€€€ô°4(€€¤ì4(€½¹ÍÐ½±±•Ñ•‘	å	ÕÍ¥¹•ÍÌ€ô¹•Ü5…ÀñÍÑÉ¥¹œ°¹Õµ‰•Èø ¤ì4(€É••¥ÁÑÌ¹™½É…  ¡É••¥ÁÐ¤€ôøì4(€€€½±±•Ñ•‘	å	ÕÍ¥¹•ÍÌ¹Í•Ð 4(€€€€€É••¥ÁÐ¹‰ÕÍ¥¹•ÍÍ-•ä°4(€€€€€€¡½±±•Ñ•‘	å	ÕÍ¥¹•ÍÌ¹•Ð¡É••¥ÁÐ¹‰ÕÍ¥¹•ÍÍ-•ä¤€üü€À¤€¬É••¥ÁÐ¹…µ½Õ¹Ð°4(€€€€¤ì4(€ô¤ì4(€½¹ÍÐÁÉ½‘ÕÑQ½Ñ…±Í	å	ÕÍ¥¹•ÍÌ€ô¹•Ü5…Àð4(€€€ÍÑÉ¥¹œ°4(€€€ì4(€€€€€Á…ÉÑ¹•É½µµ¥ÍÍ¥½¸è¹Õµ‰•Èì4(€€€€€‘¥É•ÑM…±•Í½±±•Ñ¥½¸è¹Õµ‰•Èì4(€€€€€‘¥É•Ñ5…É¥¸è¹Õµ‰•Èì4(€€€€€½¹Í½ÉÑ¥Õ´è¹Õµ‰•Èì4(€€€€€µ…É¥¸è¹Õµ‰•Èì4(€€€ô4(€€ø ¤ì4(€ÁÉ½‘ÕÑÌ¹™½É…  4(€€€€¡ÁÉ½‘ÕÐèì4(€€€€€‰ÕÍ¥¹•ÍÍ-•äèÍÑÉ¥¹œì4(€€€€€•ÍÑ¥µ…Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸è¹Õµ‰•Èì4(€€€€€•ÍÑ¥µ…Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸è¹Õµ‰•Èì4(€€€€€•ÍÑ¥µ…Ñ•‘¥É•Ñ5…É¥¸è¹Õµ‰•Èì4(€€€€€•ÍÑ¥µ…Ñ•‘½¹Í½ÉÑ¥ÕµA…åµ•¹Ðè¹Õµ‰•Èì4(€€€€€•ÍÑ¥µ…Ñ•‘5…É¥¸è¹Õµ‰•Èì4(€€€ô¤€ôøì4(€€€½¹ÍÐÕÉÉ•¹Ð€ôÁÉ½‘ÕÑQ½Ñ…±Í	å	ÕÍ¥¹•ÍÌ¹•Ð¡ÁÉ½‘ÕÐ¹‰ÕÍ¥¹•ÍÍ-•ä¤€üüì4(€€€€€Á…ÉÑ¹•É½µµ¥ÍÍ¥½¸è€À°4(€€€€€‘¥É•ÑM…±•Í½±±•Ñ¥½¸è€À°4(€€€€€‘¥É•Ñ5…É¥¸è€À°4(€€€€€½¹Í½ÉÑ¥Õ´è€À°4(€€€€€µ…É¥¸è€À°4(€€€ôì4(€€€ÕÉÉ•¹Ð¹Á…ÉÑ¹•É½µµ¥ÍÍ¥½¸€¬ôÁÉ½‘ÕÐ¹•ÍÑ¥µ…Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸ì4(€€€ÕÉÉ•¹Ð¹‘¥É•ÑM…±•Í½±±•Ñ¥½¸€¬ôÁÉ½‘ÕÐ¹•ÍÑ¥µ…Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸ì4(€€€ÕÉÉ•¹Ð¹‘¥É•Ñ5…É¥¸€¬ôÁÉ½‘ÕÐ¹•ÍÑ¥µ…Ñ•‘¥É•Ñ5…É¥¸ì4(€€€ÕÉÉ•¹Ð¹½¹Í½ÉÑ¥Õ´€¬ôÁÉ½‘ÕÐ¹•ÍÑ¥µ…Ñ•‘½¹Í½ÉÑ¥ÕµA…åµ•¹Ðì4(€€€ÕÉÉ•¹Ð¹µ…É¥¸€¬ôÁÉ½‘ÕÐ¹•ÍÑ¥µ…Ñ•‘5…É¥¸ì4(€€€ÁÉ½‘ÕÑQ½Ñ…±Í	å	ÕÍ¥¹•ÍÌ¹Í•Ð¡ÁÉ½‘ÕÐ¹‰ÕÍ¥¹•ÍÍ-•ä°ÕÉÉ•¹Ð¤ì4(€€€ô°4(€€¤ì4(€½¹ÍÐ½¹ÍÑÉÕÑ¥½¹5…É¥¹	å	ÕÍ¥¹•ÍÌ€ô¹•Ü5…ÀñÍÑÉ¥¹œ°¹Õµ‰•Èø ¤ì4(€½¹ÍÐ½¹ÍÑÉÕÑ¥½¹EÕ½Ñ•Í	å	ÕÍ¥¹•ÍÌ€ô¹•Ü5…Àð4(€€€ÍÑÉ¥¹œ°4(€€€ÉÉ…äñìÅÕ½Ñ…Ñ¥½¹µ½Õ¹Ðè¹Õµ‰•Èì…µ½Õ¹ÑI•¥ÍÑ•É•è‰½½±•…¸ôø4(€€ø ¤ì4(€½¹ÍÑÉÕÑ¥½¹I•ÍÕ±Ð¹É•ÍÕ±ÑÌ¹™½É…  ¡É½ÜèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤€ôøì4(€€€½¹ÍÐ‰ÕÍ¥¹•ÍÍ-•ä€ô…¹…±åÑ¥Í	ÕÍ¥¹•ÍÍI½Õ¹‘-•ä 4(€€€€€É½Ü¹½É…¹¥é…Ñ¥½¸°4(€€€€€É½Ü¹‰ÕÍ¥¹•ÍÍ}É½Õ¹°4(€€€€¤ì4(€€€¥˜€ 4(€€€€€€…•±¥¥‰±•	ÕÍ¥¹•ÍÍ-•åÌ¹¡…Ì¡‰ÕÍ¥¹•ÍÍ-•ä¤ñð4(€€€€€€…•±¥¥‰±•Ñ¥Ù¥Ñå%‘Ì¹¡…Ì¡9Õµ‰•È¡É½Ü¹…Ñ¥Ù¥Ñå}¥¤¤4(€€€€¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€½¹ÍÐ™¥¹…¹”€ô…±Õ±…Ñ•½¹ÍÑÉÕÑ¥½¹¥¹…¹”¡ì4(€€€€€½¹ÍÑÉÕÑ¥½¹µ½Õ¹Ðè4(€€€€€€€É½Ü¹½¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð€ôôô¹Õ±°ñð4(€€€€€€€É½Ü¹½¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð€ôôôÕ¹‘•™¥¹•4(€€€€€€€€€€ü¹Õ±°4(€€€€€€€€€€è9Õµ‰•È¡É½Ü¹½¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð¤°4(€€€€€…ÑÕ…±½¹ÍÑÉÕÑ¥½¹½ÍÐè4(€€€€€€€É½Ü¹…ÑÕ…±}½¹ÍÑÉÕÑ¥½¹}½ÍÐ€ôôô¹Õ±°ñð4(€€€€€€€É½Ü¹…ÑÕ…±}½¹ÍÑÉÕÑ¥½¹}½ÍÐ€ôôôÕ¹‘•™¥¹•4(€€€€€€€€€€ü¹Õ±°4(€€€€€€€€€€è9Õµ‰•È¡É½Ü¹…ÑÕ…±}½¹ÍÑÉÕÑ¥½¹}½ÍÐ¤°4(€€€ô¤ì4(€€€½¹ÍÑÉÕÑ¥½¹5…É¥¹	å	ÕÍ¥¹•ÍÌ¹Í•Ð 4(€€€€€‰ÕÍ¥¹•ÍÍ-•ä°4(€€€€€€¡½¹ÍÑÉÕÑ¥½¹5…É¥¹	å	ÕÍ¥¹•ÍÌ¹•Ð¡‰ÕÍ¥¹•ÍÍ-•ä¤€üü€À¤€¬4(€€€€€€€™¥¹…¹”¹½¹ÍÑÉÕÑ¥½¹5…É¥¸°4(€€€€¤ì4(€€€½¹ÍÐ½¹ÍÑÉÕÑ¥½¹EÕ½Ñ•Ì€ô4(€€€€€½¹ÍÑÉÕÑ¥½¹EÕ½Ñ•Í	å	ÕÍ¥¹•ÍÌ¹•Ð¡‰ÕÍ¥¹•ÍÍ-•ä¤€üümtì4(€€€½¹ÍÑÉÕÑ¥½¹EÕ½Ñ•Ì¹ÁÕÍ ¡ì4(€€€€€ÅÕ½Ñ…Ñ¥½¹µ½Õ¹Ðè™¥¹…¹”¹½¹ÍÑÉÕÑ¥½¹µ½Õ¹Ð°4(€€€€€…µ½Õ¹ÑI•¥ÍÑ•É•è4(€€€€€€€É½Ü¹½¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð€„ôô¹Õ±°€˜˜4(€€€€€€€É½Ü¹½¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð€„ôôÕ¹‘•™¥¹•°4(€€€ô¤ì4(€€€½¹ÍÑÉÕÑ¥½¹EÕ½Ñ•Í	å	ÕÍ¥¹•ÍÌ¹Í•Ð¡‰ÕÍ¥¹•ÍÍ-•ä°½¹ÍÑÉÕÑ¥½¹EÕ½Ñ•Ì¤ì4(€ô¤ì4(€½¹ÍÐ¥Ñ•µEÕ½Ñ•Í	å	ÕÍ¥¹•ÍÌ€ô¹•Ü5…Àð4(€€€ÍÑÉ¥¹œ°4(€€€ÉÉ…äñìÅÕ½Ñ…Ñ¥½¹µ½Õ¹Ðè¹Õµ‰•Èì…µ½Õ¹ÑI•¥ÍÑ•É•è‰½½±•…¸ôø4(€€ø ¤ì4(€ÁÉ½‘ÕÑÌ¹™½É…  4(€€€€¡ÁÉ½‘ÕÐèì4(€€€€€‰ÕÍ¥¹•ÍÍ-•äèÍÑÉ¥¹œì4(€€€€€ÅÕ½Ñ…Ñ¥½¹µ½Õ¹Ðè¹Õµ‰•Èì4(€€€€€ÅÕ½Ñ•µ½Õ¹ÑI•¥ÍÑ•É•è‰½½±•…¸ì4(€€€ô¤€ôøì4(€€€€€½¹ÍÐ¥Ñ•µEÕ½Ñ•Ì€ô¥Ñ•µEÕ½Ñ•Í	å	ÕÍ¥¹•ÍÌ¹•Ð¡ÁÉ½‘ÕÐ¹‰ÕÍ¥¹•ÍÍ-•ä¤€üümtì4(€€€€€¥Ñ•µEÕ½Ñ•Ì¹ÁÕÍ ¡ì4(€€€€€€€ÅÕ½Ñ…Ñ¥½¹µ½Õ¹ÐèÁÉ½‘ÕÐ¹ÅÕ½Ñ…Ñ¥½¹µ½Õ¹Ð°4(€€€€€€€…µ½Õ¹ÑI•¥ÍÑ•É•èÁÉ½‘ÕÐ¹ÅÕ½Ñ•µ½Õ¹ÑI•¥ÍÑ•É•°4(€€€€€ô¤ì4(€€€€€¥Ñ•µEÕ½Ñ•Í	å	ÕÍ¥¹•ÍÌ¹Í•Ð¡ÁÉ½‘ÕÐ¹‰ÕÍ¥¹•ÍÍ-•ä°¥Ñ•µEÕ½Ñ•Ì¤ì4(€€€ô°4(€€¤ì4(€½¹ÍÐ…Ý…É‘Ì€ô…Ý…É‘Í	…Í”¹µ…À ¡…Ý…É¤€ôøì4(€€€½¹ÍÐ™¥¹…±EÕ½Ñ…Ñ¥½¸€ô±…Ñ•ÍÑ¥¹…±EÕ½Ñ…Ñ¥½¹	å	ÕÍ¥¹•ÍÌ¹•Ð 4(€€€€€…Ý…É¹‰ÕÍ¥¹•ÍÍ-•ä°4(€€€€¤ì4(€€€½¹ÍÐ•á•ÕÑ¥½¹QåÁ”€ô4(€€€€€™¥¹…±EÕ½Ñ…Ñ¥½¸ü¹•á•ÕÑ¥½¹QåÁ”€ôôô€‹²î£²0ˆñð…Ý…É¹•á•ÕÑ¥½¹QåÁ”€ôôô€‹²î£²0ˆ4(€€€€€€€€ü€‹²î£²0ˆ…Ì½¹ÍÐ4(€€€€€€€€è€‹²ž²bˆ…Ì½¹ÍÐì4(€€€½¹ÍÐÉ•¥ÍÑ•É•‘EÕ½Ñ”€ô…±Õ±…Ñ•I•¥ÍÑ•É•‘EÕ½Ñ”¡ì4(€€€€€¥Ñ•µÌè¥Ñ•µEÕ½Ñ•Í	å	ÕÍ¥¹•ÍÌ¹•Ð¡…Ý…É¹‰ÕÍ¥¹•ÍÍ-•ä¤€üümt°4(€€€€€½¹ÍÑÉÕÑ¥½¹Ìè4(€€€€€€€½¹ÍÑÉÕÑ¥½¹EÕ½Ñ•Í	å	ÕÍ¥¹•ÍÌ¹•Ð¡…Ý…É¹‰ÕÍ¥¹•ÍÍ-•ä¤€üümt°4(€€€ô¤ì4(€€€¥˜€ ……Ý…É¹½¹™¥Éµ•¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€€€€€€¸¸¹…Ý…É°4(€€€€€€€•á•ÕÑ¥½¹QåÁ”°4(€€€€€€€½¹™¥Éµ•‘µ½Õ¹Ðè€À°4(€€€€€€€ÅÕ½Ñ•MÑ…ÑÕÌè™¥¹…±EÕ½Ñ…Ñ¥½¸€ü€‰½µÁ±•Ñ”ˆ…Ì½¹ÍÐ€èÉ•¥ÍÑ•É•‘EÕ½Ñ”¹ÅÕ½Ñ•MÑ…ÑÕÌ°4(€€€€€€€ÅÕ½Ñ•%Ñ•µ½Õ¹Ðè™¥¹…±EÕ½Ñ…Ñ¥½¸ü¹¥Ñ•µÌ¹±•¹Ñ €üüÉ•¥ÍÑ•É•‘EÕ½Ñ”¹ÅÕ½Ñ•%Ñ•µ½Õ¹Ð°4(€€€€€€€ÅÕ½Ñ•5¥ÍÍ¥¹µ½Õ¹Ñ%Ñ•µ½Õ¹Ðè4(€€€€€€€€€™¥¹…±EÕ½Ñ…Ñ¥½¸€ü€À€èÉ•¥ÍÑ•É•‘EÕ½Ñ”¹ÅÕ½Ñ•5¥ÍÍ¥¹µ½Õ¹Ñ%Ñ•µ½Õ¹Ð°4(€€€€€ôì4(€€€ô4(€€€½¹ÍÐÍ½ÕÉ”€ôÁÉ½‘ÕÑQ½Ñ…±Í	å	ÕÍ¥¹•ÍÌ¹•Ð¡…Ý…É¹‰ÕÍ¥¹•ÍÍ-•ä¤€üüì4(€€€€€Á…ÉÑ¹•É½µµ¥ÍÍ¥½¸è€À°4(€€€€€‘¥É•ÑM…±•Í½±±•Ñ¥½¸è€À°4(€€€€€‘¥É•Ñ5…É¥¸è€À°4(€€€€€½¹Í½ÉÑ¥Õ´è€À°4(€€€€€µ…É¥¸è€À°4(€€€ôì4(€€€½¹ÍÐ•áÁ•Ñ•‘½¹ÍÑÉÕÑ¥½¹5…É¥¸€ô4(€€€€€½¹ÍÑÉÕÑ¥½¹5…É¥¹	å	ÕÍ¥¹•ÍÌ¹•Ð¡…Ý…É¹‰ÕÍ¥¹•ÍÍ-•ä¤€üü€Àì4(€€€½¹ÍÐ™¥¹…±EÕ½Ñ…Ñ¥½¹A…ÉÑ¹•É…É¹¥¹œ€ô™¥¹…±EÕ½Ñ…Ñ¥½¸ü¹¥Ñ•µÌ4(€€€€€€¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÕÁÁ±åQåÁ”€„ôô€‰‘¥É•Ðˆ¤4(€€€€€€¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬¥Ñ•´¹•áÁ•Ñ•‘…É¹¥¹œ°€À¤ì4(€€€½¹ÍÐ™¥¹…±EÕ½Ñ…Ñ¥½¹¥É•Ñ…É¹¥¹œ€ô™¥¹…±EÕ½Ñ…Ñ¥½¸ü¹¥Ñ•µÌ4(€€€€€€¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÕÁÁ±åQåÁ”€ôôô€‰‘¥É•Ðˆ¤4(€€€€€€¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬¥Ñ•´¹•áÁ•Ñ•‘…É¹¥¹œ°€À¤ì4(€€€½¹ÍÐ™¥¹…±EÕ½Ñ…Ñ¥½¹¥É•ÑM…±•Ì€ô™¥¹…±EÕ½Ñ…Ñ¥½¸ü¹¥Ñ•µÌ4(€€€€€€¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹ÍÕÁÁ±åQåÁ”€ôôô€‰‘¥É•Ðˆ€˜˜€…¥Ñ•´¹½µÁ±¥µ•¹Ñ…Éä¤4(€€€€€€¹É•‘Õ” ¡ÍÕ´°¥Ñ•´¤€ôøÍÕ´€¬¥Ñ•´¹…µ½Õ¹Ð°€À¤ì4(€€€½¹ÍÐÁÉ½©•Ñ¥½¸€ô…±Õ±…Ñ•Ý…É‘M•ÑÑ±•µ•¹ÑAÉ½©•Ñ¥½¸¡ì4(€€€€€•áÁ•Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸èÍ½ÕÉ”¹Á…ÉÑ¹•É½µµ¥ÍÍ¥½¸°4(€€€€€•áÁ•Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸èÍ½ÕÉ”¹‘¥É•ÑM…±•Í½±±•Ñ¥½¸°4(€€€€€•áÁ•Ñ•‘¥É•Ñ5…É¥¸èÍ½ÕÉ”¹‘¥É•Ñ5…É¥¸°4(€€€€€•áÁ•Ñ•‘½¹ÍÑÉÕÑ¥½¹5…É¥¸°4(€€€€€•áÁ•Ñ•‘½¹Í½ÉÑ¥ÕµM•ÑÑ±•µ•¹ÐèÍ½ÕÉ”¹½¹Í½ÉÑ¥Õ´°4(€€€ô¤ì4(€€€½¹ÍÐ½±±•Ñ•‘µ½Õ¹Ð€ô4(€€€€€½±±•Ñ•‘	å	ÕÍ¥¹•ÍÌ¹•Ð¡…Ý…É¹‰ÕÍ¥¹•ÍÍ-•ä¤€üü€Àì4(€€€É•ÑÕÉ¸ì4(€€€€€€¸¸¹…Ý…É°4(€€€€€•á•ÕÑ¥½¹QåÁ”°4(€€€€€½¹™¥Éµ•‘µ½Õ¹Ðè4(€€€€€€€™¥¹…±EÕ½Ñ…Ñ¥½¸4(€€€€€€€€€€ü™¥¹…±EÕ½Ñ…Ñ¥½¸¹Ñ½Ñ…±µ½Õ¹Ð4(€€€€€€€€€€èÉ•¥ÍÑ•É•‘EÕ½Ñ”¹ÅÕ½Ñ•MÑ…ÑÕÌ€ôôô€‰½µÁ±•Ñ”ˆ4(€€€€€€€€€€üÉ•¥ÍÑ•É•‘EÕ½Ñ”¹½¹ÑÉ…Ñµ½Õ¹Ð4(€€€€€€€€€€è€À°4(€€€€€ÅÕ½Ñ•MÑ…ÑÕÌè™¥¹…±EÕ½Ñ…Ñ¥½¸€ü€‰½µÁ±•Ñ”ˆ…Ì½¹ÍÐ€èÉ•¥ÍÑ•É•‘EÕ½Ñ”¹ÅÕ½Ñ•MÑ…ÑÕÌ°4(€€€€€ÅÕ½Ñ•%Ñ•µ½Õ¹Ðè™¥¹…±EÕ½Ñ…Ñ¥½¸ü¹¥Ñ•µÌ¹±•¹Ñ €üüÉ•¥ÍÑ•É•‘EÕ½Ñ”¹ÅÕ½Ñ•%Ñ•µ½Õ¹Ð°4(€€€€€ÅÕ½Ñ•5¥ÍÍ¥¹µ½Õ¹Ñ%Ñ•µ½Õ¹Ðè4(€€€€€€€™¥¹…±EÕ½Ñ…Ñ¥½¸€ü€À€èÉ•¥ÍÑ•É•‘EÕ½Ñ”¹ÅÕ½Ñ•5¥ÍÍ¥¹µ½Õ¹Ñ%Ñ•µ½Õ¹Ð°4(€€€€€•áÁ•Ñ•‘½µµ¥ÍÍ¥½¸è4(€€€€€€€™¥¹…±EÕ½Ñ…Ñ¥½¹A…ÉÑ¹•É…É¹¥¹œ€üüÍ½ÕÉ”¹Á…ÉÑ¹•É½µµ¥ÍÍ¥½¸°4(€€€€€•áÁ•Ñ•‘A…ÉÑ¹•É½µµ¥ÍÍ¥½¸è4(€€€€€€€™¥¹…±EÕ½Ñ…Ñ¥½¹A…ÉÑ¹•É…É¹¥¹œ€üüÍ½ÕÉ”¹Á…ÉÑ¹•É½µµ¥ÍÍ¥½¸°4(€€€€€•áÁ•Ñ•‘¥É•ÑM…±•Í½±±•Ñ¥½¸è4(€€€€€€€™¥¹…±EÕ½Ñ…Ñ¥½¹¥É•ÑM…±•Ì€üüÍ½ÕÉ”¹‘¥É•ÑM…±•Í½±±•Ñ¥½¸°4(€€€€€•áÁ•Ñ•‘¥É•Ñ5…É¥¸è4(€€€€€€€™¥¹…±EÕ½Ñ…Ñ¥½¹¥É•Ñ…É¹¥¹œ€üüÍ½ÕÉ”¹‘¥É•Ñ5…É¥¸°4(€€€€€•áÁ•Ñ•‘½¹ÍÑÉÕÑ¥½¹5…É¥¸°4(€€€€€É…ÝáÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°èÁÉ½©•Ñ¥½¸¹É…ÝáÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°°4(€€€€€•áÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°èÁÉ½©•Ñ¥½¸¹•áÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°°4(€€€€€•áÁ•Ñ•‘M•ÑÑ±•µ•¹Ñ•™¥¥ÐèÁÉ½©•Ñ¥½¸¹•áÁ•Ñ•‘M•ÑÑ±•µ•¹Ñ•™¥¥Ð°4(€€€€€•áÁ•Ñ•‘AÉ½™¥ÐèÁÉ½©•Ñ¥½¸¹•áÁ•Ñ•‘AÉ½™¥Ð°4(€€€€€µ…¹Õ™…ÑÕÉ•É½µµ¥ÍÍ¥½¹I••¥Ù•è½±±•Ñ•‘µ½Õ¹Ð°4(€€€€€½µµ¥ÍÍ¥½¹I••¥Ù…‰±”è5…Ñ ¹µ…à 4(€€€€€€€€À°4(€€€€€€€ÁÉ½©•Ñ¥½¸¹•áÁ•Ñ•‘½±±•Ñ¥½¹Q½Ñ…°€´½±±•Ñ•‘µ½Õ¹Ð°4(€€€€€€¤°4(€€€€€¹•ÑI•Ù•¹Õ”è™¥¹…±EÕ½Ñ…Ñ¥½¸ü¹µ…É¥¹µ½Õ¹Ð€üüÁÉ½©•Ñ¥½¸¹•áÁ•Ñ•‘AÉ½™¥Ð°4(€€€ôì4(€ô¤ì4(€½¹ÍÐÕ¹±¥¹­•‘AÉ½©•ÑÌ€ôÕ¹±¥¹­•‘AÉ½©•ÑI•ÍÕ±Ð¹É•ÍÕ±ÑÌ¹™¥±Ñ•È 4(€€€€¡É½ÜèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤€ôø4(€€€€€•±¥¥‰±•	ÕÍ¥¹•ÍÍ-•åÌ¹¡…Ì 4(€€€€€€€…¹…±åÑ¥Í	ÕÍ¥¹•ÍÍI½Õ¹‘-•ä¡É½Ü¹½É…¹¥é…Ñ¥½¸°É½Ü¹‰ÕÍ¥¹•ÍÍ}É½Õ¹¤°4(€€€€€€¤°4(€€¤ì4(€½¹ÍÐ±¥¹­•ÈÀÈÕAÉ½©•ÑÌ€ô±¥¹­•ÈÀÈÕAÉ½©•ÑI•ÍÕ±Ð¹É•ÍÕ±ÑÌ¹™¥±Ñ•È 4(€€€€¡É½ÜèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤€ôø4(€€€€€•±¥¥‰±•	ÕÍ¥¹•ÍÍ-•åÌ¹¡…Ì 4(€€€€€€€…¹…±åÑ¥Í	ÕÍ¥¹•ÍÍI½Õ¹‘-•ä¡É½Ü¹½É…¹¥é…Ñ¥½¸°É½Ü¹‰ÕÍ¥¹•ÍÍ}É½Õ¹¤°4(€€€€€€¤°4(€€¤ì4(€É•ÑÕÉ¸ì4(€€€…Ý…É‘Ì°4(€€€É••¥ÁÑÌ°4(€€€ÁÉ½‘ÕÑÌ°4(€€€‘…Ñ…EÕ…±¥Ñäèì4(€€€€€Õ¹½¹™¥Éµ•‘Ý…É‘Ìè…Ý…É‘Ì¹™¥±Ñ•È 4(€€€€€€€€¡…Ý…É¤€ôø4(€€€€€€€€€…Ý…É¹½¹™¥Éµ•€˜˜…Ý…É¹µ…¹Õ™…ÑÕÉ•É½µµ¥ÍÍ¥½¹I••¥Ù•€ðô€À°4(€€€€€€¤¹±•¹Ñ °4(€€€€€Õ¹±¥¹­•‘AÉ½‘ÕÑAÉ½©•ÑÌèÕ¹±¥¹­•‘AÉ½©•ÑÌ¹±•¹Ñ °4(€€€€€µ¥ÍÍ¥¹½µµ¥ÍÍ¥½¹%Ñ•µÌèÁÉ½‘ÕÑÌ¹™¥±Ñ•È 4(€€€€€€€€¡ÁÉ½‘ÕÐèì½µµ¥ÍÍ¥½¹5¥ÍÍ¥¹œè‰½½±•…¸ô¤€ôø4(€€€€€€€€€ÁÉ½‘ÕÐ¹½µµ¥ÍÍ¥½¹5¥ÍÍ¥¹œ°4(€€€€€€¤¹±•¹Ñ °4(€€€€€±¥¹­•ÈÀÈÕAÉ½©•ÑÌè±¥¹­•ÈÀÈÕAÉ½©•ÑÌ¹±•¹Ñ °4(€€€ô°4(€€€ÅÕ…±¥Ñå•Ñ…¥±Ìèì4(€€€€€Õ¹±¥¹­•‘AÉ½©•ÑÌèÕ¹±¥¹­•‘AÉ½©•ÑÌ¹Í±¥” À°€ÈÀÀ¤¹µ…À 4(€€€€€€€€¡É½ÜèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤€ôø€¡ì4(€€€€€€€ÁÉ½©•Ñ%è9Õµ‰•È¡É½Ü¹ÁÉ½©•Ñ}¥¤°4(€€€€€€€½É…¹¥é…Ñ¥½¸èMÑÉ¥¹œ¡É½Ü¹½É…¹¥é…Ñ¥½¸€üü€ˆˆ¤°4(€€€€€€€ÁÉ½©•Ñ9…µ”èMÑÉ¥¹œ¡É½Ü¹ÁÉ½©•Ñ}¹…µ”€üü€ˆˆ¤°4(€€€€€€€ÍÑ…ÑÕÌèMÑÉ¥¹œ¡É½Ü¹ÍÑ…ÑÕÌ€üü€ˆˆ¤°4(€€€€€€€…Ñ¥Ù¥Ñå…Ñ”è€ˆˆ°4(€€€€€€€…Ý…É‘•‘EÕ…¹Ñ¥Ñäè9Õµ‰•È¡É½Ü¹…Ý…É‘•‘}ÅÕ…¹Ñ¥Ñä€üü€À¤°4(€€€€€€€ô¤°4(€€€€€€¤°4(€€€€€±¥¹­•ÈÀÈÕAÉ½©•ÑÌè±¥¹­•ÈÀÈÕAÉ½©•ÑÌ¹Í±¥” À°€ÈÀÀ¤¹µ…À 4(€€€€€€€€¡É½ÜèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤€ôø€¡ì4(€€€€€€€ÁÉ½©•Ñ%è9Õµ‰•È¡É½Ü¹ÁÉ½©•Ñ}¥¤°4(€€€€€€€½É…¹¥é…Ñ¥½¸èMÑÉ¥¹œ¡É½Ü¹½É…¹¥é…Ñ¥½¸€üü€ˆˆ¤°4(€€€€€€€ÁÉ½©•Ñ9…µ”èMÑÉ¥¹œ¡É½Ü¹ÁÉ½©•Ñ}¹…µ”€üü€ˆˆ¤°4(€€€€€€€ÍÑ…ÑÕÌèMÑÉ¥¹œ¡É½Ü¹ÍÑ…ÑÕÌ€üü€ˆˆ¤°4(€€€€€€€…Ñ¥Ù¥Ñå…Ñ”èMÑÉ¥¹œ¡É½Ü¹…Ñ¥Ù¥Ñå}‘…Ñ”€üü€ˆˆ¤¹Í±¥” À°€ÄÀ¤°4(€€€€€€€…Ý…É‘•‘EÕ…¹Ñ¥Ñäè€À°4(€€€€€€€ô¤°4(€€€€€€¤°4(€€€ô°4(€ôì4)ô4(4)…Íå¹Œ™Õ¹Ñ¥½¸…¹…±åÑ¥ÍI•ÍÁ½¹Í” ¤ì4(€…Ý…¥ÐÉ•ÅÕ¥É•5•µ‰•ÉA•Éµ¥ÍÍ¥½¸ ‰…¹…±åÑ¥ÌéÙ¥•Üˆ¤ì4(€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡…Ý…¥Ð‰Õ¥±‘¹…±åÑ¥ÍA…å±½… ¤¤ì4)ô4(4)…Íå¹Œ™Õ¹Ñ¥½¸½Ý¹•ÉA•É™½Éµ…¹•I•ÍÁ½¹Í” ¤ì4(€…Ý…¥ÐÉ•ÅÕ¥É•AÉ¥µ…Éå=Ý¹•È ¤ì4(€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡…Ý…¥Ð‰Õ¥±‘¹…±åÑ¥ÍA…å±½… ¤¤ì4)ô4(4)•áÁ½ÉÐ…Íå¹Œ™Õ¹Ñ¥½¸P¡É•ÅÕ•ÍÐèI•ÅÕ•ÍÐ¤ì4(€ÑÉäì4(€€€½¹ÍÐÁ…É…µÌ€ô¹•ÜUI0¡É•ÅÕ•ÍÐ¹ÕÉ°¤¹Í•…É¡A…É…µÌì4(€€€¥˜€¡Á…É…µÌ¹•Ð ‰µ½‘”ˆ¤€ôôô€‰…¹…±åÑ¥Ìˆ¤É•ÑÕÉ¸…¹…±åÑ¥ÍI•ÍÁ½¹Í” ¤ì4(€€€¥˜€¡Á…É…µÌ¹•Ð ‰µ½‘”ˆ¤€ôôô€‰½Ý¹•ÈµÁ•É™½Éµ…¹”ˆ¤ì4(€€€€€É•ÑÕÉ¸½Ý¹•ÉA•É™½Éµ…¹•I•ÍÁ½¹Í” ¤ì4(€€€ô4(€€€½¹ÍÐµ•µ‰•È€ô…Ý…¥ÐÉ•ÅÕ¥É•ÁÁÉ½Ù•‘5•µ‰•È ¤ì4(€€€½¹ÍÐÄ€ô…Ý…¥Ð•¹ÍÕÉ•½Õ¹Ñ¥¹I•…‘ä ¤ì4(€€€…Ý…¥Ð•¹ÍÕÉ•ÕÑ¡½É•‘EÕ½Ñ…Ñ¥½¹ÍI•…‘ä ¤ì4(€€€½¹ÍÐ¡¥ÍÑ½ÉåÑ¥Ù¥Ñå%€ô9Õµ‰•È¡Á…É…µÌ¹•Ð ‰¡¥ÍÑ½ÉåÑ¥Ù¥Ñå%ˆ¤¤ì4(€€€¥˜€¡9Õµ‰•È¹¥Í%¹Ñ••È¡¡¥ÍÑ½ÉåÑ¥Ù¥Ñå%¤€˜˜¡¥ÍÑ½ÉåÑ¥Ù¥Ñå%€ø€À¤ì4(€€€€€…Ý…¥ÐÉ•ÅÕ¥É•5•µ‰•ÉA•Éµ¥ÍÍ¥½¸ ‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤ì4(€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É”¡€4(€€€€€€€€€M1P¥°Í¹…ÁÍ¡½Ñ}©Í½¸°¡…¹•‘}™¥•±‘Í}©Í½¸°¡…¹•‘}‰å}¹…µ”°É•…Ñ•‘}…Ð4(€€€€€€€€€I=4…½Õ¹Ñ¥¹}Í•ÑÑ±•µ•¹Ñ}¡¥ÍÑ½Éä4(€€€€€€€€€]!I…Ñ¥Ù¥Ñå}¥€ô€ü4(€€€€€€€€€=IH	dÉ•…Ñ•‘}…ÐM°¥M4(€€€€€€€€€1%5%P€ÄÀÀ4(€€€€€€€€¤4(€€€€€€€€¹‰¥¹¡¡¥ÍÑ½ÉåÑ¥Ù¥Ñå%¤4(€€€€€€€€¹…±°ñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€€€¡¥ÍÑ½ÉäèÉ•ÍÕ±Ð¹É•ÍÕ±ÑÌ¹µ…À ¡É½ÜèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸ø¤€ôø€¡ì4(€€€€€€€€€¥è9Õµ‰•È¡É½Ü¹¥¤°4(€€€€€€€€€Í¹…ÁÍ¡½Ðè)M=8¹Á…ÉÍ”¡MÑÉ¥¹œ¡É½Ü¹Í¹…ÁÍ¡½Ñ}©Í½¸€üü€‰íôˆ¤¤°4(€€€€€€€€€¡…¹•‘¥•±‘Ìè)M=8¹Á…ÉÍ”¡MÑÉ¥¹œ¡É½Ü¹¡…¹•‘}™¥•±‘Í}©Í½¸€üü€‰mtˆ¤¤°4(€€€€€€€€€¡…¹•‘	å9…µ”èMÑÉ¥¹œ¡É½Ü¹¡…¹•‘}‰å}¹…µ”€üü€ˆˆ¤°4(€€€€€€€€€É•…Ñ•‘ÐèMÑÉ¥¹œ¡É½Ü¹É•…Ñ•‘}…Ð€üü€ˆˆ¤°4(€€€€€€€ô¤¤°4(€€€€€ô¤ì4(€€€ô4(4(€€€½¹ÍÐ…¹M••±°€ô4(€€€€€¡…Í5•µ‰•ÉA•Éµ¥ÍÍ¥½¸¡µ•µ‰•È°€‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤ñð4(€€€€€¡…Í5•µ‰•ÉA•Éµ¥ÍÍ¥½¸¡µ•µ‰•È°€‰…¹…±åÑ¥ÌéÙ¥•Üˆ¤ì4(€€€¥˜€¡Á…É…µÌ¹•Ð ‰Í½Á”ˆ¤€„ôô€‰Ù¥Í¥‰±”ˆ€˜˜€…¡…Í5•µ‰•ÉA•Éµ¥ÍÍ¥½¸¡µ•µ‰•È°€‰…½Õ¹Ñ¥¹œéµ…¹…”ˆ¤¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²"cªâ#
ß²ÆªÚ0ƒªÒ®š°ƒªÚ3¶Vs²vÐƒ¶V²jS¶V§®.#®.¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÌô¤ì4(€€€ô4(€€€½¹ÍÐmÉ•ÍÕ±Ð°ÅÕ½Ñ…Ñ¥½¹I•ÍÕ±Ñt€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l4(€€€€€Ä¹ÁÉ•Á…É” 4(€€€€€€€€‘í…Ý…É‘½Õ¹Ñ¥¹EÕ•Éåô=IH	d„¹…Ñ¥Ù¥Ñå}‘…Ñ”M°„¹¥M€°4(€€€€€€¤¹…±°ñI…Ý½Õ¹Ñ¥¹I½Üø ¤°4(€€€€€Ä¹ÁÉ•Á…É”¡€4(€€€€€€€M1P€¨I=4…ÕÑ¡½É•‘}ÅÕ½Ñ…Ñ¥½¹Ì4(€€€€€€€]!IÍÑ…ÑÕÌ€ô€™¥¹…°œ9‘•±•Ñ•‘}…Ð€ô€œœ4(€€€€€€€=IH	dÅÕ½Ñ•}‘…Ñ”M°É•Ù¥Í¥½¹}¹Õµ‰•ÈM°¥M4(€€€€€€€1%5%P€ÄÀÀÀ4(€€€€€€¤¹…±°ñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø ¤°4(€€€t¤ì4(€€€½¹ÍÐ±…Ñ•ÍÑEÕ½Ñ…Ñ¥½¹	å	ÕÍ¥¹•ÍÌ€ô¹•Ü5…ÀñÍÑÉ¥¹œ°ÕÑ¡½É•‘EÕ½Ñ…Ñ¥½¸ø ¤ì4(€€€ÅÕ½Ñ…Ñ¥½¹I•ÍÕ±Ð¹É•ÍÕ±ÑÌ¹™½É…  ¡É½Ü¤€ôøì4(€€€€€½¹ÍÐÅÕ½Ñ…Ñ¥½¸€ô…ÕÑ¡½É•‘EÕ½Ñ…Ñ¥½¹É½µI½Ü¡É½Ü¤ì4(€€€€€½¹ÍÐ‰ÕÍ¥¹•ÍÍ-•ä€ô…¹…±åÑ¥Í	ÕÍ¥¹•ÍÍI½Õ¹‘-•ä 4(€€€€€€€ÅÕ½Ñ…Ñ¥½¸¹½É…¹¥é…Ñ¥½¸°4(€€€€€€€ÅÕ½Ñ…Ñ¥½¸¹‰ÕÍ¥¹•ÍÍI½Õ¹°4(€€€€€€¤ì4(€€€€€¥˜€ …±…Ñ•ÍÑEÕ½Ñ…Ñ¥½¹	å	ÕÍ¥¹•ÍÌ¹¡…Ì¡‰ÕÍ¥¹•ÍÍ-•ä¤¤ì4(€€€€€€€±…Ñ•ÍÑEÕ½Ñ…Ñ¥½¹	å	ÕÍ¥¹•ÍÌ¹Í•Ð¡‰ÕÍ¥¹•ÍÍ-•ä°ÅÕ½Ñ…Ñ¥½¸¤ì4(€€€€€ô4(€€€ô¤ì4(€€€½¹ÍÐ±…Ñ•ÍÑI½ÝÌ€ô½µÁ±•Ñ•‘]¡¥ééÕÁÝ…É‘I½ÝÌ¡É•ÍÕ±Ð¹É•ÍÕ±ÑÌ¤ì4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€É½ÝÌè±…Ñ•ÍÑI½ÝÌ4(€€€€€€€€¹™¥±Ñ•È 4(€€€€€€€€€€¡É½Ü¤€ôø4(€€€€€€€€€€€…¹M••±°ñð4(€€€€€€€€€€€MÑÉ¥¹œ¡É½Ü¹ÁÉ½É•ÍÍ}µ…¹…•È€üü€ˆˆ¤€ôôôµ•µ‰•È¹‘¥ÍÁ±…å9…µ”°4(€€€€€€€€¤4(€€€€€€€€¹µ…À ¡É½Ü¤€ôøµ…Á½Õ¹Ñ¥¹I½Ü 4(€€€€€€€€€É½Ü°4(€€€€€€€€€±…Ñ•ÍÑEÕ½Ñ…Ñ¥½¹	å	ÕÍ¥¹•ÍÌ¹•Ð 4(€€€€€€€€€€€…¹…±åÑ¥Í	ÕÍ¥¹•ÍÍI½Õ¹‘-•ä¡É½Ü¹½É…¹¥é…Ñ¥½¸°É½Ü¹‰ÕÍ¥¹•ÍÍ}É½Õ¹¤°4(€€€€€€€€€€¤°4(€€€€€€€€¤¤°4(€€€ô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€É•ÑÕÉ¸…•ÍÍÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(4)•áÁ½ÉÐ…Íå¹Œ™Õ¹Ñ¥½¸AUP ¤ì4(€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€ì4(€€€€€•ÉÉ½Èè4(€€€€€€€€‹ªÖ³¶bTƒ¶j3ªÎƒ²‚W²
Àƒ²‚²z”ƒªâÃ®*—²v ƒ²Š®Ž3®Bc²^#²*×®.#®.¸ƒ².“²‚pƒ²"cªâ#²v ƒ².ƒªÞpƒ²"cªâ ƒ²nC²z—²^C²pƒ®NÇ®†w¶VÐƒ²Žó²ã²jP¸ˆ°4(€€€ô°4(€€€ì4(€€€€€ÍÑ…ÑÕÌè€ÐÀÔ°4(€€€€€¡•…‘•ÉÌèì±±½Üè€‰Pˆô°4(€€€ô°4(€€¤ì4)ô4