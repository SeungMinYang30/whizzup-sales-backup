"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { resilientFetch } from "./resilient-fetch";

type Row = Record<string, unknown>;
type ComplexProject = Row & {
  id: number;
  organization: string;
  business_round: number;
  name: string;
  status: string;
  total_budget: number | null;
  source_type: "whizzup" | "external";
  source_award_status: string;
  manager_name: string;
  notes: string;
  budgets: Row[];
  zones: Row[];
  items: Array<Row & { deliveries: Row[]; schedule_state: string }>;
  summary: {
    allocated_amount: number;
    quote_amount: number;
    item_quote_amount: number;
    construction_amount: number;
    item_count: number;
    unscheduled_count: number;
    protection_needed_count: number;
    quantity_issue_count: number;
    price_missing_count: number;
    selection_pending_count: number;
    budget_unassigned_count: number;
    remaining_budget: number | null;
  };
};

type Payload = {
  projects: ComplexProject[];
  budgetGroups: Row[];
  members: Row[];
  candidates: Row[];
};

const emptyPayload: Payload = { projects: [], budgetGroups: [], members: [], candidates: [] };

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return `${numberValue(value).toLocaleString("ko-KR")}원`;
}

function readError(value: unknown) {
  return value && typeof value === "object" && "error" in value
    ? String((value as { error?: unknown }).error ?? "요청을 처리하지 못했습니다.")
    : "요청을 처리하지 못했습니다.";
}

