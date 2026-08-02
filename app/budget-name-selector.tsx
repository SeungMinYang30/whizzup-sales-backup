"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type BudgetKind = "purpose" | "self" | "";
export type BudgetAmountMode = "manual" | "quote_auto" | "";
export type BudgetMatchStatus =
  | "auto"
  | "review"
  | "unclassified"
  | "pending"
  | "hold"
  | "rejected"
  | "approved"
  | "unknown";

export type BudgetSelection = {
  budgetType: string;
  budgetOriginalName?: string;
  budgetGroupId?: number | null;
  budgetMatchStatus?: BudgetMatchStatus | string;
  budgetMatchMethod?: string;
  budgetRequestId?: string | null;
  budgetKind?: BudgetKind | string;
  budgetAmountMode?: BudgetAmountMode | string;
  defaultBudgetAmount?: number | null;
};

type BudgetAliasOption = {
  id?: number;
  aliasName: string;
};

type BudgetCatalogOption = {
  id: number;
  canonicalName: string;
  budgetKind: BudgetKind;
  amountMode: BudgetAmountMode;
  defaultAmount: number | null;
  aliases: BudgetAliasOption[];
};

type MyBudgetRequest = {
  id: string;
  requestedName: string;
  status: string;
  expectedKind: BudgetKind;
  reason: string;
  decisionReason: string;
  canonicalName: string;
  resolvedGroupId: number | null;
  budgetKind: BudgetKind;
  amountMode: BudgetAmountMode;
  createdAt: string;
};

type CatalogPayload = {
  catalog?: unknown[];
  groups?: unknown[];
  options?: unknown[];
  myRequests?: unknown[];
  request?: unknown;
  error?: string;
};

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function key(value: unknown) {
  return clean(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s._·/\\()[\]{}'"`~!@#$%^&*+=:;?,<>|-]+/g, "");
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeKind(value: unknown): BudgetKind {
  const text = clean(value);
  if (text === "purpose" || text === "목적예산") return "purpose";
  if (text === "self" || text === "자체예산") return "self";
  return "";
}

function normalizeAmountMode(value: unknown): BudgetAmountMode {
  const text = clean(value);
  if (text === "manual" || text === "수기 입력" || text === "직접 입력") {
    return "manual";
  }
  if (
    text === "quote_auto" ||
    text === "자동 계산" ||
    text === "품목 합계 자동 계산"
  ) {
    return "quote_auto";
  }
  return "";
}

function normalizeAlias(value: unknown): BudgetAliasOption {
  if (typeof value === "string") return { aliasName: clean(value) };
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    id: numberOrNull(row.id) ?? undefined,
    aliasName: clean(row.aliasName ?? row.alias_name ?? row.name),
  };
}

function normalizeCatalogOption(value: unknown): BudgetCatalogOption | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = numberOrNull(row.id ?? row.groupId ?? row.group_id);
  const canonicalName = clean(
    row.canonicalName ?? row.canonical_name ?? row.name,
  );
  if (!id || !canonicalName) return null;
  const aliases = Array.isArray(row.aliases)
    ? row.aliases.map(normalizeAlias).filter((item) => item.aliasName)
    : [];
  return {
    id,
    canonicalName,
    budgetKind: normalizeKind(
      row.budgetKind ?? row.budget_kind ?? row.kind,
    ),
    amountMode: normalizeAmountMode(
      row.amountMode ?? row.amount_mode ?? row.amountHandling,
    ),
    defaultAmount:
      row.defaultAmount === null || row.default_amount === null
        ? null
        : Number.isFinite(Number(row.defaultAmount ?? row.default_amount))
          ? Math.max(0, Number(row.defaultAmount ?? row.default_amount))
          : null,
    aliases,
  };
}

function normalizeRequest(value: unknown): MyBudgetRequest | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = clean(row.id ?? row.requestId ?? row.request_id);
  const requestedName = clean(
    row.requestedName ?? row.requested_name ?? row.name,
  );
  if (!id || !requestedName) return null;
  return {
    id,
    requestedName,
    status: clean(row.status) || "pending",
    expectedKind: normalizeKind(
      row.expectedKind ?? row.expected_kind ?? row.budgetKind,
    ),
    reason: clean(row.reason ?? row.requestReason),
    decisionReason: clean(
      row.decisionReason ?? row.decision_reason ?? row.reviewReason,
    ),
    canonicalName: clean(
      row.canonicalName ?? row.canonical_name ?? row.resolvedName,
    ),
    resolvedGroupId: numberOrNull(
      row.resolvedGroupId ?? row.resolved_group_id ?? row.groupId,
    ),
    budgetKind: normalizeKind(row.budgetKind ?? row.budget_kind),
    amountMode: normalizeAmountMode(row.amountMode ?? row.amount_mode),
    createdAt: clean(row.createdAt ?? row.created_at),
  };
}

