"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONSTRUCTION_STAGES,
  constructionStageIndex,
} from "../lib/construction-stages";
import { resilientFetch } from "./resilient-fetch";
import { personDisplayLabel } from "../lib/person-label";

type ScheduleCategory = "sales" | "meeting" | "construction" | "showroom" | "other" | "personal" | "google";
type CalendarFilter = "all" | ScheduleCategory;
type HomeCalendarSchedule = {
  id: number | string;
  organization: string;
  businessRound: number;
  label: string;
  category: ScheduleCategory;
  completed: boolean;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  endDate: string;
  assigneeName: string;
  assigneeMemberId: number | null;
  editable: boolean;
  externalUrl?: string;
  details?: string;
  syncStatus?: "pending" | "synced" | "failed" | "readonly" | "local_only";
  syncError?: string;
  syncAttempts?: number;
  googleOrigin?: boolean;
  googleEventId?: string;
  suggestedCategory?: "sales" | "meeting" | "construction" | "showroom" | "other";
};
type SyncIssue = { id: number; label: string; organization: string; operation: "upsert" | "delete" | "unlink"; error: string; attempts: number };
type Institution = {
  organization: string;
  businessRound: number;
  region: string;
  progressManager: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
};
type InstitutionRecord = Institution & { activityDate?: string; id?: number };
type Member = { id: number; display_name: string; job_title?: string; role: string; status: string };
type EditorKind = "ì˜ì—…" | "íšŒì˜" | "ì‹œê³µ" | "ì‡¼ë£¸" | "ê¸°íƒ€" | "ë‚´ ì¼ì •";
type InstitutionSearchState = "idle" | "debouncing" | "loading" | "success" | "empty" | "error";

const FILTERS: Array<[CalendarFilter, string]> = [
  ["all", "ì „ì²´"], ["sales", "ì˜ì—…"], ["meeting", "íšŒì˜"], ["construction", "ì‹œê³µ"],
  ["showroom", "ì‡¼ë£¸"], ["other", "ê¸°íƒ€"], ["personal", "ë‚´ ì¼ì •"], ["google", "Google ì—°ê²° í•„ìš”"],
];
const CATEGORY_LABEL: Record<ScheduleCategory, string> = {
  sales: "ì˜ì—…", meeting: "íšŒì˜", construction: "ì‹œê³µ", showroom: "ì‡¼ë£¸",
  other: "ê¸°íƒ€", personal: "ë‚´ ì¼ì •", google: "ì—°ê²° í•„ìš”",
};
const GOOGLE_EVENT_DELETED_SYNC_ERROR = "google_event_deleted";
const KIND_CATEGORY: Record<EditorKind, Exclude<ScheduleCategory, "google">> = {
  ì˜ì—…: "sales", íšŒì˜: "meeting", ì‹œê³µ: "construction", ì‡¼ë£¸: "showroom", ê¸°íƒ€: "other", "ë‚´ ì¼ì •": "personal",
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
function monthTitle(value: string) { const [year, month] = value.split("-").map(Number); return `${year}ë…„ ${month}ì›”`; }
function selectedDateTitle(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(dateFromValue(value));
}
function cleanScheduleTitle(label: string) { return label.replace(/^(ì˜ì—…|íšŒì˜|ì‹œê³µ|ì‡¼ë£¸|ê¸°íƒ€|ë‚´ ì¼ì •)\s*Â·\s*/, ""); }
function compactCalendarOrganization(value: string) {
  return value
    .replace(/^(ì„œìš¸íŠ¹ë³„ì‹œ|ë¶€ì‚°ê´‘ì—­ì‹œ|ëŒ€êµ¬ê´‘ì—­ì‹œ|ì¸ì²œê´‘ì—­ì‹œ|ê´‘ì£¼ê´‘ì—­ì‹œ|ëŒ€ì „ê´‘ì—­ì‹œ|ìš¸ì‚°ê´‘ì—­ì‹œ|ì„¸ì¢…íŠ¹ë³„ìì¹˜ì‹œ|ê²½ê¸°ë„|ê°•ì›íŠ¹ë³„ìì¹˜ë„|ì¶©ì²­ë¶ë„|ì¶©ì²­ë‚¨ë„|ì „ë¶íŠ¹ë³„ìì¹˜ë„|ì „ë¼ë‚¨ë„|ê²½ìƒë¶ë„|ê²½ìƒë‚¨ë„|ì œì£¼íŠ¹ë³„ìì¹˜ë„)\s+/, "")
    .replace(/^[ê°€-í£]+(?:ì‹œ|êµ°|êµ¬)\s+/, "")
    .replace(/ì´ˆë“±í•™êµ$/, "ì´ˆ")
    .replace(/ì¤‘í•™êµ$/, "ì¤‘")
    .replace(/ê³ ë“±í•™êµ$/, "ê³ ")
    .trim();
}
function structuredGoogleDescription(value: string) {
  const result = { content: "", constructionStage: "", memo: "" };
  let memoStarted = false;
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    const matched = line.match(/^(ë‹´ë‹¹ì|ì¼ì • ë‚´ìš©|ì‹œê³µ ë‹¨ê³„|ì‹œê³µì—…ì²´|ê³µì‚¬Â·í’ˆëª©|ë©”ëª¨):\s*(.*)$/);
    if (matched) {
      memoStarted = matched[1] === "ë©”ëª¨";
      if (matched[1] === "ì¼ì • ë‚´ìš©") result.content = matched[2].trim();
      if (matched[1] === "ì‹œê³µ ë‹¨ê³„") result.constructionStage = matched[2].trim();
      if (matched[1] === "ë©”ëª¨") result.memo = matched[2].trim();
    } else if (memoStarted && line) {
      result.memo = `${result.memo}${result.memo ? "\n" : ""}${line}`;
    }
  }
  if (result.content === "[ì…ë ¥ í•„ìš”]") result.content = "";
  if (result.constructionStage === "[ì…ë ¥ í•„ìš”]") result.constructionStage = "";
  return { ...result, memo: result.memo.slice(0, 500) };
}
function normalizedInstitution(value: string) { return value.replace(/[\sÂ·â€¢._()\-]/g, "").toLocaleLowerCase("ko-KR"); }
function institutionSearchRank(item: Institution, normalizedQuery: string) {
  const organization = normalizedInstitution(item.organization);
  if (organization === normalizedQuery) return 0;
  if (organization.startsWith(normalizedQuery)) return 1;
  if (organization.includes(normalizedQuery)) return 2;
  return 3;
}
function kindFromSchedule(schedule: HomeCalendarSchedule): EditorKind {
  if (schedule.category === "construction") return "ì‹œê³µ";
  if (schedule.category === "meeting") return "íšŒì˜";
  if (schedule.category === "showroom") return "ì‡¼ë£¸";
  if (schedule.category === "other") return "ê¸°íƒ€";
  if (schedule.category === "personal") return "ë‚´ ì¼ì •";
  const matched = schedule.label.match(/^(ì˜ì—…|íšŒì˜|ì‹œê³µ|ì‡¼ë£¸|ê¸°íƒ€|ë‚´ ì¼ì •)\s*Â·/);
  return (matched?.[1] as EditorKind) || "ì˜ì—…";
}
function eventTime(schedule: HomeCalendarSchedule) { return schedule.startTime ? schedule.startTime : ""; }
function emptyEditor(date: string) {
  return {
    scheduleId: null as number | null, googleEventId: "", organization: "", businessRound: 0, organizationQuery: "", linked: false,
    kind: "ì˜ì—…" as EditorKind, title: "", scheduledDate: date, allDay: true, startTime: "", endTime: "",
    assigneeMemberId: 0, assigneeName: "", details: "", completed: false, syncError: "",
  };
}
type CalendarEditor = ReturnType<typeof emptyEditor>;

