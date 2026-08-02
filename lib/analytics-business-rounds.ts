import { institutionAliasKey } from "./institution-names";
import { normalizeAwardCompletedDate } from "./award-completion";

export type AnalyticsAwardRow = Record<string, unknown>;

const authoritativeAwardStatuses = new Set([
  "위즈업 수주",
  "협력사 수주",
  "타업체 수주",
]);

const financeFields = [
  "entry_count",
  "unconfirmed_entries",
  "recognized_date",
  "commission_collected_amount",
  "receivable_balance",
  "consortium_paid_amount",
  "contribution_margin",
  "legacy_confirmed",
  "legacy_contract_amount",
  "legacy_commission_collected_amount",
  "legacy_receivable_balance",
  "legacy_consortium_paid_amount",
  "legacy_contribution_margin",
  "settlement_id",
  "confirmed_contract_amount",
  "deposit_amount",
  "interim_amount",
  "balance_amount",
  "paid_amount",
  "actual_cost",
  "confirmed_commission",
  "confirmed_margin",
  "manufacturer_commission_expected",
  "manufacturer_commission_received",
  "manufacturer_commission_received_date",
  "consortium_payment_expected",
  "consortium_payment_paid",
  "consortium_payment_date",
  "other_cost",
  "commission_receivable",
  "consortium_payable",
  "net_revenue",
  "revenue_recognition_date",
  "invoice_status",
  "invoice_date",
  "settlement_status",
  "accounting_note",
  "confirmed",
  "updated_by_name",
  "updated_at",
  "suggested_manufacturer_commission",
  "suggested_consortium_payment",
] as const;

export function normalizeBusinessRound(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(99, parsed) : 1;
}

function rowDate(row: AnalyticsAwardRow) {
  return String(row.activity_date ?? "").slice(0, 10);
}

function rowId(row: AnalyticsAwardRow) {
  return Number(row.activity_id ?? row.id ?? 0);
}

function compareNewest(left: AnalyticsAwardRow, right: AnalyticsAwardRow) {
  return rowDate(right).localeCompare(rowDate(left)) || rowId(right) - rowId(left);
}

function hasAccounting(row: AnalyticsAwardRow) {
  return (
    Number(row.entry_count ?? 0) > 0 ||
    Number(row.settlement_id ?? 0) > 0 ||
    (row.legacy_contract_amount !== null &&
      row.legacy_contract_amount !== undefined) ||
    Number(row.legacy_confirmed ?? 0) > 0
  );
}

export function analyticsBusinessRoundKey(
  organization: unknown,
  round: unknown,
) {
  return `${institutionAliasKey(organization)}\u001f${normalizeBusinessRound(round)}`;
}

export function isAuthoritativeAwardRow(row: AnalyticsAwardRow) {
  return authoritativeAwardStatuses.has(String(row.award_status ?? "").trim());
}

export function isCompletedWhizzupAwardRow(row: AnalyticsAwardRow) {
  return (
    String(row.award_status ?? "").trim() === "위즈업 수주" &&
    String(row.award_stage ?? "").trim() === "납품 완료"
  );
}

export function isUpcomingWhizzupAwardRow(row: AnalyticsAwardRow) {
  return (
    String(row.award_status ?? "").trim() === "위즈업 수주" &&
    String(row.award_stage ?? "").trim() !== "납품 완료"
  );
}

/**
 * 활동 이력은 그대로 두되 통계에서는 기관의 같은 사업 차수를 한 수주로 본다.
 * 최신 활동이 현재 상태를 대표하고, 회계값은 실제 전표가 연결된 활동에서 가져온다.
 */
export function groupAnalyticsAwardRows(rows: AnalyticsAwardRow[]) {
  const groups = new Map<string, AnalyticsAwardRow[]>();
  for (const row of rows) {
    const key = analyticsBusinessRoundKey(
      row.organization,
      row.business_round,
    );
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  return [...groups.entries()].map(([businessKey, unsortedRows]) => {
    const groupedRows = [...unsortedRows].sort(compareNewest);
    const latest = groupedRows[0];
    const latestAwardStatus = String(latest.award_status ?? "").trim();
    const currentAwardRows: AnalyticsAwardRow[] = [];
    for (const row of groupedRows) {
      if (
        String(row.award_status ?? "").trim() !== latestAwardStatus
      ) {
        break;
      }
      currentAwardRows.push(row);
    }
    const financeRow =
      currentAwardRows.find(
        (row) =>
          hasAccounting(row),
      ) ??
      latest;
    const completedDate =
      currentAwardRows
        .map((row) => normalizeAwardCompletedDate(row.award_completed_date))
        .find(Boolean) ||
      currentAwardRows
        .filter((row) => String(row.award_stage ?? "") === "납품 완료")
        .map(rowDate)
        .find(Boolean) ||
      rowDate(latest);
    const latestStage = String(latest.award_stage ?? "").trim();
    const grouped: AnalyticsAwardRow = {
      ...latest,
      business_key: businessKey,
      business_round: normalizeBusinessRound(latest.business_round),
      activity_date:
        latestStage === "납품 완료" ? completedDate : rowDate(latest),
      grouped_activity_ids: currentAwardRows.map(rowId),
    };
    for (const field of financeFields) grouped[field] = financeRow[field];
    return grouped;
  });
}

/**
 * 수주 주체와 진행 단계는 기관·사업 차수의 가장 최근 수주 결정 기록만
 * 권위 있는 현재 상태로 본다. 미정 활동은 기존 수주 결정을 덮어쓰지 않는다.
 */
export function groupLatestAuthoritativeAwardRows(
  rows: AnalyticsAwardRow[],
) {
  return groupAnalyticsAwardRows(rows.filter(isAuthoritativeAwardRow));
}

export function completedWhizzupAwardRows(rows: AnalyticsAwardRow[]) {
  return groupLatestAuthoritativeAwardRows(rows).filter(
    isCompletedWhizzupAwardRow,
  );
}

export function upcomingWhizzupAwardRows(rows: AnalyticsAwardRow[]) {
  return groupLatestAuthoritativeAwardRows(rows).filter(
    isUpcomingWhizzupAwardRow,
  );
}
