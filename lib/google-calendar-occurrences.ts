type ConstructionOccurrenceSchedule = {
  id: number;
  category: string;
  scheduledDate: string;
  endDate: string;
  startTime: string;
};

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function constructionOccurrenceDates(schedule: ConstructionOccurrenceSchedule) {
  if (schedule.category !== "construction" || schedule.startTime.trim()) {
    return [schedule.scheduledDate];
  }
  const endDate = schedule.endDate >= schedule.scheduledDate
    ? schedule.endDate
    : schedule.scheduledDate;
  const dates: string[] = [];
  for (let date = schedule.scheduledDate; date <= endDate && dates.length < 366; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates.length ? dates : [schedule.scheduledDate];
}