export default function HomeCalendar({ refreshVersion, onOpenOrganization, onOpenConstructionSchedule, onRecordsChanged, records }: {
  refreshVersion: number;
  onOpenOrganization: (organization: string, businessRound: number) => void;
  onOpenConstructionSchedule: () => void;
  onRecordsChanged?: () => void | Promise<void>;
  records: InstitutionRecord[];
}) {
  const today = dateValue(new Date());
  const [monthValue, setMonthValue] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [mobileAgendaOpen, setMobileAgendaOpen] = useState(false);
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [schedules, setSchedules] = useState<HomeCalendarSchedule[]>([]);
  const [constructionStages, setConstructionStages] = useState<string[]>([...CONSTRUCTION_STAGES]);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentMember, setCurrentMember] = useState({ id: 0, displayName: "", role: "member" });
  const [googleState, setGoogleState] = useState({ configured: false, connected: false, writable: false, error: "" });
  const [syncIssues, setSyncIssues] = useState<SyncIssue[]>([]);
  const [googleRefreshing, setGoogleRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [institutionCreating, setInstitutionCreating] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(() => emptyEditor(today));
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [createdInstitutions, setCreatedInstitutions] = useState<Institution[]>([]);
  const [institutionSearchState, setInstitutionSearchState] = useState<InstitutionSearchState>("idle");
  const institutionRequestSequence = useRef(0);
  const institutionCreatingRef = useRef(false);
  const scheduleSavingRef = useRef(false);
  const [readOnlySchedule, setReadOnlySchedule] = useState<HomeCalendarSchedule | null>(null);
  const dates = useMemo(() => monthGrid(monthValue), [monthValue]);
  const rangeStart = dateValue(dates[0]);
  const rangeEnd = dateValue(dates[dates.length - 1]);
  const institutionIndex = useMemo(() => {
    const latest = new Map<string, InstitutionRecord>();
    const ordered = [...records].sort((left, right) => {
      const byDate = String(right.activityDate || "").localeCompare(String(left.activityDate || ""));
      return byDate || (Number(right.id) || 0) - (Number(left.id) || 0);
    });
    for (const record of ordered) {
      const organization = record.organization.trim();
      if (!organization) continue;
      const businessRound = Math.max(1, Number(record.businessRound) || 1);
      const key = `${normalizedInstitution(organization)}::${businessRound}`;
      if (!latest.has(key)) latest.set(key, { ...record, organization, businessRound });
    }
    for (const institution of createdInstitutions) {
      const key = `${normalizedInstitution(institution.organization)}::${institution.businessRound}`;
      latest.set(key, institution);
    }
    return [...latest.values()];
  }, [createdInstitutions, records]);

  useEffect(() => {
    if (!editorOpen || members.length) return;
    void fetch("/api/members?scope=assignees", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { members?: Member[] }) => setMembers(Array.isArray(payload.members) ? payload.members : []))
      .catch(() => undefined);
  }, [editorOpen, members.length]);

  useEffect(() => {
    void fetch("/api/schedules?scope=construction-stages", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { stages?: unknown[] }) => {
        const stages = Array.isArray(payload.stages)
          ? payload.stages.map((stage) => String(stage || "").trim()).filter(Boolean)
          : [];
        if (stages.length) setConstructionStages(stages);
      })
      .catch(() => undefined);
  }, [reloadVersion]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    const requestCalendar = async (refreshGoogle: boolean) => {
      const response = await resilientFetch(
        `/api/schedules?scope=calendar&start=${rangeStart}&end=${rangeEnd}&refreshGoogle=${refreshGoogle ? "1" : "0"}`,
        {
          cache: "no-store",
          signal: controller.signal,
          // The stored site calendar stays fast. Google reconciliation may
          // update and repair several events, so let that single background
          // request finish instead of aborting and immediately duplicating it.
          timeoutMs: refreshGoogle ? 45_000 : 12_000,
          retries: refreshGoogle ? 0 : 1,
        },
      );
        const payload = await response.json() as {
          schedules?: HomeCalendarSchedule[]; currentMember?: { id: number; displayName: string; role: string };
          googleCalendarConfigured?: boolean; googleCalendarConnected?: boolean; googleCalendarWritable?: boolean;
          googleCalendarError?: string; googleRefreshPending?: boolean; syncIssues?: SyncIssue[]; error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "ì¼ì •ì„ ë¶ˆëŸ¬ì˜¤ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.");
        return payload;
    };
    const applyPayload = (payload: Awaited<ReturnType<typeof requestCalendar>>) => {
      if (!active) return;
        setSchedules(Array.isArray(payload.schedules) ? payload.schedules : []);
        if (payload.currentMember) setCurrentMember(payload.currentMember);
        if (typeof payload.googleCalendarConfigured === "boolean") {
          setGoogleState({
            configured: payload.googleCalendarConfigured,
            connected: Boolean(payload.googleCalendarConnected),
            writable: Boolean(payload.googleCalendarWritable),
            error: payload.googleCalendarError || "",
          });
        }
        setSyncIssues(Array.isArray(payload.syncIssues) ? payload.syncIssues : []);
        setError("");
    };
    void (async () => {
      try {
        applyPayload(await requestCalendar(false));
        if (!active) return;
        setLoading(false);
        // Give the primary dashboard request a brief head start, then reconcile
        // Google without making the calendar appear idle for several seconds.
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        if (!active) return;
        setGoogleRefreshing(true);
        try {
          applyPayload(await requestCalendar(true));
        } catch (caught) {
          if (active && !(caught instanceof DOMException && caught.name === "AbortError")) {
            console.warn("Google calendar refresh failed", caught);
          }
        } finally {
          if (active) setGoogleRefreshing(false);
        }
      } catch (caught) {
        if (active && !(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(caught instanceof Error ? caught.message : "ì¼ì •ì„ ë¶ˆëŸ¬ì˜¤ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.");
        }
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [rangeEnd, rangeStart, refreshVersion, reloadVersion]);

  useEffect(() => {
    const query = editor.organizationQuery.trim();
    const requestId = ++institutionRequestSequenceïo}¶‰Ëkºwµçq•¹‘…ÈµÍÑ…Ñ”ˆù½½±”ƒ²vó²‚Tƒ¶fW²vàƒ²’GŠ˜ğ½Íµ…±°ø€è¹Õ±±ô4(€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ½µÁ±•Ñ•µ™¥±Ñ•Èˆøñ¥¹ÁÕĞÑåÁ”ô‰¡•­‰½àˆ¡•­•õí¡¥‘•½µÁ±•Ñ•‘ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ!¥‘•½µÁ±•Ñ•¡•Ù•¹Ğ¹Ñ…É•Ğ¹¡•­•¥ô€¼øƒ²f®0ƒ²vó²‚Tƒ²"£ªâÃªâÀğ½±…‰•°ø4(€€€€€€ğ½‘¥Øø4(€€€€€íÍå¹%ÍÍÕ•Ì¹±•¹Ñ €ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰…±•¹‘…ÈµÍå¹Œµ¥ÍÍÕ•ÌˆÉ½±”ô‰ÍÑ…ÑÕÌˆø4(€€€€€€€€ñÍÑÉ½¹œù½½±”…±•¹‘…Èƒ®>gªâÃ¶fPƒ².“¶2 íÍå¹%ÍÍÕ•Ì¹±•¹Ñ¡÷ªÆĞğ½ÍÑÉ½¹œø4(€€€€€€€íÍå¹%ÍÍÕ•Ì¹Í±¥” À°€Ì¤¹µ…À ¡¥ÍÍÕ”¤€ôø€ñ‘¥Ø­•äõí¥ÍÍÕ”¹¥‘ôø4(€€€€€€€€€€ñÍÁ…¸ùí¥ÍÍÕ”¹½É…¹¥é…Ñ¥½¹ôƒ
Üí¥ÍÍÕ”¹±…‰•±ôñÍµ…±°ùí¥ÍÍÕ”¹½Á•É…Ñ¥½¸€ôôô€‰‘•±•Ñ”ˆ€ü€‹²
·²‚pˆ€è¥ÍÍÕ”¹½Á•É…Ñ¥½¸€ôôô€‰Õ¹±¥¹¬ˆ€ü€‰½½±”ƒªÎ×²r€ƒ¶VÓ²‚pˆ€è€‹®NÇ®†w
ß²"c²‚T‰ôƒ
Üí¥ÍÍÕ”¹•ÉÉ½Éôğ½Íµ…±°øğ½ÍÁ…¸ø4(€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ‘¥Í…‰±•õíÉ•ÑÉå¥¹%€ôôô¥ÍÍÕ”¹¥‘ô½¹±¥¬õì ¤€ôøÙ½¥É•ÑÉåMå¹Œ¡¥ÍÍÕ”¹¥¥ôùíÉ•ÑÉå¥¹%€ôôô¥ÍÍÕ”¹¥€ü€‹²z³².s®>ƒ²’Dˆ€è€‹²z³².s®>‰ôğ½‰ÕÑÑ½¸ø4(€€€€€€€€ğ½‘¥Øø¥ô4(€€€€€€ğ½‘¥Øø€è¹Õ±±ô4(€€€€€í•ÉÉ½È€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ•ÉÉ½Èˆùí•ÉÉ½Éôğ½‘¥Øø€è¹Õ±±ô4(€€€€€í¹½Ñ¥”€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ¹½Ñ¥”ˆÉ½±”ô‰ÍÑ…ÑÕÌˆùí¹½Ñ¥•ôğ½‘¥Øø€è¹Õ±±ô4(€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ±…å½ÕĞˆø4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…ÈµÉ¥ˆ…É¥„µ‰ÕÍäõí±½…‘¥¹ôø4(€€€€€€€€€íl‹²vğˆ°€‹²nPˆ°€‹¶fPˆ°€‹²"`ˆ°€‹®ª¤ˆ°€‹ªâ ˆ°€‹¶€‰t¹µ…À ¡‘…ä¤€ôø€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµİ••­‘…äˆ­•äõí‘…åôùí‘…åôğ½‘¥Øø¥ô4(€€€€€€€€€í‘…Ñ•Ì¹µ…À ¡‘…Ñ”¤€ôøì4(€€€€€€€€€€€½¹ÍĞÙ…±Õ”€ô‘…Ñ•Y…±Õ”¡‘…Ñ”¤ì½¹ÍĞ¥Ñ•µÌ€ôÉ½ÕÁ•¹•Ğ¡Ù…±Õ”¤ñğmtì4(€€€€€€€€€€€É•ÑÕÉ¸€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”õí¡½µ”µ…±•¹‘…Èµ‘…ä‘íÙ…±Õ”¹ÍÑ…ÉÑÍ]¥Ñ ¡µ½¹Ñ¡AÉ•™¥à¤€ü€ˆˆ€è€ˆ½ÕÑÍ¥‘”‰ô‘íÙ…±Õ”€ôôôÑ½‘…ä€ü€ˆÑ½‘…äˆ€è€ˆ‰ô‘íÙ…±Õ”€ôôôÍ•±•Ñ•‘…Ñ”€ü€ˆÍ•±•Ñ•ˆ€è€ˆ‰õô­•äõíÙ…±Õ•ô½¹±¥¬õì ¤€ôøìÍ•ÑM•±•Ñ•‘…Ñ”¡Ù…±Õ”¤ìÍ•Ñ5½‰¥±••¹‘…=Á•¸¡ÑÉÕ”¤ìõôø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ‘…äµ¹Õµ‰•Èˆùí‘…Ñ”¹•Ñ…Ñ” ¥ôğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ‘…äµ¥Ñ•µÌˆø4(€€€€€€€€€€€€€€€í¥Ñ•µÌ¹Í±¥” À°€Ì¤¹µ…À ¡¥Ñ•´¤€ôø€ñÍÁ…¸±…ÍÍ9…µ”õí€‘í¥Ñ•´¹…Ñ•½Éåô‘í¥Ñ•´¹½µÁ±•Ñ•€ü€ˆ½µÁ±•Ñ•ˆ€è€ˆ‰õô­•äõí¥Ñ•´¹¥‘ôÑ¥Ñ±”õí€‘í¥Ñ•´¹½É…¹¥é…Ñ¥½¹ôƒ
Ü€‘í¥Ñ•´¹±…‰•±õôø4(€€€€€€€€€€€€€€€€€€ñˆø4(€€€€€€€€€€€€€€€€€€€í¥Ñ•´¹ÍÑ…ÉÑQ¥µ”€ü€‘í¥Ñ•´¹ÍÑ…ÉÑQ¥µ•ô€€è€ˆ‰ô4(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰…±•¹‘…Èµ½É…¹¥é…Ñ¥½¸µ™Õ±°ˆùí¥Ñ•´¹½É…¹¥é…Ñ¥½¹ôğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰…±•¹‘…Èµ½É…¹¥é…Ñ¥½¸µ½µÁ…Ğˆùí½µÁ…Ñ…±•¹‘…É=É…¹¥é…Ñ¥½¸¡¥Ñ•´¹½É…¹¥é…Ñ¥½¸¥ôğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€ğ½ˆøñÍµ…±°ùí±•…¹M¡•‘Õ±•Q¥Ñ±”¡¥Ñ•´¹±…‰•°¥ôğ½Íµ…±°ø4(€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø¥ô4(€€€€€€€€€€€€€€€í¥Ñ•µÌ¹±•¹Ñ €ø€Ì€ü€ñ•´ø­í¥Ñ•µÌ¹±•¹Ñ €´€Í÷ªÆĞƒ®6S®ÎÓªâÀğ½•´ø€è¹Õ±±ô4(€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€ğ½‰ÕÑÑ½¸øì4(€€€€€€€€€ô¥ô4(€€€€€€€€ğ½‘¥Øø4(€€€€€€€íµ½‰¥±••¹‘…=Á•¸€ü€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ…•¹‘„µ‰…­‘É½Àˆ…É¥„µ±…‰•°ô‹²vó²‚Tƒ®ª§®†tƒ®.¯ªâÀˆ½¹±¥¬õì ¤€ôøÍ•Ñ5½‰¥±••¹‘…=Á•¸¡™…±Í”¥ô€¼ø€è¹Õ±±ô(€€€€€€€€ñ…Í¥‘”±…ÍÍ9…µ”õí¡½µ”µ…±•¹‘…Èµ…•¹‘„‘íµ½‰¥±••¹‘…=Á•¸€ü€ˆµ½‰¥±”µ½Á•¸ˆ€è€ˆ‰õô…É¥„µ±…‰•°õí€‘íÍ•±•Ñ•‘…Ñ•Q¥Ñ±”¡Í•±•Ñ•‘…Ñ”¥ôƒ²vó²‚Tƒ®ª§®†uôø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ…•¹‘„µ¡•…‘¥¹œˆøñÍÁ…¸ùíÍ•±•Ñ•‘…Ñ”€ôôôÑ½‘…ä€ü€‹²b“®*`ˆ€è€‹²ƒ¶tƒ®
ƒ²p‰ôğ½ÍÁ…¸øñ ÌùíÍ•±•Ñ•‘…Ñ•Q¥Ñ±”¡Í•±•Ñ•‘…Ñ”¥ôğ½ ÌøñˆùíÍ•±•Ñ•‘M¡•‘Õ±•Ì¹±•¹Ñ¡÷ªÆĞğ½ˆøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ…•¹‘„µ±½Í”ˆ…É¥„µ±…‰•°ô‹²vó²‚Tƒ®ª§®†tƒ®.¯ªâÀˆ½¹±¥¬õì ¤€ôøÍ•Ñ5½‰¥±••¹‘…=Á•¸¡™…±Í”¥ôû\ğ½‰ÕÑÑ½¸øğ½‘¥Øø(€€€€€€€€€í±½…‘¥¹œ€ü€ñÀ±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ…•¹‘„µ•µÁÑäˆû²vó²‚W²vƒ¶fW²vã¶Vc®*Pƒ²’G²z®.#®.¸ğ½Àø€èÍ•±•Ñ•‘M¡•‘Õ±•Ì¹±•¹Ñ €ü€ 4(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ…•¹‘„µ±¥ÍĞˆùíÍ•±•Ñ•‘M¡•‘Õ±•Ì¹µ…À ¡¥Ñ•´¤€ôø€ 4(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”õí¥Ñ•´¹½µÁ±•Ñ•€ü€‰½µÁ±•Ñ•ˆ€è€ˆ‰ô­•äõí¥Ñ•´¹¥‘ô½¹±¥¬õì ¤€ôø½Á•¹‘¥Ğ¡¥Ñ•´¥ôø4(€€€€€€€€€€€€€€€€ñ¤±…ÍÍ9…µ”õí¥Ñ•´¹…Ñ•½Éåô€¼øñÍÁ…¸øñÍÑÉ½¹œùí¥Ñ•´¹ÍÑ…ÉÑQ¥µ”€ü€‘í¥Ñ•´¹ÍÑ…ÉÑQ¥µ•ô€€è€ˆ‰õí¥Ñ•´¹½É…¹¥é…Ñ¥½¹ôğ½ÍÑÉ½¹œøñÍµ…±°ùí±•…¹M¡•‘Õ±•Q¥Ñ±”¡¥Ñ•´¹±…‰•°¥ôğ½Íµ…±°øñÍµ…±°±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µ…ÍÍ¥¹•”ˆû®.Ó®.äí¥Ñ•´¹…ÍÍ¥¹••9…µ”ñğ€‹®¾ã²‚T‰õí¥Ñ•´¹½½±•=É¥¥¸€ü€ˆƒ
Ü½½±—²^C²pƒ²^ÃªÊÀˆ€è€ˆ‰ôğ½Íµ…±°ùí¥Ñ•´¹Íå¹ÉÉ½È€ôôô==1}Y9Q}1Q}Me9}II=H€ü€ñÍµ…±°±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µÍå¹Œ™…¥±•ˆù½½±—²^C²pƒ²
·²‚s®B ƒ
Üƒ²
³²vÓ¶*àƒ²vó²‚Tƒ²rƒ² ƒ²’Dğ½Íµ…±°ø€è¥Ñ•´¹Íå¹MÑ…ÑÕÌ€ôôô€‰™…¥±•ˆ€ü€ñÍµ…±°±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µÍå¹Œ™…¥±•ˆù½½±”ƒ®>gªâÃ¶fPƒ².“¶2 ƒ
Üƒ²z³².s®>ƒ¶V²jPğ½Íµ…±°ø€è¥Ñ•´¹Íå¹MÑ…ÑÕÌ€ôôô€‰Á•¹‘¥¹œˆ€ü€ñÍµ…±°±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µÍå¹ŒÁ•¹‘¥¹œˆù½½±”ƒ®>gªâÃ¶fPƒ®2ªâÀğ½Íµ…±°ø€è¥Ñ•´¹Íå¹MÑ…ÑÕÌ€ôôô€‰±½…±}½¹±äˆ€ü€ñÍµ…±°±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µÍå¹Œ±½…°µ½¹±äˆû²
³²vÓ¶*àƒ²‚²j¤ƒ²vó²‚Tƒ
Ü½½±”ƒªÎ×²r€ƒ²V ƒ¶V ğ½Íµ…±°ø€è¥Ñ•´¹½½±•Ù•¹Ñ%€ü€ñÍµ…±°±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µÍå¹ŒÍå¹•ˆù½½±”ƒ²^ÃªÊÃ®B ğ½Íµ…±°ø€è¹Õ±±ôğ½ÍÁ…¸øñ•´±…ÍÍ9…µ”õí¥Ñ•´¹…Ñ•½ÉåôùíQ=Ie}1	1m¥Ñ•´¹…Ñ•½Éåuôğ½•´ø4(€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€¤¥ôğ½‘¥Øø4(€€€€€€€€€€¤€è€ñÀ±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ…•¹‘„µ•µÁÑäˆû²vĞƒ®
ƒ²s²^@ƒ®NÇ®†w®Bpƒ²vó²‚W²vĞƒ²^²*×®.#®.¸ğ½Àùô4(€€€€€€€€ğ½…Í¥‘”ø4(€€€€€€ğ½‘¥Øø4(4(€€€€€í•‘¥Ñ½É=Á•¸€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µ•‘¥Ñ½ÈµÍ¡•±°ˆÉ½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆ½¹5½ÕÍ•½İ¸õì¡•Ù•¹Ğ¤€ôøì¥˜€¡•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ€ôôô•Ù•¹Ğ¹Ñ…É•Ğ¤Í•Ñ‘¥Ñ½É=Á•¸¡™…±Í”¤ìõôø4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ•‘¥Ñ½ÈˆÉ½±”ô‰‘¥…±½œˆ…É¥„µµ½‘…°ô‰ÑÉÕ”ˆø4(€€€€€€€€€€ñ¡•…‘•Èøñ‘¥ØøñÍÁ…¸±…ÍÍ9…µ”ô‰Í•Ñ¥½¸µ­¥­•Èˆùí•‘¥Ñ½È¹½½±•Ù•¹Ñ%€ü€‰=99P==1M!U1ˆ€è•‘¥Ñ½È¹Í¡•‘Õ±•%€ü€‰%PM!U1ˆ€è€‰9\M!U1‰ôğ½ÍÁ…¸øñ Ìùí•‘¥Ñ½È¹½½±•Ù•¹Ñ%€ü€‰½½±”ƒ²vó²‚Tƒ²^ÃªÊÀˆ€è•‘¥Ñ½È¹Í¡•‘Õ±•%€ü€‹²vó²‚Tƒ²"c²‚Tˆ€è€‹²vó²‚Tƒ®NÇ®†t‰ôğ½ ÌøñÀùí•‘¥Ñ½È¹½½±•Ù•¹Ñ%€ü€‹²ÚS²Êpƒ®
Ó²j§²vƒ¶fW²vã¶VcªÎ€ƒªâÃªÒ
ß®Ú®–c
ß®.Ó®.ç²zC®–ğƒ²^ÃªÊÃ¶VĞƒ²ó²ã²jP¸ˆ€è€‹².sªÎÔƒ²vó²‚W²v ƒ².sªÎ×
ß®
§¶J ƒ²vó²‚W¶Fs²^C²pƒªÒ®š³¶VcªÎ€ƒ²vĞƒ¶fS®¦Ó²^C®*Pƒ²zC®>dƒ²^Ã®>g®B§®.#®.¸‰ôğ½Àøğ½‘¥Øøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ…É¥„µ±…‰•°ô‹®.¯ªâÀˆ½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ½É=Á•¸¡™…±Í”¥ôû\ğ½‰ÕÑÑ½¸øğ½¡•…‘•Èø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ­¥¹ˆùì ¡•‘¥Ñ½È¹½½±•Ù•¹Ñ%€ül‹²b²^ˆ°€‹¶j3²v`ˆ°€‹².sªÎÔˆ°€‹²ó®àˆ°€‹ªâÃ¶ ‰t€è•‘¥Ñ½È¹Í¡•‘Õ±•%€ül‹²b²^ˆ°€‹¶j3²v`ˆ°€‹².sªÎÔˆ°€‹²ó®àˆ°€‹ªâÃ¶ ˆ°€‹®
Ğƒ²vó²‚T‰t€èl‹²b²^ˆ°€‹¶j3²v`ˆ°€‹².sªÎÔˆ°€‹²ó®àˆ°€‹ªâÃ¶ ˆ°€‹®
Ğƒ²vó²‚T‰t¤…Ì‘¥Ñ½É-¥¹‘mt¤¹µ…À ¡­¥¹¤€ôø€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ­•äõí­¥¹‘ô±…ÍÍ9…µ”õí•‘¥Ñ½È¹­¥¹€ôôô­¥¹€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°­¥¹ô¤¥ôùí­¥¹‘ôğ½‰ÕÑÑ½¸ø¥ôğ½‘¥Øø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ¥¹ÍÑ¥ÑÕÑ¥½¸ˆø4(€€€€€€€€€€€€ñ±…‰•°¡Ñµ±½Èô‰¡½µ”µÍ¡•‘Õ±”µ¥¹ÍÑ¥ÑÕÑ¥½¸µ¥¹ÁÕĞˆùí•‘¥Ñ½È¹½½±•Ù•¹Ñ%€ü€‹²^ÃªÊÃ¶V€ƒªâÃªÒ ˆ€è€‹ªâÃªÒ ƒ®bC®*Pƒ²vó²‚Tƒ²z—²0‰ô€ñˆø¨ğ½ˆøğ½±…‰•°ø4(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ¥¹ÍÑ¥ÑÕÑ¥½¸µÍ•…É ˆø4(€€€€€€€€€€€€€€ñ¥¹ÁÕĞ¥ô‰¡½µ”µÍ¡•‘Õ±”µ¥¹ÍÑ¥ÑÕÑ¥½¸µ¥¹ÁÕĞˆÙ…±Õ”õí•‘¥Ñ½È¹½É…¹¥é…Ñ¥½¹EÕ•Éåô4(€€€€€€€€€€€€€€€½¹%¹ÁÕĞõì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•%¹ÍÑ¥ÑÕÑ¥½¹EÕ•Éä¡•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ¹Ù…±Õ”¥ô4(€€€€€€€€€€€€€€€½¹½µÁ½Í¥Ñ¥½¹¹õì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•%¹ÍÑ¥ÑÕÑ¥½¹EÕ•Éä¡•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ¹Ù…±Õ”¥ô4(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøì4(€€€€€€€€€€€€€€€€€½¹ÍĞÙ…±Õ”€ô•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ¹Ù…±Õ”ì4(€€€€€€€€€€€€€€€€€ÕÁ‘…Ñ•%¹ÍÑ¥ÑÕÑ¥½¹EÕ•Éä¡Ù…±Õ”¤ì4(€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‹ªâÃªÒ®ª€Ëªâ²z@ƒ²vÓ²ƒªÊ²$ƒ®bC®*Pƒ²²‚Dƒ²z®‚”ˆ€¼ø4(€€€€€€€€€€€€€ì…•‘¥Ñ½È¹±¥¹­•€˜˜•‘¥Ñ½È¹½É…¹¥é…Ñ¥½¹EÕ•Éä¹ÑÉ¥´ ¤¹±•¹Ñ €øô€È€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ¥¹ÍÑ¥ÑÕÑ¥½¸µÉ•ÍÕ±ÑÌˆø4(€€€€€€€€€€€€€€€í¥¹ÍÑ¥ÑÕÑ¥½¹Ì¹µ…À ¡¥Ñ•´¤€ôø€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ­•äõí€‘í¥Ñ•´¹½É…¹¥é…Ñ¥½¹ô´‘í¥Ñ•´¹‰ÕÍ¥¹•ÍÍI½Õ¹‘õô½¹±¥¬õì ¤€ôøÍ•±•Ñ%¹ÍÑ¥ÑÕÑ¥½¸¡¥Ñ•´¥ôøñÍÑÉ½¹œùí¥Ñ•´¹½É…¹¥é…Ñ¥½¹ôğ½ÍÑÉ½¹œøñÍµ…±°ùí¥Ñ•´¹É•¥½¸ñğ€‹²²^´ƒ®¾ã®NÇ®†t‰ôƒ
Üí¥Ñ•´¹‰ÕÍ¥¹•ÍÍI½Õ¹‘÷²Â ƒ²
³²^ƒ
Üí¥Ñ•´¹ÁÉ½É•ÍÍ5…¹…•Èñğ€‹®.Ó®.ç²z@ƒ®¾ã²‚T‰ôğ½Íµ…±°øğ½‰ÕÑÑ½¸ø¥ô4(€€€€€€€€€€€€€€€í¥¹ÍÑ¥ÑÕÑ¥½¹M•…É¡MÑ…Ñ”€ôôô€‰‘•‰½Õ¹¥¹œˆñğ¥¹ÍÑ¥ÑÕÑ¥½¹M•…É¡MÑ…Ñ”€ôôô€‰±½…‘¥¹œˆ€ü€ñÀ±…ÍÍ9…µ”ô‰Í•…É¡¥¹œˆûªâÃªÒ²vƒªÊ²'¶Vc®*Pƒ²’G²z®.#®.¸ğ½Àø€è¹Õ±±ô4(€€€€€€€€€€€€€€€í¥¹ÍÑ¥ÑÕÑ¥½¹M•…É¡MÑ…Ñ”€ôôô€‰•µÁÑäˆ€ü€ñÀûªÊ²$ƒªÊÃªÎóªÂ ƒ²^²*×®.#®.¸ğ½Àø€è¹Õ±±ô4(€€€€€€€€€€€€€€€í¥¹ÍÑ¥ÑÕÑ¥½¹M•…É¡MÑ…Ñ”€ôôô€‰•ÉÉ½Èˆ€ü€ñÀ±…ÍÍ9…µ”ô‰Í•…É µ•ÉÉ½ÈˆûªÊ²'²vĞƒ²²^Ã®BcªÎ€ƒ²z#²*×®.#®.¸ƒ²zƒ².pƒ¶nƒ®.“².pƒ²z®‚—¶VĞƒ²ó²ã²jP¸ğ½Àø€è¹Õ±±ô4(€€€€€€€€€€€€€€ğ½‘¥Øø€è¹Õ±±ô4(€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€ñÍµ…±°±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ±¥¹¬µ¹½Ñ”ˆùí•‘¥Ñ½È¹±¥¹­•€ü•‘¥Ñ½È¹­¥¹€ôôô€‹².sªÎÔˆ€ü€‹².sªÎ×
ß®
§¶J ƒ²vó²‚W¶Fs²f ƒªâÃªÒ ƒ²²ã²v`ƒ²b#²‚Tƒ²vó²‚W²^@ƒ²^ÃªÊÃ®B§®.#®.¸ˆ€è€‹ªâÃªÒ ƒ²²ã²v`ƒ²b#²‚Tƒ²vó²‚W²^@ƒ²^ÃªÊÃ®B§®.#®.¸ˆ€è•‘¥Ñ½È¹­¥¹€ôôô€‹².sªÎÔˆ€ü€‹².sªÎÔƒ²vó²‚W²v ƒªâÃ²†ĞƒªâÃªÒ²vƒ²ƒ¶w¶VÓ²Vğƒ¶Vc®¦À°ƒ²vó²‚W¶Fpƒ®¾ã®NÇ®†tƒªâÃªÒ²v ƒ²‚²z—¶V€ƒ®V0ƒ®NÇ®†tƒ²^³®Ú®–ğƒ¶fW²vã¶V§®.#®.¸ˆ€è•‘¥Ñ½È¹½½±•Ù•¹Ñ%€ü€‹²ÚS²ÊpƒªâÃªÒ²vƒ²ƒ¶w¶Vpƒ®Jƒ²^ÃªÊÃ¶V€ƒ²"`ƒ²z#²*×®.#®.¸ˆ€è•‘¥Ñ½È¹­¥¹€ôôô€‹²b²^ˆ€ü€‹²b²^ƒ²vó²‚W²v ƒªâÃ²†ĞƒªâÃªÒ²vƒ²ƒ¶w¶VcªÆÃ®
`ƒ² ƒªâÃªÒ²ró®†pƒ®NÇ®†w¶VÓ²Vğƒ¶V§®.#®.¸ˆ€è€‹¶j3²vc
ß²ó®ã
ßªâÃ¶
ß®
Ğƒ²vó²‚W²v ƒªâÃªÒ ƒ²^ÃªÊÀƒ®bC®*Pƒ²zC²r€ƒ²z—²0ƒ²z®‚—²vĞƒ®ª£®F@ƒªÂ®*—¶V§®.#®.¸‰ôğ½Íµ…±°ø4(€€€€€€€€€€€ì…•‘¥Ñ½È¹±¥¹­•€˜˜•‘¥Ñ½È¹­¥¹€„ôô€‹².sªÎÔˆ€˜˜•‘¥Ñ½È¹½É…¹¥é…Ñ¥½¹EÕ•Éä¹ÑÉ¥´ ¤¹±•¹Ñ €øô€È€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ¥¹ÍÑ¥ÑÕÑ¥½¸µÉ•…Ñ”ˆøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µÉ•…Ñ”µ¥¹ÍÑ¥ÑÕÑ¥½¸ˆ‘¥Í…‰±•õí¥¹ÍÑ¥ÑÕÑ¥½¹É•…Ñ¥¹œñğÍ…Ù¥¹ô½¹±¥¬õì ¤€ôøÙ½¥É•…Ñ•%¹ÍÑ¥ÑÕÑ¥½¸ ¥ôùí¥¹ÍÑ¥ÑÕÑ¥½¹É•…Ñ¥¹œ€ü€‹ªâÃªÒ ƒ®NÇ®†tƒ²’GŠ˜ˆ€è€ˆ¬ƒ² ƒªâÃªÒ ƒ®NÇ®†tƒ¶nƒ²^ÃªÊÀ‰ôğ½‰ÕÑÑ½¸øğ½‘¥Øø€è¹Õ±±ô4(€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€í•‘¥Ñ½È¹­¥¹€ôôô€‹².sªÎÔˆ€ü€ñ±…‰•°û².sªÎÔƒªÎ×²‚T€ñˆø¨ğ½ˆøñ¥¹ÁÕĞ±¥ÍĞô‰½¹ÍÑÉÕÑ¥½¸µÍÑ…”µ½ÁÑ¥½¹Ìˆµ…á1•¹Ñ õìĞÁôÙ…±Õ”õí•‘¥Ñ½È¹Ñ¥Ñ±•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°Ñ¥Ñ±”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¤¥ôÁ±…•¡½±‘•Èô‹®ª§®†w²^C²pƒ²ƒ¶w¶VcªÆÃ®
`ƒªÎ×²‚W®ªƒ²²‚Dƒ²z®‚”ˆ€¼øñ‘…Ñ…±¥ÍĞ¥ô‰½¹ÍÑÉÕÑ¥½¸µÍÑ…”µ½ÁÑ¥½¹Ìˆùí½¹ÍÑÉÕÑ¥½¹MÑ…•Ì¹µ…À ¡ÍÑ…”¤€ôø€ñ½ÁÑ¥½¸­•äõíÍÑ…•ôÙ…±Õ”õíÍÑ…•ô€¼ø¥ôğ½‘…Ñ…±¥ÍĞøñÍµ…±°û®ª§®†w²^@ƒ²^²ZÓ®>ƒ²²‚Dƒ²z®‚—¶Vc®¦Ğƒ²‚²z”ƒ¶nƒ®.“²v0ƒ²ƒ¶w®Ú¶Àƒ²z³²
³²j§®B§®.#®.¸ğ½Íµ…±°øğ½±…‰•°ø€è€ñ±…‰•°û²vó²‚Tƒ²‚s®ª¤€ñˆø¨ğ½ˆøñ¥¹ÁÕĞÙ…±Õ”õí•‘¥Ñ½È¹Ñ¥Ñ±•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°Ñ¥Ñ±”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¤¥ôÁ±…•¡½±‘•Èô‹²b èƒ®.Ó®.ç²z@ƒ®Â§®²àƒ®¾ã¶2ˆ€¼øğ½±…‰•°ùô4(€€€€€€€€€€ñ±…‰•°û²vó²‚Tƒ®.Ó®.ç²z@€ñˆø¨ğ½ˆøñÍ•±•ĞÙ…±Õ”õí•‘¥Ñ½È¹…ÍÍ¥¹••5•µ‰•É%ñğ€ˆ‰ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôø¡…¹•ÍÍ¥¹•”¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¥ôøñ½ÁÑ¥½¸Ù…±Õ”ôˆˆû®.Ó®.ç²z@ƒ²ƒ¶tğ½½ÁÑ¥½¸ùíµ•µ‰•ÉÌ¹µ…À ¡µ•µ‰•È¤€ôø€ñ½ÁÑ¥½¸­•äõíµ•µ‰•È¹¥‘ôÙ…±Õ”õíµ•µ‰•È¹¥‘ôùíÁ•ÉÍ½¹¥ÍÁ±…å1…‰•°¡µ•µ‰•È¥ôğ½½ÁÑ¥½¸ø¥ôğ½Í•±•Ğøğ½±…‰•°ø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ‘…Ñ”µÉ¥ˆøñ±…‰•°û®
ƒ²p€ñˆø¨ğ½ˆøñ¥¹ÁÕĞÑåÁ”ô‰‘…Ñ”ˆÙ…±Õ”õí•‘¥Ñ½È¹Í¡•‘Õ±•‘…Ñ•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°Í¡•‘Õ±•‘…Ñ”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¤¥ô€¼øğ½±…‰•°ø4(€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µ…±°µ‘…äˆøñ¥¹ÁÕĞÑåÁ”ô‰¡•­‰½àˆ¡•­•õí•‘¥Ñ½È¹…±±…åô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°…±±…äè•Ù•¹Ğ¹Ñ…É•Ğ¹¡•­•°ÍÑ…ÉÑQ¥µ”è•Ù•¹Ğ¹Ñ…É•Ğ¹¡•­•€ü€ˆˆ€èÕÉÉ•¹Ğ¹ÍÑ…ÉÑQ¥µ”°•¹‘Q¥µ”è•Ù•¹Ğ¹Ñ…É•Ğ¹¡•­•€ü€ˆˆ€èÕÉÉ•¹Ğ¹•¹‘Q¥µ”ô¤¥ô€¼øƒ²Š²vğƒ²vó²‚Tğ½±…‰•°ø4(€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€ì…•‘¥Ñ½È¹…±±…ä€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µÑ¥µ”µÉ¥ˆøñ±…‰•°û².s²zDƒ².sªÂ€ñˆø¨ğ½ˆøñÍ•±•ĞÙ…±Õ”õí•‘¥Ñ½È¹ÍÑ…ÉÑQ¥µ•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°ÍÑ…ÉÑQ¥µ”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¤¥ôøñ½ÁÑ¥½¸Ù…±Õ”ôˆˆû²ƒ¶tğ½½ÁÑ¥½¸ùíQ%5}=AQ%=9L¹µ…À ¡Ñ¥µ”¤€ôø€ñ½ÁÑ¥½¸­•äõíÑ¥µ•ôÙ…±Õ”õíÑ¥µ•ôùíÑ¥µ•ôğ½½ÁÑ¥½¸ø¥ôğ½Í•±•Ğøğ½±…‰•°øñ±…‰•°û²Š®0ƒ².sªÂñÍ•±•ĞÙ…±Õ”õí•‘¥Ñ½È¹•¹‘Q¥µ•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°•¹‘Q¥µ”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¤¥ôøñ½ÁÑ¥½¸Ù…±Õ”ôˆˆû²ƒ¶tƒ²V ƒ¶V ğ½½ÁÑ¥½¸ùíQ%5}=AQ%=9L¹µ…À ¡Ñ¥µ”¤€ôø€ñ½ÁÑ¥½¸­•äõíÑ¥µ•ôÙ…±Õ”õíÑ¥µ•ôùíÑ¥µ•ôğ½½ÁÑ¥½¸ø¥ôğ½Í•±•Ğøğ½±…‰•°øğ½‘¥Øø€è¹Õ±±ô4(€€€€€€€€€€ñ±…‰•°û®¦S®ª €ñÍµ…±°û²ƒ¶tƒ²z®‚”ƒ
Üƒ² ƒ²vó²‚W®Ú¶Àƒ²‚²z—®B§®.#®.¸ğ½Íµ…±°øñÑ•áÑ…É•„Ù…±Õ”õí•‘¥Ñ½È¹‘•Ñ…¥±Íôµ…á1•¹Ñ õìÔÀÁôÉ½İÌõìÑô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°‘•Ñ…¥±Ìè•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¤¥ôÁ±…•¡½±‘•Èô‹®Â§®²àƒ®ª§²‚°ƒ²’®æ²
³¶V´ƒ®NÄƒ¶V²jS¶Vpƒ®
Ó²j§²vƒ²z®‚—¶Vc²ã²jP¸½½±”ƒ²vó²‚Tƒ²“®ª²^C®>ƒ¶Fs².s®B§®.#®.¸ˆ€¼øğ½±…‰•°ø4(€€€€€€€€€í•‘¥Ñ½È¹Í¡•‘Õ±•%€ü€ñ±…‰•°±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µ½µÁ±•Ñ•ˆøñ¥¹ÁÕĞÑåÁ”ô‰¡•­‰½àˆ¡•­•õí•‘¥Ñ½È¹½µÁ±•Ñ•‘ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È ¡ÕÉÉ•¹Ğ¤€ôø€¡ì€¸¸¹ÕÉÉ•¹Ğ°½µÁ±•Ñ•è•Ù•¹Ğ¹Ñ…É•Ğ¹¡•­•ô¤¥ô€¼øƒ²vĞƒ²vó²‚W²vƒ²f®0ƒ²¶s®†pƒ²²‚Tğ½±…‰•°ø€è¹Õ±±ô4(€€€€€€€€€í•‘¥Ñ½ÉÉÉ½È€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µ…±•¹‘…Èµ•ÉÉ½ÈˆÉ½±”ô‰…±•ÉĞˆùí•‘¥Ñ½ÉÉÉ½Éôğ½‘¥Øø€è¹Õ±±ô4(€€€€€€€€€€ñ™½½Ñ•Èùí•‘¥Ñ½È¹Í¡•‘Õ±•%€ü€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰‘…¹•Èµ‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÙ½¥‘•±•Ñ•M¡•‘Õ±” ¥ôû²
³²vÓ¶*ã²^C²pƒ²
·²‚pğ½‰ÕÑÑ½¸ø€è¹Õ±±õí±¥¹­•‘•Ñ…¥±Ù…¥±…‰±”€ü€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøìÍ•Ñ‘¥Ñ½É=Á•¸¡™…±Í”¤ì½¹=Á•¹=É…¹¥é…Ñ¥½¸¡•‘¥Ñ½È¹½É…¹¥é…Ñ¥½¸°•‘¥Ñ½È¹‰ÕÍ¥¹•ÍÍI½Õ¹¤ìõôûªâÃªÒ ƒ²²àƒ®ÎÓªâÀğ½‰ÕÑÑ½¸ø€è¹Õ±±ôñÍÁ…¸€¼øñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ‘¥Í…‰±•õí¥¹ÍÑ¥ÑÕÑ¥½¹É•…Ñ¥¹œñğÍ…Ù¥¹ô½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ½É=Á•¸¡™…±Í”¥ôû²Ş£²0ğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰ÁÉ¥µ…Éäµ‰ÕÑÑ½¸ˆ‘¥Í…‰±•õí¥¹ÍÑ¥ÑÕÑ¥½¹É•…Ñ¥¹œñğÍ…Ù¥¹œñğ€…•‘¥Ñ½È¹Ñ¥Ñ±”¹ÑÉ¥´ ¤ñğ€…•‘¥Ñ½È¹½É…¹¥é…Ñ¥½¹EÕ•Éä¹ÑÉ¥´ ¤ñğ€…•‘¥Ñ½È¹…ÍÍ¥¹••5•µ‰•É%ñğ€ ¡•‘¥Ñ½È¹­¥¹€ôôô€‹²b²^ˆñğ•‘¥Ñ½È¹­¥¹€ôôô€‹².sªÎÔˆñğ	½½±•…¸¡•‘¥Ñ½È¹½½±•Ù•¹Ñ%¤¤€˜˜€…•‘¥Ñ½È¹±¥¹­•¥ô½¹±¥¬õì ¤€ôøÙ½¥Í…Ù•M¡•‘Õ±” ¥ôùíÍ…Ù¥¹œ€ü€‹²‚²z”ƒ²’Dˆ€è•‘¥Ñ½È¹Íå¹ÉÉ½È€ôôô==1}Y9Q}1Q}Me9}II=H€ü€‰½½±—²^@ƒ®.“².pƒ²^ÃªÊÀˆ€è•‘¥Ñ½È¹½½±•Ù•¹Ñ%€ü€‹²vÓ®2®†pƒ²^ÃªÊÀˆ€è€‹²‚²z”‰ôğ½‰ÕÑÑ½¸øğ½™½½Ñ•Èø4(€€€€€€€€ğ½‘¥Øø4(€€€€€€ğ½‘¥Øø€è¹Õ±±ô4(4(€€€€€íÉ•…‘=¹±åM¡•‘Õ±”€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µ•‘¥Ñ½ÈµÍ¡•±°ˆÉ½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆ½¹5½ÕÍ•½İ¸õì¡•Ù•¹Ğ¤€ôøì¥˜€¡•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ€ôôô•Ù•¹Ğ¹Ñ…É•Ğ¤Í•ÑI•…‘=¹±åM¡•‘Õ±”¡¹Õ±°¤ìõôø4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¡½µ”µÍ¡•‘Õ±”µ•‘¥Ñ½ÈÍ¡•‘Õ±”µÉ•…‘½¹±äµ‘¥…±½œˆÉ½±”ô‰‘¥…±½œˆ…É¥„µµ½‘…°ô‰ÑÉÕ”ˆø4(€€€€€€€€€€ñ¡•…‘•Èøñ‘¥ØøñÍÁ…¸±…ÍÍ9…µ”ô‰Í•Ñ¥½¸µ­¥­•Èˆù==1=99Q%=89ğ½ÍÁ…¸øñ Ìù½½±”ƒ²vó²‚Tƒ²^ÃªÊÀƒ¶V²jPğ½ ÌøñÀû¶2²n@ƒ®"ªÖ³®
`ƒªâÃªÒ
ß®Ú®–c
ß®.Ó®.ç²zC®–ğƒ¶fW²vã¶VcªÎ€ƒ²^ÃªÊÃ¶V€ƒ²"`ƒ²z#²*×®.#®.¸ğ½Àøğ½‘¥Øøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ…É¥„µ±…‰•°ô‹®.¯ªâÀˆ½¹±¥¬õì ¤€ôøÍ•ÑI•…‘=¹±åM¡•‘Õ±”¡¹Õ±°¥ôû\ğ½‰ÕÑÑ½¸øğ½¡•…‘•Èø4(€€€€€€€€€€ñ‘°øñ‘¥Øøñ‘Ğû²‚s®ª¤ğ½‘Ğøñ‘ùíÉ•…‘=¹±åM¡•‘Õ±”¹±…‰•±ôğ½‘øğ½‘¥Øøñ‘¥Øøñ‘Ğû²z—²0ğ½‘Ğøñ‘ùíÉ•…‘=¹±åM¡•‘Õ±”¹½É…¹¥é…Ñ¥½¸ñğ€‹®¾ã²z®‚”‰ôğ½‘øğ½‘¥Øøñ‘¥Øøñ‘Ğû²vó².pğ½‘Ğøñ‘ùíÉ•…‘=¹±åM¡•‘Õ±”¹Í¡•‘Õ±•‘…Ñ•õíÉ•…‘=¹±åM¡•‘Õ±”¹ÍÑ…ÉÑQ¥µ”€ü€€‘íÉ•…‘=¹±åM¡•‘Õ±”¹ÍÑ…ÉÑQ¥µ•õ€€è€ˆ€£²Š²vğ¤‰õíÉ•…‘=¹±åM¡•‘Õ±”¹•¹‘Q¥µ”€ü€ø€‘íÉ•…‘=¹±åM¡•‘Õ±”¹•¹‘Q¥µ•õ€€è€ˆ‰ôğ½‘øğ½‘¥ØùíÉ•…‘=¹±åM¡•‘Õ±”¹‘•Ñ…¥±Ì€ü€ñ‘¥Øøñ‘Ğû®
Ó²j¤ğ½‘Ğøñ‘ùíÉ•…‘=¹±åM¡•‘Õ±”¹‘•Ñ…¥±Íôğ½‘øğ½‘¥Øø€è¹Õ±±ôğ½‘°ø4(€€€€€€€€€€ñ™½½Ñ•ÈùíÕÉÉ•¹Ñ5•µ‰•È¹É½±”€ôôô€‰…‘µ¥¸ˆ€ü€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰‘…¹•Èµ‰ÕÑÑ½¸ˆ‘¥Í…‰±•õíÍ…Ù¥¹ô½¹±¥¬õì ¤€ôøÙ½¥‘•±•Ñ•½½±•M¡•‘Õ±”¡É•…‘=¹±åM¡•‘Õ±”¥ôù½½±—²^C²s®>ƒ²
·²‚pğ½‰ÕÑÑ½¸ø€è¹Õ±±ôñÍÁ…¸€¼øñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ•ÑI•…‘=¹±åM¡•‘Õ±”¡¹Õ±°¥ôû®.¯ªâÀğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøİ¥¹‘½Ü¹½Á•¸¡É•…‘=¹±åM¡•‘Õ±”¹•áÑ•É¹…±UÉ°ñğ€‰¡ÑÑÁÌè¼½…±•¹‘…È¹½½±”¹½´½…±•¹‘…È½Ô¼À½Èˆ°€‰}‰±…¹¬ˆ°€‰¹½½Á•¹•È±¹½É•™•ÉÉ•Èˆ¥ôù½½±—²^C²pƒ²^ÓªâÀğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰ÁÉ¥µ…Éäµ‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôø½Á•¹½½±•1¥¹¬¡É•…‘=¹±åM¡•‘Õ±”¥ôûªâÃªÒªÎğƒ²^ÃªÊÀğ½‰ÕÑÑ½¸øğ½™½½Ñ•Èø4(€€€€€€€€ğ½‘¥Øø4(€€€€€€ğ½‘¥Øø€è¹Õ±±ô4(€€€€ğ½Í•Ñ¥½¸ø4(€€¤ì4)ô4(