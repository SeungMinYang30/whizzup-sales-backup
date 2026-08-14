export type ScheduleReminderMember = {
  id: number;
  displayName: string;
  role: "admin" | "assistant" | "member";
};

const sharedInstallationSchedulePattern = /(?:설치|납품|시공|공사|입고|출고|철거|통신|목공|도장|바닥|시스템|사인|검수)/;
const sharedSalesSchedulePattern = /^영업\s*[·•-]\s*/;
const sharedGeneralCategories = new Set(["meeting", "showroom", "other"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedPersonName(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function hasAssignedManager(value: unknown) {
  const manager = text(value);
  return Boolean(manager) && !["미정", "미지정", "해당 없음"].includes(manager);
}

export function isSharedPostAwardSchedule(input: {
  awardStatus: unknown;
  label: unknown;
}) {
  return (
    ["위즈업 수주", "협력사 수주"].includes(text(input.awardStatus)) &&
    sharedInstallationSchedulePattern.test(text(input.label))
  );
}

export function isSharedSalesSchedule(input: {
  category: unknown;
  label: unknown;
}) {
  const category = text(input.category);
  return sharedGeneralCategories.has(category) || (
    category === "general" && sharedSalesSchedulePattern.test(text(input.label))
  );
}

export function canMemberSeeScheduleReminder(
  row: {
    awardStatus: unknown;
    category?: unknown;
    label: unknown;
    assigneeMemberId?: unknown;
    progressManager: unknown;
    creatorMemberId: unknown;
    creatorName: unknown;
  },
  member: ScheduleReminderMember,
) {
  const shared = isSharedPostAwardSchedule({
    awardStatus: row.awardStatus,
    label: row.label,
  });
  const sharedSales = isSharedSalesSchedule({
    category: row.category,
    label: row.label,
  });
  const viewerName = normalizedPersonName(member.displayName);
  const managerName = normalizedPersonName(row.progressManager);
  const creatorName = normalizedPersonName(row.creatorName);
  const assigneeMemberId = Number(row.assigneeMemberId);
  const hasAssigneeMemberId = Number.isSafeInteger(assigneeMemberId) && assigneeMemberId > 0;
  const assignedToViewer = hasAssigneeMemberId
    ? assigneeMemberId === member.id
    : Boolean(viewerName) && managerName === viewerName;
  const createdByViewer =
    Number(row.creatorMemberId) === member.id ||
    (Boolean(viewerName) && creatorName === viewerName);

  if (sharedSales) return true;
  if (shared) {
    return member.role === "admin" || assignedToViewer || createdByViewer;
  }
  if (hasAssignedManager(row.progressManager)) return assignedToViewer;
  return createdByViewer;
}

export function canCompleteScheduleReminder(
  row: Parameters<typeof canMemberSeeScheduleReminder>[0] & {
    scheduledDate: unknown;
  },
  member: ScheduleReminderMember,
  todayValue: string,
) {
  const scheduledDate = text(row.scheduledDate);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) &&
    scheduledDate < todayValue &&
    canMemberSeeScheduleReminder(row, member)
  );
}
