import {
  automaticCollectionStatus,
  uniqueCollectionReceipts,
  type CollectionReceiptLike,
} from "./collection-analytics.ts";

export type AccountingJointEntryLike = {
  id?: number;
  activityId: number;
  businessKey: string;
  businessRound: number;
  activityDate: string;
  organization: string;
  region?: string;
  budgetType?: string;
  progressManager?: string;
  awardStage?: string;
  groupedActivityIds?: number[];
  contractAmountReference?: number;
  quoteStatus?: "complete" | "partial" | "missing";
  quoteItemCount?: number;
  quoteMissingAmountItemCount?: number;
  executionType?: "직영" | "컨소";
  consortiumCompany?: string;
  sourceItems?: Array<{ id: number }>;
  sourceProjects?: Array<{ id: number }>;
  expectedPartnerCommission?: number;
  expectedDirectSalesCollection?: number;
  expectedDirectMargin?: number;
  expectedConstructionMargin?: number;
  expectedCollectionTotal?: number;
  expectedSettlementDeficit?: number;
  expectedProfit?: number;
  expectedCommission?: number;
  expectedConsortiumSettlement?: number;
  expectedContributionMargin?: number;
  commissionCollectedAmount?: number;
  receivableBalance?: number;
  collectionDate?: string;
  workflowExcluded?: boolean;
  workflowExcludedAt?: string;
  confirmed?: boolean;
  accountingStatus?: string;
  needsCollection?: boolean;
  receipts?: CollectionReceiptLike[];
  jointProjectId?: number | null;
  jointProjectName?: string;
  jointProjectSponsor?: string;
  jointProjectSponsorKey?: string;
  jointProjectRole?: "sponsor" | "site" | "";
  jointProjectBudgetType?: string;
  jointProjectYear?: number | null;
  jointProjectRound?: number | null;
};

