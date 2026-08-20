import { institutionAliasKey } from "./institution-names";

export type AwardStateRecord = Record<string, unknown>;

function field(record: AwardStateRecord, camel: string, snake: string) {
  return record[camel] ?? record[snake];
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isTrue(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function recordDate(record: AwardStateRecord) {
  return clean(field(record, "activityDate", "activity_date"));
}

function recordId(record: AwardStateRecord) {
  return Number(record.id ?? record.activity_id ?? 0);
}

export function awardStatusForRecord(record: AwardStateRecord) {
  return clean(field(record, "awardStatus", "award_status")) || "미정";
}

export function hasExplicitAwardStatus(record: AwardStateRecord) {
  return isTrue(field(record, "awardStatusExplicit", "award_status_explicit"));
}

export function awardBusinessKey(record: AwardStateRecord) {
  const organization = institutionAliasKey(clean(record.organization));
  const parsedRound = Number(field(record, "businessRound", "business_round"));
  const businessRound =
    Number.isSafeInteger(parsedRound) && parsedRound > 0 ? parsedRound : 1;
  return organization ? `${organization}\u001f${businessRound}` : "";
}

/**
 * Ordinary activities carry an implicit pending value and must not erase a
 * previous award. A pending value only wins when a user explicitly saved it.
 */
export function latestAwardStateRecords<T extends AwardStateRecord>(source: T[]) {
  const latestByBusiness = new Map<string, T>();
  [...source]
    .sort(
      (left, right) =>
        recordDate(right).localeCompare(recordDate(left)) ||
        recordId(right) - recordId(left),
    )
    .forEach((record) => {
      const businessKey = awardBusinessKey(record);
      if (!businessKey || latestByBusiness.has(businessKey)) return;
      if (
        awardStatusForRecord(record) === "미정" &&
        !hasExplicitAwardStatus(record)
      ) {
        return;
      }
      latestByBusiness.set(businessKey, record);
    });
  return [...latestByBusiness.values()];
}

export function latestAwardRecords<T extends AwardStateRecord>(source: T[]) {
  return latestAwardStateRecords(source).filter(
    (record) => awardStatusForRecord(record) !== "미정",
  );
}
