export type ManagerInspectionFilter =
  | "attention"
  | "overdue"
  | "stalled"
  | "ownerless"
  | "missing"
  | "processed"
  | "all";

export type ManagerInspectionSearchRow = {
  name: string;
  effectiveContactName?: string;
  overdue: boolean;
  stalled: boolean;
  ownerless: boolean;
  missingInfo: boolean;
  issues: string[];
  latest: {
    progressManager: string;
    contactName: string;
    region: string;
    topic: string;
    nextAction: string;
  };
};

function matchesIssueFilter(
  row: ManagerInspectionSearchRow,
  filter: ManagerInspectionFilter,
) {
  if (filter === "overdue") return row.overdue;
  if (filter === "stalled") return row.stalled;
  if (filter === "ownerless") return row.ownerless;
  if (filter === "missing") return row.missingInfo;
  return row.issues.length > 0;
}

function matchesSearch(row: ManagerInspectionSearchRow, keyword: string) {
  if (!keyword) return true;
  return [
    row.name,
    row.latest.progressManager,
    row.effectiveContactName ?? "",
    row.latest.contactName,
    row.latest.region,
    row.latest.topic,
    row.latest.nextAction,
    ...row.issues,
  ].some((value) => value.toLocaleLowerCase("ko-KR").includes(keyword));
}

/**
 * 좌측 배지, 상단 카드, 표가 같은 필터와 검색어를 공유하도록 한 곳에서
 * 관리자 점검 목록을 계산합니다.
 */
export function filterManagerInspectionRows<
  TRow extends ManagerInspectionSearchRow,
>(
  activeRows: TRow[],
  processedRows: TRow[],
  filter: ManagerInspectionFilter,
  search = "",
) {
  const keyword = search.trim().toLocaleLowerCase("ko-KR");
  const source = filter === "processed" ? processedRows : activeRows;
  return source.filter(
    (row) => matchesIssueFilter(row, filter) && matchesSearch(row, keyword),
  );
}

export function managerInspectionCounts<
  TRow extends ManagerInspectionSearchRow,
>(activeRows: TRow[], processedRows: TRow[], search = "") {
  return {
    attention: filterManagerInspectionRows(
      activeRows,
      processedRows,
      "attention",
      search,
    ).length,
    overdue: filterManagerInspectionRows(
      activeRows,
      processedRows,
      "overdue",
      search,
    ).length,
    stalled: filterManagerInspectionRows(
      activeRows,
      processedRows,
      "stalled",
      search,
    ).length,
    ownerless: filterManagerInspectionRows(
      activeRows,
      processedRows,
      "ownerless",
      search,
    ).length,
    missing: filterManagerInspectionRows(
      activeRows,
      processedRows,
      "missing",
      search,
    ).length,
    processed: filterManagerInspectionRows(
      activeRows,
      processedRows,
      "processed",
      search,
    ).length,
    all: filterManagerInspectionRows(
      activeRows,
      processedRows,
      "all",
      search,
    ).length,
  };
}
