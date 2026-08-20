import {
  SALES_PROGRESS_OPTIONS,
  normalizeSalesProgress,
} from "./sales-taxonomy";

export const AI_SUGGESTED_STATUS_VALUES = SALES_PROGRESS_OPTIONS;

export function normalizeAiSuggestedStatus(
  value: unknown,
  followUpRequired = false,
) {
  void followUpRequired;
  const requested = String(value ?? "").trim();
  return AI_SUGGESTED_STATUS_VALUES.includes(
    requested as (typeof AI_SUGGESTED_STATUS_VALUES)[number],
  )
    ? requested
    : normalizeSalesProgress(requested);
}
