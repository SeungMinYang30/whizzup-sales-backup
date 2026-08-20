import { isCompletedAwardStage } from "./sales-taxonomy";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeAwardCompletedDate(value: unknown) {
  const date = String(value ?? "").trim().slice(0, 10);
  return datePattern.test(date) ? date : "";
}

export function resolveAwardCompletedDate({
  awardStage,
  requestedDate,
  previousDate,
  fallbackDate,
}: {
  awardStage: unknown;
  requestedDate?: unknown;
  previousDate?: unknown;
  fallbackDate?: unknown;
}) {
  if (!isCompletedAwardStage(awardStage)) return "";
  return (
    normalizeAwardCompletedDate(requestedDate) ||
    normalizeAwardCompletedDate(previousDate) ||
    normalizeAwardCompletedDate(fallbackDate)
  );
}
