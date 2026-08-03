"use client";

import { useEffect, useMemo, useState } from "react";

type HomeCalendarSchedule = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  category: "sales" | "construction" | "showroom" | "personal";
  scheduledDate: string;
  visibility: "private" | "shared-post-award";
  assigneeName: string;
};

type CalendarFilter = "all" | "sales" | "construction" | "showroom" | "personal";
type CalendarInstitution = {
  organization: string;
  businessRound: number;
  region?: string;
};

function dateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromValue(value: string) {
  return new Date(`${value}T00:00:00`);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function initialMonthValue() {
  return dateValue(new Date()).slice(0, 7);
}

function monthGrid(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function moveMonth(monthValue: string, offset: number) {
  const [year, month] = monthValue.split("-").map(Number);
  return dateValue(new Date(year, month - 1 + offset, 1)).slice(0, 7);
}

function monthTitle(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function selectedDateTitle(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(dateFromValue(value));
}

export default function HomeCalendar({
  refreshVersion,
  onOpenOrganization,
  records,
}: {
  refreshVersion: number;
  onOpenOrganization: (organization: string, businessRound: number) => void;
  records: CalendarInstitution[];
}) {
  const todayValue = dateValue(new Date());
  const [monthValue, setMonthValue] = useState(initialMonthValue);
  const [selectedDate, setSelectedDate] = useState(todayValue);
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [schedules, setSchedules] = useState<HomeCalendarSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    organizationKey: "",
    kind: "영업",
    title: "",
    scheduledDate: todayValue,
  });
  const gridDates = useMemo(() => monthGrid(monthValue), [monthValue]);
  const rangeStart = dateValue(gridDates[0]);
  const rangeEnd = dateValue(gridDates[gridDates.length - 1]);

  useEffect(() => {
    let active = true;
    void fetch(
      `/api/schedules?scope=calendar&start=${encodeURIComponent(rangeStart)}&end=${encodeURIComponent(rangeEnd)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          schedules?: HomeCalendarSchedule[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "일정을 불러오지 못했습니다.");
        return Array.isArray(payload.schedules) ? payload.schedules : [];
      })
      .then((next) => {
        if (active) {
          setSchedules(next);
          setError("");
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "일정을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rangeEnd, rangeStart, refreshVersion, reloadVersion]);

  const institutionOptions = useMemo(() => {
    const unique = new Map<string, CalendarInstitution>();
    records.forEach((record) => {
      const organization = String(record.organization ?? "").trim();
      const businessRound = Math.max(1, Number(record.businessRound) || 1);
      if (!organization) return;
      const key = `${organization}\u001f${businessRound}`;
      if (!unique.has(key)) unique.set(key, { ...record, organization, businessRound });
    });
    return [...unique.entries()].sort((left, right) =>
      left[1].organization.localeCompare(right[1].organization, "ko-KR"),
    );
  }, [records]);

  async function saveSchedule() {
    const selected = institutionOptions.find(([key]) => key === scheduleForm.organizationKey)?.[1];
    if (!selected || !scheduleForm.title.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-general-schedule",
          organization: selected.organization,
          businessRound: selected.businessRound,
          label: `${scheduleForm.kind} · ${scheduleForm.title.trim()}`,
          scheduledDate: scheduleForm.scheduledDate,
          category: scheduleForm.kind === "쇼룸" ? "showroom" : "general",
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "일정을 등록하지 못했습니다.");
      setEditorOpen(false);
      setScheduleForm({ organizationKey: "", kind: "영업", title: "", scheduledDate: scheduleForm.scheduledDate });
      setReloadVersion((current) => current + 1);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "일정을 등록하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const usefulSchedules = useMemo(
    () => schedules.filter((schedule) => schedule.visibility !== "private" || schedule.category === "personal"),
    [schedules],
  );
  const filteredSchedules = useMemo(
    () => usefulSchedules.filter((schedule) => filter === "all" || schedule.category === filter),
    [filter, usefulSchedules],
  );
  const schedulesByDate = useMemo(() => {
    const grouped = new Map<string, HomeCalendarSchedule[]>();
    filteredSchedules.forEach((schedule) => {
      const current = grouped.get(schedule.scheduledDate) ?? [];
      current.push(schedule);
      grouped.set(schedule.scheduledDate, current);
    });
    return grouped;
  }, [filteredSchedules]);
  const selectedSchedules = schedulesByDate.get(selectedDate) ?? [];
  const monthPrefix = `${monthValue}-`;
  const monthCounts = useMemo(
    () => ({
      all: usefulSchedules.filter((item) => item.scheduledDate.startsWith(monthPrefix)).length,
      sales: usefulSchedules.filter((item) => item.scheduledDate.startsWith(monthPrefix) && item.category === "sales").length,
      construction: usefulSchedules.filter((item) => item.scheduledDate.startsWith(monthPrefix) && item.category === "construction").length,
      showroom: usefulSchedules.filter((item) => item.scheduledDate.startsWith(monthPrefix) && item.category === "showroom").length,
      personal: usefulSchedules.filter((item) => item.scheduledDate.startsWith(monthPrefix) && item.category === "personal").length,
    }),
    [monthPrefix, usefulSchedules],
  );

  const changeMonth = (next: string) => {
    setLoading(true);
    setError("");
    setMonthValue(next);
    setSelectedDate(`${next}-01`);
  };

  return (
    <section className="home-calendar-panel" aria-labelledby="home-calendar-title">
      <header className="home-calendar-header">
        <div>
          <span className="section-kicker">WORK CALENDAR</span>
          <h2 id="home-calendar-title">통합 일정</h2>
          <p>영업·시공·쇼룸 일정과 내 재연락 일정을 월간으로 확인합니다.</p>
        </div>
        <div className="home-calendar-month-controls" aria-label="달력 월 이동">
          <button type="button" className="home-calendar-add" onClick={() => setEditorOpen(true)}>+ 일정 등록</button>
          <button type="button" onClick={() => changeMonth(moveMonth(monthValue, -1))}>이전</button>
          <button
            type="button"
            className="home-calendar-today"
            onClick={() => {
              setLoading(true);
              setError("");
              setMonthValue(todayValue.slice(0, 7));
              setSelectedDate(todayValue);
            }}
          >
            오늘
          </button>
          <button type="button" onClick={() => changeMonth(moveMonth(monthValue, 1))}>다음</button>
          <strong>{monthTitle(monthValue)}</strong>
        </div>
      </header>

      <div className="home-calendar-filters" aria-label="일정 종류">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 <b>{monthCounts.all}</b></button>
        <button type="button" className={filter === "sales" ? "active" : ""} onClick={() => setFilter("sales")}>영업 <b>{monthCounts.sales}</b></button>
        <button type="button" className={filter === "construction" ? "active" : ""} onClick={() => setFilter("construction")}>시공 <b>{monthCounts.construction}</b></button>
        <button type="button" className={filter === "showroom" ? "active" : ""} onClick={() => setFilter("showroom")}>쇼룸 <b>{monthCounts.showroom}</b></button>
        <button type="button" className={filter === "personal" ? "active" : ""} onClick={() => setFilter("personal")}>내 일정 <b>{monthCounts.personal}</b></button>
      </div>

      {editorOpen ? (
        <div className="schedule-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditorOpen(false); }}>
          <div className="home-schedule-editor" role="dialog" aria-modal="true" aria-label="일정 등록">
            <header>
              <div><span className="section-kicker">NEW SCHEDULE</span><h3>일정 등록</h3><p>시공 일정은 시공·납품 일정표에서 등록하면 자동으로 연동됩니다.</p></div>
              <button type="button" onClick={() => setEditorOpen(false)}>×</button>
            </header>
            <div className="home-schedule-kind">
              {["영업", "회의", "쇼룸", "기타"].map((kind) => (
                <button type="button" className={scheduleForm.kind === kind ? "active" : ""} key={kind} onClick={() => setScheduleForm({ ...scheduleForm, kind })}>{kind}</button>
              ))}
            </div>
            <label>기관 <b>*</b>
              <select value={scheduleForm.organizationKey} onChange={(event) => setScheduleForm({ ...scheduleForm, organizationKey: event.target.value })}>
                <option value="">기관을 선택하세요</option>
                {institutionOptions.map(([key, option]) => <option key={key} value={key}>{option.organization} · {option.businessRound}차{option.region ? ` · ${option.region}` : ""}</option>)}
              </select>
            </label>
            <label>일정 제목 <b>*</b><input value={scheduleForm.title} onChange={(event) => setScheduleForm({ ...scheduleForm, title: event.target.value })} placeholder="예: 담당자 방문 미팅" /></label>
            <label>날짜 <b>*</b><input type="date" value={scheduleForm.scheduledDate} onChange={(event) => setScheduleForm({ ...scheduleForm, scheduledDate: event.target.value })} /></label>
            <footer><button type="button" onClick={() => setEditorOpen(false)}>취소</button><button type="button" className="primary-button" disabled={saving || !scheduleForm.organizationKey || !scheduleForm.title.trim()} onClick={() => void saveSchedule()}>{saving ? "등록 중…" : "등록"}</button></footer>
          </div>
        </div>
      ) : null}

      {error ? <div className="home-calendar-error">{error}</div> : null}
      <div className="home-calendar-layout">
        <div className="home-calendar-grid" aria-busy={loading}>
          {['일','월','화','수','목','금','토'].map((day) => <div className="home-calendar-weekday" key={day}>{day}</div>)}
          {gridDates.map((date) => {
            const value = dateValue(date);
            const items = schedulesByDate.get(value) ?? [];
            const inMonth = value.startsWith(monthPrefix);
            return (
              <button
                type="button"
                className={`home-calendar-day${inMonth ? "" : " outside"}${value === todayValue ? " today" : ""}${value === selectedDate ? " selected" : ""}`}
                key={value}
                onClick={() => setSelectedDate(value)}
                aria-label={`${selectedDateTitle(value)} 일정 ${items.length}건`}
              >
                <span className="home-calendar-day-number">{date.getDate()}</span>
                <span className="home-calendar-day-items">
                  {items.slice(0, 3).map((item) => (
                    <span className={item.category} key={item.id} title={`${item.organization} · ${item.label}`}>
                      <b>{item.organization}</b><small>{item.label}</small>
                    </span>
                  ))}
                  {items.length > 3 ? <em>+{items.length - 3}건 더보기</em> : null}
                </span>
              </button>
            );
          })}
        </div>

        <aside className="home-calendar-agenda" aria-label="선택 날짜 일정">
          <div className="home-calendar-agenda-heading">
            <span>{selectedDate === todayValue ? "오늘" : "선택 날짜"}</span>
            <h3>{selectedDateTitle(selectedDate)}</h3>
            <b>{selectedSchedules.length}건</b>
          </div>
          {loading ? (
            <p className="home-calendar-agenda-empty">일정을 확인하는 중입니다.</p>
          ) : selectedSchedules.length > 0 ? (
            <div className="home-calendar-agenda-list">
              {selectedSchedules.map((item) => (
                <button type="button" key={item.id} onClick={() => onOpenOrganization(item.organization, item.businessRound)}>
                  <i className={item.category} />
                  <span><strong>{item.organization}</strong><small>{item.label}</small></span>
                  <em>{item.category === "personal" ? "개인" : item.category === "construction" ? "시공" : item.category === "showroom" ? "쇼룸" : "영업"}</em>
                </button>
              ))}
            </div>
          ) : (
            <p className="home-calendar-agenda-empty">이 날짜에 등록된 일정이 없습니다.</p>
          )}
          <small className="home-calendar-privacy">내 일정에는 본인 재연락 일정만 표시되고, 시공 일정은 시공·납품 일정표와 자동 연동됩니다.</small>
        </aside>
      </div>
    </section>
  );
}
