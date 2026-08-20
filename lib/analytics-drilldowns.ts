export type AnalyticsBusinessProduct = {
  businessKey: string;
  activityDate: string;
};

export function groupAnalyticsProductsByBusiness<
  T extends AnalyticsBusinessProduct,
>(rows: T[]) {
  const grouped = new Map<
    string,
    {
      businessKey: string;
      rows: T[];
      activityDate: string;
    }
  >();
  rows.forEach((row) => {
    const current = grouped.get(row.businessKey) ?? {
      businessKey: row.businessKey,
      rows: [],
      activityDate: row.activityDate,
    };
    current.rows.push(row);
    if (row.activityDate > current.activityDate) {
      current.activityDate = row.activityDate;
    }
    grouped.set(row.businessKey, current);
  });
  return [...grouped.values()];
}
