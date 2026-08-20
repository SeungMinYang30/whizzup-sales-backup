const modules = {
  "../../../../lib/collaboration": `
    export const accessErrorResponse = (error) =>
      Response.json({ error: String(error?.message ?? error) }, { status: 500 });
    export const hasMemberPermission = () => true;
    export const requireApprovedMember = async () => ({
      id: 1,
      displayName: "회계 테스트",
    });
    export const requireMemberPermission = async () => ({
      id: 1,
      displayName: "회계 테스트",
    });
  `,
  "../../../../lib/accounting-store": `
    export const ensureAccountingReady = async () =>
      globalThis.__accountingEntriesD1;
    export const ensureLegacyReceiptLedgerMigration = async () => undefined;
    export const linkEquipmentProjectsToWhizzupAwards = async () => undefined;
    export const parseStoredMoney = (value) => Number(value ?? 0) || 0;
  `,
  "../../../../lib/equipment-finance": `
    const toTenWon = (value) => Math.floor(Math.max(0, value) / 10) * 10;
    export const calculateEquipmentFinance = (input) => {
      const total = Number(input.unitPrice ?? 0) * Number(input.quantity ?? 1);
      const partner =
        input.supplyType === "direct"
          ? 0
          : toTenWon(total * Number(input.commissionRate ?? 0));
      const directMargin =
        input.supplyType === "direct"
          ? toTenWon(total * Number(input.marginRate ?? 0))
          : 0;
      return {
        expectedPartnerCommission: partner,
        expectedDirectMargin: directMargin,
        consortiumPayment: 0,
        quotationAmount: total,
      };
    };
    export const equipmentSettlementQuantity = (input) =>
      Number(input.proposedQty || input.awardedQty || input.installedQty || 1);
  `,
  "../../../../lib/analytics-business-rounds": `
    const businessKey = (organization, round) =>
      String(organization ?? "").trim() + "\\u001f" + String(Number(round) || 1);

    const grouped = (rows, completed) => {
      const groups = new Map();
      for (const row of rows) {
        if (String(row.award_status ?? "") !== "위즈업 수주") continue;
        const isCompleted = String(row.award_stage ?? "") === "납품 완료";
        if (completed !== isCompleted) continue;
        const key = businessKey(row.organization, row.business_round);
        const current = groups.get(key) ?? [];
        current.push(row);
        groups.set(key, current);
      }
      return [...groups.entries()].map(([key, values]) => {
        const ordered = [...values].sort(
          (left, right) => Number(right.activity_id) - Number(left.activity_id),
        );
        return {
          ...ordered[0],
          business_key: key,
          grouped_activity_ids: ordered.map((row) => Number(row.activity_id)),
        };
      });
    };

    export const analyticsBusinessRoundKey = businessKey;
    export const completedWhizzupAwardRows = (rows) => grouped(rows, true);
    export const upcomingWhizzupAwardRows = (rows) => grouped(rows, false);
    export const normalizeBusinessRound = (value) => Number(value) || 1;
  `,
  "../../../../lib/collection-analytics": `
    export const automaticCollectionStatus = () => "미수";
  `,
  "../../../../lib/joint-projects": `
    export const ensureJointProjectsReady = async () => undefined;
  `,
  "../../../../lib/accounting-joint-projects": `
    export const groupAccountingJointProjects = (entries) =>
      entries.map((entry) => ({
        key: entry.businessKey,
        isJointProject: false,
        representative: entry,
        members: [entry],
      }));
  `,
};

export async function resolve(specifier, context, nextResolve) {
  if (
    context.parentURL?.endsWith("/app/api/accounting/entries/route.ts") &&
    Object.hasOwn(modules, specifier)
  ) {
    return {
      url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
