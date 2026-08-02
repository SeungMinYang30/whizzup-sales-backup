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

type QuickInstitutionRole = "sponsor" | "site";

type QuickInstitutionDraft = {
  role: QuickInstitutionRole;
  organization: string;
  region: string;
  address: string;
  institutionType: string;
};

type StandardBudgetOption = {
  id: number;
  canonicalName: string;
  budgetKind: "purpose" | "self" | string;
  amountMode: string;
  defaultAmount: number | null;
};

type ActivityLinkCandidate = {
  id: number;
  organization: string;
  activityDate: string;
  budgetType: string;
  businessRound: number;
};

type ActivityLinkAmbiguity = {
  organization: string;
  businessRound: number;
  candidates: ActivityLinkCandidate[];
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
  const [createdCandidates, setCreatedCandidates] = useState<
    JointProjectCandidate[]
  >([]);
  const sponsorOptions = useMemo(
    () => [
      ...new Map(
        [...availableSponsors, ...normalizedCandidates, ...createdCandidates]
          .filter((item) => item.organization.trim())
          .map((item) => [item.organization.trim(), item]),
      ).values(),
    ].sort(
      (left, right) =>
        sponsorScore(right.organization) - sponsorScore(left.organization) ||
        left.organization.localeCompare(right.organization, "ko-KR"),
    ),
    [availableSponsors, createdCandidates, normalizedCandidates],
  );
  const recommendedSponsor = useMemo(() => {
    const selected = [...normalizedCandidates].sort(
      (left, right) =>
        sponsorScore(right.organization) - sponsorScore(left.organization),
    )[0];
    return selected && sponsorScore(selected.organization) > 0
      ? selected.organization
      : normalizedCandidates[0]?.organization ?? "";
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
  const [activityAmbiguities, setActivityAmbiguities] = useState<ActivityLinkAmbiguity[]>([]);
  const [activitySelections, setActivitySelections] = useState<Record<string, string>>({});
  const [extraMembers, setExtraMembers] = useState<JointProjectCandidate[]>([]);
  const [siteOrganizationDraft, setSiteOrganizationDraft] = useState("");
  const [quickInstitution, setQuickInstitution] =
    useState<QuickInstitutionDraft | null>(null);
  const [quickInstitutionBusy, setQuickInstitutionBusy] = useState(false);

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
    setActivityAmbiguities([]);
    setActivitySelections({});
    setExtraMembers([]);
    setCreatedCandidates([]);
    setSiteOrganizationDraft("");
    setQuickInstitution(null);
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
    ...new Map(
      [
        ...(sponsorCandidate ? [sponsorCandidate] : []),
        ...normalizedCandidates,
        ...extraMembers,
      ].map((item) => [amountKey(item), item]),
    ).values(),
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
      !sponsorCandidate ||
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
          members: memberCandidates.map((item) => {
            const selectedActivityId = Number(
              activitySelections[amountKey(item)] ?? "",
            );
            return {
              ...item,
              activityId:
                Number.isSafeInteger(selectedActivityId) && selectedActivityId > 0
                  ? selectedActivityId
                  : item.activityId,
              budgetAmount:
                item.organization === sponsorOrganization
                  ? null
                  : amountValue(memberAmounts[amountKey(item)] ?? ""),
              role:
                item.organization === sponsorOrganization ? "sponsor" : "site",
            };
          }),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        activityCandidates?: ActivityLinkAmbiguity[];
      };
      if (!response.ok) {
        if (response.status === 409 && payload.activityCandidates?.length) {
          setActivityAmbiguities(payload.activityCandidates);
          setError("기관별 실제 수주 기록을 확인해 선택한 뒤 다시 연결해 주세요.");
          return;
        }
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

  function addExistingSite() {
    const matched = sponsorOptions.find(
      (item) => item.organization === siteOrganizationDraft.trim(),
    );
    if (!matched) {
      setError("등록된 기관을 선택하거나 새 기관을 먼저 등록해 주세요.");
      return;
    }
    if (matched.organization === sponsorOrganization) {
      setError("주관기관과 설치기관이 같으면 별도 공동사업 연결이 필요하지 않습니다.");
      return;
    }
    setExtraMembers((current) => [
      ...new Map([...current, matched].map((item) => [amountKey(item), item])).values(),
    ]);
    setMemberAmounts((current) => ({
      ...current,
      [amountKey(matched)]: current[amountKey(matched)] ?? "",
    }));
    setSiteOrganizationDraft("");
    setError("");
  }

  function openQuickInstitution(role: QuickInstitutionRole) {
    setQuickInstitution({
      role,
      organization:
        role === "sponsor"
          ? sponsorOrganization.trim()
          : siteOrganizationDraft.trim(),
      region: "",
      address: "",
      institutionType: "기관",
    });
    setError("");
  }

  async function createQuickInstitution() {
    if (!quickInstitution || quickInstitutionBusy) return;
    const organization = quickInstitution.organization.trim();
    if (!organization) {
      setError("새 기관명을 입력해 주세요.");
      return;
    }
    const exact = sponsorOptions.find(
      (item) => item.organization.trim() === organization,
    );
    if (exact) {
      setError("이미 등록된 기관입니다. 기존 기관을 선택해 주세요.");
      return;
    }
    if (
      quickInstitution.role === "sponsor" &&
      sponsorCandidate &&
      sponsorCandidate.organization !== organization &&
      !window.confirm(
        `${sponsorCandidate.organization} 대신 ${organization}을 주관기관으로 선택할까요?`,
      )
    ) {
      return;
    }
    try {
      setQuickInstitutionBusy(true);
      setError("");
      let addressWarning = "";
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization,
          activityDate: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Seoul",
          }).format(new Date()),
          activityType: "기타",
          category: quickInstitution.institutionType.trim() || "기관",
          region: quickInstitution.region.trim(),
          businessRound: 1,
          topic: "공동사업 기관 등록",
          summary: "공동사업 연결 화면에서 새 기관으로 등록했습니다.",
          status: "신규 접촉",
          awardStatus: "미정",
          sourceChat: "공동사업 빠른 등록",
          skipInstitutionStateLookup: true,
        }),
      });
      const payload = (await response.json()) as {
        record?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !payload.record) {
        throw new Error(payload.error || "새 기관을 등록하지 못했습니다.");
      }
      const savedOrganization = String(
        payload.record.organization ?? organization,
      ).trim();
      const candidate: JointProjectCandidate = {
        organization: savedOrganization,
        businessRound: Math.max(
          1,
          Number(payload.record.businessRound ?? payload.record.business_round) || 1,
        ),
        activityId:
          Number(payload.record.id) > 0 ? Number(payload.record.id) : null,
        budgetAmount: selectedBudget?.defaultAmount ?? null,
        budgetType: selectedBudget?.canonicalName ?? budgetType,
      };
      if (quickInstitution.address.trim()) {
        const locationResponse = await fetch("/api/map/locations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization: savedOrganization,
            region: quickInstitution.region.trim(),
            address: quickInstitution.address.trim(),
            roadAddress: quickInstitution.address.trim(),
            latitude: 0,
            longitude: 0,
            placeName: savedOrganization,
            placeId: "",
          }),
        });
        if (!locationResponse.ok) {
          const locationPayload = (await locationResponse.json()) as {
            error?: string;
          };
          addressWarning =
            locationPayload.error ||
            "기관은 등록했지만 주소를 저장하지 못했습니다. 기관별 관리에서 주소를 다시 입력해 주세요.";
        }
      }
      setCreatedCandidates((current) => [...current, candidate]);
      if (quickInstitution.role === "sponsor") {
        setSponsorOrganization(savedOrganization);
      } else {
        setExtraMembers((current) => [...current, candidate]);
        setMemberAmounts((current) => ({
          ...current,
          [amountKey(candidate)]:
            selectedBudget?.defaultAmount === null || !selectedBudget
              ? ""
              : String(Math.max(0, Math.round(selectedBudget.defaultAmount))),
        }));
        setSiteOrganizationDraft("");
      }
      setQuickInstitution(null);
      if (addressWarning) setError(addressWarning);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "새 기관을 등록하지 못했습니다.",
      );
    } finally {
      setQuickInstitutionBusy(false);
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
              <span>공동사업 연도</span>
              <select
                value={projectYear}
                onChange={(event) => setProjectYear(event.target.value)}
                disabled={Boolean(existingProjectId)}
              >
                {Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 2 + index).map((year) => (
                  <option key={year} value={year}>{year}년</option>
                ))}
              </select>
              <small>같은 예산·차수라도 연도가 다르면 별도 공동사업으로 관리됩니다.</small>
            </label>
            <label className="joint-project-field">
              <span>공동사업 차수</span>
              <select
                value={selectedJointRound}
                onChange={(event) => setSelectedJointRound(event.target.value)}
                disabled={Boolean(existingProjectId)}
              >
                {Array.from({ length: 10 }, (_, index) => index + 1).map((round) => (
                  <option key={round} value={round}>{round}차</option>
                ))}
              </select>
              <small>
                공동사업 차수는 이 공동사업의 연도별 묶음 기준입니다. 각 기관의
                1차·2차 사업 차수는 변경하지 않고 별도로 연결합니다.
              </small>
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
              <>
                <small>현재 등록된 기관 중 주관기관을 검색해 선택해 주세요.</small>
                <button
                  type="button"
                  className="joint-project-inline-action"
                  onClick={() => openQuickInstitution("sponsor")}
                >
                  + 새 기관 등록
                </button>
              </>
            )}
          </label>
          {!existingProjectId && (
            <div className="joint-project-add-site">
              <label className="joint-project-field">
                <span>설치기관 검색·추가</span>
                <input
                  list="joint-project-sponsor-options"
                  value={siteOrganizationDraft}
                  onChange={(event) => setSiteOrganizationDraft(event.target.value)}
                  placeholder="기존 기관명 검색·선택"
                />
              </label>
              <button type="button" onClick={addExistingSite}>기존 기관 추가</button>
              <button type="button" onClick={() => openQuickInstitution("site")}>
                + 새 기관 등록
              </button>
            </div>
          )}
          {quickInstitution && !existingProjectId && (
            <section className="joint-project-quick-institution">
              <header>
                <div>
                  <strong>
                    새 {quickInstitution.role === "sponsor" ? "주관" : "설치"}기관 등록
                  </strong>
                  <span>등록과 동시에 현재 공동사업 기관으로 선택합니다.</span>
                </div>
                <button type="button" onClick={() => setQuickInstitution(null)}>
                  닫기
                </button>
              </header>
              <div className="joint-project-quick-grid">
                <label>
                  <span>기관명 *</span>
                  <input
                    value={quickInstitution.organization}
                    onChange={(event) =>
                      setQuickInstitution((current) =>
                        current
                          ? { ...current, organization: event.target.value }
                          : current,
                      )
                    }
                    placeholder="기관명"
                  />
                </label>
                <label>
                  <span>기관 유형</span>
                  <select
                    value={quickInstitution.institutionType}
                    onChange={(event) =>
                      setQuickInstitution((current) =>
                        current
                          ? { ...current, institutionType: event.target.value }
                          : current,
                      )
                    }
                  >
                    <option value="기관">기관</option>
                    <option value="학교">학교</option>
                    <option value="유아">어린이집·유치원</option>
                    <option value="노인">노인</option>
                    <option value="장애인">장애인</option>
                    <option value="기타">기타</option>
                  </select>
                </label>
                <label>
                  <span>지역</span>
                  <input
                    value={quickInstitution.region}
                    onChange={(event) =>
                      setQuickInstitution((current) =>
                        current ? { ...current, region: event.target.value } : current,
                      )
                    }
                    placeholder="예: 충남 보령"
                  />
                </label>
                <label className="wide">
                  <span>주소</span>
                  <input
                    value={quickInstitution.address}
                    onChange={(event) =>
                      setQuickInstitution((current) =>
                        current ? { ...current, address: event.target.value } : current,
                      )
                    }
                    placeholder="주소를 알면 입력해 주세요. 지도 위치는 나중에 확인할 수 있습니다."
                  />
                </label>
              </div>
              {quickInstitution.organization.trim() && (
                <div className="joint-project-duplicate-guide">
                  <strong>비슷한 기존 기관</strong>
                  <span>
                    {sponsorOptions
                      .filter((item) => {
                        const query = quickInstitution.organization.replace(/\s+/g, "");
                        const name = item.organization.replace(/\s+/g, "");
                        return query && (name.includes(query) || query.includes(name));
                      })
                      .slice(0, 3)
                      .map((item) => item.organization)
                      .join(", ") || "없음"}
                  </span>
                </div>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={quickInstitutionBusy || !quickInstitution.organization.trim()}
                onClick={() => void createQuickInstitution()}
              >
                {quickInstitutionBusy ? "등록 중…" : "기관 등록하고 선택"}
              </button>
            </section>
          )}
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
                  <small>기관 사업 {item.businessRound}차</small>
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
          {activityAmbiguities.length > 0 && (
            <section className="joint-project-link-confirmation">
              <header>
                <strong>실제 수주 기록 확인</strong>
                <span>잘못 연결하지 않도록 후보가 여러 건인 기관만 확인합니다.</span>
              </header>
              {activityAmbiguities.map((item) => (
                <label key={amountKey(item)}>
                  <span>{item.organization}</span>
                  <select
                    value={activitySelections[amountKey(item)] ?? ""}
                    onChange={(event) =>
                      setActivitySelections((current) => ({
                        ...current,
                        [amountKey(item)]: event.target.value,
                      }))
                    }
                  >
                    <option value="">연결할 수주 기록 선택</option>
                    {item.candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.activityDate} · {candidate.budgetType || "예산 미정"} · {candidate.businessRound}차
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </section>
          )}
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
                activityAmbiguities.some(
                  (item) => !activitySelections[amountKey(item)],
                ) ||
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
