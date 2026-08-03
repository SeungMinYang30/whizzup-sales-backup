"use client";

import { useEffect, useMemo, useState } from "react";
import {
  constructionStageIndex,
  isConstructionStage,
} from "../lib/construction-stages";

type ScheduleCategory = "sales" | "meeting" | "construction" | "showroom" | "other" | "personal" | "google";
type CalendarFilter = "all" | ScheduleCategory;
type HomeCalendarSchedule = {
  id: number | string;
  organization: string;
  businessRound: number;
  label: string;
  category: ScheduleCategory;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  endDate: string;
  assigneeName: string;
  assigneeMemberId: number | null;
  editable: boolean;
  externalUrl?: string;
  details?: string;
};
type Institution = { organization: string; businessRound: number; region: string; progressManager: string };
type Member = { id: number; display_name: string; role: string; status: string };
type EditorKind = "영업" | "회의" | "쇼룸" | "기타" | "내 일정";

const FILTERS: Array<[CalendarFilter, string]> = [
  ["all", "전체"], ["sales", "영업"], ["meeting", "회의"], ["construction", "시공"],
  ["showroom", "쇼룸"], ["other", "기타"], ["personal", "내 일정"], ["google", "위즈업 일정"],
];
const CATEGORY_LABEL: Record<ScheduleCategory, string> = {
  sales: "영업", meeting: "회의", construction: "시공", showroom: "쇼룸",
  other: "기타", personal: "내 일정", google: "위즈업 일정",
};
const KIND_CATEGORY: Record<EditorKind, Exclude<ScheduleCategory, "construction" | "google">> = {
  영업: "sales", 회의: "meeting", 쇼룸: "showroom", 기타: "other", "내 일정": "personal",
};
const TIME_OPTIONS = Array.from({ length: 24 * 6 }, (_, index) => {
  const hour = Math.floor(index / 6);
  const minute = (index % 6) * 10;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateFromValue(value: string) { return new Date(`${value}T00:00:00`); }
function addDays(value: Date, days: number) { const next = new Date(value); next.setDate(next.getDate() + days); return next; }
function monthGrid(value: string) {
  const [year, month] = value.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}
function moveMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  return dateValue(new Date(year, month - 1 + offset, 1)).slice(0, 7);
}
function monthTitle(value: string) { const [year, month] = value.split("-").map(Number); return `${year}년 ${month}월`; }
function selectedDateTitle(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(dateFromValue(value));
}
function cleanScheduleTitle(label: string) { return label.replace(/^(영업|회의|쇼룸|기타|내 일정)\s*·\s*/, ""); }
function kindFromSchedule(schedule: HomeCalendarSchedule): EditorKind {
  if (schedule.category === "meeting") return "회의";
  if (schedule.category === "showroom") return "쇼룸";
  if (schedule.category === "other") return "기타";
  if (schedule.category === "personal") return "내 일정";
  const matched = schedule.label.match(/^(영업|회의|쇼룸|기타|내 일정)\s*·/);
  return (matched?.[1] as EditorKind) || "영업";
}
function eventTime(schedule: HomeCalendarSchedule) { return schedule.startTime ? schedule.startTime : ""; }
function emptyEditor(date: string) {
  return {
    scheduleId: null as number | null, organization: "", businessRound: 0, organizationQuery: "", linked: false,
    kind: "영업" as EditorKind, title: "", scheduledDate: date, allDay: true, startTime: "", endTime: "",
    assigneeMemberId: 0, assigneeName: "", completed: false,
  };
}

export default function HomeCalendar({ refreshVersion, onOpenOrganization, onOpenConstructionSchedule }: {
  refreshVersion: number;
  onOpenOrganization: (organization: string, businessRound: number) => void;
  onOpenConstructionSchedule: () => void;
  records: Array<{ organization: string; businessRound: number; region?: string }>;
}) {
  const today = dateValue(new Date());
  const [monthValue, setMonthValue] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [schedules, setSchedules] = useState<HomeCalendarSchedule[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentMember, setCurrentMember] = useState({ id: 0, displayName: "" });
  const [googleState, setGoogleState] = useState({ configured: false, connected: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState(() => emptyEditor(today));
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionLoading, setInstitutionLoading] = useState(false);
  const [readOnlySchedule, setReadOnlySchedule] = useState<HomeCalendarSchedule | null>(null);
  const dates = useMemo(() => monthGrid(monthValue), [monthValue]);
  const rangeStart = dateValue(dates[0]);
  const rangeEnd = dateValue(dates[dates.length - 1]);

  useEffect(() => {
    void fetch("/api/members?scope=assignees", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { members?: Member[] }) => setMembers(Array.isArray(payload.members) ? payload.members : []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch(`/api/schedules?scope=calendar&start=${rangeStart}&end=${rangeEnd}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as {
          schedules?: HomeCalendarSchedule[]; currentMember?: { id: number; displayName: string };
          googleCalendarConfigured?: boolean; googleCalendarConnected?: boolean; error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "일정을 불러오지 못했습니다.");
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setSchedules(Array.isArray(payload.schedules) ? payload.schedules : []);
        if (payload.currentMember) setCurrentMember(payload.currentMember);
        setGoogleState({ configured: Boolean(payload.googleCalendarConfigured), connected: Boolean(payload.googleCalendarConnected) });
        setError("");
      })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "일정을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [rangeEnd, rangeStart, refreshVersion, reloadVersion]);

  useEffect(() => {
    const query = editor.organizationQuery.trim();
    if (!editorOpen || query.length < 2 || editor.linked) { setInstitutions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setInstitutionLoading(true);
      void fetch(`/api/institutions/search?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json())
        .then((payload: { institutions?: Institution[] }) => setInstitutions(Array.isArray(payload.institutions) ? payload.institutions.slice(0, 10) : []))
        .catch(() => undefined)
        .finally(() => setInstitutionLoading(false));
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [editor.organizationQuery, editor.linked, editorOpen]);

  function openNew(date = selectedDate) {
    setReadOnlySchedule(null);
    setEditor({ ...emptyEditor(date), assigneeMemberId: currentMember.id, assigneeName: currentMember.displayName });
    setEditorOpen(true);
  }
  function openEdit(schedule: HomeCalendarSchedule) {
    if (schedule.category === "construction") { onOpenConstructionSchedule(); return; }
    if (schedule.category === "google") { setReadOnlySchedule(schedule); return; }
    if (!schedule.editable || typeof schedule.id !== "number") return;
    setEditor({
      scheduleId: schedule.id, organization: schedule.organization, businessRound: schedule.businessRound,
      organizationQuery: schedule.organization, linked: schedule.businessRound > 0, kind: kindFromSchedule(schedule),
      title: cleanScheduleTitle(schedule.label), scheduledDate: schedule.scheduledDate,
      allDay: !schedule.startTime, startTime: schedule.startTime || "", endTime: schedule.endTime || "",
      assigneeMemberId: schedule.assigneeMemberId || 0, assigneeName: schedule.assigneeName, completed: false,
    });
    setEditorOpen(true);
  }
  function selectInstitution(item: Institution) {
    const member = members.find((candidate) => candidate.display_name === item.progressManager);
    setEditor((current) => ({
      ...current, organization: item.organization, businessRound: item.businessRound, organizationQuery: item.organization,
      linked: true, assigneeMemberId: member?.id || current.assigneeMemberId || currentMember.id,
      assigneeName: member?.display_name || item.progressManager || current.assigneeName || currentMember.displayName,
    }));
    setInstitutions([]);
  }
  function changeAssignee(value: string) {
    const id = Number(value) || 0;
    const member = members.find((candidate) => candidate.id === id);
    setEditor((current) => ({ ...current, assigneeMemberId: id, assigneeName: member?.display_name || "" }));
  }
  async function createInstitution() {
    if (editor.organizationQuery.trim().length < 2) return;
    setSaving(true);
    try {
      const response = await fetch("/api/records", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: editor.organizationQuery.trim(), activityDate: today, activityType: "기타", region: "",
          summary: "통합 일정에서 신규 기관 등록", businessRound: 1, awardStatus: "미정", awardStage: "미정",
          skipInstitutionStateLookup: true,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "기관을 등록하지 못했습니다.");
      setEditor((current) => ({ ...current, organization: current.organizationQuery.trim(), businessRound: 1, linked: true }));
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "기관을 등록하지 못했습니다."); }
    finally { setSaving(false); }
  }
  async function saveSchedule() {
    const organization = (editor.linked ? editor.organization : editor.organizationQuery).trim();
    if (!organization || !editor.title.trim() || saving || !editor.assigneeMemberId || (editor.kind === "영업" && !editor.linked)) return;
    if (!editor.allDay && !editor.startTime) { setError("시간 일정은 시작 시간을 선택해 주세요."); return; }
    if (!editor.allDay && editor.endTime && editor.endTime < editor.startTime) { setError("종료 시간은 시작 시간 이후여야 합니다."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", {
        method: editor.scheduleId ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editor.scheduleId ? "update-general-schedule" : "add-general-schedule", scheduleId: editor.scheduleId,
          organization, businessRound: editor.linked ? editor.businessRound : 0,
          label: `${editor.kind} · ${editor.title.trim()}`, scheduledDate: editor.scheduledDate,
          startTime: editor.allDay ? "" : editor.startTime, endTime: editor.allDay ? "" : editor.endTime,
          category: KIND_CATEGORY[editor.kind], linked: editor.linked,
          assigneeMemberId: editor.assigneeMemberId, assigneeName: editor.assigneeName, completed: editor.completed,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "일정을 저장하지 못했습니다.");
      setEditorOpen(false); setReloadVersion((value) => value + 1); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "일정을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  }
  async function deleteSchedule() {
    if (!editor.scheduleId || saving || !window.confirm("이 일정을 삭제할까요?")) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-general-schedule", scheduleId: editor.scheduleId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "일정을 삭제하지 못했습니다.");
      setEditorOpen(false); setReloadVersion((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "일정을 삭제하지 못했습니다."); }
    finally { setSaving(false); }
  }

  const visibleSchedules = useMemo(
    () => schedules.filter((item) => item.category !== "construction" || isConstructionStage(item.label)),
    [schedules],
  );
  const filtered = useMemo(
    () => visibleSchedules.filter((item) => filter === "all" || item.category === filter),
    [filter, visibleSchedules],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, HomeCalendarSchedule[]>();
    filtered.forEach((item) => {
      let day = item.scheduledDate;
      while (day <= (item.endDate || item.scheduledDate)) {
        map.set(day, [...(map.get(day) || []), item]);
        day = dateValue(addDays(dateFromValue(day), 1));
      }
    });
    map.forEach((items, key) => map.set(key, [...items].sort((a, b) => {
      const timeA = eventTime(a); const timeB = eventTime(b);
      if (!timeA && timeB) return -1; if (timeA && !timeB) return 1;
      const timeOrder = timeA.localeCompare(timeB);
      if (timeOrder) return timeOrder;
      if (a.category === "construction" && b.category === "construction") {
        const stageOrder = constructionStageIndex(a.label) - constructionStageIndex(b.label);
        if (stageOrder) return stageOrder;
      }
      return a.organization.localeCompare(b.organization, "ko");
    })));
    return map;
  }, [filtered]);
  const monthPrefix = `${monthValue}-`;
  const counts = useMemo(() => {
    const inMonth = visibleSchedules.filter((item) => item.scheduledDate.startsWith(monthPrefix));
    return Object.fromEntries(FILTERS.map(([key]) => [key, key === "all" ? inMonth.length : inMonth.filter((item) => item.category === key).length])) as Record<CalendarFilter, number>;
  }, [monthPrefix, visibleSchedules]);
  const selectedSchedules = grouped.get(selectedDate) || [];
  const changeMonth = (value: string) => { setMonthValue(value); setSelectedDate(`${value}-01`); };
  const linkedDetailAvailable = editor.linked && editor.businessRound > 0;

  return (
    <section className="home-calendar-panel" aria-labelledby="home-calendar-title">
      <header className="home-calendar-header">
        <div><span className="section-kicker">WORK CALENDAR</span><h2 id="home-calendar-title">통합 일정</h2><p>영업·회의·시공·쇼룸·개인 일정과 위즈업 공유일정을 월간으로 확인합니다.</p></div>
        <div className="home-calendar-month-controls">
          <button type="button" className="home-calendar-add" onClick={() => openNew()}>+ 일정 등록</button>
          <button type="button" onClick={() => changeMonth(moveMonth(monthValue, -1))}>이전</button>
          <button type="button" onClick={() => { setMonthValue(today.slice(0, 7)); setSelectedDate(today); }}>오늘</button>
          <button type="button" onClick={() => changeMonth(moveMonth(monthValue, 1))}>다음</button>
          <strong>{monthTitle(monthValue)}</strong>
        </div>
      </header>
      <div className="home-calendar-filters">
        {FILTERS.map(([key, label]) => (
          <button type="button" key={key} className={`home-calendar-filter home-calendar-filter-${key}${filter === key ? " active" : ""}`}
            disabled={key === "google" && !googleState.configured}
            title={key === "google" && !googleState.configured ? "위즈업 공유 캘린더 주소가 아직 등록되지 않았습니다." : ""}
            onClick={() => setFilter(key)}>{label} <b>{counts[key]}</b></button>
        ))}
        {googleState.configured && !googleState.connected ? <small className="google-calendar-state">위즈업 공유일정 연결을 확인해 주세요.</small> : null}
      </div>
      {error ? <div className="home-calendar-error">{error}</div> : null}
      <div className="home-calendar-layout">
        <div className="home-calendar-grid" aria-busy={loading}>
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => <div className="home-calendar-weekday" key={day}>{day}</div>)}
          {dates.map((date) => {
            const value = dateValue(date); const items = grouped.get(value) || [];
            return <button type="button" className={`home-calendar-day${value.startsWith(monthPrefix) ? "" : " outside"}${value === today ? " today" : ""}${value === selectedDate ? " selected" : ""}`} key={value} onClick={() => setSelectedDate(value)}>
              <span className="home-calendar-day-number">{date.getDate()}</span>
              <span className="home-calendar-day-items">
                {items.slice(0, 3).map((item) => <span className={item.category} key={item.id} title={`${item.organization} · ${item.label}`}>
                  <b>{item.startTime ? `${item.startTime} ` : ""}{item.organization}</b><small>{cleanScheduleTitle(item.label)}</small>
                </span>)}
                {items.length > 3 ? <em>+{items.length - 3}건 더보기</em> : null}
              </span>
            </button>;
          })}
        </div>
        <aside className="home-calendar-agenda">
          <div className="home-calendar-agenda-heading"><span>{selectedDate === today ? "오늘" : "선택 날짜"}</span><h3>{selectedDateTitle(selectedDate)}</h3><b>{selectedSchedules.length}건</b></div>
          {loading ? <p className="home-calendar-agenda-empty">일정을 확인하는 중입니다.</p> : selectedSchedules.length ? (
            <div className="home-calendar-agenda-list">{selectedSchedules.map((item) => (
              <button type="button" key={item.id} onClick={() => openEdit(item)}>
                <i className={item.category} /><span><strong>{item.startTime ? `${item.startTime} ` : ""}{item.organization}</strong><small>{cleanScheduleTitle(item.label)}</small><small className="schedule-assignee">담당 {item.assigneeName || "미정"}</small></span><em className={item.category}>{CATEGORY_LABEL[item.category]}</em>
              </button>
            ))}</div>
          ) : <p className="home-calendar-agenda-empty">이 날짜에 등록된 일정이 없습니다.</p>}
        </aside>
      </div>

      {editorOpen ? <div className="schedule-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditorOpen(false); }}>
        <div className="home-schedule-editor" role="dialog" aria-modal="true">
          <header><div><span className="section-kicker">{editor.scheduleId ? "EDIT SCHEDULE" : "NEW SCHEDULE"}</span><h3>{editor.scheduleId ? "일정 수정" : "일정 등록"}</h3><p>시공 일정은 시공·납품 일정표에서 관리하고 이 화면에는 자동 연동됩니다.</p></div><button type="button" aria-label="닫기" onClick={() => setEditorOpen(false)}>×</button></header>
          <div className="home-schedule-kind">{(["영업", "회의", "쇼룸", "기타", "내 일정"] as EditorKind[]).map((kind) => <button type="button" key={kind} className={editor.kind === kind ? "active" : ""} onClick={() => setEditor((current) => ({ ...current, kind }))}>{kind}</button>)}</div>
          <label className="home-schedule-institution">기관 또는 일정 장소 <b>*</b>
            <input value={editor.organizationQuery} onChange={(event) => setEditor((current) => ({ ...current, organizationQuery: event.target.value, organization: "", businessRound: 0, linked: false }))} placeholder="기관명 2글자 이상 검색 또는 직접 입력" />
            {!editor.linked && editor.organizationQuery.trim().length >= 2 ? <div className="home-schedule-institution-results">
              {institutions.map((item) => <button type="button" key={`${item.organization}-${item.businessRound}`} onClick={() => selectInstitution(item)}><strong>{item.organization}</strong><small>{item.region || "지역 미등록"} · {item.businessRound}차 사업 · {item.progressManager || "담당자 미정"}</small></button>)}
              {!institutionLoading && !institutions.length ? <p>등록된 기관이 없습니다.</p> : null}
            </div> : null}
            <small className="home-schedule-link-note">{editor.linked ? "기관 상세 이력에 연결됩니다." : editor.kind === "영업" ? "영업 일정은 기존 기관을 선택하거나 새 기관으로 등록해야 합니다." : "회의·쇼룸·기타·내 일정은 기관 연결 또는 자유 장소 입력이 모두 가능합니다."}</small>
            {!editor.linked && editor.organizationQuery.trim().length >= 2 ? <button type="button" className="schedule-create-institution" onClick={() => void createInstitution()}>+ 새 기관 등록 후 연결</button> : null}
          </label>
          <label>일정 제목 <b>*</b><input value={editor.title} onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))} placeholder="예: 담당자 방문 미팅" /></label>
          <label>일정 담당자 <b>*</b><select value={editor.assigneeMemberId || ""} onChange={(event) => changeAssignee(event.target.value)}><option value="">담당자 선택</option>{members.map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select></label>
          <div className="home-schedule-date-grid"><label>날짜 <b>*</b><input type="date" value={editor.scheduledDate} onChange={(event) => setEditor((current) => ({ ...current, scheduledDate: event.target.value }))} /></label>
            <label className="schedule-all-day"><input type="checkbox" checked={editor.allDay} onChange={(event) => setEditor((current) => ({ ...current, allDay: event.target.checked, startTime: event.target.checked ? "" : current.startTime, endTime: event.target.checked ? "" : current.endTime }))} /> 종일 일정</label>
          </div>
          {!editor.allDay ? <div className="home-schedule-time-grid"><label>시작 시간 <b>*</b><select value={editor.startTime} onChange={(event) => setEditor((current) => ({ ...current, startTime: event.target.value }))}><option value="">선택</option>{TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</select></label><label>종료 시간<select value={editor.endTime} onChange={(event) => setEditor((current) => ({ ...current, endTime: event.target.value }))}><option value="">선택 안 함</option>{TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</select></label></div> : null}
          {editor.scheduleId ? <label className="schedule-completed"><input type="checkbox" checked={editor.completed} onChange={(event) => setEditor((current) => ({ ...current, completed: event.target.checked }))} /> 이 일정을 완료 상태로 지정</label> : null}
          <footer>{editor.scheduleId ? <button type="button" className="danger-button" onClick={() => void deleteSchedule()}>삭제</button> : null}{linkedDetailAvailable ? <button type="button" onClick={() => { setEditorOpen(false); onOpenOrganization(editor.organization, editor.businessRound); }}>기관 상세 보기</button> : null}<span /><button type="button" onClick={() => setEditorOpen(false)}>취소</button><button type="button" className="primary-button" disabled={saving || !editor.title.trim() || !editor.organizationQuery.trim() || !editor.assigneeMemberId || (editor.kind === "영업" && !editor.linked)} onClick={() => void saveSchedule()}>{saving ? "저장 중" : "저장"}</button></footer>
        </div>
      </div> : null}

      {readOnlySchedule ? <div className="schedule-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setReadOnlySchedule(null); }}>
        <div className="home-schedule-editor schedule-readonly-dialog" role="dialog" aria-modal="true">
          <header><div><span className="section-kicker">WHIZZUP GOOGLE CALENDAR</span><h3>위즈업 공유일정</h3><p>Google 캘린더에서 가져온 읽기 전용 일정입니다.</p></div><button type="button" aria-label="닫기" onClick={() => setReadOnlySchedule(null)}>×</button></header>
          <dl><div><dt>제목</dt><dd>{readOnlySchedule.label}</dd></div><div><dt>장소</dt><dd>{readOnlySchedule.organization || "미입력"}</dd></div><div><dt>일시</dt><dd>{readOnlySchedule.scheduledDate}{readOnlySchedule.startTime ? ` ${readOnlySchedule.startTime}` : " (종일)"}{readOnlySchedule.endTime ? ` ~ ${readOnlySchedule.endTime}` : ""}</dd></div>{readOnlySchedule.details ? <div><dt>내용</dt><dd>{readOnlySchedule.details}</dd></div> : null}</dl>
          <footer><span /><button type="button" onClick={() => setReadOnlySchedule(null)}>닫기</button><button type="button" className="primary-button" onClick={() => window.open(readOnlySchedule.externalUrl || "https://calendar.google.com/calendar/u/0/r", "_blank", "noopener,noreferrer")}>Google 캘린더에서 열기</button></footer>
        </div>
      </div> : null}
    </section>
  );
}
