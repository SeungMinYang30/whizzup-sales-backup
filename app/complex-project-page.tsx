"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadComplexProjectWorkbook } from "./complex-project-xlsx";

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

type ItemFilter = "unscheduled" | "protection" | "quantity" | "price" | "selection" | "budget";
type SummaryDialog = "budget-total" | "execution" | "remaining" | ItemFilter;

const itemFilterLabels: Record<ItemFilter, string> = {
  unscheduled: "일정 미정 품목",
  protection: "영업보호 필요 품목",
  quantity: "수량 초과 품목",
  price: "금액 미입력 품목",
  selection: "물선위·선정 확인 품목",
  budget: "표준 예산 연결 확인 품목",
};

function summaryDialogTitle(dialog: SummaryDialog) {
  if (dialog === "budget-total") return "전체예산";
  if (dialog === "execution") return "계약·집행금액";
  if (dialog === "remaining") return "남은 예산";
  return itemFilterLabels[dialog];
}

function isBudgetSummary(dialog: SummaryDialog) {
  return dialog === "budget-total" || dialog === "remaining";
}

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

export default function ComplexProjectPage(props: {
  onOpenOrganization?: (organization: string, businessRound: number) => void;
  onRecordsChanged?: () => void | Promise<void>;
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
  const [createSourceType, setCreateSourceType] = useState<"whizzup" | "new">("whizzup");
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState("");
  const [selectedScope, setSelectedScope] = useState("");
  const [createNewRound, setCreateNewRound] = useState(false);
  const [createName, setCreateName] = useState("");
  const [newOrganization, setNewOrganization] = useState("");
  const [newRegion, setNewRegion] = useState("");
  const [newBusinessRound, setNewBusinessRound] = useState("1");
  const [createManagerId, setCreateManagerId] = useState("");
  const [basicInfoOpen, setBasicInfoOpen] = useState(false);
  const [itemFilter, setItemFilter] = useState<ItemFilter | null>(null);
  const [summaryDialog, setSummaryDialog] = useState<SummaryDialog | null>(null);
  const budgetSectionRef = useRef<HTMLElement>(null);
  const itemSectionRef = useRef<HTMLElement>(null);
  const [detailTarget, setDetailTarget] = useState<{
    organization: string;
    businessRound: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/complex-projects", { cache: "no-store" });
      const body = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "공간재구조화 사업을 불러오지 못했습니다.");
      setData(body);
      setSelectedId((current) => {
        if (current && body.projects.some((project) => Number(project.id) === current)) return current;
        return body.projects[0] ? Number(body.projects[0].id) : null;
      });
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "공간재구조화 사업을 불러오지 못했습니다.");
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
      setSelectedOrganization(organization);
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
    setMessage("이미 관리 중인 공간재구조화 사업을 열었습니다.");
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
      void fetch(`/api/complex-projects?candidateQuery=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as { candidates?: Row[]; error?: string };
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

  const filteredItems = useMemo(() => {
    if (!selected || !itemFilter) return selected?.items ?? [];
    return selected.items.filter((item) => {
      const scheduleState = String(item.schedule_state || "");
      const protectionState = String(item.protection_state || item.protection_status || "");
      const selectionStatus = String(item.selection_status || "");
      if (itemFilter === "unscheduled") {
        return scheduleState === "일정 미정" || scheduleState === "수량 미배정";
      }
      if (itemFilter === "protection") {
        return !["신청 완료", "승인", "보호 중", "해당 없음"].includes(protectionState);
      }
      if (itemFilter === "quantity") return scheduleState === "수량 초과";
      if (itemFilter === "price") {
        return item.catalog_unit_price === null || item.catalog_unit_price === undefined;
      }
      if (itemFilter === "selection") {
        return Boolean(selectionStatus) && !["선정 완료", "확정"].includes(selectionStatus);
      }
      return !numberValue(item.budget_group_id);
    });
  }, [itemFilter, selected]);

  useEffect(() => {
    setBasicInfoOpen(false);
    setItemFilter(null);
    setSummaryDialog(null);
  }, [selectedId]);

  function openBudgetSection() {
    budgetSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openItemSection(filter: ItemFilter | null = null) {
    setItemFilter(filter);
    window.requestAnimationFrame(() => {
      itemSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const candidateInstitutions = useMemo(() => {
    const groups = new Map<string, { organization: string; canonical: string; region: string; address: string; rounds: Row[] }>();
    candidates.forEach((candidate) => {
      const organization = String(candidate.organization || "").trim();
      const canonical = String(candidate.canonical_organization || organization).trim();
      if (!organization || !canonical) return;
      const current = groups.get(canonical) ?? {
        organization,
        canonical,
        region: String(candidate.region || ""),
        address: String(candidate.address || ""),
        rounds: [],
      };
      current.rounds.push(candidate);
      groups.set(canonical, current);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      rounds: group.rounds.sort((left, right) => numberValue(right.business_round) - numberValue(left.business_round)),
    }));
  }, [candidates]);

  const selectedInstitution = useMemo(
    () => candidateInstitutions.find((group) => group.organization === selectedOrganization) ?? null,
    [candidateInstitutions, selectedOrganization],
  );

  async function mutate(payload: Record<string, unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/complex-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(readError(body));
      setData(body);
      setMessage(success);
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
    const organization = createSourceType === "new" ? newOrganization.trim() : scope[0];
    const businessRound = createSourceType === "new"
      ? Math.max(1, Number(newBusinessRound || 1))
      : Number(scope[1] || 1);
    if (!organization) {
      setMessage(createSourceType === "new" ? "기관명을 입력해 주세요." : "기관과 사업 차수를 선택해 주세요.");
      return;
    }
    const ok = await mutate({
      action: "create_project",
      sourceType: "whizzup",
      registerNewAward: createSourceType === "new",
      createNewRound: createSourceType === "whizzup" && createNewRound,
      organization,
      businessRound,
      region: createSourceType === "new" ? newRegion : selectedInstitution?.region,
      name: createName,
      status: "준비",
      managerMemberId: createManagerId,
      notes: form.get("notes"),
    }, "공간재구조화 사업을 시작했습니다.");
    if (ok) {
      await props.onRecordsChanged?.();
      const created = ok.projects.find(
        (project) => project.organization === organization && numberValue(project.business_round) === businessRound,
      );
      if (created) setSelectedId(Number(created.id));
      setCreateOpen(false);
      setCandidateSearch("");
      setCandidates([]);
      setSelectedOrganization("");
      setSelectedScope("");
      setCreateNewRound(false);
      setCreateName("");
      setNewOrganization("");
      setNewRegion("");
      setNewBusinessRound("1");
      setCreateManagerId("");
      setCreateSourceType("whizzup");
    }
  }

  async function updateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const ok = await mutate({
      action: "update_project",
      projectId: selected.id,
      name: form.get("name"),
      status: form.get("status"),
      managerMemberId: form.get("managerMemberId"),
      notes: form.get("notes"),
    }, "공간재구조화 사업 기본 정보를 저장했습니다.");
    if (ok) {
      setBasicInfoOpen(false);
      await props.onRecordsChanged?.();
    }
  }

  async function addBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const ok = await mutate({
      action: "add_budget",
      projectId: selected.id,
      budgetGroupId: form.get("budgetGroupId"),
    }, "표준 예산을 기관 상세와 공간재구조화 사업에 추가했습니다.");
    if (ok) {
      setBudgetOpen(false);
      await props.onRecordsChanged?.();
    }
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
      setSummaryDialog(null);
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
    if (!selected || !window.confirm("이 공간재구조화 사업을 취소하시겠습니까? 기록은 보존되고 목록에서 숨겨집니다.")) return;
    const result = await mutate({ action: "cancel_project", projectId: selected.id }, "공간재구조화 사업을 취소했습니다.");
    if (result) setSelectedId(null);
  }

  return (
    <section className="complex-project-page">
      <header className="complex-page-header">
        <div>
          <span className="section-kicker">LARGE · COMPLEX PROJECT</span>
          <h2>공간재구조화 사업 관리</h2>
          <p>큰 사업의 여러 예산·공간·품목·분할 납품·영업보호를 한 화면에서 관리합니다.</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreateOpen((open) => {
          if (!open) setMessage("");
          return !open;
        })}>
          + 공간재구조화 사업 시작
        </button>
      </header>

      {message && <div className="complex-message" role="status">{message}</div>}

      {createOpen && (
        <form className="complex-inline-form" onSubmit={createProject} noValidate>
          <strong>기관의 공간재구조화 사업 시작</strong>
          <div className="complex-source-switch wide" role="radiogroup" aria-label="공간재구조화 사업 출처">
            <button type="button" role="radio" aria-checked={createSourceType === "whizzup"} className={createSourceType === "whizzup" ? "selected" : ""} onClick={() => { setCreateSourceType("whizzup"); setSelectedScope(""); setCreateNewRound(false); }}>기존 위즈업 기관에서 선택</button>
            <button type="button" role="radio" aria-checked={createSourceType === "new"} className={createSourceType === "new" ? "selected" : ""} onClick={() => { setCreateSourceType("new"); setSelectedOrganization(""); setSelectedScope(""); setCandidates([]); }}>새 기관 위즈업 수주 등록</button>
          </div>
          {createSourceType === "whizzup" ? <>
          <label className="wide">기관 검색
            <input
              value={candidateSearch}
              onChange={(event) => {
                setCandidateSearch(event.target.value);
                setSelectedOrganization("");
                setSelectedScope("");
                setCreateNewRound(false);
              }}
              placeholder="기관명 또는 지역을 두 글자 이상 입력"
              autoComplete="off"
            />
            <small>{candidateLoading ? "기관을 검색하는 중입니다." : candidateSearch.replace(/\s+/g, "").length < 2 ? "두 글자부터 검색합니다." : `${candidates.length}개 후보`}</small>
          </label>
          <div className="complex-candidate-results wide" role="listbox" aria-label="공간재구조화 기관 검색 결과">
            {candidateInstitutions.map((institution) => <button
              type="button"
              key={institution.canonical}
              className={selectedOrganization === institution.organization ? "selected" : ""}
              onClick={() => {
                setSelectedOrganization(institution.organization);
                setSelectedScope("");
                setCreateNewRound(false);
                setCreateName(`${institution.organization} 공간재구조화 사업`);
                const latestManager = institution.rounds.find((candidate) => String(candidate.progress_manager || "").trim());
                const matched = data.members.find((member) => String(member.display_name) === String(latestManager?.progress_manager || ""));
                setCreateManagerId(matched ? String(matched.id) : "");
              }}
            >
              <span><b>{institution.organization}</b><small>{institution.region || "지역 미입력"} · {institution.rounds.length}개 사업 차수</small><small>{institution.address || "주소 미입력"}</small></span>
              <em>차수 선택</em>
            </button>)}
            {!candidateLoading && candidateSearch.replace(/\s+/g, "").length >= 2 && !candidates.length && <p>일치하는 기관·사업 차수가 없습니다.</p>}
          </div>
          {selectedInstitution && <div className="complex-round-results wide">
            <strong>{selectedInstitution.organization} 사업 차수</strong>
            {selectedInstitution.rounds.map((candidate) => {
              const scope = `${candidate.organization}\u001f${candidate.business_round}`;
              const active = numberValue(candidate.complex_project_id) > 0;
              return <button type="button" key={scope} className={selectedScope === scope && !createNewRound ? "selected" : ""} onClick={() => {
                if (active) {
                  setSelectedId(numberValue(candidate.complex_project_id));
                  setCreateOpen(false);
                  setMessage("이미 관리 중인 공간재구조화 사업을 열었습니다.");
                  return;
                }
                setSelectedScope(scope);
                setCreateNewRound(false);
                setCreateName(String(candidate.complex_project_name || `${candidate.organization} 공간재구조화 사업`));
                const matched = data.members.find((member) => String(member.display_name) === String(candidate.progress_manager));
                setCreateManagerId(matched ? String(matched.id) : "");
              }}>
                <span><b>{numberValue(candidate.business_round)}차</b><small>{String(candidate.latest_date || "날짜 미입력")} · 예산 {numberValue(candidate.budget_count)}개 · 품목 {numberValue(candidate.item_count)}개</small></span>
                <em>{active ? "관리 중" : "기존 차수 연결"}</em>
              </button>;
            })}
            <button type="button" className={createNewRound ? "selected" : ""} onClick={() => {
              const nextRound = Math.max(0, ...selectedInstitution.rounds.map((candidate) => numberValue(candidate.business_round))) + 1;
              setSelectedScope(`${selectedInstitution.organization}\u001f${nextRound}`);
              setCreateNewRound(true);
              setCreateName(`${selectedInstitution.organization} 공간재구조화 사업`);
              const latestManager = selectedInstitution.rounds.find((candidate) => String(candidate.progress_manager || "").trim());
              const matched = data.members.find((member) => String(member.display_name) === String(latestManager?.progress_manager || ""));
              setCreateManagerId(matched ? String(matched.id) : "");
            }}><span><b>새 차수 만들기</b><small>기관 정보만 이어받고 과거 예산·품목은 복사하지 않습니다.</small></span><em>새 사업</em></button>
          </div>}
          </> : <>
            <div className="complex-external-notice wide">새 위즈업 수주 기관과 1차 사업을 기관별 관리에도 함께 등록합니다.</div>
            <label>기관명<input value={newOrganization} onChange={(event) => { setNewOrganization(event.target.value); if (!createName) setCreateName(`${event.target.value} 공간재구조화 사업`); }} required placeholder="기관명" /></label>
            <label>지역<input value={newRegion} onChange={(event) => setNewRegion(event.target.value)} placeholder="예: 경기 고양" /></label>
            <label>사업 차수<input value={newBusinessRound} onChange={(event) => setNewBusinessRound(event.target.value)} type="number" min="1" /></label>
          </>}
          <label>사업명<input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="예: 일산초 공간재구조화 사업" /></label>
          <label>진행 담당자
            <select value={createManagerId} onChange={(event) => setCreateManagerId(event.target.value)}>
              <option value="">담당자 미지정</option>
              {data.members.map((member) => <option key={String(member.id)} value={String(member.id)}>{String(member.display_label || member.display_name)}</option>)}
            </select>
          </label>
          <label className="wide">메모<textarea name="notes" rows={2} /></label>
          <div className="complex-form-actions">
            {message && <span className="complex-form-feedback" role="status" aria-live="polite">{message}</span>}
            <button type="button" onClick={() => setCreateOpen(false)}>취소</button>
            <button type="submit" className="primary" disabled={busy || (createSourceType === "whizzup" && !selectedScope) || (createSourceType === "new" && !newOrganization.trim())}>{busy ? "저장 중…" : "시작"}</button>
          </div>
        </form>
      )}

      <div className="complex-workspace">
        <aside className="complex-project-list" aria-label="공간재구조화 사업 목록">
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
          {!loading && data.projects.length === 0 && <p className="empty-state">아직 등록한 공간재구조화 사업이 없습니다.</p>}
        </aside>

        <div className="complex-project-detail">
          {loading ? <div className="empty-state">공간재구조화 사업을 불러오는 중입니다.</div> : selected ? (
            <>
              <div className="complex-detail-heading">
                <div><h3>{selected.name}</h3><p>{selected.organization} · {numberValue(selected.business_round)}차 사업 · {selected.source_type === "external" ? `${selected.source_award_status}(통계 제외)` : "위즈업 수주"}</p></div>
                <div className="complex-detail-actions">
                  <button type="button" onClick={() => downloadComplexProjectWorkbook(selected)}>엑셀 내보내기</button>
                  <button type="button" onClick={() => props.onOpenOrganization?.(selected.organization, numberValue(selected.business_round))}>기관 상세 보기</button>
                  <button type="button" className="danger" onClick={() => void cancelProject()}>사업 취소</button>
                </div>
              </div>

              <div className="complex-institution-link" role="status">
                <div>
                  <strong>기관 상세와 같은 사업 기록을 사용합니다.</strong>
                  <span>기관 상세의 같은 차수에 등록된 예산 {selected.budgets.length.toLocaleString("ko-KR")}건·품목 {selected.items.length.toLocaleString("ko-KR")}건이 자동으로 연결되며, 어느 화면에서 수정해도 함께 반영됩니다.</span>
                </div>
                <button type="button" onClick={() => props.onOpenOrganization?.(selected.organization, numberValue(selected.business_round))}>기관 상세 열기</button>
              </div>

              <div className="complex-summary-grid">
                <button type="button" onClick={() => setSummaryDialog("budget-total")}><small>전체예산</small><b>{selected.total_budget === null ? "예산 미입력" : money(selected.total_budget)}</b></button>
                <button type="button" onClick={() => setSummaryDialog("execution")}><small>계약·집행금액</small><b>{money(selected.summary.quote_amount)}</b></button>
                <button type="button" onClick={() => setSummaryDialog("remaining")} className={selected.summary.remaining_budget !== null && selected.summary.remaining_budget < 0 ? "danger" : ""}><small>{selected.summary.remaining_budget !== null && selected.summary.remaining_budget < 0 ? "전체예산 초과" : "남은 예산"}</small><b>{selected.summary.remaining_budget === null ? "예산 미입력" : money(Math.abs(selected.summary.remaining_budget))}</b></button>
                <button type="button" onClick={() => setSummaryDialog("unscheduled")} className={selected.summary.unscheduled_count ? "warning" : ""}><small>일정 미정 품목</small><b>{selected.summary.unscheduled_count}건</b></button>
                <button type="button" onClick={() => setSummaryDialog("protection")} className={selected.summary.protection_needed_count ? "warning" : ""}><small>영업보호 필요</small><b>{selected.summary.protection_needed_count}건</b></button>
                <button type="button" onClick={() => setSummaryDialog("quantity")} className={selected.summary.quantity_issue_count ? "danger" : ""}><small>수량 초과</small><b>{selected.summary.quantity_issue_count}건</b></button>
                <button type="button" onClick={() => setSummaryDialog("price")} className={selected.summary.price_missing_count ? "warning" : ""}><small>금액 미입력 품목</small><b>{selected.summary.price_missing_count}건</b></button>
                <button type="button" onClick={() => setSummaryDialog("selection")} className={selected.summary.selection_pending_count ? "warning" : ""}><small>물선위·선정 확인</small><b>{selected.summary.selection_pending_count}건</b></button>
                <button type="button" onClick={() => setSummaryDialog("budget")} className={selected.summary.budget_unassigned_count ? "warning" : ""}><small>표준 예산 연결 확인</small><b>{selected.summary.budget_unassigned_count}건</b></button>
              </div>

              {summaryDialog && <div className="complex-summary-dialog-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSummaryDialog(null); }}><section className="complex-summary-dialog" role="dialog" aria-modal="true" aria-label="사업 요약 확인 및 수정"><header><div><span className="section-kicker">QUICK EDIT</span><h3>{summaryDialogTitle(summaryDialog)}</h3></div><button type="button" aria-label="닫기" onClick={() => setSummaryDialog(null)}>×</button></header>{isBudgetSummary(summaryDialog) && <><p>전체예산은 기관 상세의 같은 사업 차수에 등록된 예산을 기준으로 자동 계산합니다.</p><div className="complex-budget-list">{selected.budgets.map((budget) => <article key={String(budget.id)}><span><b>{String(budget.name)}</b><small>{String(budget.budget_kind || "분류 미정")}</small></span><strong>{budget.budget_amount === null ? "예산 미입력" : money(budget.budget_amount)}</strong></article>)}</div><footer><button type="button" onClick={() => { setSummaryDialog(null); props.onOpenOrganization?.(selected.organization, numberValue(selected.business_round)); }}>기관 상세에서 예산 수정</button></footer></>}{!isBudgetSummary(summaryDialog) && <div className="complex-summary-item-list">{selected.items.filter((item) => { if (summaryDialog === "execution") return true; const scheduleState = String(item.schedule_state || ""); const protectionState = String(item.protection_state || item.protection_status || ""); const selectionStatus = String(item.selection_status || ""); if (summaryDialog === "unscheduled") return scheduleState === "일정 미정" || scheduleState === "수량 미배정"; if (summaryDialog === "protection") return !["신청 완료", "승인", "보호 중", "해당 없음"].includes(protectionState); if (summaryDialog === "quantity") return scheduleState === "수량 초과"; if (summaryDialog === "price") return item.catalog_unit_price == null; if (summaryDialog === "selection") return Boolean(selectionStatus) && !["선정 완료", "확정"].includes(selectionStatus); return !numberValue(item.budget_group_id); }).map((item) => <article key={String(item.equipment_item_id)}><div><strong>{String(item.product_name)}</strong><small>{String(item.specification || "규격 미입력")} · {item.catalog_unit_price == null ? "금액 미입력" : money(item.quotation_amount)}</small></div><button type="button" onClick={() => { setEditItem(item); setItemOpen(false); }}>바로 수정</button>{editItem?.equipment_item_id === item.equipment_item_id && <ItemForm project={selected} item={editItem} busy={busy} onSubmit={saveItem} onCancel={() => setEditItem(null)} />}</article>)}{!selected.items.length && <p className="empty-state">등록된 품목이 없습니다.</p>}</div>}</section></div>}

              <details className="complex-section" open={basicInfoOpen} onToggle={(event) => setBasicInfoOpen(event.currentTarget.open)}>
                <summary>기본정보 수정</summary>
                <form className="complex-project-form" onSubmit={updateProject} key={`project-${selected.id}-${selected.updated_at}`}>
                  <label>사업명<input name="name" defaultValue={selected.name} required /></label>
                  <label>상태<select name="status" defaultValue={selected.status}>{["준비", "진행", "보류", "완료", "취소"].map((status) => <option key={status}>{status}</option>)}</select></label>
                  <label>진행 담당자<select name="managerMemberId" defaultValue={String(selected.manager_member_id ?? "")}><option value="">담당자 미지정</option>{data.members.map((member) => <option key={String(member.id)} value={String(member.id)}>{String(member.display_label || member.display_name)}</option>)}</select></label>
                  <label className="wide">메모<textarea name="notes" rows={2} defaultValue={selected.notes} /></label>
                  <div className="complex-form-actions"><button className="primary" disabled={busy}>기본 정보 저장</button></div>
                </form>
              </details>

              <section className="complex-section" ref={budgetSectionRef}>
                <div className="complex-section-title"><div><h3>기관 예산</h3><p>기관 상세의 같은 차수에 등록된 예산을 자동으로 불러옵니다. 여기서 추가한 예산도 기관 상세에 함께 반영됩니다.</p></div><button type="button" onClick={() => setBudgetOpen((open) => !open)}>+ 예산 추가</button></div>
                {budgetOpen && <form className="complex-compact-form complex-budget-form" onSubmit={addBudget}>
                  <select name="budgetGroupId" required defaultValue=""><option value="" disabled>등록된 표준 예산명 선택</option>{data.budgetGroups.map((group) => <option key={String(group.id)} value={String(group.id)}>{String(group.canonical_name)}</option>)}</select>
                  <button className="primary" disabled={busy}>추가</button>
                </form>}
                <div className="complex-budget-list">
                  {selected.budgets.map((budget) => <article key={String(budget.id)}><span><b>{String(budget.name)}</b><small>{String(budget.budget_kind || "분류 미정")}</small></span><strong>{budget.budget_amount === null ? "예산 미입력" : money(budget.budget_amount)}</strong></article>)}
                  {!selected.budgets.length && <p className="empty-state">기관 상세에 등록된 예산이 없습니다. 예산을 추가해 주세요.</p>}
                </div>
              </section>

              <section className="complex-section">
                <div className="complex-section-title"><div><h3>공간·구역</h3><p>동·층·교실을 등록하면 많은 품목도 설치 위치별로 찾을 수 있습니다.</p></div><button type="button" onClick={() => setZoneOpen((open) => !open)}>+ 공간 추가</button></div>
                {zoneOpen && <form className="complex-compact-form complex-zone-form" onSubmit={addZone}><input name="building" placeholder="동/건물" /><input name="floor" placeholder="층" /><input name="room" placeholder="실/교실" /><input name="name" placeholder="표시할 공간명" required /><input name="notes" placeholder="메모" /><button className="primary" disabled={busy}>추가</button></form>}
                <div className="complex-zone-list">{selected.zones.map((zone) => <span key={String(zone.id)}><b>{String(zone.name)}</b><small>{[zone.building, zone.floor, zone.room].filter(Boolean).join(" · ")}</small><button type="button" aria-label="공간 삭제" onClick={() => void removeEntity("zone", numberValue(zone.id))}>−</button></span>)}{!selected.zones.length && <small>공간을 등록하지 않아도 품목 관리는 가능합니다.</small>}</div>
              </section>

              <section className="complex-section" ref={itemSectionRef}>
                <div className="complex-section-title"><div><h3>품목·영업보호·납품</h3><p>기관 상세의 제품·견적 품목을 그대로 사용하며, 분할 납품 합계와 수주 수량이 다르면 자동으로 표시합니다.</p></div><button type="button" onClick={() => { setEditItem(null); setItemOpen((open) => !open); }}>+ 품목 추가</button></div>
                {itemFilter && <div className="complex-active-filter" role="status"><span>{itemFilterLabels[itemFilter]}만 표시 중 · {filteredItems.length}건</span><button type="button" onClick={() => setItemFilter(null)}>전체 보기</button></div>}
                {itemOpen && <ItemForm project={selected} item={editItem} busy={busy} onSubmit={saveItem} onCancel={() => { setItemOpen(false); setEditItem(null); }} />}
                <div className="complex-item-list">
                  {filteredItems.map((item) => {
                    const itemId = numberValue(item.equipment_item_id);
                    const zone = selected.zones.find((entry) => numberValue(entry.id) === numberValue(item.zone_id));
                    return <article key={itemId} className="complex-item-card">
                      <header>
                        <div><span className="complex-item-tags"><em>{String(item.budget_name)}</em><em>{String(item.item_category)}</em>{zone && <em>{String(zone.name)}</em>}</span><h4>{String(item.product_name)}</h4><p>{String(item.specification || "규격 미입력")}</p></div>
                        <span className={`complex-state state-${String(item.schedule_state).replace(/\s/g, "-")}`}>{String(item.schedule_state)}</span>
                      </header>
                      <div className="complex-item-metrics">
                        <span>적용 수량 <b>{numberValue(item.settlement_quantity).toLocaleString("ko-KR")}{String(item.unit)}</b></span>
                        <span>일정 배정 <b>{numberValue(item.planned_delivery_qty).toLocaleString("ko-KR")}{String(item.unit)}</b></span>
                        <span>완료 <b>{numberValue(item.completed_delivery_qty).toLocaleString("ko-KR")}{String(item.unit)}</b></span>
                        <span>계약·집행금액 <b>{item.catalog_unit_price === null ? "미입력" : money(item.quotation_amount)}</b></span>
                        <span>업체 <b>{String(item.supplier_vendor_name || "미지정")}</b></span>
                        <span className={["신청 완료", "승인", "보호 중", "해당 없음"].includes(String(item.protection_state || item.protection_status)) ? "ok" : "warning-text"}>영업보호 <b>{String(item.protection_state || item.protection_status)}</b></span>
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
                      <footer><button type="button" onClick={() => { setEditItem(item); setItemOpen(true); }}>품목 수정</button><button type="button" className="primary" onClick={() => { setDeliveryItemId(itemId); setEditDelivery(null); }}>+ 분할 일정</button></footer>
                      {deliveryItemId === itemId && <DeliveryForm item={item} delivery={editDelivery} busy={busy} onSubmit={saveDelivery} onCancel={() => { setDeliveryItemId(null); setEditDelivery(null); }} />}
                    </article>;
                  })}
                  {!selected.items.length && <p className="empty-state">아직 등록한 품목이 없습니다.</p>}
                  {Boolean(selected.items.length && itemFilter && !filteredItems.length) && <p className="empty-state">이 조건에 해당하는 품목이 없습니다.</p>}
                </div>
              </section>
            </>
            ) : <div className="empty-state">왼쪽에서 공간재구조화 사업을 선택해 주세요.</div>}
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
    <label>수량<input name="awardedQty" type="number" min="0" defaultValue={numberValue(item?.settlement_quantity ?? item?.awarded_qty)} /></label>
    <label>단위<input name="unit" defaultValue={String(item?.unit ?? "대")} /></label>
    <label>단가<input name="unitPrice" type="number" min="0" defaultValue={item?.catalog_unit_price === null ? "" : numberValue(item?.catalog_unit_price)} /></label>
    <label>상태<select name="status" defaultValue={String(item?.status ?? "수주")}>{["제안", "견적", "수주", "발주", "설치 중", "설치 완료", "보류", "취소"].map((name) => <option key={name}>{name}</option>)}</select></label>
    <label>공간<select name="zoneId" defaultValue={String(item?.zone_id ?? "")}><option value="">공간 미지정</option>{props.project.zones.map((zone) => <option key={String(zone.id)} value={String(zone.id)}>{String(zone.name)}</option>)}</select></label>
    <label>납품·설치 위치<input name="deliveryLocation" defaultValue={String(item?.delivery_location ?? "")} /></label>
    <label>업체<input name="supplierName" defaultValue={String(item?.supplier_vendor_name ?? "")} /></label>
    <label>영업보호<select name="protectionStatus" defaultValue={String(item?.protection_state ?? item?.protection_status ?? "신청 필요")}>{["신청 필요", "신청 중", "신청 완료", "보호 중", "승인", "만료", "해당 없음"].map((name) => <option key={name}>{name}</option>)}</select></label>
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
    <label>배정 수량<input name="plannedQty" type="number" min="0" defaultValue={delivery ? numberValue(delivery.planned_qty) : Math.max(0, numberValue(props.item.settlement_quantity ?? props.item.awarded_qty) - numberValue(props.item.planned_delivery_qty))} /></label>
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