function statusLabel(status: string) {
  switch (clean(status).toLocaleLowerCase()) {
    case "pending":
    case "신청":
    case "신청 대기":
      return "승인 대기";
    case "hold":
    case "보류":
      return "보류";
    case "rejected":
    case "반려":
      return "반려";
    case "approved":
    case "승인":
      return "승인";
    default:
      return clean(status) || "승인 대기";
  }
}

function statusClass(status: string) {
  const normalized = clean(status).toLocaleLowerCase();
  if (["approved", "승인"].includes(normalized)) return "approved";
  if (["rejected", "반려"].includes(normalized)) return "rejected";
  if (["hold", "보류"].includes(normalized)) return "hold";
  return "pending";
}

function budgetKindLabel(kind: BudgetKind | string) {
  return normalizeKind(kind) === "self" ? "자체예산" : "목적예산";
}

function amountModeLabel(mode: BudgetAmountMode | string) {
  return normalizeAmountMode(mode) === "quote_auto"
    ? "품목·견적 합계 자동 계산"
    : "금액 직접 입력";
}

function suggestionScore(option: BudgetCatalogOption, query: string) {
  const queryKey = key(query);
  if (!queryKey) return 0;
  const names = [
    option.canonicalName,
    ...option.aliases.map((alias) => alias.aliasName),
  ];
  let score = 0;
  for (const name of names) {
    const nameKey = key(name);
    if (nameKey === queryKey) return 100;
    if (nameKey.includes(queryKey) || queryKey.includes(nameKey)) {
      score = Math.max(score, 70 - Math.abs(nameKey.length - queryKey.length));
    }
    const shared = [...new Set(queryKey)].filter((character) =>
      nameKey.includes(character),
    ).length;
    score = Math.max(
      score,
      Math.round((shared / Math.max(queryKey.length, nameKey.length, 1)) * 50),
    );
  }
  return score;
}

