"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  BudgetAmountMode,
  BudgetKind,
} from "./budget-name-selector";

type BudgetNameRow = {
  name: string;
  activityCount: number;
  projectCount: number;
  matchStatus: string;
};

type BudgetAlias = {
  id: number;
  groupId: number;
  aliasName: string;
  aliasKey: string;
};

type BudgetMember = {
  id: number;
  groupId: number;
  entityType: "activity" | "equipment_project";
  entityId: number;
  activityId: number;
  originalName: string;
  aliasKey: string;
  organization: string;
  activityDate: string;
  businessRound: number;
  recordName: string;
  progressManager: string;
};

type BudgetBusinessMembers = {
  key: string;
  organization: string;
  businessRound: number;
  activityDate: string;
  progressManager: string;
  members: BudgetMember[];
};

type BudgetGroup = {
  id: number;
  canonicalName: string;
  canonicalKey: string;
  budgetKind: BudgetKind;
  amountMode: BudgetAmountMode;
  defaultAmount: number | null;
  active: boolean;
  sortOrder: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  aliases: BudgetAlias[];
  members: BudgetMember[];
};

type BudgetRequestCandidate = {
  groupId: number;
  canonicalName: string;
  budgetKind: BudgetKind;
  amountMode: BudgetAmountMode;
  reason: string;
};

type BudgetRequest = {
  id: string;
  requestedName: string;
  status: string;
  expectedKind: BudgetKind;
  submissionCount: number;
  applicants: string[];
  createdAt: string;
  relatedRecords: Array<{
    submissionId?: string;
    activityId?: number;
    organization: string;
    applicantName: string;
    reason: string;
  }>;
  candidates: BudgetRequestCandidate[];
  decisionReason: string;
};

type BudgetEvent = {
  id: number;
  groupId: number | null;
  action: string;
  changedByName: string;
  createdAt: string;
  summary: string;
  undoable: boolean;
};

type RetrofitRow = {
  entityType: "activity" | "equipment_project";
  entityId: number;
  organization: string;
  originalName: string;
  activityDate: string;
  awardStatus: string;
};

type BudgetManagementPayload = {
  names: BudgetNameRow[];
  groups: BudgetGroup[];
  requests: BudgetRequest[];
  events: BudgetEvent[];
  retrofitPreview: RetrofitRow[];
  error?: string;
};

type ManagerTab = "standards" | "unclassified" | "requests" | "history";
type RequestDecision = "approve-new" | "approve-alias" | "hold" | "reject";

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function moneyInput(value: unknown) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
}

function formatMoney(value: number | null) {
  return value === null ? "미지정" : `${value.toLocaleString("ko-KR")}원`;
}

function normalizeKind(value: unknown): BudgetKind {
  const text = clean(value);
  if (text === "purpose" || text === "목적예산") return "purpose";
  if (text === "self" || text === "자체예산") return "self";
  return "";
}

function normalizeMode(value: unknown): BudgetAmountMode {
  const text = clean(value);
  if (["manual", "수기 입력", "직접 입력"].includes(text)) return "manual";
  if (
    ["quote_auto", "자동 계산", "품목 합계 자동 계산"].includes(text)
  ) {
    return "quote_auto";
  }
  return "";
}

function budgetKindLabel(value: unknown) {
  return normalizeKind(value) === "self" ? "자체예산" : "목적예산";
}

function amountModeLabel(value: unknown) {
  return normalizeMode(value) === "quote_auto"
    ? "품목·견적 합계 자동 계산"
    : "금액 직접 입력";
}

function statusLabel(value: unknown) {
  switch (clean(value).toLocaleLowerCase()) {
    case "pending":
      return "승인 대기";
    case "hold":
      return "보류";
    case "rejected":
      return "반려";
    case "approved":
      return "승인";
    default:
      return clean(value) || "승인 대기";
  }
}

function normalizeAlias(value: unknown): BudgetAlias | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = positiveInteger(row.id);
  const groupId = positiveInteger(row.groupId ?? row.group_id);
  const aliasName = clean(row.aliasName ?? row.alias_name ?? row.name);
  if (!id || !groupId || !aliasName) return null;
  return {
    id,
    groupId,
    aliasName,
    aliasKey: clean(row.aliasKey ?? row.alias_key),
  };
}

function normalizeMember(value: unknown): BudgetMember | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = positiveInteger(row.id);
  const groupId = positiveInteger(row.groupId ?? row.group_id);
  const entityId = positiveInteger(row.entityId ?? row.entity_id);
  if (!id || !groupId || !entityId) return null;
  const entityType =
    clean(row.entityType ?? row.entity_type) === "equipment_project"
      ? "equipment_project"
      : "activity";
  return {
    id,
    groupId,
    entityType,
    entityId,
    activityId:
      positiveInteger(row.activityId ?? row.activity_id) ||
      (entityType === "activity" ? entityId : 0),
    originalName: clean(row.originalName ?? row.original_name),
    aliasKey: clean(row.aliasKey ?? row.alias_key),
    organization: clean(row.organization),
    activityDate: clean(row.activityDate ?? row.activity_date),
    businessRound: Math.max(
      1,
      Number(row.businessRound ?? row.business_round) || 1,
    ),
    recordName: clean(row.recordName ?? row.record_name),
    progressManager: clean(row.progressManager ?? row.progress_manager),
  };
}

function budgetBusinessKey(member: BudgetMember) {
  return member.activityId
    ? `activity:${member.activityId}`
    : `${member.entityType}:${member.entityId}`;
}

function groupBudgetBusinessMembers(members: BudgetMember[]) {
  const grouped = new Map<string, BudgetMember[]>();
  for (const member of members) {
    const key = budgetBusinessKey(member);
    const values = grouped.get(key) ?? [];
    values.push(member);
    grouped.set(key, values);
  }
  return [...grouped.entries()].map(([key, records]): BudgetBusinessMembers => {
    const primary =
      records.find((record) => record.entityType === "activity") ?? records[0];
    const fallback = records.find((record) => record.organization) ?? primary;
    return {
      key,
      organization: primary.organization || fallback.organization,
      businessRound: primary.businessRound || fallback.businessRound || 1,
      activityDate: primary.activityDate || fallback.activityDate,
      progressManager: primary.progressManager || fallback.progressManager,
      members: [...records].sort(
        (left, right) =>
          Number(left.entityType === "equipment_project") -
            Number(right.entityType === "equipment_project") ||
          right.id - left.id,
      ),
    };
  });
}