export type AccountingJointGroup<TEntry extends AccountingJointEntryLike> = {
  key: string;
  isJointProject: boolean;
  representative: TEntry;
  members: TEntry[];
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum<TEntry extends AccountingJointEntryLike>(
  entries: TEntry[],
  field: keyof AccountingJointEntryLike,
) {
  return entries.reduce((total, entry) => total + numberValue(entry[field]), 0);
}

function normalizedInstitutionKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function uniqueText(values: unknown[]) {
  return [
    ...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  ];
}

function uniqueById<TItem extends { id: number }>(items: TItem[]) {
  const byId = new Map<number, TItem>();
  items.forEach((item) => {
    if (!byId.has(item.id)) byId.set(item.id, item);
  });
  return [...byId.values()];
}

function jointProjectTitle(entry: AccountingJointEntryLike) {
  const budget =
    String(entry.jointProjectBudgetType ?? "").trim() ||
    String(entry.budgetType ?? "").trim() ||
    "예산 미등록";
  const round = Math.max(
    1,
    Math.trunc(numberValue(entry.jointProjectRound ?? entry.businessRound)),
  );
  return `${budget} · 공동사업 ${round}차`;
}

export function accountingBusinessTitle(entry: AccountingJointEntryLike) {
  return entry.jointProjectId && entry.jointProjectRole === "site"
    ? jointProjectTitle(entry)
    : `${String(entry.budgetType ?? "").trim() || "예산 미등록"} · ${Math.max(
        1,
        Math.trunc(numberValue(entry.businessRound)),
      )}차 사업`;
}

function summarizeJointProject<TEntry extends AccountingJointEntryLike>(
  members: TEntry[],
) {
  const ordered = [...members].sort(
    (left, right) =>
      right.activityDate.localeCompare(left.activityDate) ||
      left.organization.localeCompare(right.organization, "ko-KR"),
  );
  const first = ordered[0];
  const sponsor = String(first.jointProjectSponsor ?? "").trim() || first.organization;
  const sponsorKey =
    String(first.jointProjectSponsorKey ?? "").trim() ||
    normalizedInstitutionKey(sponsor);
  const projectId = Number(first.jointProjectId);
  const expectedCollectionTotal = sum(ordered, "expectedCollectionTotal");
  const expectedSettlementDeficit = sum(ordered, "expectedSettlementDeficit");
  const commissionCollectedAmount = sum(ordered, "commissionCollectedAmount");
  const receipts = uniqueCollectionReceipts(
    ordered.flatMap((entry) => entry.receipts ?? []),
  ).sort(
    (left, right) =>
      right.collectionDate.localeCompare(left.collectionDate) ||
      Number(right.id ?? 0) - Number(left.id ?? 0),
  );
  const managers = uniqueText(ordered.map((entry) => entry.progressManager));
  const stages = uniqueText(ordered.map((entry) => entry.awardStage));
  const quoteStatuses = ordered.map((entry) => entry.quoteStatus ?? "missing");
  const quoteStatus = quoteStatuses.every((status) => status === "complete")
    ? "complete"
    : quoteStatuses.every((status) => status === "missing")
      ? "missing"
      : "partial";
  const collectionDate = receipts[0]?.collectionDate ?? "";
  const receivableBalance = Math.max(
    0,
    expectedCollectionTotal - commissionCollectedAmount,
  );
  const accountingStatus =
    expectedSettlementDeficit > 0
      ? "지급 검토"
      : automaticCollectionStatus(
          expectedCollectionTotal,
          commissionCollectedAmount,
        );

  return {
    ...first,
    businessKey: `${sponsorKey}\u001fjoint:${projectId}`,
    businessRound: Math.max(
      1,
      Math.trunc(numberValue(first.jointProjectRound ?? first.businessRound)),
    ),
    organization: sponsor,
    budgetType:
      String(first.jointProjectBudgetType ?? "").trim() || first.budgetType,
    progressManager:
      managers.length <= 1 ? managers[0] ?? "" : `${managers.length}명`,
    awardStage:
      stages.length <= 1 ? stages[0] ?? "미정" : `${ordered.length}곳 진행`,
    groupedActivityIds: [
      ...new Set(
        ordered.flatMap(
          (entry) => entry.groupedActivityIds ?? [entry.activityId],
        ),
      ),
    ],
    contractAmountReference: sum(ordered, "contractAmountReference"),
    quoteStatus,
    quoteItemCount: sum(ordered, "quoteItemCount"),
    quoteMissingAmountItemCount: sum(
      ordered,
      "quoteMissingAmountItemCount",
    ),
    executionType: ordered.some((entry) => entry.executionType === "컨소")
      ? "컨소"
      : "직영",
    consortiumCompany: uniqueText(
      ordered.map((entry) => entry.consortiumCompany),
    ).join(", "),
    sourceItems: uniqueById(ordered.flatMap((entry) => entry.sourceItems ?? [])),
    sourceProjects: uniqueById(
      ordered.flatMap((entry) => entry.sourceProjects ?? []),
    ),
    expectedPartnerCommission: sum(ordered, "expectedPartnerCommission"),
    expectedDirectSalesCollection: sum(
      ordered,
      "expectedDirectSalesCollection",
    ),
    expectedDirectMargin: sum(ordered, "expectedDirectMargin"),
    expectedConstructionMargin: sum(ordered, "expectedConstructionMargin"),
    expectedCollectionTotal,
    expectedSettlementDeficit,
    expectedProfit: sum(ordered, "expectedProfit"),
    expectedCommission: sum(ordered, "expectedCommission"),
    expectedConsortiumSettlement: sum(
      ordered,
      "expectedConsortiumSettlement",
    ),
    expectedContributionMargin: sum(
      ordered,
      "expectedContributionMargin",
    ),
    commissionCollectedAmount,
    receivableBalance,
    collectionDate,
    workflowExcluded: ordered.every((entry) => entry.workflowExcluded),
    workflowExcludedAt:
      ordered.find((entry) => entry.workflowExcludedAt)?.workflowExcludedAt ?? "",
    confirmed: ordered.some((entry) => entry.confirmed),
    accountingStatus,
    needsCollection:
      expectedCollectionTotal > 0 && commissionCollectedAmount === 0,
    receipts,
  } as TEntry;
}

/**
 * 공동사업은 현재 화면 범위에 포함된 설치기관만 묶는다.
 * 따라서 입금 예정과 납품 완료 화면이 같은 함수를 사용해도 각 범위의
 * 설치기관만 합계에 들어가며, 주관기관 원본 행은 금액 합계에서 제외된다.
 */
export function groupAccountingJointProjects<
  TEntry extends AccountingJointEntryLike,
>(entries: TEntry[]): AccountingJointGroup<TEntry>[] {
  const groups = new Map<string, AccountingJointGroup<TEntry>>();

  entries.forEach((entry) => {
    if (entry.jointProjectId && entry.jointProjectRole === "sponsor") return;
    if (entry.jointProjectId && entry.jointProjectRole === "site") {
      const key = `joint:${entry.jointProjectId}`;
      const current = groups.get(key) ?? {
        key,
        isJointProject: true,
        representative: entry,
        members: [],
      };
      current.members.push(entry);
      groups.set(key, current);
      return;
    }

    const key = `entry:${entry.businessKey || entry.activityId}`;
    groups.set(key, {
      key,
      isJointProject: false,
      representative: entry,
      members: [entry],
    });
  });

  return [...groups.values()].map((group) =>
    group.isJointProject
      ? {
          ...group,
          representative: summarizeJointProject(group.members),
        }
      : group,
  );
}

export function accountingJointProjectSubtitle(
  entry: AccountingJointEntryLike,
) {
  return entry.jointProjectId ? jointProjectTitle(entry) : "";
}