export default function BudgetNameSelector({
  value,
  onChange,
  organization = "",
  activityId,
  disabled = false,
  standardOnly = false,
  onToast,
}: {
  value: BudgetSelection;
  onChange: (selection: BudgetSelection) => void;
  organization?: string;
  activityId?: number | null;
  disabled?: boolean;
  standardOnly?: boolean;
  onToast?: (message: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [catalog, setCatalog] = useState<BudgetCatalogOption[]>([]);
  const [myRequests, setMyRequests] = useState<MyBudgetRequest[]>([]);
  const [query, setQuery] = useState(value.budgetType || "");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [myRequestsOpen, setMyRequestsOpen] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [requestKind, setRequestKind] = useState<BudgetKind>("purpose");
  const [requestReason, setRequestReason] = useState("");
  const [confirmedNoSuggestion, setConfirmedNoSuggestion] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);

  async function loadCatalog() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/budget-catalog", {
        cache: "no-store",
      });
      const payload = (await response.json()) as CatalogPayload;
      if (!response.ok) {
        throw new Error(payload.error || "표준 예산명을 불러오지 못했습니다.");
      }
      const source = payload.catalog ?? payload.groups ?? payload.options ?? [];
      setCatalog(
        source
          .map(normalizeCatalogOption)
          .filter((item): item is BudgetCatalogOption => Boolean(item)),
      );
      setMyRequests(
        (payload.myRequests ?? [])
          .map(normalizeRequest)
          .filter((item): item is MyBudgetRequest => Boolean(item)),
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "표준 예산명을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredOptions = useMemo(() => {
    const queryKey = key(query);
    return catalog
      .filter((option) => {
        if (!queryKey) return true;
        return [
          option.canonicalName,
          ...option.aliases.map((alias) => alias.aliasName),
        ].some((name) => key(name).includes(queryKey));
      })
      .slice(0, 30);
  }, [catalog, query]);

  const requestSuggestions = useMemo(
    () =>
      catalog
        .map((option) => ({
          option,
          score: suggestionScore(option, requestName),
        }))
        .filter((item) => item.score >= 22)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.option.canonicalName.localeCompare(
              right.option.canonicalName,
              "ko-KR",
            ),
        )
        .slice(0, 5),
    [catalog, requestName],
  );

  const selectedOption = value.budgetGroupId
    ? catalog.find((option) => option.id === value.budgetGroupId)
    : catalog.find((option) => key(option.canonicalName) === key(value.budgetType));
  const linkedRequest = value.budgetRequestId
    ? myRequests.find((request) => request.id === value.budgetRequestId)
    : myRequests.find(
        (request) =>
          key(request.requestedName) === key(value.budgetOriginalName || value.budgetType),
      );

  function selectOption(option: BudgetCatalogOption) {
    setQuery(option.canonicalName);
    setOpen(false);
    onChange({
      budgetType: option.canonicalName,
      budgetOriginalName: option.canonicalName,
      budgetGroupId: option.id,
      budgetMatchStatus: "auto",
      budgetMatchMethod: "selected",
      budgetRequestId: null,
      budgetKind: option.budgetKind,
      budgetAmountMode: option.amountMode,
      defaultBudgetAmount: option.defaultAmount,
    });
  }

  function selectUnknown() {
    setQuery("예산명 미확인");
    setOpen(false);
    onChange({
      budgetType: "예산명 미확인",
      budgetOriginalName: "",
      budgetGroupId: null,
      budgetMatchStatus: "unknown",
      budgetMatchMethod: "unknown",
      budgetRequestId: null,
      budgetKind: "",
      budgetAmountMode: "",
    });
  }

  function beginRequest() {
    const draftName =
      query && query !== "예산명 미확인" ? query : value.budgetOriginalName || "";
    setRequestName(draftName);
    setRequestKind(normalizeKind(value.budgetKind) || "purpose");
    setRequestReason("");
    setConfirmedNoSuggestion(false);
    setOpen(false);
    setRequestOpen(true);
  }

  async function submitRequest() {
    const requestedName = clean(requestName);
    const reason = clean(requestReason);
    if (!requestedName) {
      setError("신청할 예산명을 입력해 주세요.");
      return;
    }
    if (!reason) {
      setError("신청 사유 또는 확인한 내용을 입력해 주세요.");
      return;
    }
    if (requestSuggestions.length > 0 && !confirmedNoSuggestion) {
      setError("추천된 기존 예산명을 먼저 확인해 주세요.");
      return;
    }
    setRequestSaving(true);
    setError("");
    try {
      const response = await fetch("/api/budget-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-request",
          requestedName,
          expectedKind: requestKind,
          reason,
          organization: clean(organization),
          activityId: numberOrNull(activityId),
          confirmNoExistingMatch: confirmedNoSuggestion,
        }),
      });
      const payload = (await response.json()) as CatalogPayload;
      if (!response.ok) {
        throw new Error(payload.error || "새 예산명 신청을 제출하지 못했습니다.");
      }
      const request = normalizeRequest(payload.request);
      if (!request) {
        throw new Error("신청 결과를 확인하지 못했습니다.");
      }
      setMyRequests((current) => [
        request,
        ...current.filter((item) => item.id !== request.id),
      ]);
      setQuery(request.requestedName);
      onChange({
        budgetType: request.requestedName,
        budgetOriginalName: request.requestedName,
        budgetGroupId: null,
        budgetMatchStatus: "pending",
        budgetMatchMethod: "employee-request",
        budgetRequestId: request.id,
        budgetKind: request.expectedKind,
        budgetAmountMode:
          request.expectedKind === "self" ? "quote_auto" : "manual",
      });
      setRequestOpen(false);
      onToast?.("새 예산명 신청을 제출했습니다. 승인 전에도 기록을 저장할 수 있습니다.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "새 예산명 신청을 제출하지 못했습니다.",
      );
    } finally {
      setRequestSaving(false);
    }
  }

  return (
    <div
      className="budget-selector"
      ref={wrapperRef}
      onBlur={(event) => {
        if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <div className={`budget-selector-control ${open ? "open" : ""}`}>
        <span className="budget-selector-search-mark" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls="budget-standard-options"
          aria-autocomplete="list"
          disabled={disabled}
          value={open ? query : value.budgetType || ""}
          placeholder="표준 예산명 검색·선택"
          onFocus={() => {
            setQuery(value.budgetType || "");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        <button
          type="button"
          aria-label={open ? "예산명 목록 닫기" : "예산명 목록 열기"}
          disabled={disabled}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            setQuery(value.budgetType || "");
            setOpen(true);
          }}
        >
          {open ? "▴" : "▾"}
        </button>
      </div>

      {open && (
        <div className="budget-selector-popover" id="budget-standard-options">
          <div className="budget-selector-popover-heading">
            <strong>활성 표준 예산명</strong>
            <small>{loading ? "불러오는 중" : `${catalog.length}개`}</small>
          </div>
          <div className="budget-selector-option-list" role="listbox">
            {filteredOptions.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={selectedOption?.id === option.id}
                key={option.id}
                onClick={() => selectOption(option)}
              >
                <span>
                  <strong>{option.canonicalName}</strong>
                  {option.aliases.length > 0 && (
                    <small>
                      별칭 {option.aliases.map((alias) => alias.aliasName).join(", ")}
                    </small>
                  )}
                </span>
                <em>{budgetKindLabel(option.budgetKind)}</em>
                <small>{amountModeLabel(option.amountMode)}</small>
              </button>
            ))}
            {!loading && filteredOptions.length === 0 && (
              <p>일치하는 표준 예산명이 없습니다.</p>
            )}
          </div>
          {!standardOnly && (
            <div className="budget-selector-special-actions">
              <button type="button" onClick={selectUnknown}>
                <span>
                  <strong>예산명 미확인</strong>
                  <small>기관에서 예산명을 아직 확인하지 못한 경우</small>
                </span>
              </button>
              <button type="button" className="request" onClick={beginRequest}>
                + 새 예산명 신청
              </button>
            </div>
          )}
          {!standardOnly && myRequests.length > 0 && (
            <button
              type="button"
              className="budget-my-requests-toggle"
              onClick={() => setMyRequestsOpen((current) => !current)}
            >
              내 예산명 신청 {myRequests.length}건{" "}
              {myRequestsOpen ? "접기" : "보기"}
            </button>
          )}
          {!standardOnly && myRequestsOpen && (
            <div className="budget-my-requests">
              {myRequests.map((request) => {
                const normalizedStatus = clean(
                  request.status,
                ).toLocaleLowerCase("ko-KR");
                const approved = ["approved", "승인"].includes(
                  normalizedStatus,
                );
                const rejected = ["rejected", "반려"].includes(
                  normalizedStatus,
                );
                const selectedName = approved
                  ? request.canonicalName || request.requestedName
                  : request.requestedName;
                const selectedKind = approved
                  ? request.budgetKind || request.expectedKind
                  : request.expectedKind;
                const selectedMode = approved
                  ? request.amountMode ||
                    (selectedKind === "self" ? "quote_auto" : "manual")
                  : selectedKind === "self"
                    ? "quote_auto"
                    : "manual";
                return (
                <button
                  type="button"
                  key={request.id}
                  disabled={rejected}
                  title={rejected ? "반려된 신청은 예산명으로 선택할 수 없습니다." : ""}
                  onClick={() => {
                    if (rejected) return;
                    setQuery(selectedName);
                    setOpen(false);
                    onChange({
                      budgetType: selectedName,
                      budgetOriginalName: request.requestedName,
                      budgetGroupId: approved ? request.resolvedGroupId : null,
                      budgetMatchStatus: approved ? "approved" : request.status,
                      budgetMatchMethod: "employee-request",
                      budgetRequestId: request.id,
                      budgetKind: selectedKind,
                      budgetAmountMode: selectedMode,
                    });
                  }}
                >
                  <span>
                    <strong>{request.requestedName}</strong>
                    {approved &&
                      request.canonicalName &&
                      key(request.canonicalName) !== key(request.requestedName) && (
                        <small>표준 예산명 · {request.canonicalName}</small>
                      )}
                    {request.decisionReason && (
                      <small>{request.decisionReason}</small>
                    )}
                  </span>
                  <em className={statusClass(request.status)}>
                    {statusLabel(request.status)}
                  </em>
                </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(selectedOption || linkedRequest || value.budgetMatchStatus) && (
        <div className="budget-selection-status">
          {linkedRequest ? (
            <>
              <span className={`status ${statusClass(linkedRequest.status)}`}>
                예산명 {statusLabel(linkedRequest.status)}
              </span>
              <small>
                신청 원문 ‘{linkedRequest.requestedName}’을 보존하고 있습니다.
                {linkedRequest.decisionReason
                  ? ` · ${linkedRequest.decisionReason}`
                  : ""}
              </small>
            </>
          ) : selectedOption ? (
            <>
              <span className="status approved">표준 예산명</span>
              <small>
                {budgetKindLabel(selectedOption.budgetKind)} ·{" "}
                {amountModeLabel(selectedOption.amountMode)}
              </small>
            </>
          ) : value.budgetMatchStatus === "unknown" ? (
            <>
              <span className="status unknown">예산명 미확인</span>
              <small>예산명이 확인되면 표준 예산명으로 다시 선택해 주세요.</small>
            </>
          ) : null}
        </div>
      )}

      {error && (
        <p className="budget-selector-error" role="alert">
          {error}
        </p>
      )}

      {requestOpen && (
        <div
          className="budget-request-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !requestSaving) {
              setRequestOpen(false);
            }
          }}
        >
          <section
            className="budget-request-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-request-title"
          >
            <header>
              <div>
                <span>NEW BUDGET REQUEST</span>
                <h3 id="budget-request-title">새 예산명 신청</h3>
                <p>
                  비슷한 표준 예산명이 있으면 먼저 확인하고, 적절한 이름이 없을
                  때 신청해 주세요.
                </p>
              </div>
              <button
                type="button"
                aria-label="신청창 닫기"
                disabled={requestSaving}
                onClick={() => setRequestOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="budget-request-form">
              <label>
                <span>신청 예산명 *</span>
                <input
                  value={requestName}
                  maxLength={120}
                  autoFocus
                  onChange={(event) => {
                    setRequestName(event.target.value);
                    setConfirmedNoSuggestion(false);
                  }}
                  placeholder="기관에서 확인한 예산명"
                />
              </label>
              <label>
                <span>예상 구분 *</span>
                <select
                  value={requestKind}
                  onChange={(event) =>
                    setRequestKind(normalizeKind(event.target.value) || "purpose")
                  }
                >
                  <option value="purpose">목적예산 예상</option>
                  <option value="self">자체예산 예상</option>
                </select>
              </label>
              <label className="span-2">
                <span>신청 사유 또는 확인 내용 *</span>
                <textarea
                  rows={4}
                  maxLength={1_000}
                  value={requestReason}
                  onChange={(event) => setRequestReason(event.target.value)}
                  placeholder="기관에서 들은 명칭, 확인한 공문·사업 내용 등을 적어 주세요."
                />
              </label>
              <div className="budget-request-related span-2">
                <span>관련 기관 및 활동 기록</span>
                <strong>{organization || "기관 저장 전"}</strong>
                <small>
                  {activityId
                    ? `영업 기록 #${activityId}`
                    : "새 영업 기록을 저장하면 신청과 함께 연결됩니다."}
                </small>
              </div>
            </div>

            <div className="budget-request-suggestions">
              <div>
                <strong>유사한 기존 표준 예산명</strong>
                <small>기존 예산으로 처리할 수 있으면 바로 선택하세요.</small>
              </div>
              {requestSuggestions.length > 0 ? (
                requestSuggestions.map(({ option }) => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => {
                      selectOption(option);
                      setRequestOpen(false);
                      onToast?.(
                        `기존 표준 예산명 ‘${option.canonicalName}’을 선택했습니다.`,
                      );
                    }}
                  >
                    <span>
                      <strong>{option.canonicalName}</strong>
                      <small>
                        {budgetKindLabel(option.budgetKind)} ·{" "}
                        {amountModeLabel(option.amountMode)}
                      </small>
                    </span>
                    <em>이 이름 선택</em>
                  </button>
                ))
              ) : (
                <p>현재 이름과 유사한 표준 예산명이 없습니다.</p>
              )}
              {requestSuggestions.length > 0 && (
                <label className="budget-request-no-match">
                  <input
                    type="checkbox"
                    checked={confirmedNoSuggestion}
                    onChange={(event) =>
                      setConfirmedNoSuggestion(event.target.checked)
                    }
                  />
                  <span>추천된 이름 중 적절한 예산명이 없습니다.</span>
                </label>
              )}
            </div>
            <footer>
              <button
                type="button"
                disabled={requestSaving}
                onClick={() => setRequestOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  requestSaving ||
                  !requestName.trim() ||
                  !requestReason.trim() ||
                  (requestSuggestions.length > 0 && !confirmedNoSuggestion)
                }
                onClick={() => void submitRequest()}
              >
                {requestSaving ? "신청 중…" : "새 예산명 신청"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