function normalizeGroup(value: unknown): BudgetGroup | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = positiveInteger(row.id ?? row.groupId ?? row.group_id);
  const canonicalName = clean(
    row.canonicalName ?? row.canonical_name ?? row.name,
  );
  if (!id || !canonicalName) return null;
  return {
    id,
    canonicalName,
    canonicalKey: clean(row.canonicalKey ?? row.canonical_key),
    budgetKind: normalizeKind(
      row.budgetKind ?? row.budget_kind ?? row.kind,
    ),
    amountMode: normalizeMode(
      row.amountMode ?? row.amount_mode ?? row.amountHandling,
    ),
    defaultAmount:
      row.defaultAmount === null || row.default_amount === null
        ? null
        : Number.isFinite(Number(row.defaultAmount ?? row.default_amount))
          ? Math.max(0, Number(row.defaultAmount ?? row.default_amount))
          : null,
    active:
      row.active === undefined ? true : Boolean(Number(row.active) || row.active === true),
    sortOrder: Number(row.sortOrder ?? row.sort_order) || 0,
    createdByName: clean(row.createdByName ?? row.created_by_name),
    createdAt: clean(row.createdAt ?? row.created_at),
    updatedAt: clean(row.updatedAt ?? row.updated_at),
    aliases: (Array.isArray(row.aliases) ? row.aliases : [])
      .map(normalizeAlias)
      .filter((item): item is BudgetAlias => Boolean(item)),
    members: (Array.isArray(row.members) ? row.members : [])
      .map(normalizeMember)
      .filter((item): item is BudgetMember => Boolean(item)),
  };
}

function normalizeRequestCandidate(value: unknown): BudgetRequestCandidate | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const groupId = positiveInteger(row.groupId ?? row.group_id ?? row.id);
  const canonicalName = clean(
    row.canonicalName ?? row.canonical_name ?? row.name,
  );
  if (!groupId || !canonicalName) return null;
  return {
    groupId,
    canonicalName,
    budgetKind: normalizeKind(row.budgetKind ?? row.budget_kind),
    amountMode: normalizeMode(row.amountMode ?? row.amount_mode),
    reason: clean(row.reason ?? row.matchReason ?? row.match_reason),
  };
}

function normalizeRequest(value: unknown): BudgetRequest | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = clean(row.id ?? row.requestId ?? row.request_id);
  const requestedName = clean(
    row.requestedName ?? row.requested_name ?? row.name,
  );
  if (!id || !requestedName) return null;
  const submissions = Array.isArray(row.relatedRecords)
    ? row.relatedRecords
    : Array.isArray(row.submissions)
      ? row.submissions
      : [];
  return {
    id,
    requestedName,
    status: clean(row.status) || "pending",
    expectedKind: normalizeKind(
      row.expectedKind ?? row.expected_kind ?? row.budgetKind,
    ),
    submissionCount:
      positiveInteger(row.submissionCount ?? row.submission_count) ||
      submissions.length ||
      1,
    applicants: Array.isArray(row.applicants)
      ? row.applicants.map(clean).filter(Boolean)
      : clean(row.applicantNames ?? row.applicant_names)
          .split(",")
          .map(clean)
          .filter(Boolean),
    createdAt: clean(row.createdAt ?? row.created_at),
    relatedRecords: submissions.map((submission) => {
      const related = (submission ?? {}) as Record<string, unknown>;
      return {
        submissionId:
          clean(related.submissionId ?? related.submission_id) ||
          undefined,
        activityId:
          positiveInteger(related.activityId ?? related.activity_id) ||
          undefined,
        organization: clean(related.organization),
        applicantName: clean(
          related.applicantName ??
            related.applicant_name ??
            related.submittedByName,
        ),
        reason: clean(related.reason),
      };
    }),
    candidates: (Array.isArray(row.candidates) ? row.candidates : [])
      .map(normalizeRequestCandidate)
      .filter((item): item is BudgetRequestCandidate => Boolean(item)),
    decisionReason: clean(
      row.decisionReason ?? row.decision_reason ?? row.reviewReason,
    ),
  };
}

function normalizeEvent(value: unknown): BudgetEvent | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = positiveInteger(row.id);
  if (!id) return null;
  return {
    id,
    groupId: positiveInteger(row.groupId ?? row.group_id) || null,
    action: clean(row.action),
    changedByName: clean(row.changedByName ?? row.changed_by_name),
    createdAt: clean(row.createdAt ?? row.created_at),
    summary: clean(row.summary ?? row.description),
    undoable: Boolean(row.undoable),
  };
}

function normalizeRetrofitRow(value: unknown): RetrofitRow | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const entityId = positiveInteger(row.entityId ?? row.entity_id ?? row.id);
  if (!entityId) return null;
  return {
    entityType:
      clean(row.entityType ?? row.entity_type) === "equipment_project"
        ? "equipment_project"
        : "activity",
    entityId,
    organization: clean(row.organization),
    originalName: clean(
      row.originalName ?? row.original_name ?? row.budgetType,
    ),
    activityDate: clean(row.activityDate ?? row.activity_date),
    awardStatus: clean(row.awardStatus ?? row.award_status),
  };
}

function normalizePayload(payload: Record<string, unknown>): BudgetManagementPayload {
  const names = (Array.isArray(payload.names) ? payload.names : [])
    .map((value): BudgetNameRow | null => {
      const row = (value ?? {}) as Record<string, unknown>;
      const name = clean(row.name ?? row.originalName ?? row.original_name);
      if (!name) return null;
      return {
        name,
        activityCount: Number(row.activityCount ?? row.activity_count) || 0,
        projectCount: Number(row.projectCount ?? row.project_count) || 0,
        matchStatus: clean(row.matchStatus ?? row.match_status) || "unclassified",
      };
    })
    .filter((item): item is BudgetNameRow => Boolean(item));
  return {
    names,
    groups: (Array.isArray(payload.groups) ? payload.groups : [])
      .map(normalizeGroup)
      .filter((item): item is BudgetGroup => Boolean(item)),
    requests: (Array.isArray(payload.requests) ? payload.requests : [])
      .map(normalizeRequest)
      .filter((item): item is BudgetRequest => Boolean(item)),
    events: (Array.isArray(payload.events) ? payload.events : [])
      .map(normalizeEvent)
      .filter((item): item is BudgetEvent => Boolean(item)),
    retrofitPreview: (
      Array.isArray(payload.retrofitPreview)
        ? payload.retrofitPreview
        : Array.isArray(payload.retrofit_preview)
          ? payload.retrofit_preview
          : []
    )
      .map(normalizeRetrofitRow)
      .filter((item): item is RetrofitRow => Boolean(item)),
    error: clean(payload.error),
  };
}

