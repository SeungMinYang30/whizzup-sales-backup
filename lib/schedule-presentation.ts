const koreanWeekdays = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function formatScheduleDate(value: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) return value.replaceAll("-", "/");

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return value.replaceAll("-", "/");
  }

  return `${month}/${day} (${koreanWeekdays[candidate.getUTCDay()]})`;
}

type ScheduleRow = {
  organization: string;
  items: { date: string }[];
};

export function sortScheduleRowsByEarliestDate<T extends ScheduleRow>(rows: T[]) {
  return [...rows].sort(
    (left, right) =>
      (left.items[0]?.date ?? "").localeCompare(
        right.items[0]?.date ?? "",
      ) || left.organization.localeCompare(right.organization, "ko-KR"),
  );
}

export function sortScheduleRowsForDashboard<T extends ScheduleRow>(
  rows: T[],
  todayValue: string,
) {
  const normalizedRows = rows.map((row) => ({
    ...row,
    items: [...row.items].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
  }));

  return normalizedRows.sort((left, right) => {
    const leftUpcomingDate = left.items.find(
      (item) => item.date >= todayValue,
    )?.date;
    const rightUpcomingDate = right.items.find(
      (item) => item.date >= todayValue,
    )?.date;

    if (leftUpcomingDate && !rightUpcomingDate) return -1;
    if (!leftUpcomingDate && rightUpcomingDate) return 1;

    return (
      (leftUpcomingDate ?? left.items[0]?.date ?? "").localeCompare(
        rightUpcomingDate ?? right.items[0]?.date ?? "",
      ) || left.organization.localeCompare(right.organization, "ko-KR")
    );
  });
}
