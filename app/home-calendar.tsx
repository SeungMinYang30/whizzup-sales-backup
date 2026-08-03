"use client";

import { useEffect, useMemo, useState } from "react";

type HomeCalendarSchedule = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  scheduledDate: string;
  visibility: "private" | "shared-post-award";
  assigneeName: string;
};

type CalendarFilter = "all" | "private" | "shared-post-award";

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
}: {
  refreshVersion: number;
  onOpenOrganization: (organization: string, businessRound: number) => void;
}) {
  const todayValue = dateValue(new Date());
  const [monthValue, setMonthValue] = useState(initialMonthValue);
  const [selectedDate, setSelectedDate] = useState(todayValue);
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [schedules, setSchedules] = useState<HomeCalendarSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
  }, [rangeEnd, rangeStart, refreshVersion]);

  const filteredSchedules = useMemo(
    () =>
      schedules.filter(
        (schedule) => filter === "all" || schedule.visibility === filter,
      ),
    [filter, schedules],
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
      all: schedules.filter((item) => item.scheduledDate.startsWith(monthPrefix)).length,
      private: schedules.filter(
        (item) => item.scheduledDate.startsWith(monthPrefix) && item.visibility === "private",
      ).length,
      shared: schedules.filter(
        (item) => item.scheduledDate.startsWith(monthPrefix) && item.visibility === "shared-post-award",
      ).length,
    }),
    [monthPrefix, schedules],
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
          <p>내 개인 일정과 수주 후 설치·납품 일정을 월간으로 확인합니다.</p>
        </div>
        <div className="home-calendar-month-controls" aria-label="달력 월 이동">
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
        <button type="button" className={filter === "private" ? "active" : ""} onClick={() => setFilter("private")}>내 일정 <b>{monthCounts.private}</b></button>
        <button type="button" className={filter === "shared-post-award" ? "active" : ""} onClick={() => setFilter("shared-post-award")}>설치·납품 <b>{monthCounts.shared}</b></button>
        <span><i className="private" />개인 일정 <i className="shared" />수주 후 공유</span>
      </div>

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
                    <span className={item.visibility === "shared-post-award" ? "shared" : "private"} key={item.id} title={`${item.organization} · ${item.label}`}>
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
                  <i className={item.visibility === "shared-post-award" ? "shared" : "private"} />
                  <span><strong>{item.organization}</strong><small>{item.label}</small></span>
                  <em>{item.visibility === "shared-post-award" ? "공유" : "개인"}</em>
                </button>
              ))}
            </div>
          ) : (
            <p className="home-calendar-agenda-empty">이 날짜에 등록된 일정이 없습니다.</p>
          )}
          <small className="home-calendar-privacy">개인 일정은 본인에게만, 설치·납품 일정은 관련 담당자와 관리자에게 표시됩니다.</small>
        </aside>
      </div>
    </section>
  );
}
