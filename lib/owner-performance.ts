export type OwnerPerformanceAward = {
  activityId: number;
  businessKey: string;
  businessRound: number;
  activityDate: string;
  organization: string;
  region: string;
  progressManager: string;
  confirmed: boolean;
  confirmedAmount: number;
  netRevenue: number;
};

export type OwnerPerformanceProduct = {
  businessKey: string;
  productName: string;
  quantity: number;
  amount: number;
  progressManager: string;
};

export type OwnerPerformanceInstitution = {
  activityId: number;
  businessKey: string;
  businessRound: number;
  activityDate: string;
  organization: string;
  region: string;
  salesAmount: number;
  margin: number;
  quantity: number;
  products: Array<{ name: string; quantity: number; amount: number }>;
};

export type OwnerPerformanceManager = {
  name: string;
  orderCount: number;
  salesAmount: number;
  margin: number;
  quantity: number;
  averageMargin: number;
  marginRate: number;
  institutions: OwnerPerformanceInstitution[];
};

function normalizedManager(value: unknown) {
  const manager = String(value ?? "").trim();
  return manager && manager !== "해당 없음" ? manager : "담당자 미정";
}

function inDateRange(date: string, startDate: string, endDate: string) {
  const day = String(date ?? "").slice(0, 10);
  return Boolean(day) && day >= startDate && day <= endDate;
}

export function buildOwnerPerformance(
  awards: OwnerPerformanceAward[],
  products: OwnerPerformanceProduct[],
  startDate: string,
  endDate: string,
) {
  const filteredAwards = awards.filter(
    (award) =>
      award.confirmed && inDateRange(award.activityDate, startDate, endDate),
  );
  const awardByBusinessKey = new Map(
    filteredAwards.map((award) => [award.businessKey, award]),
  );
  const productsByBusiness = new Map<string, OwnerPerformanceProduct[]>();
  products.forEach((product) => {
    if (!awardByBusinessKey.has(product.businessKey)) return;
    const current = productsByBusiness.get(product.businessKey) ?? [];
    current.push(product);
    productsByBusiness.set(product.businessKey, current);
  });

  const managers = new Map<string, OwnerPerformanceManager>();
  filteredAwards.forEach((award) => {
    const name = normalizedManager(award.progressManager);
    const manager = managers.get(name) ?? {
      name,
      orderCount: 0,
      salesAmount: 0,
      margin: 0,
      quantity: 0,
      averageMargin: 0,
      marginRate: 0,
      institutions: [],
    };
    const productRows = productsByBusiness.get(award.businessKey) ?? [];
    const productMap = new Map<
      string,
      { name: string; quantity: number; amount: number }
    >();
    productRows.forEach((product) => {
      const productName = product.productName.trim() || "미등록 제품";
      const current = productMap.get(productName) ?? {
        name: productName,
        quantity: 0,
        amount: 0,
      };
      current.quantity += Math.max(0, Number(product.quantity) || 0);
      current.amount += Math.max(0, Number(product.amount) || 0);
      productMap.set(productName, current);
    });
    const quantity = [...productMap.values()].reduce(
      (sum, product) => sum + product.quantity,
      0,
    );
    const institution: OwnerPerformanceInstitution = {
      activityId: award.activityId,
      businessKey: award.businessKey,
      businessRound: award.businessRound,
      activityDate: award.activityDate,
      organization: award.organization,
      region: award.region,
      salesAmount: Math.max(0, Number(award.confirmedAmount) || 0),
      margin: Number(award.netRevenue) || 0,
      quantity,
      products: [...productMap.values()].sort(
        (left, right) =>
          right.quantity - left.quantity || left.name.localeCompare(right.name, "ko"),
      ),
    };
    manager.orderCount += 1;
    manager.salesAmount += institution.salesAmount;
    manager.margin += institution.margin;
    manager.quantity += institution.quantity;
    manager.institutions.push(institution);
    managers.set(name, manager);
  });

  const rows = [...managers.values()].map((manager) => ({
    ...manager,
    averageMargin:
      manager.orderCount > 0 ? manager.margin / manager.orderCount : 0,
    marginRate:
      manager.salesAmount > 0 ? manager.margin / manager.salesAmount : 0,
    institutions: manager.institutions.sort(
      (left, right) =>
        right.margin - left.margin ||
        right.activityDate.localeCompare(left.activityDate),
    ),
  }));

  return {
    managers: rows,
    totals: {
      managerCount: rows.filter((row) => row.name !== "담당자 미정").length,
      orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
      salesAmount: rows.reduce((sum, row) => sum + row.salesAmount, 0),
      margin: rows.reduce((sum, row) => sum + row.margin, 0),
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    },
  };
}
