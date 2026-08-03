"use client";

import { useEffect, useMemo, useState } from "react";
import { downloadRowsXlsx } from "./activity-xlsx";

type ScheduleRecord = {
  id: number;
  organization: string;
  businessRound: number;
  region: string;
  awardStatus: string;
  awardStage: string;
  progressManager: string;
  activityDate: string;
  summary: string;
};

type ConstructionProject = {
  id: number;
  organization: string;
  businessRound: number;
  workSummary: string;
  completed: boolean;
  updatedAt: string;
};

type ConstructionSchedule = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  stage: string;
  scheduledDate: string;
  endDate: string;
  vendorName: string;
  details: string;
  completed: boolean;
};

type EditorItem = {
  key: string;
  stage: string;
  scheduledDate: string;
  endDate: string;
  vendorName: string;
  details: string;
  active: boolean;
};

type EditorState = {
  organization: string;
  businessRound: number;
  workSummary: string;
  completed: boolean;
  items: EditorItem[];
};

const STAGES = ["출고", "철거", "통신", "목공", "도장", "바닥", "시스템", "납품", "사인", "검수"];
const localDate = (date = new Date()) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const dayLabel = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});
const scopeKey = (organization: string, businessRound: number) =>
  `${organization}\u001f${businessRound}`;
const itemKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function ConstructionSchedulePage({
  records,
  onOpenOrganization,
  embedded = false,
}: {
  records: ScheduleRecord[];
  onOpenOrganization: (organization: string, businessRound: number) => void;
  embedded?: boolean;
}) {
  const today = localDate();
  const [start, setStart] = useState(today);
  const [projects, setProjects] = useState<ConstructionProject[]>([]);
  const [schedules, setSchedules] = useState<ConstructionSchedule[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hideCompleted, setHideCompleted] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const days = useMemo(
    () => Array.from({ length: 31 }, (_, index) => addDays(start, index)),
    [start],
  );

  const latestByScope = useMemo(() => {
    const map = new Map<string, ScheduleRecord>();
    [...records]
      .sort((a, b) => b.activityDate.localeCompare(a.activityDate) || b.id - a.id)
      .forEach((record) => {
        const key = scopeKey(record.organization, record.businessRound);
        if (!map.has(key)) map.set(key, record);
      });
    return map;
  }, [records]);

  const institutionOptions = useMemo(
    () =>
      [...latestByScope.values()]
        .filter((record) => record.awardStatus === "위즈업 수주")
        .sort((a, b) => a.organization.localeCompare(b.organization, "ko-KR")),
    [latestByScope],
  );

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/schedules?scope=construction-board", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        projects?: ConstructionProject[];
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "일정표를 불러오지 못했습니다.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일정표를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const schedulesByScope = useMemo(() => {
    const map = new Map<string, ConstructionSchedule[]>();
    schedules.forEach((schedule) => {
      const key = scopeKey(schedule.organization, schedule.businessRound);
      map.set(key, [...(map.get(key) ?? []), schedule]);
    });
    return map;
  }, [schedules]);

  const rows = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    return projects
      .map((project) => {
        const record = latestByScope.get(scopeKey(project.organization, project.businessRound));
        return {
          project,
          record,
          items: schedulesByScope.get(scopeKey(project.organization, project.businessRound)) ?? [],
        };
      })
      .filter(({ project }) => !hideCompleted || !project.completed)
      .filter(({ project, record }) =>
        !keyword ||
        `${project.organization} ${project.workSummary} ${record?.region ?? ""} ${record?.progressManager ?? ""}`
          .toLocaleLowerCase("ko-KR")
          .includes(keyword),
      )
      .sort((a, b) => {
        const left = a.items[0]?.scheduledDate ?? "9999-12-31";
        const right = b.items[0]?.scheduledDate ?? "9999-12-31";
        return left.localeCompare(right) || a.project.organization.localeCompare(b.project.organization, "ko-KR");
      });
  }, [hideCompleted, latestByScope, projects, query, schedulesByScope]);

  const addOptions = useMemo(() => {
    const keyword = addQuery.trim().toLocaleLowerCase("ko-KR");
    const registered = new Set(projects.map((project) => scopeKey(project.organization, project.businessRound)));
    return institutionOptions
      .filter((option) => !registered.has(scopeKey(option.organization, option.businessRound)))
      .filter((option) =>
        !keyword || `${option.organization} ${option.region}`.toLocaleLowerCase("ko-KR").includes(keyword),
      )
      .slice(0, 30);
  }, [addQuery, institutionOptions, projects]);

  async function addProject(record: ScheduleRecord) {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-construction-project",
          organization: record.organization,
          businessRound: record.businessRound,
          workSummary: record.summary,
        }),
      });
      const payload = (await response.json()) as {
        projects?: ConstructionProject[];
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "기관을 추가하지 못했습니다.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setAddOpen(false);
      setAddQuery("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기관을 추가하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function openEditor(project: ConstructionProject, selectedDate = today) {
    const current = schedulesByScope.get(scopeKey(project.organization, project.businessRound)) ?? [];
    const items: EditorItem[] = current.map((schedule) => ({
      key: `saved-${schedule.id}`,
      stage: schedule.stage || schedule.label,
      scheduledDate: schedule.scheduledDate,
      endDate: schedule.endDate || schedule.scheduledDate,
      vendorName: schedule.vendorName,
      details: schedule.details,
      active: true,
    }));
    STAGES.forEach((stage) => {
      if (!items.some((item) => item.stage === stage)) {
        items.push({
          key: itemKey(),
          stage,
          scheduledDate: selectedDate,
          endDate: selectedDate,
          vendorName: "",
          details: "",
          active: false,
        });
      }
    });
    setEditor({
      organization: project.organization,
      businessRound: project.businessRound,
      workSummary: project.workSummary,
      completed: project.completed,
      items,
    });
  }

  function updateEditorItem(key: string, patch: Partial<EditorItem>) {
    if (!editor) return;
    setEditor({
      ...editor,
      items: editor.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    });
  }

  function addStageRange(stage: string, date: string) {
    if (!editor) return;
    setEditor({
      ...editor,
      items: [
        ...editor.items,
        {
          key: itemKey(),
          stage,
          scheduledDate: date,
          endDate: date,
          vendorName: "",
          details: "",
          active: true,
        },
      ],
    });
  }

  async function saveEditor() {
    if (!editor || saving) return;
    setSaving(true);
    try {
      const activeItems = editor.items.filter((item) => item.active);
      if (activeItems.some((item) => !item.scheduledDate || !item.endDate || item.endDate < item.scheduledDate)) {
        throw new Error("시작일과 종료일을 확인해 주세요.");
      }
      const response = await fetch("/api/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-construction",
          organization: editor.organization,
          businessRound: editor.businessRound,
          workSummary: editor.workSummary,
          completed: editor.completed,
          schedules: activeItems,
        }),
      });
      const payload = (await response.json()) as {
        projects?: ConstructionProject[];
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "일정을 저장하지 못했습니다.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setEditor(null);
      setMessage("일정이 기관 상세와 HOME에 함께 반영되었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function removeProject(project: ConstructionProject) {
    if (saving || !window.confirm(`${project.organization}을(를) 시공 일정표에서 뺄까요?\n기관 정보와 영업·수주 기록은 유지됩니다.`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove-construction-project",
          organization: project.organization,
          businessRound: project.businessRound,
        }),
      });
      const payload = (await response.json()) as {
        projects?: ConstructionProject[];
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "일정표에서 기관을 빼지 못했습니다.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setMessage("기관을 일정표에서 뺐습니다. 기관 정보와 영업·수주 기록은 유지됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일정표에서 기관을 빼지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function exportExcel() {
    const exportRows = rows.map(({ project, record, items }) => [
      record?.region || "지역 미등록",
      project.organization,
      `${project.businessRound}차 사업`,
      project.workSummary || "공사·품목 미등록",
      record?.progressManager || "미정",
      ...days.map((day) => items
        .filter((item) => item.scheduledDate <= day && (item.endDate || item.scheduledDate) >= day)
        .map((item) => `${item.stage || item.label}${item.vendorName ? ` (${item.vendorName})` : ""}`)
        .join(" / ")),
    ]);
    downloadRowsXlsx({
      filename: `위즈업_시공납품일정_${start}.xlsx`,
      sheetName: "시공 납품 일정",
      headers: ["지역", "기관명", "사업", "공사·품목", "진행 담당자", ...days.map((day) => dayLabel.format(new Date(`${day}T00:00:00Z`)))],
      rows: exportRows,
      widths: [14, 28, 12, 30, 16, ...days.map(() => 15)],
    });
  }

  const shift = (amount: number) => setStart(addDays(start, amount));

  return (
    <section className={`construction-schedule-workspace${embedded ? " is-embedded" : ""}`}>
      <header className="construction-schedule-header">
        <div>
          <span className="section-kicker">INSTALLATION · DELIVERY</span>
          <h2>시공·납품 일정표</h2>
          <p>기관을 등록하고 단계별 업체와 기간을 한 화면에서 관리합니다.</p>
        </div>
        <div className="construction-schedule-actions">
          <button type="button" className="primary-button" onClick={() => setAddOpen(true)}>+ 기관 추가</button>
          <button type="button" onClick={exportExcel}>엑셀 내보내기</button>
          <label className="construction-completed-filter">
            <input type="checkbox" checked={hideCompleted} onChange={(event) => setHideCompleted(event.target.checked)} />
            완료 기관 제외
          </label>
        </div>
      </header>

      <div className="construction-schedule-toolbar">
        <div className="construction-schedule-controls">
          <button type="button" onClick={() => shift(-31)}>이전</button>
          <button type="button" onClick={() => setStart(today)}>오늘부터</button>
          <button type="button" onClick={() => shift(31)}>다음</button>
          <label>시작일<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        </div>
        <div className="construction-schedule-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기관명·지역·담당자·공사 내용 검색" />
          <span>{rows.length.toLocaleString()}개 기관</span>
        </div>
      </div>

      {message ? <div className="quotation-workspace-message">{message}</div> : null}

      <div className="construction-timeline">
        <div className="construction-timeline-head">
          <div className="construction-fixed-head"><span>지역</span><span>기관명</span><span>공사·품목</span><span>담당자</span></div>
          <div className="construction-days">
            {days.map((day) => <span className={day === today ? "today" : ""} key={day}>{dayLabel.format(new Date(`${day}T00:00:00Z`))}</span>)}
          </div>
        </div>
        {loading ? <div className="empty-state">일정표를 불러오는 중입니다.</div> : null}
        {!loading && rows.map(({ project, record, items }) => (
          <article className="construction-timeline-row" key={scopeKey(project.organization, project.businessRound)}>
            <div className="construction-fixed-cells">
              <span>{record?.region || "지역 미등록"}</span>
              <span className="construction-institution-cell"><button type="button" onClick={() => onOpenOrganization(project.organization, project.businessRound)}><strong>{project.organization}</strong><small>{project.businessRound}차 사업</small></button><button type="button" className="construction-remove-project" onClick={() => void removeProject(project)}>일정표에서 빼기</button></span>
              <span title={project.workSummary}>{project.workSummary || "공사·품목 미등록"}</span>
              <span>{record?.progressManager || "미정"}</span>
            </div>
            <div className="construction-days construction-row-days">
              {days.map((day) => {
                const dayItems = items.filter((item) => item.scheduledDate <= day && (item.endDate || item.scheduledDate) >= day);
                return (
                  <span className={day === today ? "today" : ""} key={day} onClick={() => openEditor(project, day)}>
                    {dayItems.map((item) => (
                      <button
                        type="button"
                        className={`construction-event stage-${STAGES.indexOf(item.stage || item.label) % 5}`}
                        key={item.id}
                        title={`${item.stage || item.label} · ${item.vendorName || "업체 미정"} · ${item.scheduledDate}~${item.endDate || item.scheduledDate}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditor(project, day);
                        }}
                      >
                        {item.stage || item.label}
                      </button>
                    ))}
                  </span>
                );
              })}
            </div>
          </article>
        ))}
        {!loading && !rows.length ? <div className="empty-state">표시할 기관이 없습니다. ‘기관 추가’에서 먼저 등록해 주세요.</div> : null}
      </div>

      <div className="construction-mobile-list">
        {rows.map(({ project, record, items }) => (
          <article key={scopeKey(project.organization, project.businessRound)}>
            <header><button type="button" onClick={() => onOpenOrganization(project.organization, project.businessRound)}>{project.organization}</button><span>{record?.progressManager || "미정"}</span></header>
            <p>{record?.region || "지역 미등록"} · {project.workSummary || "공사·품목 미등록"}</p>
            <div>{items.map((item) => <button type="button" key={item.id} onClick={() => openEditor(project, item.scheduledDate)}><b>{item.scheduledDate.slice(5).replace("-", "/")}</b>{item.stage || item.label}</button>)}</div>
            <button className="construction-mobile-edit" type="button" onClick={() => openEditor(project)}>일정 관리</button>
            <button className="construction-mobile-remove" type="button" onClick={() => void removeProject(project)}>일정표에서 빼기</button>
          </article>
        ))}
      </div>

      {addOpen ? (
        <div className="schedule-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAddOpen(false); }}>
          <div className="construction-add-dialog" role="dialog" aria-modal="true">
            <header><div><span className="section-kicker">ADD INSTITUTION</span><h3>시공 일정표에 기관 추가</h3><p>위즈업 수주로 전환된 기관만 검색되며 기관 상세페이지와 그대로 연결됩니다.</p></div><button type="button" onClick={() => setAddOpen(false)}>×</button></header>
            <input autoFocus value={addQuery} onChange={(event) => setAddQuery(event.target.value)} placeholder="위즈업 수주 기관명 또는 지역 검색" />
            <div className="construction-add-results">
              {addOptions.map((option) => (
                <button type="button" key={scopeKey(option.organization, option.businessRound)} disabled={saving} onClick={() => void addProject(option)}>
                  <span><strong>{option.organization}</strong><small>{option.region || "지역 미등록"} · {option.businessRound}차 사업</small></span><b>추가</b>
                </button>
              ))}
              {!addOptions.length ? <p>추가할 수 있는 기관이 없습니다.</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {editor ? (
        <div className="schedule-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditor(null); }}>
          <div className="schedule-editor construction-stage-editor" role="dialog" aria-modal="true">
            <header><div><span className="section-kicker">CONSTRUCTION SCHEDULE</span><h3>{editor.organization}</h3><p>체크한 단계만 저장됩니다. + 버튼으로 같은 단계의 기간을 추가할 수 있습니다.</p></div><button type="button" onClick={() => setEditor(null)}>×</button></header>
            <div className="construction-editor-summary">
              <label>공사·품목<input value={editor.workSummary} onChange={(event) => setEditor({ ...editor, workSummary: event.target.value })} placeholder="예: 스크린·시스템 설치" /></label>
              <label className="construction-project-complete"><input type="checkbox" checked={editor.completed} onChange={(event) => setEditor({ ...editor, completed: event.target.checked })} />기관 일정 완료</label>
            </div>
            <div className="construction-stage-table">
              <div className="construction-stage-head"><span>사용</span><span>단계</span><span>시공 업체</span><span>시작일</span><span>종료일</span><span>추가</span></div>
              {editor.items.map((item, index) => (
                <div className={`construction-stage-row${item.active ? " active" : ""}`} key={item.key}>
                  <input aria-label={`${item.stage} 사용`} type="checkbox" checked={item.active} onChange={(event) => updateEditorItem(item.key, { active: event.target.checked })} />
                  <strong>{item.stage}{editor.items.slice(0, index).some((previous) => previous.stage === item.stage) ? " · 추가" : ""}</strong>
                  <input value={item.vendorName} disabled={!item.active} onChange={(event) => updateEditorItem(item.key, { vendorName: event.target.value })} placeholder="업체명" />
                  <input type="date" value={item.scheduledDate} disabled={!item.active} onChange={(event) => updateEditorItem(item.key, { scheduledDate: event.target.value, endDate: item.endDate < event.target.value ? event.target.value : item.endDate })} />
                  <input type="date" value={item.endDate} disabled={!item.active} onChange={(event) => updateEditorItem(item.key, { endDate: event.target.value })} />
                  <button type="button" aria-label={`${item.stage} 기간 추가`} onClick={() => addStageRange(item.stage, item.endDate || item.scheduledDate)}>+</button>
                </div>
              ))}
            </div>
            <footer><button type="button" onClick={() => setEditor(null)}>취소</button><button type="button" className="primary-button" disabled={saving} onClick={() => void saveEditor()}>{saving ? "저장 중…" : "설정 완료"}</button></footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