async function readJson<T>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(response.ok
      ? "서버 응답을 확인하지 못했습니다. 다시 시도해 주세요."
      : "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export default function ComplexProjectPage(props: {
  onOpenOrganization?: (organization: string, businessRound: number) => void;
}) {
  const [data, setData] = useState<Payload>(emptyPayload);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [deliveryItemId, setDeliveryItemId] = useState<number | null>(null);
  const [editItem, setEditItem] = useState<Row | null>(null);
  const [editDelivery, setEditDelivery] = useState<Row | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [createSourceType, setCreateSourceType] = useState<"whizzup" | "external">("whizzup");
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [selectedScope, setSelectedScope] = useState("");
  const [createManagerId, setCreateManagerId] = useState("");
  const [createName, setCreateName] = useState("");
  const [createTotalBudget, setCreateTotalBudget] = useState("");
  const [detailTarget, setDetailTarget] = useState<{
    organization: string;
    businessRound: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await resilientFetch("/api/complex-projects", {
        cache: "no-store",
        timeoutMs: 20_000,
        retries: 0,
      });
      const body = await readJson<Payload & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "복합사업을 불러오지 못했습니다.");
      setData(body);
      setSelectedId((current) => {
        if (current && body.projects.some((project) => Number(project.id) === current)) return current;
        return body.projects[0] ? Number(body.projects[0].id) : null;
      });
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "복합사업을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const raw = window.sessionStorage.getItem("whizzup.complexProjectTarget");
    if (!raw) return;
    window.sessionStorage.removeItem("whizzup.complexProjectTarget");
    try {
      const parsed = JSON.parse(raw) as {
        organization?: unknown;
        businessRound?: unknown;
      };
      const organization = String(parsed.organization ?? "").trim();
      const businessRound = Math.max(1, numberValue(parsed.businessRound));
      if (!organization) return;
      setDetailTarget({ organization, businessRound });
      setCandidateSearch(organization);
      setSelectedScope(`${organization}\u001f${businessRound}`);
      setCreateOpen(true);
    } catch {
      // 잘못된 임시 이동 정보는 무시하고 일반 목록을 표시합니다.
    }
  }, []);

  useEffect(() => {
    if (!detailTarget || loading) return;
    const existing = data.projects.find(
      (project) =>
        project.organization === detailTarget.organization &&
        numberValue(project.business_round) === detailTarget.businessRound,
    );
    if (!existing) return;
    setSelectedId(Number(existing.id));
    setCreateOpen(false);
    setDetailTarget(null);
    setMessage("이미 활성화된 복합사업을 열었습니다.");
  }, [data.projects, detailTarget, loading]);

  useEffect(() => {
    const query = candidateSearch.trim();
    if (!createOpen || createSourceType !== "whizzup" || query.replace(/\s+/g, "").length < 2) {
      setCandidates([]);
      setCandidateLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCandidateLoading(true);
      void resilientFetch(`/api/complex-projects?candidateQuery=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
        timeoutMs: 12_000,
        retries: 0,
      })
        .then(async (response) => {
          const body = await readJson<{ candidates?: Row[]; error?: string }>(response);
          if (!response.ok) throw new Error(body.error || "기관을 검색하지 못했습니다.");
          setCandidates(Array.isArray(body.candidates) ? body.candidates : []);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setCandidates([]);
          setMessage(error instanceof Error ? error.message : "기관을 검색하지 못했습니다.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setCandidateLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [candidateSearch, createOpen, createSourceType]);

  const selected = useMemo(
    () => data.projects.find((project) => Number(project.id) === selectedId) ?? null,
    [data.projects, selectedId],
  );

  const applyCandidateDefaults = useCallback((candidate: Row) => {
    const scope = `${candidate.organization}\u001f${candidate.business_round}`;
    setSelectedScope(scope);
    setCreateName(String(candidate.suggested_name || `${candidate.organization} 복합사업`));
    setCreateTotalBudget(numberValue(candidate.suggested_total_budget)
      ? String(numberValue(candidate.suggested_total_budget))
      : "");
    const normalizedManager = String(candidate.progress_manager || "").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    const matched = data.members.find((member) =>
      String(member.display_name || "").replace(/\s+/g, "").toLocaleLowerCase("ko-KR") === normalizedManager,
    );
    setCreateManagerId(matched ? String(matched.id) : "");
  }, [data.members]);

  useEffect(() => {
    if (!detailTarget || !candidates.length || createName || createTotalBudget) return;
    const candidate = candidates.find((entry) =>
      String(entry.organization) === detailTarget.organization
      && numberValue(entry.business_round) === detailTarget.businessRound,
    );
    if (candidate) applyCandidateDefaults(candidate);
  }, [applyCandidateDefaults, candidates, createName, createTotalBudget, detailTarget]);

  async function mutate(payload: Record<string, unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    try {
      const response = await resilientFetch("/api/complex-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 20_000,
        retries: 0,
      });
      const body = await readJson<Record<string, unknown> & { error?: string }>(response);
      if (!response.ok) throw new Error(readError(body));
      setMessage(success);
      try {
        const refreshResponse = await resilientFetch("/api/complex-projects", {
          cache: "no-store",
          timeoutMs: 20_000,
          retries: 0,
        });
        const refreshed = await readJson<Payload & { error?: string }>(refreshResponse);
        if (!refreshResponse.ok) throw new Error(readError(refreshed));
        setData(refreshed);
        setSelectedId((current) => {
          const requested = numberValue(body.projectId) || current;
          if (requested && refreshed.projects.some((project) => Number(project.id) === requested)) return requested;
          return refreshed.projects[0] ? Number(refreshed.projects[0].id) : null;
        });
      } catch {
        setMessage(`${success} 최신 화면 갱신이 지연되고 있어 잠시 후 새로고침해 주세요.`);
      }
      return body;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scope = selectedScope.split("\u001f");
    const organization = createSourceType === "external"
      ? String(form.get("externalOrganization") ?? "").trim()
      : scope[0];
    const businessRound = createSourceType === "external"
      ? Math.max(1, Number(form.get("externalBusinessRound") || 1))
      : Number(scope[1] || 1);
    if (!organization) {
      setMessage("검색 결과에서 기관과 사업 차수를 선택해 주세요.");
      return;
    }
    const ok = await mutate({
      action: "create_project",
      sourceType: createSourceType,
      sourceAwardStatus: form.get("sourceAwardStatus"),
      organization,
      businessRound,
      name: form.get("name"),
      status: "준비",
      totalBudget: form.get("totalBudget"),
      managerMemberId: createManagerId,
      notes: form.get("notes"),
    }, "복합사업을 시작했습니다.");
    if (ok) {
      if (numberValue(ok.projectId)) setSelectedId(numberValue(ok.projectId));
      setCreateOpen(false);
      setCandidateSearch("");
      setCandidates([]);
      setSelectedScope("");
      setCreateManagerId("");
      setCreateName("");
      setCreateTotalBudget("");
      setCreateSourceType("whizzup");
    }
  }

  async function updateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await mutate({
      action: "update_project",
      projectId: selected.id,
      name: form.get("name"),
      status: form.get("status"),
      totalBudget: form.get("totalBudget"),
      managerMemberId: form.get("managerMemberId"),
      notes: form.get("notes"),
    }, "복합사업 기본 정보를 저장했습니다.");
  }

  async function addBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const ok = await mutate({
      action: "add_budget",
      projectId: selected.id,
      budgetGroupId: form.get("budgetGroupId"),
      allocatedAmount: form.get("allocatedAmount"),
    }, "표준 예산을 사업에 연결했습니다.");
    if (ok) setBudgetOpen(false);
  }

  async function addZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const ok = await mutate({
      action: "save_zone",
      projectId: selected.id,
      name: form.get("name"),
      building: form.get("building"),
      floor: form.get("floor"),
      room: form.get("room"),
      notes: form.get("notes"),
    }, "공간을 추가했습니다.");
    if (ok) setZoneOpen(false);
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const ok = await mutate({
      action: "save_item",
      projectId: selected.id,
      itemId: editItem?.equipment_item_id ?? null,
      equipmentProjectId: form.get("equipmentProjectId"),
      productName: form.get("productName"),
      specification: form.get("specification"),
      itemCategory: form.get("itemCategory"),
      zoneId: form.get("zoneId"),
      proposedQty: form.get("awardedQty"),
      awardedQty: form.get("awardedQty"),
      installedQty: editItem?.installed_qty ?? 0,
      unit: form.get("unit"),
      unitPrice: form.get("unitPrice"),
      status: form.get("status"),
      supplierName: form.get("supplierName"),
      protectionStatus: form.get("protectionStatus"),
      procurementMethod: form.get("procurementMethod"),
      procurementIdentifier: form.get("procurementIdentifier"),
      deliveryLocation: form.get("deliveryLocation"),
      selectionRound: form.get("selectionRound"),
      selectionStatus: form.get("selectionStatus"),
      changeReason: form.get("changeReason"),
      electricalRequirements: form.get("electricalRequirements"),
      networkRequirements: form.get("networkRequirements"),
      protectionVendorName: form.get("protectionVendorName"),
      protectionExpiresAt: form.get("protectionExpiresAt"),
      notes: form.get("notes"),
    }, editItem ? "품목을 수정했습니다." : "품목을 추가했습니다.");
    if (ok) {
      setItemOpen(false);
      setEditItem(null);
    }
  }

  async function saveDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !deliveryItemId) return;
    const form = new FormData(event.currentTarget);
    const ok = await mutate({
      action: "save_delivery",
      projectId: selected.id,
      itemId: deliveryItemId,
      deliveryId: editDelivery?.id ?? null,
      kind: form.get("kind"),
      plannedQty: form.get("plannedQty"),
      completedQty: form.get("completedQty"),
      startDate: form.get("startDate"),
      endDate: form.get("endDate"),
      vendorName: form.get("vendorName"),
      location: form.get("location"),
      status: form.get("status"),
      notes: form.get("notes"),
    }, "분할 납품 일정을 저장하고 시공·납품 일정표에 연결했습니다.");
    if (ok) {
      setDeliveryItemId(null);
      setEditDelivery(null);
    }
  }

  async function removeEntity(entity: "zone" | "delivery", id: number) {
    if (!selected || !window.confirm("이 항목을 삭제하시겠습니까?")) return;
    await mutate({ action: "delete_entity", projectId: selected.id, entity, id }, "항목을 삭제했습니다.");
  }

  async function cancelProject() {
    if (!selected) return;
    const reason = window.prompt(
      "복합사업 연결을 취소합니다. 기관 상세·예산·품목·수주 기록은 삭제되지 않습니다.\n취소 사유를 입력해 주세요.",
      "",
    );
    if (reason === null) return;
    if (!window.confirm("복합사업을 취소하시겠습니까? 원본 기관 기록과 회계·통계 자료는 그대로 유지됩니다.")) return;
    const ok = await mutate({ action: "cancel_project", projectId: selected.id, reason }, "복합사업을 취소했습니다.");
    if (ok) setSelectedId(null);
  }

  return (
    <section className="complex-project-page">
      <header className="complex-page-header">
        <div>
          <span className="section-kicker">LARGE · COMPLEX PROJECT</span>
          <h2>복합사업 관리</h2>
          <p>큰 사업의 여러 예산·공간·품목·분할 납품·영업보호를 한 화면에서 관리합니다.</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreateOpen((open) => !open)}>
          + 복합사업 시작
        </button>
      </header>

      {message && <div className="complex-message" role="status">{message}</div>}

      {createOpen && (
        <form className="complex-inline-form" onSubmit={createProject}>
          <strong>기관의 복합사업 활성화</strong>
          <div className="complex-source-switch wide" role="radiogroup" aria-label="복합사업 출처">
            <button type="button" role="radio" aria-checked={createSourceType === "whizzup"} className={createSourceType === "whizzup" ? "selected" : ""} onClick={() => { setCreateSourceType("whizzup"); setSelectedScope(""); setCreateName(""); setCreateTotalBudget(""); }}>위즈업 수주에서 선택</button>
            <button type="button" role="radio" aria-checked={createSourceType === "external"} className={createSourceType === "external" ? "selected" : ""} onClick={() => { setCreateSourceType("external"); setSelectedScope(""); setCreateName(""); setCreateTotalBudget(""); setCandidates([]); }}>외부 사업 수기 등록</button>
          </div>
          {createSourceType === "whizzup" ? <>
          <label className="wide">기관 검색
            <input
              value={candidateSearch}
              onChange={(event) => {
                setCandidateSearch(event.target.value);
                setSelectedScope("");
                setCreateName("");
                setCreateTotalBudget("");
              }}
              placeholder="기관명 또는 지역을 두 글자 이상 입력"
              autoComplete="off"
            />
            <small>{candidateLoading ? "기관을 검색하는 중입니다." : candidateSearch.replace(/\s+/g, "").length < 2 ? "두 글자부터 검색합니다." : `${candidates.length}개 후보`}</small>
          </label>
          <div className="complex-candidate-results wide" role="listbox" aria-label="복합사업 기관 검색 결과">
            {candidates.map((candidate) => {
              const scope = `${candidate.organization}\u001f${candidate.business_round}`;
              const active = numberValue(candidate.complex_project_id) > 0;
              return <button
                type="button"
                key={scope}
                className={selectedScope === scope ? "selected" : ""}
                onClick={() => {
                  if (active) {
                    setSelectedId(numberValue(candidate.complex_project_id));
                    setCreateOpen(false);
                    setMessage("이미 활성화된 복합사업을 열었습니다.");
                    return;
                  }
                  applyCandidateDefaults(candidate);
                }}
              >
                <span><b>{String(candidate.organization)}</b><small>{String(candidate.region || "지역 미입력")} · {numberValue(candidate.business_round)}차 · {String(candidate.award_status || "수주 미정")}</small><small>{String(candidate.address || "주소 미입력")}</small><small>{numberValue(candidate.linked_budget_count)}개 예산 · 품목 {money(candidate.linked_item_amount)} · 공사 {money(candidate.linked_construction_amount)}</small></span>
                <em>{active ? "관리 중" : numberValue(candidate.whizzup_award) ? "위즈업 수주" : "선택"}</em>
              </button>;
            })}
            {!candidateLoading && candidateSearch.replace(/\s+/g, "").length >= 2 && !candidates.length && <p>일치하는 기관·사업 차수가 없습니다.</p>}
          </div>
          </> : <>
            <div className="complex-external-notice wide">협력사·타업체 수주를 위한 내부 일정·품목 관리입니다. 수금·수주 통계에는 포함되지 않습니다.</div>
            <label>기관명<input name="externalOrganization" required placeholder="기관명" /></label>
            <label>사업 차수<input name="externalBusinessRound" type="number" min="1" defaultValue="1" /></label>
            <label>외부 수주 구분<select name="sourceAwardStatus" defaultValue="협력사 수주"><option>협력사 수주</option><option>타업체 수주</option><option>기타 외부 사업</option></select></label>
          </>}
          <label>사업명<input name="name" value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="기관 선택 시 기존 사업 정보를 불러옵니다" /></label>
          <label>총 관리예산<input name="totalBudget" value={createTotalBudget} onChange={(event) => setCreateTotalBudget(event.target.value)} type="number" min="0" placeholder="기관 선택 시 기존 예산을 합산합니다" /></label>
          <label>진행 담당자
            <select value={createManagerId} onChange={(event) => setCreateManagerId(event.target.value)}>
              <option value="">담당자 미지정</option>
              {data.members.map((member) => <option key={String(member.id)} value={String(member.id)}>{String(member.display_name)}</option>)}
            </select>
          </label>
          <label className="wide">메모<textarea name="notes" rows={2} /></label>
          <div className="complex-form-actions"><button type="button" onClick={() => setCreateOpen(false)}>취소</button><button className="primary" disabled={busy || (createSourceType === "whizzup" && !selectedScope)}>{busy ? "저장 중…" : "시작"}</button></div>
        </form>
      )}

      <div className="complex-workspace">
        <aside className="complex-project-list" aria-label="복합사업 목록">
          {data.projects.map((project) => (
            <button type="button" className={selectedId === Number(project.id) ? "active" : ""} key={project.id} onClick={() => setSelectedId(Number(project.id))}>
              <span><b>{project.name}</b><small>{project.organization} · {numberValue(project.business_round)}차</small><small>{project.source_type === "external" ? `${project.source_award_status} · 통계 제외` : "위즈업 수주 연결"}</small></span>
              <em>{project.status}</em>
              <span className="complex-list-alerts">
                {project.summary.unscheduled_count > 0 && <small>일정 미정 {project.summary.unscheduled_count}</small>}
                {project.summary.protection_needed_count > 0 && <small>보호 필요 {project.summary.protection_needed_count}</small>}
                {project.summary.price_missing_count > 0 && <small>금액 미입력 {project.summary.price_missing_count}</small>}
                {project.summary.selection_pending_count > 0 && <small>선정 확인 {project.summary.selection_pending_count}</small>}
              </span>
            </button>
          ))}
          {!loading && data.projects.length === 0 && <p className="empty-state">아직 활성화한 복합사업이 없습니다.</p>}
        </aside>

        <div className="complex-project-detail">
          {loading ? <div className="empty-state">복합사업을 불러오는 중입니다.</div> : selected ? (
            <>
              <div className="complex-detail-heading">
                <div><h3>{selected.name}</h3><p>{selected.organization} · {numberValue(selected.business_round)}차 사업 · {selected.source_type === "external" ? `${selected.source_award_status}(통계 제외)` : "위즈업 수주"}</p></div>
                <div className="complex-heading-actions"><button type="button" onClick={() => props.onOpenOrganization?.(selected.organization, numberValue(selected.business_round))}>기관 상세 보기</button><button type="button" className="danger" onClick={() => void cancelProject()}>복합사업 취소</button></div>
              </div>

              <div className="complex-summary-grid">
                <article><small>총 관리예산</small><b>{money(selected.total_budget)}</b></article>
                <article><small>예산 배정 합계</small><b>{money(selected.summary.allocated_amount)}</b></article>
                <article><small>연결 품목 금액</small><b>{money(selected.summary.item_quote_amount)}</b></article>
                <article><small>연결 공사비</small><b>{money(selected.summary.construction_amount)}</b></article>
                <article><small>품목·공사비 합계</small><b>{money(selected.summary.quote_amount)}</b></article>
                <article className={selected.summary.remaining_budget !== null && selected.summary.remaining_budget < 0 ? "danger" : ""}><small>{selected.summary.remaining_budget !== null && selected.summary.remaining_budget < 0 ? "관리예산 초과" : "관리예산 잔액"}</small><b>{selected.summary.remaining_budget === null ? "예산 미입력" : money(Math.abs(selected.summary.remaining_budget))}</b></article>
                <article className={selected.summary.unscheduled_count ? "warning" : ""}><small>일정 미정 품목</small><b>{selected.summary.unscheduled_count}건</b></article>
                <article className={selected.summary.protection_needed_count ? "warning" : ""}><small>영업보호 필요</small><b>{selected.summary.protection_needed_count}건</b></article>
                <article className={selected.summary.quantity_issue_count ? "danger" : ""}><small>수량 초과</small><b>{selected.summary.quantity_issue_count}건</b></article>
                <article className={selected.summary.price_missing_count ? "warning" : ""}><small>금액 미입력 품목</small><b>{selected.summary.price_missing_count}건</b></article>
                <article className={selected.summary.selection_pending_count ? "warning" : ""}><small>물선위·선정 확인</small><b>{selected.summary.selection_pending_count}건</b></article>
                <article className={selected.summary.budget_unassigned_count ? "warning" : ""}><small>표준 예산 연결 확인</small><b>{selected.summary.budget_unassigned_count}건</b></article>
              </div>

              <details className="complex-section" open>
                <summary>사업 기본 정보</summary>
                <form className="complex-project-form" onSubmit={updateProject} key={`project-${selected.id}-${selected.updated_at}`}>
                  <label>사업명<input name="name" defaultValue={selected.name} required /></label>
                  <label>상태<select name="status" defaultValue={selected.status}>{["준비", "진행", "보류", "완료", "취소"].map((status) => <option key={status}>{status}</option>)}</select></label>
                  <label>총 관리예산<input name="totalBudget" type="number" min="0" defaultValue={selected.total_budget ?? ""} /></label>
                  <label>진행 담당자<select name="managerMemberId" defaultValue={String(selected.manager_member_id ?? "")}><option value="">담당자 미지정</option>{data.members.map((member) => <option key={String(member.id)} value={String(member.id)}>{String(member.display_name)}</option>)}</select></label>
                  <label className="wide">메모<textarea name="notes" rows={2} defaultValue={selected.notes} /></label>
                  <div className="complex-form-actions"><button className="primary" disabled={busy}>기본 정보 저장</button></div>
                </form>
              </details>

              <section className="complex-section">
                <div className="complex-section-title"><div><h3>표준 예산 연결</h3><p>기존 표준 예산과 품목 카드를 그대로 사용해 통계·회계 이중 집계를 막습니다.</p></div><button type="button" onClick={() => setBudgetOpen((open) => !open)}>+ 예산 연결</button></div>
                {budgetOpen && <form className="complex-compact-form" onSubmit={addBudget}>
                  <select name="budgetGroupId" required defaultValue=""><option value="" disabled>등록된 표준 예산명 선택</option>{data.budgetGroups.map((group) => <option key={String(group.id)} value={String(group.id)}>{String(group.canonical_name)}</option>)}</select>
                  <input name="allocatedAmount" type="number" min="0" placeholder="이 사업의 배정 금액" />
                  <button className="primary" disabled={busy}>연결</button>
                </form>}
                <div className="complex-budget-list">
                  {selected.budgets.map((budget) => <article key={String(budget.id)}><span><b>{String(budget.name)}</b><small>{String(budget.budget_kind || "분류 미정")}</small></span><strong>{budget.allocated_amount === null ? "배정액 미입력" : money(budget.allocated_amount)}</strong></article>)}
                  {!selected.budgets.length && <p className="empty-state">연결된 표준 예산이 없습니다. 예산을 먼저 연결해 주세요.</p>}
                </div>
              </section>

              <section className="complex-section">
                <div className="complex-section-title"><div><h3>공간·구역</h3><p>동·층·교실을 등록하면 많은 품목도 설치 위치별로 찾을 수 있습니다.</p></div><button type="button" onClick={() => setZoneOpen((open) => !open)}>+ 공간 추가</button></div>
                {zoneOpen && <form className="complex-compact-form complex-zone-form" onSubmit={addZone}><input name="building" placeholder="동/건물" /><input name="floor" placeholder="층" /><input name="room" placeholder="실/교실" /><input name="name" placeholder="표시할 공간명" required /><input name="notes" placeholder="메모" /><button className="primary" disabled={busy}>추가</button></form>}
                <div className="complex-zone-list">{selected.zones.map((zone) => <span key={String(zone.id)}><b>{String(zone.name)}</b><small>{[zone.building, zone.floor, zone.room].filter(Boolean).join(" · ")}</small><button type="button" aria-label="공간 삭제" onClick={() => void removeEntity("zone", numberValue(zone.id))}>−</button></span>)}{!selected.zones.length && <small>공간을 등록하지 않아도 품목 관리는 가능합니다.</small>}</div>
              </section>

              <section className="complex-section">
                <div className="complex-section-title"><div><h3>품목·영업보호·납품</h3><p>분할 납품 합계와 수주 수량이 다르면 자동으로 표시합니다.</p></div><button type="button" onClick={() => { setEditItem(null); setItemOpen((open) => !open); }}>+ 품목 추가</button></div>
                {itemOpen && <ItemForm project={selected} item={editItem} busy={busy} onSubmit={saveItem} onCancel={() => { setItemOpen(false); setEditItem(null); }} />}
                <div className="complex-item-list">
                  {selected.items.map((item) => {
                    const itemId = numberValue(item.equipment_item_id);
                    const zone = selected.zones.find((entry) => numberValue(entry.id) === numberValue(item.zone_id));
                    return <article key={itemId} className="complex-item-card">
                      <header>
                        <div><span className="complex-item-tags"><em>{String(item.budget_name)}</em><em>{String(item.item_category)}</em>{zone && <em>{String(zone.name)}</em>}</span><h4>{String(item.product_name)}</h4><p>{String(item.specification || "규격 미입력")}</p></div>
                        <span className={`complex-state state-${String(item.schedule_state).replace(/\s/g, "-")}`}>{String(item.schedule_state)}</span>
                      </header>
                      <div className="complex-item-metrics">
                        <span>기준 수량 <b>{numberValue(item.settlement_quantity).toLocaleString("ko-KR")}{String(item.unit)}</b>{String(item.quantity_source) === "기본 수량" && <small> · 원본 수량 미입력</small>}</span>
                        <span>일정 배정 <b>{numberValue(item.planned_delivery_qty).toLocaleString("ko-KR")}{String(item.unit)}</b></span>
                        <span>완료 <b>{numberValue(item.completed_delivery_qty).toLocaleString("ko-KR")}{String(item.unit)}</b></span>
                        <span>금액 <b>{item.effective_unit_price === null ? "미입력" : money(item.item_amount)}</b>{item.unit_price_source === "제품 기준" && <small> · 제품 기준</small>}</span>
                        <span>업체 <b>{String(item.supplier_display_name || "미지정")}</b></span>
                        <span className={String(item.protection_status) === "신청 완료" ? "ok" : "warning-text"}>영업보호 <b>{String(item.protection_state || item.protection_status)}</b></span>
                      </div>
                      <div className="complex-item-notes">
                        {Boolean(item.selection_round) && <span>물선위 {String(item.selection_round)}</span>}
                        {Boolean(item.selection_status) && <span>선정 {String(item.selection_status)}</span>}
                        {Boolean(item.procurement_method) && <span>{String(item.procurement_method)}</span>}
                        {Boolean(item.procurement_identifier) && <span>식별번호 {String(item.procurement_identifier)}</span>}
                        {Boolean(item.protection_expires_at) && <span>영업보호 만료 {String(item.protection_expires_at)}</span>}
                        {Boolean(item.electrical_requirements || item.network_requirements) && <span>사전공사 확인 필요</span>}
                      </div>
                      <div className="complex-delivery-list">
                        {(item.deliveries ?? []).map((delivery) => <span key={String(delivery.id)}><b>{String(delivery.kind)}</b><small>{String(delivery.start_date || "일정 미정")}{delivery.end_date && delivery.end_date !== delivery.start_date ? ` ~ ${delivery.end_date}` : ""}</small><small>{numberValue(delivery.planned_qty)}{String(item.unit)} · {String(delivery.status)}</small><button type="button" onClick={() => { setDeliveryItemId(itemId); setEditDelivery(delivery); }}>수정</button><button type="button" onClick={() => void removeEntity("delivery", numberValue(delivery.id))}>삭제</button></span>)}
                      </div>
                      <footer>
                        {numberValue(item.comparison_document_count) > 0 && Boolean(item.catalog_item_id) && (
                          <a href={`/api/product-comparison-documents?productId=${encodeURIComponent(String(item.catalog_item_id))}&latest=1`} target="_blank" rel="noreferrer">비교표 내려받기</a>
                        )}
                        <button type="button" onClick={() => { setEditItem(item); setItemOpen(true); }}>품목 수정</button>
                        <button type="button" className="primary" onClick={() => { setDeliveryItemId(itemId); setEditDelivery(null); }}>+ 분할 일정</button>
                      </footer>
                      {deliveryItemId === itemId && <DeliveryForm item={item} delivery={editDelivery} busy={busy} onSubmit={saveDelivery} onCancel={() => { setDeliveryItemId(null); setEditDelivery(null); }} />}
                    </article>;
                  })}
                  {!selected.items.length && <p className="empty-state">아직 등록한 품목이 없습니다.</p>}
                </div>
              </section>
            </>
          ) : <div className="empty-state">왼쪽에서 복합사업을 선택해 주세요.</div>}
        </div>
      </div>
    </section>
  );
}

function ItemForm(props: { project: ComplexProject; item: Row | null; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const item = props.item;
  return <form className="complex-inline-form complex-item-form" onSubmit={props.onSubmit} key={item ? `item-${item.equipment_item_id}-${item.updated_at}` : "new-item"}>
    <label>연결 예산<select name="equipmentProjectId" required defaultValue={String(item?.project_id ?? "")}><option value="" disabled>예산 선택</option>{props.project.budgets.map((budget) => <option key={String(budget.equipment_project_id)} value={String(budget.equipment_project_id)}>{String(budget.name)}</option>)}</select></label>
    <label>품목 구분<select name="itemCategory" defaultValue={String(item?.item_category ?? "기자재")}>{["기자재", "가구·비품", "설치·공사", "소프트웨어", "기타"].map((name) => <option key={name}>{name}</option>)}</select></label>
    <label className="wide">품목명<input name="productName" required defaultValue={String(item?.product_name ?? "")} /></label>
    <label className="wide">규격<input name="specification" defaultValue={String(item?.specification ?? "")} /></label>
    <label>수량<input name="awardedQty" type="number" min="0" defaultValue={numberValue(item?.awarded_qty) || numberValue(item?.settlement_quantity)} /></label>
    <label>단위<input name="unit" defaultValue={String(item?.unit ?? "대")} /></label>
    <label>단가<input name="unitPrice" type="number" min="0" defaultValue={item?.effective_unit_price === null ? "" : numberValue(item?.effective_unit_price)} /></label>
    <label>상태<select name="status" defaultValue={String(item?.status ?? "수주")}>{["제안", "견적", "수주", "발주", "설치 중", "설치 완료", "보류", "취소"].map((name) => <option key={name}>{name}</option>)}</select></label>
    <label>공간<select name="zoneId" defaultValue={String(item?.zone_id ?? "")}><option value="">공간 미지정</option>{props.project.zones.map((zone) => <option key={String(zone.id)} value={String(zone.id)}>{String(zone.name)}</option>)}</select></label>
    <label>납품·설치 위치<input name="deliveryLocation" defaultValue={String(item?.delivery_location ?? "")} /></label>
    <label>업체<input name="supplierName" defaultValue={String(item?.supplier_vendor_name || item?.supplier_display_name || "")} /></label>
    <label>영업보호<select name="protectionStatus" defaultValue={String(item?.protection_state ?? item?.protection_status ?? "신청 필요")}>{["신청 필요", "신청 중", "보호 중", "승인", "만료", "해당 없음"].map((name) => <option key={name}>{name}</option>)}</select></label>
    <label>보호 대상 업체<input name="protectionVendorName" defaultValue={String(item?.protection_vendor_name ?? item?.supplier_vendor_name ?? "")} /></label>
    <label>영업보호 만료일<input name="protectionExpiresAt" type="date" defaultValue={String(item?.protection_expires_at ?? "")} /></label>
    <label>조달 방식<input name="procurementMethod" placeholder="나라장터·학교장터·수의계약 등" defaultValue={String(item?.procurement_method ?? "")} /></label>
    <label>물품 식별번호<input name="procurementIdentifier" defaultValue={String(item?.procurement_identifier ?? "")} /></label>
    <label>물선위 차수<input name="selectionRound" placeholder="예: 2차·변경 물선위" defaultValue={String(item?.selection_round ?? "")} /></label>
    <label>선정 상태<select name="selectionStatus" defaultValue={String(item?.selection_status ?? "검토 중")}>{["검토 중", "선정 예정", "선정 완료", "조달 재등록", "제품 변경", "확정", "취소"].map((name) => <option key={name}>{name}</option>)}</select></label>
    <label className="wide">변경·재등록 사유<input name="changeReason" placeholder="제품 단종, 모델·금액 변경 등" defaultValue={String(item?.change_reason ?? "")} /></label>
    <label className="wide">전기·배선 요구사항<textarea name="electricalRequirements" rows={2} placeholder="필요전력, 콘센트, 전기선 등" defaultValue={String(item?.electrical_requirements ?? "")} /></label>
    <label className="wide">네트워크 요구사항<textarea name="networkRequirements" rows={2} placeholder="랜선 수량, 회선, 설치 조건 등" defaultValue={String(item?.network_requirements ?? "")} /></label>
    <label className="wide">메모<textarea name="notes" rows={2} defaultValue={String(item?.notes ?? "")} /></label>
    <div className="complex-form-actions"><button type="button" onClick={props.onCancel}>취소</button><button className="primary" disabled={props.busy}>품목 저장</button></div>
  </form>;
}

function DeliveryForm(props: { item: Row; delivery: Row | null; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const delivery = props.delivery;
  return <form className="complex-delivery-form" onSubmit={props.onSubmit} key={delivery ? `delivery-${delivery.id}-${delivery.updated_at}` : "new-delivery"}>
    <label>구분<select name="kind" defaultValue={String(delivery?.kind ?? "납품")}>{["납품", "설치", "시공", "검수", "교육", "철거", "기타"].map((name) => <option key={name}>{name}</option>)}</select></label>
    <label>배정 수량<input name="plannedQty" type="number" min="0" defaultValue={delivery ? numberValue(delivery.planned_qty) : Math.max(0, numberValue(props.item.awarded_qty) - numberValue(props.item.planned_delivery_qty))} /></label>
    <label>완료 수량<input name="completedQty" type="number" min="0" defaultValue={numberValue(delivery?.completed_qty)} /></label>
    <label>시작일<input name="startDate" type="date" defaultValue={String(delivery?.start_date ?? "")} /></label>
    <label>종료일<input name="endDate" type="date" defaultValue={String(delivery?.end_date ?? "")} /></label>
    <label>상태<select name="status" defaultValue={String(delivery?.status ?? "예정")}><option>일정 미정</option><option>예정</option><option>진행</option><option>완료</option><option>변경</option><option>취소</option></select></label>
    <label>업체<input name="vendorName" defaultValue={String(delivery?.vendor_name ?? props.item.supplier_vendor_name ?? "")} /></label>
    <label>위치<input name="location" defaultValue={String(delivery?.location ?? props.item.delivery_location ?? "")} /></label>
    <label className="wide">메모<input name="notes" defaultValue={String(delivery?.notes ?? "")} /></label>
    <div className="complex-form-actions"><button type="button" onClick={props.onCancel}>취소</button><button className="primary" disabled={props.busy}>{delivery ? "일정 수정" : "일정 저장"}</button></div>
  </form>;
}
