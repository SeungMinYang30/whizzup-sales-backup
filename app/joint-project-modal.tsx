"use client";

import { useEffect, useMemo, useState } from "react";

export type JointProjectCandidate = {
  organization: string;
  businessRound: number;
  activityId?: number | null;
  campaignTargetId?: number | null;
  budgetAmount?: number | null;
  budgetType?: string;
  jointProjectId?: number | null;
  jointProjectName?: string;
};

type StandardBudgetOption = {
  id: number;
  canonicalName: string;
  budgetKind: "purpose" | "self" | string;
  amountMode: string;
  defaultAmount: number | null;
};

function sponsorScore(name: string) {
  if (/(시청|군청|구청|도청)$/.test(name)) return 100;
  if (/(교육청|교육지원청|재단|본청)$/.test(name)) return 80;
  if (/(센터|협회|공단)$/.test(name)) return 30;
  return 0;
}

function formatWon(value: number | null | undefined) {
  return value === null || value === undefined
    ? "금액 미입력"
    : `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function amountKey(item: Pick<JointProjectCandidate, "organization" | "businessRound">) {
  return `${item.organization}\u0000${Math.max(1, item.businessRound || 1)}`;
}

function amountValue(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export default function JointProjectModal({
  open,
  candidates,
  availableSponsors = [],
  campaignId = null,
  budgetGroupId = null,
  budgetType = "",
  initialProjectYear,
  onClose,
  onSaved,
}: {
  open: boolean;
  candidates: JointProjectCandidate[];
  availableSponsors?: JointProjectCandidate[];
  campaignId?: number | null;
  budgetGroupId?: number | null;
  budgetType?: string;
  initialProjectYear?: number | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const normalizedCandidates = useMemo(
    () => [
      ...new Map(
        candidates
          .filter((item) => item.organization.trim())
          .map((item) => [
            `${item.organization.trim()}\u0000${Math.max(1, item.businessRound || 1)}`,
            {
              ...item,
              organization: item.organization.trim(),
              businessRound: Math.max(1, item.businessRound || 1),
            },
          ]),
      ).values(),
    ],
    [candidates],
  );
  const sponsorOptions = useMemo(
    () => [
      ...new Map(
        [...availableSponsors, ...normalizedCandidates]
          .filter((item) => item.organization.trim())
          .map((item) => [item.organization.trim(), item]),
      ).values(),
    ].sort(
      (left, right) =>
        sponsorScore(right.organization) - sponsorScore(left.organization) ||
        left.organization.localeCompare(right.organization, "ko-KR"),
    ),
    [availableSponsors, normalizedCandidates],
  );
  const recommendedSponsor = useMemo(() => {
    const selected = [...normalizedCandidates].sort(
      (left, right) =>
        sponsorScore(right.organization) - sponsorScore(left.organization),
    )[0];
    return selected && sponsorScore(selected.organization) > 0
      ? selected.organization
      : "";
  }, [normalizedCandidates]);
  const existingProjectId = useMemo(() => {
    const ids = [
      ...new Set(
        normalizedCandidates
          .map((item) => Number(item.jointProjectId))
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ];
    return ids.length === 1 ? ids[0] : null;
  }, [normalizedCandidates]);
  const existingProjectName =
    normalizedCandidates.find(
      (item) => Number(item.jointProjectId) === existingProjectId,
    )?.jointProjectName ?? "";
  const [sponsorOrganization, setSponsorOrganization] = useState("");
  const [budgetCatalog, setBudgetCatalog] = useState<StandardBudgetOption[]>([]);
  const [selectedBudgetGroupId, setSelectedBudgetGroupId] = useState("");
  const [projectYear, setProjectYear] = useState("");
  const [selectedJointRound, setSelectedJointRound] = useState("1");
  const [memberAmounts, setMemberAmounts] = useState<Record<string, string>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSponsorOrganization(recommendedSponsor);
    setProjectYear(
      String(
        initialProjectYear && initialProjectYear >= 2000
          ? initialProjectYear
          : new Date().getFullYear(),
      ),
    );
    setSelectedJointRound("1");
    setMemberAmounts(
      Object.fromEntries(
        normalizedCandidates.map((item) => [
          amountKey(item),
          item.budgetAmount === null || item.budgetAmount === undefined
            ? ""
            : String(Math.max(0, Math.round(item.budgetAmount))),
        ]),
      ),
    );
    setNotes("");
    setError("");
    setCatalogLoading(true);
    void fetch("/api/budget-catalog", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          catalog?: StandardBudgetOption[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "표준 예산명을 불러오지 못했습니다.");
        }
        const catalog = payload.catalog ?? [];
        setBudgetCatalog(catalog);
        const matched = catalog.find(
          (item) =>
            Number(item.id) === Number(budgetGroupId) ||
            item.canonicalName === budgetType,
        );
        setSelectedBudgetGroupId(matched ? String(matched.id) : "");
      })
      .catch((caught) => {
        setBudgetCatalog([]);
        setSelectedBudgetGroupId("");
        setError(
          caught instanceof Error
            ? caught.message
            : "표준 예산명을 불러오지 못했습니다.",
        );
      })
      .finally(() => setCatalogLoading(false));
  }, [
    budgetGroupId,
    budgetType,
    initialProjectYear,
    normalizedCandidates,
    open,
    recommendedSponsor,
  ]);

  if (!open) return null;
  const sponsorCandidate = sponsorOptions.find(
    (item) => item.organization === sponsorOrganization,
  );
  const memberCandidates = [
    ...(sponsorCandidate &&
    !normalizedCandidates.some(
      (item) => item.organization === sponsorCandidate.organization,
    )
      ? [sponsorCandidate]
      : []),
    ...normalizedCandidates,
  ];
  const siteCandidates = memberCandidates.filter(
    (item) => item.organization !== sponsorOrganization,
  );
  const selectedBudget = budgetCatalog.find(
    (item) => String(item.id) === selectedBudgetGroupId,
  );
  const total = siteCandidates.reduce(
    (sum, item) => sum + (amountValue(memberAmounts[amountKey(item)] ?? "") ?? 0),
    0,
  );

  function selectBudget(nextId: string) {
    setSelectedBudgetGroupId(nextId);
    const nextBudget = budgetCatalog.find((item) => String(item.id) === nextId);
    if (!nextBudget || existingProjectId) return;
    setMemberAmounts(
      Object.fromEntries(
        memberCandidates.map((item) => [
          amountKey(item),
          item.organization === sponsorOrganization
            ? ""
            : nextBudget.budgetKind === "self" || nextBudget.defaultAmount === null
              ? ""
              : String(Math.max(0, Math.round(nextBudget.defaultAmount))),
        ]),
      ),
    );
  }

  async function unlink() {
    if (!existingProjectId || busy) return;
    try {
      setBusy(true);
      setError("");
      const response = await fetch("/api/joint-projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: existingProjectId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "공동사업 연결을 해제하지 못했습니다.");
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "공동사업 연결을 해제하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (
      !sponsorOrganization ||
      !selectedBudget ||
      !projectYear ||
      siteCandidates.length < 1 ||
      busy
    ) return;
    try {
      setBusy(true);
      setError("");
      const response = await fetch("/api/joint-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sponsorOrganization,
          campaignId,
          budgetGroupId: selectedBudget.id,
          budgetType: selectedBudget.canonicalName,
          projectYear: Number(projectYear),
          jointRound: Number(selectedJointRound),
          notes,
          members: memberCandidates.map((item) => ({
            ...item,
            budgetAmount:
              item.organization === sponsorOrganization
                ? null
                : amountValue(memberAmounts[amountKey(item)] ?? ""),
            role:
              item.organization === sponsorOrganization ? "sponsor" : "site",
          })),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "공동사업을 연결하지 못했습니다.");
      }
      await onSaved();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "공동사업을 연결하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="joint-project-title"
    >
      <button
        type="button"
        className="modal-backdrop"
        aria-label="공동사업 연결 창 닫기"
        disabled={busy}
        onClick={onClose}
      />
      <aside className="record-modal joint-project-modal">
        <div className="modal-header">
          <div>
            <span className="section-kicker">JOINT PROJECT</span>
            <h2 id="joint-project-title">공동사업 연결</h2>
          </div>
          <button
            type="button"
            className="close-button"
            disabled={busy}
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="joint-project-body">
          <div className="joint-project-guide">
            <strong>기관은 합치지 않고 사업 관계만 연결합니다.</strong>
            <p>
              연락처·지도·영업 기록·견적·장비·수금 자료는 각 기관에 그대로
              남습니다. 주관기관은 총액에 중복 포함하지 않고 설치기관 금액만
              공동사업 합계로 계산합니다.
            </p>
          </div>
          {existingProjectId && (
            <div className="joint-project-existing">
              <strong>{existingProjectName || "연결된 공동사업"}</strong>
              <span>
                이 연결만 해제되며 기관·예산 명단·영업·수주·지도·회계 자료는
                삭제되거나 변경되지 않습니다.
              </span>
            </div>
          )}
          <label className="joint-project-field">
            <span>예산명</span>
            <select
              value={selectedBudgetGroupId}
              onChange={(event) => selectBudget(event.target.value)}
              disabled={catalogLoading || Boolean(existingProjectId)}
            >
              <option value="">
                {catalogLoading ? "표준 예산명 불러오는 중…" : "등록된 표준 예산명 선택"}
              </option>
              {budgetCatalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.canonicalName}
                </option>
              ))}
            </select>
            {selectedBudget && (
              <small>
                {selectedBudget.budgetKind === "self" ? "자체예산" : "목적예산"}
                {selectedBudget.defaultAmount !== null
                  ? ` · 기관별 기본 ${formatWon(selectedBudget.defaultAmount)}`
                  : " · 기관별 금액 직접 입력"}
              </small>
            )}
          </label>
          <div className="joint-project-period-fields">
            <label className="joint-project-field">
              <span>사업연도</span>
              <select
                value={projectYear}
                onChange={(event) => setProjectYear(event.target.value)}
                disabled={Boolean(existingProjectId)}
              >
                {Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 2 + index).map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
            </label>
            <label className="joint-project-field">
              <span>공동 진행 차수</span>
              <select
                value={selectedJointRound}
                onChange={(event) => setSelectedJointRound(event.target.value)}
                disabled={Boolean(existingProjectId)}
              >
                {Array.from({ length: 10 }, (_, index) => index + 1).map((round) => (
                  <option key={round} value={round}>{round}차</option>
                ))}
              </select>
            </label>
          </div>
          <label className="joint-project-field">
            <span>주관기관</span>
            <input
              list="joint-project-sponsor-options"
              value={sponsorOrganization}
              onChange={(event) => setSponsorOrganization(event.target.value)}
              placeholder="기존 기관명 검색·선택"
              disabled={Boolean(existingProjectId)}
            />
            <datalist id="joint-project-sponsor-options">
              {sponsorOptions.map((item) => (
                <option
                  key={`${item.organization}-${item.businessRound}`}
                  value={item.organization}
                />
              ))}
            </datalist>
            {!existingProjectId && (
              <small>현재 등록된 기관 중 주관기관을 검색해 선택해 주세요.</small>
            )}
          </label>
          <section className="joint-project-members">
            <header>
              <div>
                <strong>설치·수혜기관 {siteCandidates.length}곳</strong>
                <span>선정기관 수는 변경하지 않습니다.</span>
              </div>
              <b>{formatWon(total)}</b>
            </header>
            {memberCandidates.map((item) => {
              const sponsor = item.organization === sponsorOrganization;
              return (
                <div className={sponsor ? "sponsor" : "site"} key={`${item.organization}-${item.businessRound}`}>
                  <span>{sponsor ? "주관" : "설치"}</span>
                  <strong>{item.organization}</strong>
                  <small>{item.businessRound}차 사업</small>
                  {sponsor ? (
                    <b>합계 제외</b>
                  ) : (
                    <label className="joint-project-member-amount">
                      <input
                        inputMode="numeric"
                        value={
                          memberAmounts[amountKey(item)]
                            ? Number(memberAmounts[amountKey(item)]).toLocaleString("ko-KR")
                            : ""
                        }
                        onChange={(event) =>
                          setMemberAmounts((current) => ({
                            ...current,
                            [amountKey(item)]: event.target.value.replace(/[^0-9]/g, ""),
                          }))
                        }
                        placeholder="금액 직접 입력"
                        disabled={Boolean(existingProjectId)}
                        aria-label={`${item.organization} 예산금액`}
                      />
                      <span>원</span>
                    </label>
                  )}
                </div>
              );
            })}
          </section>
          <label className="joint-project-field">
            <span>메모</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="공동 진행 방식이나 역할을 적어 주세요."
            />
          </label>
          {error && <p className="joint-project-error">{error}</p>}
        </div>
        <footer className="joint-project-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          {existingProjectId ? (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void unlink()}
            >
              {busy ? "해제 중…" : "공동사업 연결 해제"}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={
                !selectedBudget ||
                !projectYear ||
                !sponsorOrganization ||
                !sponsorCandidate ||
                siteCandidates.length < 1 ||
                busy
              }
              onClick={() => void save()}
            >
              {busy ? "연결 중…" : "공동사업으로 연결"}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
