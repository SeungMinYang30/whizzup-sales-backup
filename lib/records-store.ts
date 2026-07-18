import { getD1 } from "../db";
import type { Member } from "./collaboration";
import { ensureCollaborationReady } from "./collaboration";
import { resolveMappedRegion } from "./map-store";

export function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function serializeProgressSchedule(value: unknown) {
  if (!Array.isArray(value)) return clean(value);
  return value
    .slice(0, 50)
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const entry = item as Record<string, unknown>;
      const label = clean(entry.label) || clean(entry.name) || "진행";
      const date = clean(entry.date);
      return date ? `${label}\t${date}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function resolveAward(payload: Record<string, unknown>) {
  const requested = clean(payload.awardStatus);
  const awardStatus = ["미정", "위즈업 수주", "타업체 수주"].includes(requested)
    ? requested
    : "미정";
  const requestedCompany = clean(payload.awardCompany);
  if (awardStatus === "타업체 수주" && !requestedCompany) {
    throw new Error("타업체 수주일 때 수주 업체명은 필수입니다.");
  }
  return {
    awardStatus,
    awardCompany:
      awardStatus === "위즈업 수주"
        ? "위즈업"
        : awardStatus === "타업체 수주"
          ? requestedCompany
          : "",
  };
}

export function resolveAwardManagement(payload: Record<string, unknown>) {
  const requestedExecutionType = clean(payload.executionType);
  const executionType = ["미정", "직영", "컨소"].includes(
    requestedExecutionType,
  )
    ? requestedExecutionType
    : "미정";
  const consortiumCompany = clean(payload.consortiumCompany);
  if (executionType === "컨소" && !consortiumCompany) {
    throw new Error("컨소 사업일 때 업체명은 필수입니다.");
  }
  const requestedAwardStage = clean(payload.awardStage);
  const awardStage = [
    "미정",
    "품의",
    "협상",
    "계약",
    "일정 조율",
    "완공",
    "검수",
    "교육",
  ].includes(requestedAwardStage)
    ? requestedAwardStage
    : "미정";
  return {
    executionType,
    consortiumCompany: executionType === "컨소" ? consortiumCompany : "",
    awardStage,
  };
}

export async function ensureRecordsReady() {
  await ensureCollaborationReady();
  return getD1();
}

export async function insertActivity(
  payload: Record<string, unknown>,
  member: Member,
  defaultSource: string,
): Promise<Record<string, unknown>> {
  const organization = clean(payload.organization);
  const activityType = clean(payload.activityType);
  if (!organization || !activityType) {
    throw new Error("기관명과 활동유형은 필수입니다.");
  }
  const award = resolveAward(payload);
  const awardManagement = resolveAwardManagement(payload);

  const d1 = await ensureRecordsReady();
  const region = await resolveMappedRegion(
    organization,
    clean(payload.region),
  );
  return d1.transaction(async (transaction) => {
    const record = await transaction
      .prepare(`
        INSERT INTO activities (
          activity_date, date_confidence, activity_type, category, contact_method,
          region, organization, budget_type, budget_amount, topic, summary,
          status, temperature, award_status, award_company, execution_type,
          consortium_company, award_stage, progress_manager,
          follow_up_required, follow_up_date, next_action, progress_schedule, contact_name,
          contact_phone, contact_email, source_chat, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `)
      .bind(
        clean(payload.activityDate) || null,
        clean(payload.dateConfidence) || "확정",
        activityType,
        clean(payload.category) || "기타",
        clean(payload.contactMethod),
        region,
        organization,
        clean(payload.budgetType),
        clean(payload.budgetAmount),
        clean(payload.topic),
        clean(payload.summary),
        clean(payload.status) || "진행 중",
        clean(payload.temperature) || "중간",
        award.awardStatus,
        award.awardCompany,
        awardManagement.executionType,
        awardManagement.consortiumCompany,
        awardManagement.awardStage,
        clean(payload.progressManager),
        payload.followUpRequired !== false,
        clean(payload.followUpDate) || null,
        clean(payload.nextAction),
        serializeProgressSchedule(payload.progressSchedule),
        clean(payload.contactName),
        clean(payload.contactPhone),
        clean(payload.contactEmail),
        clean(payload.sourceChat) || defaultSource,
        clean(payload.notes),
      )
      .first<Record<string, unknown>>();

    if (!record) throw new Error("기록을 저장하지 못했습니다.");
    await transaction
      .prepare(`
        INSERT INTO activity_authors (
          activity_id, member_id, created_by_name, created_at
        ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (activity_id) DO UPDATE SET
          member_id = EXCLUDED.member_id,
          created_by_name = EXCLUDED.created_by_name,
          created_at = EXCLUDED.created_at
      `)
      .bind(Number(record.id), member.id, member.displayName)
      .run();
    return { ...record, created_by_name: member.displayName };
  });
}