function formatDateTime(value: string) {
  if (!value) return "기록 없음";
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BudgetNameManager({
  onToast,
}: {
  onToast: (message: string) => void;
}) {
  const [data, setData] = useState<BudgetManagementPayload>({
    names: [],
    groups: [],
    requests: [],
    events: [],
    retrofitPreview: [],
  });
  const [tab, setTab] = useState<ManagerTab>("standards");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [targetGroupId, setTargetGroupId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<BudgetKind>("purpose");
  const [newAmountMode, setNewAmountMode] =
    useState<BudgetAmountMode>("manual");
  const [newDefaultAmount, setNewDefaultAmount] = useState("");
  const [aliasDrafts, setAliasDrafts] = useState<Record<number, string>>({});
  const [editGroupId, setEditGroupId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState<BudgetKind>("purpose");
  const [editAmountMode, setEditAmountMode] =
    useState<BudgetAmountMode>("manual");
  const [editDefaultAmount, setEditDefaultAmount] = useState("");
  const [memberMoveOpenId, setMemberMoveOpenId] = useState<string | null>(null);
  const [memberMoveTargets, setMemberMoveTargets] = useState<
    Record<string, number>
  >({});
  const [requestDecision, setRequestDecision] = useState<
    Record<string, RequestDecision>
  >({});
  const [requestTarget, setRequestTarget] = useState<Record<string, number>>({});
  const [requestReason, setRequestReason] = useState<Record<string, string>>({});
  const [requestKind, setRequestKind] = useState<Record<string, BudgetKind>>({});
  const [requestMode, setRequestMode] = useState<
    Record<string, BudgetAmountMode>
  >({});
  const [retrofitContext, setRetrofitContext] = useState<{
    groupId?: number;
    requestId?: string;
    originalName?: string;
  } | null>(null);
  const [selectedRetrofit, setSelectedRetrofit] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/budget-names", { cache: "no-store" });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(clean(payload.error) || "예산명 목록을 불러오지 못했습니다.");
      }
      setData(normalizePayload(payload));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "예산명 목록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function runAction(
    body: Record<string, unknown>,
    successMessage: string,
    preserveMissingCollections = false,
  ) {
    if (saving) return null;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/budget-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(clean(payload.error) || "예산명 작업을 완료하지 못했습니다.");
      }
      const normalized = normalizePayload(payload);
      setData((current) =>
        preserveMissingCollections
          ? {
              names:
                "names" in payload || "budgetNames" in payload
                  ? normalized.names
                  : current.names,
              groups:
                "groups" in payload || "catalog" in payload
                  ? normalized.groups
                  : current.groups,
              requests:
                "requests" in payload || "pendingRequests" in payload
                  ? normalized.requests
                  : current.requests,
              events:
                "events" in payload || "history" in payload
                  ? normalized.events
                  : current.events,
              retrofitPreview:
                "retrofitPreview" in payload || "retrofit_preview" in payload
                  ? normalized.retrofitPreview
                  : current.retrofitPreview,
              error: normalized.error || current.error,
            }
          : normalized,
      );
      onToast(successMessage);
      return normalized;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "예산명 작업을 완료하지 못했습니다.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  const activeGroups = useMemo(
    () =>
      data.groups
        .filter((group) => group.active)
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.canonicalName.localeCompare(right.canonicalName, "ko-KR"),
        ),
    [data.groups],
  );
  const orderedGroups = useMemo(
    () =>
      [...data.groups].sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          left.sortOrder - right.sortOrder ||
          left.canonicalName.localeCompare(right.canonicalName, "ko-KR"),
      ),
    [data.groups],
  );
  const budgetBusinessGroupIds = useMemo(() => {
    const linkedGroups = new Map<string, Set<number>>();
    for (const group of data.groups.filter((item) => item.active)) {
      for (const member of group.members) {
        const key = budgetBusinessKey(member);
        const groupIds = linkedGroups.get(key) ?? new Set<number>();
        groupIds.add(group.id);
        linkedGroups.set(key, groupIds);
      }
    }
    return linkedGroups;
  }, [data.groups]);
  const pendingRequests = data.requests.filter((request) =>
    ["pending", "hold", "신청 대기", "보류"].includes(request.status),
  );
  const filteredGroups = orderedGroups.filter((group) => {
    const keyword = search.trim().toLocaleLowerCase("ko-KR");
    return (
      !keyword ||
      group.canonicalName.toLocaleLowerCase("ko-KR").includes(keyword) ||
      group.aliases.some((alias) =>
        alias.aliasName.toLocaleLowerCase("ko-KR").includes(keyword),
      )
    );
  });
  const filteredNames = data.names.filter((item) => {
    const keyword = search.trim().toLocaleLowerCase("ko-KR");
    return !keyword || item.name.toLocaleLowerCase("ko-KR").includes(keyword);
  });

  function updateNewKind(kind: BudgetKind) {
    setNewKind(kind);
    setNewAmountMode(kind === "self" ? "quote_auto" : "manual");
  }

  function toggleName(name: string) {
    const wasSelected = selectedNames.includes(name);
    const next = wasSelected
      ? selectedNames.filter((item) => item !== name)
      : [...selectedNames, name];
    setSelectedNames(next);
    if (!wasSelected && !clean(newName)) {
      setNewName(name);
    } else if (wasSelected && clean(newName) === clean(name)) {
      setNewName(next[0] ?? "");
    }
  }

  async function createStandard() {
    const canonicalName = clean(newName);
    if (!canonicalName) {
      setError("새 표준 예산명을 입력해 주세요.");
      return;
    }
    const result = await runAction(
      {
        action: "create-standard",
        canonicalName,
        budgetKind: newKind,
        amountMode: newAmountMode,
        defaultAmount: newDefaultAmount,
      },
      `표준 예산명 ‘${canonicalName}’을 등록했습니다.`,
    );
    if (result) {
      setNewName("");
      setNewDefaultAmount("");
      setTab("standards");
    }
  }

  async function connectSelected() {
    if (!selectedNames.length || !targetGroupId) {
      setError("연결할 예산명과 표준 예산명을 선택해 주세요.");
      return;
    }
    const target = activeGroups.find((group) => group.id === targetGroupId);
    if (
      !target ||
      !window.confirm(
        `${selectedNames.length}개 이름을 ‘${target.canonicalName}’에 연결할까요?\n협력사·타업체 수주는 변경하지 않습니다.`,
      )
    ) {
      return;
    }
    const result = await runAction(
      {
        action: "connect-existing",
        selectedNames,
        groupId: targetGroupId,
      },
      `${selectedNames.length}개 이름을 ‘${target.canonicalName}’에 연결했습니다.`,
    );
    if (result) setSelectedNames([]);
  }

  async function registerSelected() {
    const canonicalName = clean(newName);
    if (!selectedNames.length || !canonicalName) {
      setError("등록할 원본 이름과 새 표준 예산명을 입력해 주세요.");
      return;
    }
    if (
      !window.confirm(
        `${selectedNames.length}개 이름을 새 표준 예산 ‘${canonicalName}’으로 등록할까요?`,
      )
    ) {
      return;
    }
    const result = await runAction(
      {
        action: "register-new",
        selectedNames,
        canonicalName,
        budgetKind: newKind,
        amountMode: newAmountMode,
      },
      `새 표준 예산명 ‘${canonicalName}’을 등록하고 선택한 이름을 연결했습니다.`,
    );
    if (result) {
      setSelectedNames([]);
      setNewName("");
      setTab("standards");
    }
  }

  async function addAlias(group: BudgetGroup) {
    const aliasName = clean(aliasDrafts[group.id]);
    if (!aliasName) {
      setError("추가할 별칭을 입력해 주세요.");
      return;
    }
    const result = await runAction(
      { action: "add-alias", groupId: group.id, aliasName },
      `‘${aliasName}’을 ‘${group.canonicalName}’의 별칭으로 추가했습니다.`,
    );
    if (result) {
      setAliasDrafts((current) => ({ ...current, [group.id]: "" }));
    }
  }

  async function saveGroup(group: BudgetGroup) {
    const canonicalName = clean(editName);
    if (!canonicalName) {
      setError("표준 예산명을 입력해 주세요.");
      return;
    }
    const result = await runAction(
      {
        action: "update-standard",
        groupId: group.id,
        canonicalName,
        budgetKind: editKind,
        amountMode: editAmountMode,
        defaultAmount: editDefaultAmount,
      },
      `표준 예산명 ‘${canonicalName}’의 설정을 저장했습니다.`,
    );
    if (result) setEditGroupId(null);
  }

  async function processRequest(request: BudgetRequest) {
    const decision = requestDecision[request.id] ?? "approve-new";
    const decisionReason = clean(requestReason[request.id]);
    if (decision === "reject" && !decisionReason) {
      setError("반려 사유를 입력해 주세요.");
      return;
    }
    if (decision === "approve-alias" && !requestTarget[request.id]) {
      setError("별칭으로 연결할 기존 표준 예산명을 선택해 주세요.");
      return;
    }
    const kind =
      requestKind[request.id] || request.expectedKind || "purpose";
    const mode =
      requestMode[request.id] ||
      (kind === "self" ? "quote_auto" : "manual");
    const result = await runAction(
      {
        action: "process-request",
        requestId: request.id,
        decision,
        targetGroupId: requestTarget[request.id] || null,
        canonicalName: request.requestedName,
        budgetKind: kind,
        amountMode: mode,
        reason: decisionReason,
      },
      decision === "approve-new"
        ? `‘${request.requestedName}’을 새 표준 예산명으로 승인했습니다.`
        : decision === "approve-alias"
          ? `‘${request.requestedName}’을 기존 표준 예산명의 별칭으로 승인했습니다.`
          : decision === "hold"
            ? `‘${request.requestedName}’ 신청을 보류했습니다.`
            : `‘${request.requestedName}’ 신청을 반려했습니다.`,
    );
    if (result && ["approve-new", "approve-alias"].includes(decision)) {
      const approved = result.groups.find(
        (group) =>
          group.id === requestTarget[request.id] ||
          group.canonicalName === request.requestedName,
      );
      setRetrofitContext({
        groupId: approved?.id,
        requestId: request.id,
        originalName: request.requestedName,
      });
      const preview = await runAction(
        {
          action: "preview-retrofit",
          groupId: approved?.id,
          requestId: request.id,
          originalName: request.requestedName,
        },
        "신청에 직접 연결되지 않은 과거 기록을 미리 확인했습니다.",
        true,
      );
      if (preview) {
        setSelectedRetrofit([]);
      }
    }
  }

  async function applyRetrofit() {
    if (!retrofitContext || !selectedRetrofit.length) return;
    const targets = selectedRetrofit.map((target) => {
      const [entityType, entityId] = target.split(":");
      return { entityType, entityId: Number(entityId) };
    });
    const result = await runAction(
      {
        action: "apply-retrofit",
        ...retrofitContext,
        targets,
      },
      `선택한 과거 기록 ${targets.length}건에 표준 예산명을 적용했습니다.`,
    );
    if (result) {
      setSelectedRetrofit([]);
      setRetrofitContext(null);
    }
  }

  return (
    <section className="budget-name-manager">
      <nav className="budget-manager-tabs" aria-label="표준 예산명 관리">
        <button
          type="button"
          className={tab === "standards" ? "active" : ""}
          onClick={() => setTab("standards")}
        >
          등록된 표준 예산명
          <span>{activeGroups.length}</span>
        </button>
        <button
          type="button"
          className={tab === "unclassified" ? "active" : ""}
          onClick={() => setTab("unclassified")}
        >
          미분류·불러온 예산명
          <span>{data.names.length}</span>
        </button>
        <button
          type="button"
          className={tab === "requests" ? "active" : ""}
          onClick={() => setTab("requests")}
        >
          신청 대기
          <span className={pendingRequests.length ? "attention" : ""}>
            {pendingRequests.length}
          </span>
        </button>
        <button
          type="button"
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          변경 이력
        </button>
      </nav>

      {error && (
        <div className="budget-name-error" role="alert">
          {error}
        </div>
      )}

      {tab === "standards" && (
        <>
          <div className="panel budget-standard-create-panel">
            <div className="panel-header">
              <div>
                <span className="section-kicker">STANDARD BUDGET</span>
                <h2>표준 예산명 사전등록</h2>
                <p>
                  영업 기록이 아직 없어도 먼저 등록할 수 있습니다. 직원은 활성
                  표준 예산명만 검색·선택합니다.
                </p>
              </div>
            </div>
            <div className="budget-standard-create-form">
              <label>
                <span>새 표준 예산명</span>
                <input
                  value={newName}
                  maxLength={120}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="예: 학교공간혁신"
                />
              </label>
              <label>
                <span>예산 구분</span>
                <select
                  value={newKind}
                  onChange={(event) =>
                    updateNewKind(normalizeKind(event.target.value) || "purpose")
                  }
                >
                  <option value="purpose">목적예산</option>
                  <option value="self">자체예산</option>
                </select>
              </label>
              <label>
                <span>금액 처리</span>
                <select
                  value={newAmountMode}
                  onChange={(event) =>
                    setNewAmountMode(
                      normalizeMode(event.target.value) || "manual",
                    )
                  }
                >
                  <option value="manual">금액 직접 입력</option>
                  <option value="quote_auto">품목·견적 합계 자동 계산</option>
                </select>
              </label>
              <label>
                <span>기본 예산액 (선택)</span>
                <input
                  inputMode="numeric"
                  value={newDefaultAmount}
                  onChange={(event) =>
                    setNewDefaultAmount(moneyInput(event.target.value))
                  }
                  placeholder="예: 50,000,000"
                />
                <small>새 기록에서 제안만 하며 기존 기록은 변경하지 않습니다.</small>
              </label>
              <button
                type="button"
                className="primary"
                disabled={saving || !newName.trim()}
                onClick={() => void createStandard()}
              >
                표준 예산명 등록
              </button>
            </div>
          </div>

          <div className="panel budget-name-groups-panel">
            <div className="panel-header budget-standard-list-header">
              <div>
                <span className="section-kicker">REGISTERED BUDGETS</span>
                <h2>등록된 표준 예산명</h2>
                <p>
                  사용 중인 이름은 삭제하지 않고 비활성화합니다. 별칭은 하나씩
                  안전하게 추가·해제할 수 있습니다.
                </p>
              </div>
              <div className="inline-search">
                <span>⌕</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="표준명·별칭 검색"
                />
              </div>
            </div>
            <div className="budget-group-list" aria-busy={loading}>
              {filteredGroups.map((group) => {
                const editing = group.active && editGroupId === group.id;
                const businesses = groupBudgetBusinessMembers(group.members);
                const additionalAliases = group.aliases.filter(
                  (alias) =>
                    alias.aliasKey !== group.canonicalKey &&
                    alias.aliasName !== group.canonicalName,
                );
                return (
                  <article
                    key={group.id}
                    className={group.active ? "" : "inactive"}
                  >
                    <header>
                      <div>
                        <div className="budget-standard-badges">
                          <span>{budgetKindLabel(group.budgetKind)}</span>
                          <span>{group.active ? "사용 중" : "비활성"}</span>
                        </div>
                        <h3>{group.canonicalName}</h3>
                        <small>
                          {amountModeLabel(group.amountMode)} · 기본 예산액{" "}
                          {formatMoney(group.defaultAmount)} · 연결 기록{" "}
                          {group.members.length.toLocaleString()}건
                        </small>
                      </div>
                      <div className="budget-standard-order">
                        {group.active && (
                          <>
                            <button
                              type="button"
                              aria-label={`${group.canonicalName} 위로 이동`}
                              disabled={
                                saving ||
                                activeGroups.findIndex(
                                  (item) => item.id === group.id,
                                ) === 0
                              }
                              onClick={() =>
                                void runAction(
                                  {
                                    action: "reorder",
                                    groupId: group.id,
                                    direction: "up",
                                  },
                                  "표시 순서를 변경했습니다.",
                                )
                              }
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`${group.canonicalName} 아래로 이동`}
                              disabled={
                                saving ||
                                activeGroups.findIndex(
                                  (item) => item.id === group.id,
                                ) ===
                                  activeGroups.length - 1
                              }
                              onClick={() =>
                                void runAction(
                                  {
                                    action: "reorder",
                                    groupId: group.id,
                                    direction: "down",
                                  },
                                  "표시 순서를 변경했습니다.",
                                )
                              }
                            >
                              ↓
                            </button>
                          </>
                        )}
                        {group.active && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditGroupId(group.id);
                              setEditName(group.canonicalName);
                              setEditKind(group.budgetKind || "purpose");
                              setEditAmountMode(group.amountMode || "manual");
                              setEditDefaultAmount(
                                group.defaultAmount === null
                                  ? ""
                                  : moneyInput(group.defaultAmount),
                              );
                            }}
                          >
                            설정 수정
                          </button>
                        )}
                        {group.active ? (
                          <button
                            type="button"
                            className="danger"
                            disabled={saving}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `‘${group.canonicalName}’을 비활성화할까요?\n기존 기록은 유지되고 새 기록에서만 선택할 수 없게 됩니다.`,
                                )
                              ) {
                                void runAction(
                                  {
                                    action: "set-active",
                                    groupId: group.id,
                                    active: false,
                                  },
                                  "표준 예산명을 비활성화했습니다.",
                                );
                              }
                            }}
                          >
                            비활성화
                          </button>
                        ) : (
                          <>
                            <small className="budget-standard-reactivation-note">
                              설정 변경은 다시 활성화한 뒤 가능합니다.
                            </small>
                            <button
                              type="button"
                              className="primary"
                              disabled={saving}
                              onClick={() =>
                                void runAction(
                                  {
                                    action: "set-active",
                                    groupId: group.id,
                                    active: true,
                                  },
                                  "표준 예산명을 다시 활성화했습니다.",
                                )
                              }
                            >
                              다시 활성화
                            </button>
                          </>
                        )}
                      </div>
                    </header>

                    {editing && (
                      <div className="budget-standard-edit">
                        <label>
                          <span>대표명</span>
                          <input
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                          />
                        </label>
                        <label>
                          <span>예산 구분</span>
                          <select
                            value={editKind}
                            onChange={(event) => {
                              const kind =
                                normalizeKind(event.target.value) || "purpose";
                              setEditKind(kind);
                              setEditAmountMode(
                                kind === "self" ? "quote_auto" : "manual",
                              );
                            }}
                          >
                            <option value="purpose">목적예산</option>
                            <option value="self">자체예산</option>
                          </select>
                        </label>
                        <label>
                          <span>금액 처리</span>
                          <select
                            value={editAmountMode}
                            onChange={(event) =>
                              setEditAmountMode(
                                normalizeMode(event.target.value) || "manual",
                              )
                            }
                          >
                            <option value="manual">금액 직접 입력</option>
                            <option value="quote_auto">
                              품목·견적 합계 자동 계산
                            </option>
                          </select>
                        </label>
                        <label>
                          <span>기본 예산액 (선택)</span>
                          <input
                            inputMode="numeric"
                            value={editDefaultAmount}
                            onChange={(event) =>
                              setEditDefaultAmount(
                                moneyInput(event.target.value),
                              )
                            }
                            placeholder="미지정"
                          />
                        </label>
                        <button
                          type="button"
                          className="primary"
                          disabled={saving}
                          onClick={() => void saveGroup(group)}
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditGroupId(null)}
                        >
                          취소
                        </button>
                      </div>
                    )}

                    <section className="budget-alias-section">
                      <header>
                        <strong>등록된 별칭</strong>
                        <small>
                          추가 별칭 {additionalAliases.length.toLocaleString()}개
                          · 같은 예산명을 입력할 때 이 표준명으로 연결됩니다.
                        </small>
                      </header>
                    <div className="budget-alias-add">
                      <label>
                        <span>별칭 하나 추가</span>
                        <input
                          value={aliasDrafts[group.id] ?? ""}
                          onChange={(event) =>
                            setAliasDrafts((current) => ({
                              ...current,
                              [group.id]: event.target.value,
                            }))
                          }
                          placeholder="예: 부산 그린스마트"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={saving || !aliasDrafts[group.id]?.trim()}
                        onClick={() => void addAlias(group)}
                      >
                        별칭 연결
                      </button>
                    </div>

                    <div className="budget-alias-list">
                      {additionalAliases.map((alias) => {
                        const memberCount = group.members.filter(
                          (member) => member.aliasKey === alias.aliasKey,
                        ).length;
                        return (
                          <div key={alias.id}>
                            <span>
                              <strong>{alias.aliasName}</strong>
                              <small>
                                별칭 · {memberCount}건
                              </small>
                            </span>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `‘${alias.aliasName}’ 별칭을 해제할까요?\n원래 입력값과 연결 이력은 보존됩니다.`,
                                  )
                                ) {
                                  void runAction(
                                    {
                                      action: "unlink-alias",
                                      aliasId: alias.id,
                                    },
                                    "선택한 별칭을 해제했습니다.",
                                  );
                                }
                              }}
                            >
                              별칭 해제
                            </button>
                          </div>
                        );
                      })}
                      {!additionalAliases.length && (
                        <p className="budget-alias-empty">
                          추가로 등록된 별칭이 없습니다.
                        </p>
                      )}
                    </div>
                    </section>
                    <details className="budget-member-details">
                      <summary>
                        연결된 사업 보기 · {businesses.length.toLocaleString()}개 사업
                        {" · "}
                        원본 기록 {group.members.length.toLocaleString()}건
                      </summary>
                      <div>
                        {businesses.map((business) => {
                          const memberIds = business.members.map(
                            (member) => member.id,
                          );
                          const activityCount = business.members.filter(
                            (member) => member.entityType === "activity",
                          ).length;
                          const projectCount =
                            business.members.length - activityCount;
                          const hasBudgetConflict =
                            (budgetBusinessGroupIds.get(business.key)?.size ??
                              0) > 1;
                          return (
                          <div
                            key={business.key}
                            className={
                              hasBudgetConflict ? "budget-business-conflict" : ""
                            }
                          >
                            <span>
                              <strong>
                                {business.organization || "기관 미입력"} ·{" "}
                                {business.businessRound}차 사업
                              </strong>
                              <small>
                                {activityCount > 0
                                  ? `영업 기록 ${activityCount}건`
                                  : ""}
                                {activityCount > 0 && projectCount > 0
                                  ? " · "
                                  : ""}
                                {projectCount > 0
                                  ? `사업 기록 ${projectCount}건`
                                  : ""}
                                {business.activityDate
                                  ? ` · ${business.activityDate}`
                                  : ""}
                                {business.progressManager
                                  ? ` · ${business.progressManager} 담당`
                                  : ""}
                              </small>
                              <small className="budget-business-record-names">
                                {business.members
                                  .map(
                                    (member) =>
                                      member.recordName ||
                                      (member.entityType === "activity"
                                        ? "영업 활동"
                                        : "수주 사업"),
                                  )
                                  .filter(
                                    (name, index, values) =>
                                      values.indexOf(name) === index,
                                  )
                                  .join(" · ")}
                              </small>
                              {hasBudgetConflict && (
                                <small className="budget-business-warning">
                                  영업 기록과 사업 기록의 표준 예산명이 서로
                                  다릅니다. 변경 시 현재 묶음의 기록만 이동합니다.
                                </small>
                              )}
                            </span>
                            <div className="budget-member-actions">
                              {memberMoveOpenId === business.key ? (
                                <>
                                  <select
                                    aria-label={`${business.organization || "사업"} 변경할 표준 예산명`}
                                    value={
                                      memberMoveTargets[business.key] ?? ""
                                    }
                                    onChange={(event) =>
                                      setMemberMoveTargets((current) => ({
                                        ...current,
                                        [business.key]: Number(
                                          event.target.value,
                                        ),
                                      }))
                                    }
                                  >
                                    <option value="">다른 표준 예산명 선택</option>
                                    {activeGroups
                                      .filter((item) => item.id !== group.id)
                                      .map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.canonicalName} ·{" "}
                                          {budgetKindLabel(item.budgetKind)}
                                        </option>
                                      ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="primary"
                                    disabled={
                                      saving ||
                                      !memberMoveTargets[business.key]
                                    }
                                    onClick={() => {
                                      const target = activeGroups.find(
                                        (item) =>
                                          item.id ===
                                          memberMoveTargets[business.key],
                                      );
                                      if (
                                        target &&
                                        window.confirm(
                                          `‘${business.organization || "이 사업"}’의 영업·사업 기록 ${memberIds.length}건을 ‘${target.canonicalName}’으로 함께 변경할까요?\n원래 입력명과 변경 이력은 보존됩니다.`,
                                        )
                                      ) {
                                        void runAction(
                                          {
                                            action: "move-member",
                                            memberIds,
                                            targetGroupId: target.id,
                                          },
                                          `선택한 사업을 ‘${target.canonicalName}’으로 변경했습니다.`,
                                        ).then((result) => {
                                          if (result) setMemberMoveOpenId(null);
                                        });
                                      }
                                    }}
                                  >
                                    변경 적용
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setMemberMoveOpenId(null)}
                                  >
                                    취소
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={saving || activeGroups.length < 2}
                                  onClick={() =>
                                    setMemberMoveOpenId(business.key)
                                  }
                                >
                                  다른 예산명으로 변경
                                </button>
                              )}
                              <details className="budget-member-advanced">
                                <summary>고급 작업</summary>
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `이 사업의 영업·사업 기록 ${memberIds.length}건은 삭제되지 않고 표준 예산명 연결만 함께 해제됩니다.\n해제 후 ‘미분류’가 되며 자동 금액 계산이 중단될 수 있습니다. 계속할까요?`,
                                      )
                                    ) {
                                      void runAction(
                                        {
                                          action: "unlink-member",
                                          memberIds,
                                        },
                                        "선택한 사업을 미분류 상태로 변경했습니다.",
                                      );
                                    }
                                  }}
                                >
                                  표준 예산명 연결 해제
                                </button>
                              </details>
                            </div>
                          </div>
                          );
                        })}
                        {!businesses.length && (
                          <p>아직 연결된 영업·사업 기록이 없습니다.</p>
                        )}
                      </div>
                    </details>
                  </article>
                );
              })}
              {!loading && !filteredGroups.length && (
                <p className="budget-name-empty">
                  등록된 표준 예산명이 없습니다.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {tab === "unclassified" && (
        <div className="panel budget-name-source-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">BUDGET NAME REVIEW</span>
              <h2>미분류·불러온 예산명</h2>
              <p>
                수주 전·수주 미정·위즈업 수주 기록만 표시합니다. 협력사·타업체
                수주는 연결·일괄 변경 대상에서 제외됩니다.
              </p>
            </div>
            <span className="record-count">{data.names.length}개</span>
          </div>
          <div className="budget-name-toolbar">
            <div className="inline-search">
              <span>⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="미분류 예산명 검색"
              />
            </div>
            <div className="budget-unclassified-actions">
              <select
                value={targetGroupId ?? ""}
                onChange={(event) =>
                  setTargetGroupId(positiveInteger(event.target.value) || null)
                }
              >
                <option value="">연결할 기존 표준 예산명</option>
                {activeGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.canonicalName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={saving || !selectedNames.length || !targetGroupId}
                onClick={() => void connectSelected()}
              >
                기존 표준 예산에 연결
              </button>
            </div>
          </div>

          <div className="budget-unclassified-create">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="선택한 예산명을 표준명으로 자동 사용"
              title="예산명을 선택하면 해당 이름이 대표 표준 예산명으로 자동 입력됩니다."
            />
            <select
              value={newKind}
              onChange={(event) =>
                updateNewKind(normalizeKind(event.target.value) || "purpose")
              }
            >
              <option value="purpose">목적예산</option>
              <option value="self">자체예산</option>
            </select>
            <select
              value={newAmountMode}
              onChange={(event) =>
                setNewAmountMode(
                  normalizeMode(event.target.value) || "manual",
                )
              }
            >
              <option value="manual">금액 직접 입력</option>
              <option value="quote_auto">품목·견적 합계 자동 계산</option>
            </select>
            <button
              type="button"
              className="primary"
              disabled={saving || !selectedNames.length || !newName.trim()}
              onClick={() => void registerSelected()}
            >
              선택 이름을 표준 예산명으로 등록
            </button>
            <button
              type="button"
              disabled={saving || !selectedNames.length}
              onClick={() =>
                void runAction(
                  { action: "keep-unclassified", selectedNames },
                  "선택한 이름을 미분류 상태로 유지했습니다.",
                )
              }
            >
              미분류 상태 유지
            </button>
          </div>

          <div className="budget-name-grid" aria-busy={loading}>
            {filteredNames.map((item) => (
              <label
                className={selectedNames.includes(item.name) ? "selected" : ""}
                key={item.name}
              >
                <input
                  type="checkbox"
                  checked={selectedNames.includes(item.name)}
                  onChange={() => toggleName(item.name)}
                />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    영업 {item.activityCount.toLocaleString()}건 · 사업·품목{" "}
                    {item.projectCount.toLocaleString()}건
                  </small>
                </span>
                <em>미분류</em>
              </label>
            ))}
            {!loading && !filteredNames.length && (
              <p className="budget-name-empty">
                확인할 미분류 예산명이 없습니다.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="panel budget-request-manager-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">BUDGET REQUESTS</span>
              <h2>직원 새 예산명 신청</h2>
              <p>
                중복 신청은 이름별로 묶어 신청자와 관련 기록을 함께 표시합니다.
                승인 전 원문과 신청 이력은 계속 보존됩니다.
              </p>
            </div>
            <span className="record-count">
              {pendingRequests.length}건 처리 대기
            </span>
          </div>
          <div className="budget-request-manager-list" aria-busy={loading}>
            {pendingRequests.map((request) => {
              const decision =
                requestDecision[request.id] ?? "approve-new";
              const finalKind =
                requestKind[request.id] || request.expectedKind || "purpose";
              const finalMode =
                requestMode[request.id] ||
                (finalKind === "self" ? "quote_auto" : "manual");
              return (
                <article key={request.id}>
                  <header>
                    <div>
                      <span className={`request-status ${request.status}`}>
                        {statusLabel(request.status)}
                      </span>
                      <h3>{request.requestedName}</h3>
                      <small>
                        {formatDateTime(request.createdAt)} · 신청{" "}
                        {request.submissionCount.toLocaleString()}건 · 신청자{" "}
                        {request.applicants.join(", ") || "확인 중"}
                      </small>
                    </div>
                    <em>{budgetKindLabel(request.expectedKind)} 예상</em>
                  </header>
                  <div className="budget-request-manager-body">
                    <section>
                      <strong>관련 기관·활동 기록</strong>
                      {request.relatedRecords.length ? (
                        request.relatedRecords.map((record, index) => (
                          <div
                            key={
                              record.submissionId ??
                              `${record.activityId}-${index}`
                            }
                          >
                            <span>
                              {record.organization || "기관 저장 전"}
                              {record.activityId
                                ? ` · 기록 #${record.activityId}`
                                : ""}
                            </span>
                            <small>
                              {record.applicantName || "신청자"} ·{" "}
                              {record.reason || "신청 내용 없음"}
                            </small>
                          </div>
                        ))
                      ) : (
                        <p>관련 기록을 확인하고 있습니다.</p>
                      )}
                    </section>
                    <section>
                      <strong>유사한 표준 예산명 후보</strong>
                      {request.candidates.length ? (
                        request.candidates.map((candidate) => (
                          <button
                            type="button"
                            key={candidate.groupId}
                            onClick={() => {
                              setRequestDecision((current) => ({
                                ...current,
                                [request.id]: "approve-alias",
                              }));
                              setRequestTarget((current) => ({
                                ...current,
                                [request.id]: candidate.groupId,
                              }));
                            }}
                          >
                            <span>
                              <b>{candidate.canonicalName}</b>
                              <small>
                                {budgetKindLabel(candidate.budgetKind)} ·{" "}
                                {candidate.reason || "이름 유사"}
                              </small>
                            </span>
                            <em>별칭으로 연결</em>
                          </button>
                        ))
                      ) : (
                        <p>추천할 기존 표준 예산명이 없습니다.</p>
                      )}
                    </section>
                  </div>

                  <div className="budget-request-decision">
                    <label>
                      <span>처리 방식</span>
                      <select
                        value={decision}
                        onChange={(event) =>
                          setRequestDecision((current) => ({
                            ...current,
                            [request.id]: event.target.value as RequestDecision,
                          }))
                        }
                      >
                        <option value="approve-new">
                          새 표준 예산명으로 승인
                        </option>
                        <option value="approve-alias">
                          기존 표준 예산명의 별칭으로 연결
                        </option>
                        <option value="hold">보류</option>
                        <option value="reject">사유 입력 후 반려</option>
                      </select>
                    </label>
                    {decision === "approve-alias" ? (
                      <label>
                        <span>연결할 표준 예산명</span>
                        <select
                          value={requestTarget[request.id] ?? ""}
                          onChange={(event) =>
                            setRequestTarget((current) => ({
                              ...current,
                              [request.id]: positiveInteger(event.target.value),
                            }))
                          }
                        >
                          <option value="">표준 예산명 선택</option>
                          {activeGroups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.canonicalName}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : decision === "approve-new" ? (
                      <>
                        <label>
                          <span>최종 예산 구분</span>
                          <select
                            value={finalKind}
                            onChange={(event) => {
                              const kind =
                                normalizeKind(event.target.value) || "purpose";
                              setRequestKind((current) => ({
                                ...current,
                                [request.id]: kind,
                              }));
                              setRequestMode((current) => ({
                                ...current,
                                [request.id]:
                                  kind === "self" ? "quote_auto" : "manual",
                              }));
                            }}
                          >
                            <option value="purpose">목적예산</option>
                            <option value="self">자체예산</option>
                          </select>
                        </label>
                        <label>
                          <span>최종 금액 처리</span>
                          <select
                            value={finalMode}
                            onChange={(event) =>
                              setRequestMode((current) => ({
                                ...current,
                                [request.id]:
                                  normalizeMode(event.target.value) || "manual",
                              }))
                            }
                          >
                            <option value="manual">금액 직접 입력</option>
                            <option value="quote_auto">
                              품목·견적 합계 자동 계산
                            </option>
                          </select>
                        </label>
                      </>
                    ) : null}
                    <label className="reason">
                      <span>
                        {decision === "reject" ? "반려 사유 *" : "처리 메모"}
                      </span>
                      <input
                        value={requestReason[request.id] ?? ""}
                        onChange={(event) =>
                          setRequestReason((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        placeholder={
                          decision === "reject"
                            ? "직원이 확인할 반려 사유"
                            : "보류 또는 승인 판단 내용을 기록합니다."
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="primary"
                      disabled={
                        saving ||
                        (decision === "approve-alias" &&
                          !requestTarget[request.id]) ||
                        (decision === "reject" &&
                          !requestReason[request.id]?.trim())
                      }
                      onClick={() => void processRequest(request)}
                    >
                      처리 결과 저장
                    </button>
                  </div>
                </article>
              );
            })}
            {!loading && !pendingRequests.length && (
              <p className="budget-name-empty">
                처리할 새 예산명 신청이 없습니다.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="panel budget-event-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">CHANGE HISTORY</span>
              <h2>표준 예산명 변경 이력</h2>
              <p>
                변경자·처리 시각·전후 내용을 보존합니다. 이후 변경이 없는 안전한
                작업만 되돌릴 수 있습니다.
              </p>
            </div>
          </div>
          <div className="budget-event-list">
            {data.events.map((event) => (
              <article key={event.id}>
                <span>{event.action || "예산명 변경"}</span>
                <div>
                  <strong>{event.summary || "변경 상세 기록"}</strong>
                  <small>
                    {event.changedByName || "시스템"} ·{" "}
                    {formatDateTime(event.createdAt)}
                  </small>
                </div>
                {event.undoable && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      if (
                        window.confirm(
                          "이 예산명 변경을 안전하게 되돌릴까요?",
                        )
                      ) {
                        void runAction(
                          { action: "undo-event", eventId: event.id },
                          "예산명 변경을 되돌렸습니다.",
                        );
                      }
                    }}
                  >
                    되돌리기
                  </button>
                )}
              </article>
            ))}
            {!loading && !data.events.length && (
              <p className="budget-name-empty">아직 변경 이력이 없습니다.</p>
            )}
          </div>
        </div>
      )}

      {retrofitContext && (
        <div className="budget-retrofit-panel" role="dialog" aria-modal="true">
          <div className="budget-retrofit-card">
            <header>
              <div>
                <span>ADDITIONAL RETROACTIVE REVIEW</span>
                <h3>추가 과거 기록 적용 대상</h3>
                <p>
                  신청과 직접 연결되지 않은 기록은 자동 변경하지 않습니다.
                  확인한 항목만 선택해 적용하세요.
                </p>
              </div>
              <button
                type="button"
                aria-label="추가 적용 검토 닫기"
                onClick={() => {
                  setRetrofitContext(null);
                  setSelectedRetrofit([]);
                }}
              >
                ×
              </button>
            </header>
            <div className="budget-retrofit-list">
              {data.retrofitPreview.map((row) => {
                const target = `${row.entityType}:${row.entityId}`;
                return (
                  <label key={target}>
                    <input
                      type="checkbox"
                      checked={selectedRetrofit.includes(target)}
                      onChange={() =>
                        setSelectedRetrofit((current) =>
                          current.includes(target)
                            ? current.filter((item) => item !== target)
                            : [...current, target],
                        )
                      }
                    />
                    <span>
                      <strong>{row.organization || "기관 미입력"}</strong>
                      <small>
                        원문 ‘{row.originalName}’ ·{" "}
                        {row.entityType === "activity" ? "영업 기록" : "사업"} #
                        {row.entityId}
                        {row.activityDate ? ` · ${row.activityDate}` : ""}
                      </small>
                    </span>
                    <em>{row.awardStatus || "수주 미정"}</em>
                  </label>
                );
              })}
              {!data.retrofitPreview.length && (
                <p>추가로 적용할 과거 기록이 없습니다.</p>
              )}
            </div>
            <footer>
              <button
                type="button"
                onClick={() => {
                  setRetrofitContext(null);
                  setSelectedRetrofit([]);
                }}
              >
                추가 적용 안 함
              </button>
              <button
                type="button"
                className="primary"
                disabled={saving || !selectedRetrofit.length}
                onClick={() => void applyRetrofit()}
              >
                선택 {selectedRetrofit.length}건 적용
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
