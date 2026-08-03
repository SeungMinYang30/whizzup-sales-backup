"use client";

import { useEffect, useMemo, useState } from "react";

type ScheduleRecord = { id: number; organization: string; businessRound: number; region: string; awardStatus: string; awardStage: string; progressManager: string; activityDate: string; summary: string };
type ScheduleItem = { id: number; organization: string; businessRound: number; label: string; scheduledDate: string; visibility: string; assigneeName: string };
type EditorItem = { label: string; scheduledDate: string; completed?: boolean };
const localDate = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const addDays = (value: string, days: number) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const dayLabel = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short", timeZone: "UTC" });

export default function ConstructionSchedulePage({ records, onOpenOrganization }: { records: ScheduleRecord[]; onOpenOrganization: (organization: string, businessRound: number) => void }) {
  const [start, setStart] = useState(localDate());
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<{ organization: string; businessRound: number; items: EditorItem[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const days = useMemo(() => Array.from({ length: 31 }, (_, index) => addDays(start, index)), [start]);
  const end = days.at(-1) ?? start;

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/schedules?scope=calendar&start=${start}&end=${end}`, { cache: "no-store" });
      const payload = await response.json() as { schedules?: ScheduleItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "일정을 불러오지 못했습니다.");
      // The construction board is intentionally limited to shared post-award
      // schedules. Personal/pre-award reminders remain on the member dashboard.
      setSchedules((payload.schedules ?? []).filter((item) => item.visibility === "shared-post-award"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "일정을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [start, end]);

  const latestByScope = useMemo(() => {
    const map = new Map<string, ScheduleRecord>();
    [...records].sort((a, b) => b.activityDate.localeCompare(a.activityDate) || b.id - a.id).forEach((record) => {
      const key = `${record.organization}\u001f${record.businessRound}`;
      if (!map.has(key)) map.set(key, record);
    });
    return map;
  }, [records]);
  const rows = useMemo(() => {
    const grouped = new Map<string, { record: ScheduleRecord | null; organization: string; businessRound: number; items: ScheduleItem[] }>();
    schedules.forEach((schedule) => {
      const key = `${schedule.organization}\u001f${schedule.businessRound}`;
      const current = grouped.get(key) ?? { record: latestByScope.get(key) ?? null, organization: schedule.organization, businessRound: schedule.businessRound, items: [] };
      current.items.push(schedule); grouped.set(key, current);
    });
    const key = query.trim().toLocaleLowerCase("ko-KR");
    return [...grouped.values()].filter((row) => !key || `${row.organization} ${row.record?.region ?? ""} ${row.record?.progressManager ?? ""}`.toLocaleLowerCase("ko-KR").includes(key)).sort((a, b) => (a.items[0]?.scheduledDate ?? "").localeCompare(b.items[0]?.scheduledDate ?? "") || a.organization.localeCompare(b.organization, "ko-KR"));
  }, [latestByScope, query, schedules]);

  async function openEditor(organization: string, businessRound: number) {
    setMessage("");
    const response = await fetch(`/api/schedules?organization=${encodeURIComponent(organization)}&businessRound=${businessRound}`, { cache: "no-store" });
    const payload = await response.json() as { schedules?: Array<EditorItem & { completed?: boolean }>; error?: string };
    if (!response.ok) { setMessage(payload.error || "일정을 불러오지 못했습니다."); return; }
    setEditor({ organization, businessRound, items: (payload.schedules ?? []).map((item) => ({ label: item.label, scheduledDate: item.scheduledDate, completed: item.completed })) });
  }
  async function saveEditor() {
    if (!editor || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organization: editor.organization, businessRound: editor.businessRound, schedules: editor.items.filter((item) => item.label.trim() && item.scheduledDate) }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "일정을 저장하지 못했습니다.");
      setEditor(null); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "일정을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  }
  const shift = (days: number) => setStart(addDays(start, days));
  const today = localDate();

  return <section className="construction-schedule-workspace">
    <header className="construction-schedule-header"><div><span className="section-kicker">INSTALLATION · DELIVERY</span><h2>시공·납품 일정표</h2><p>기관 상세의 수주 후 일정을 기준으로 한 달 흐름을 확인합니다.</p></div><div className="construction-schedule-controls"><button type="button" onClick={() => shift(-31)}>이전</button><button type="button" onClick={() => setStart(today)}>오늘부터</button><button type="button" onClick={() => shift(31)}>다음</button><label>시작일<input type="date" value={start} onChange={(event) => setStart(event.target.value)}/></label></div></header>
    {message && <div className="quotation-workspace-message">{message}</div>}
    <div className="construction-schedule-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기관명·지역·진행 담당자 검색"/><span>{rows.length.toLocaleString()}개 기관</span></div>
    <div className="construction-timeline">
      <div className="construction-timeline-head"><div className="construction-fixed-head"><span>지역</span><span>기관명</span><span>단계</span><span>담당자</span></div><div className="construction-days">{days.map((day) => <span className={day === today ? "today" : ""} key={day}>{dayLabel.format(new Date(`${day}T00:00:00Z`))}</span>)}</div></div>
      {loading ? <div className="empty-state">일정표를 불러오는 중입니다.</div> : rows.map((row) => <article className="construction-timeline-row" key={`${row.organization}-${row.businessRound}`}><div className="construction-fixed-cells"><span>{row.record?.region || "지역 미등록"}</span><button type="button" onClick={() => onOpenOrganization(row.organization, row.businessRound)}><strong>{row.organization}</strong><small>{row.businessRound}차 사업</small></button><span><b>{row.record?.awardStage || "일정 조율"}</b></span><span>{row.record?.progressManager || row.items[0]?.assigneeName || "미정"}</span></div><div className="construction-days construction-row-days" onDoubleClick={() => void openEditor(row.organization, row.businessRound)}>{days.map((day) => <span className={day === today ? "today" : ""} key={day}>{row.items.filter((item) => item.scheduledDate === day).map((item) => <button type="button" className={`construction-event ${/납품/.test(item.label) ? "delivery" : /검수|교육/.test(item.label) ? "training" : "installation"}`} key={item.id} title={`${item.label} · ${item.scheduledDate}`} onClick={() => void openEditor(row.organization, row.businessRound)}>{item.label}</button>)}</span>)}</div></article>)}
      {!loading && !rows.length && <div className="empty-state">선택한 기간에 등록된 시공·납품 일정이 없습니다.</div>}
    </div>
    <div className="construction-mobile-list">{rows.map((row) => <article key={`${row.organization}-${row.businessRound}`}><header><button type="button" onClick={() => onOpenOrganization(row.organization, row.businessRound)}>{row.organization}</button><span>{row.record?.progressManager || "미정"}</span></header><p>{row.record?.region || "지역 미등록"} · {row.record?.awardStage || "일정 조율"}</p><div>{row.items.map((item) => <button type="button" key={item.id} onClick={() => void openEditor(row.organization, row.businessRound)}><b>{item.scheduledDate.slice(5).replace("-", "/")}</b>{item.label}</button>)}</div></article>)}</div>
    {editor && <div className="schedule-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditor(null); }}><div className="schedule-editor" role="dialog" aria-modal="true"><header><div><span className="section-kicker">QUICK SCHEDULE</span><h3>{editor.organization}</h3><p>저장하면 기관 상세와 일정표에 함께 반영됩니다.</p></div><button type="button" onClick={() => setEditor(null)}>×</button></header><div className="schedule-editor-items">{editor.items.map((item, index) => <div key={`${index}-${item.scheduledDate}`}><input value={item.label} onChange={(event) => setEditor({ ...editor, items: editor.items.map((current, target) => target === index ? { ...current, label: event.target.value } : current) })} placeholder="예: 설치, 납품, 검수·교육"/><input type="date" value={item.scheduledDate} onChange={(event) => setEditor({ ...editor, items: editor.items.map((current, target) => target === index ? { ...current, scheduledDate: event.target.value } : current) })}/><button type="button" onClick={() => setEditor({ ...editor, items: editor.items.filter((_, target) => target !== index) })}>삭제</button></div>)}</div><button className="schedule-add-button" type="button" onClick={() => setEditor({ ...editor, items: [...editor.items, { label: "설치·납품", scheduledDate: today }] })}>+ 일정 추가</button><footer><button type="button" onClick={() => setEditor(null)}>취소</button><button type="button" className="primary-button" disabled={saving} onClick={() => void saveEditor()}>{saving ? "저장 중…" : "일정 저장"}</button></footer></div></div>}
  </section>;
}
