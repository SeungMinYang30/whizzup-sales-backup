"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  addConstructionDays,
  constructionStageTone,
  getConstructionTimelineDays,
  type ConstructionDayMeta,
} from "../lib/construction-calendar";
import {
  CONSTRUCTION_STAGES,
  constructionStageIndex,
} from "../lib/construction-stages";
import { calculateConstructionDashboardCounts } from "../lib/construction-dashboard";
import { downloadConstructionTimelineXlsx } from "./activity-xlsx";

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
  workSummaryMode: "auto" | "manual";
  sourceProductNames: string[];
  completed: boolean;
  hidden: boolean;
  hiddenCandidate: boolean;
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
  startTime: string;
  endTime: string;
  vendorName: string;
  details: string;
  completed: boolean;
};

type EditorItem = {
  id?: number;
  key: string;
  stage: string;
  scheduledDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  vendorName: string;
  details: string;
  active: boolean;
};

type EditorState = {
  organization: string;
  businessRound: number;
  workSummary: string;
  workSummaryMode: "auto" | "manual";
  sourceProductNames: string[];
  selectedProductNames: string[];
  completed: boolean;
  items: EditorItem[];
  customStage: string;
};

const STAGES = [...CONSTRUCTION_STAGES];
const localDate = (date = new Date()) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const scopeKey = (organization: string, businessRound: number) =>
  `${organization}\u001f${businessRound}`;
const itemKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TIME_OPTIONS = Array.from({ length: 24 * 6 }, (_, index) => {
  const minutes = index * 10;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const oneHourLater = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  const minutes = Math.min(23 * 60 + 50, hour * 60 + minute + 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};
const summarizeProducts = (names: string[]) => {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length <= 5) return unique.join(" · ");
  return `${unique.slice(0, 5).join(" · ")} 외 ${unique.length - 5}종`;
};
const displayWorkSummary = (project: ConstructionProject) =>
  project.workSummaryMode === "auto" && project.sourceProductNames.length
    ? summarizeProducts(project.sourceProductNames)
    : project.workSummary;

export default function ConstructionSchedulePage({
  records,
  onOpenOrganization,
  embedded = false,
  isPrimaryOwner = false,
  onDashboardCounts,
  onSchedulesChanged,
  formatManagerName = (name) => name || "미정",
}: {
  records: ScheduleRecord[];
  onOpenOrganization: (organization: string, businessRound: number) => void;
  embedded?: boolean;
  isPrimaryOwner?: boolean;
  onDashboardCounts?: (counts: { planned: number; active: number; completed: number }) => void;
  onSchedulesChanged?: () => void | Promise<void>;
  formatManagerName?: (name: string) => string;
}) {
  const today = localDate();
  const [start, setStart] = useState(today);
  const [projects, setProjects] = useState<ConstructionProject[]>([]);
  const [schedules, setSchedules] = useState<ConstructionSchedule[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hideCompleted, setHideCompleted] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [orientationHint, setOrientationHint] = useState(false);
  const [compactTimeline, setCompactTimeline] = useState(false);
  const [timelineRange, setTimelineRange] = useState<14 | 31>(14);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addVisibleCount, setAddVisibleCount] = useState(30);
  const [hiddenManagerOpen, setHiddenManagerOpen] = useState(false);
  const [mobileStatusFilter, setMobileStatusFilter] = useState<
    "all" | "active" | "missingSchedule" | "completed" | "missingManager"
  >("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const mobileExpandedRef = useRef(false);
  const expandedScrollYRef = useRef(0);
  const expandedHistoryTokenRef = useRef("");
  const closingExpandedRef = useRef(false);
  const suppressExpandedPopRef = useRef(false);
  const timelineDayCount = timelineRange === 31 ? 31 : compactTimeline ? 7 : 14;
  const dayMetas = useMemo(
    () => getConstructionTimelineDays(start, timelineDayCount, today),
    [start, timelineDayCount, today],
  );
  const days = useMemo(() => dayMetas.map((day) => day.date), [dayMetas]);
  const dayMetaByDate = useMemo(
    () => new Map(dayMetas.map((day) => [day.date, day])),
    [dayMetas],
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1000px)");
    const update = () => setCompactTimeline(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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
      setLoadSucceeded(true);
      setMessage("");
    } catch (error) {
      setLoadSucceeded(false);
      setMessage(error instanceof Error ? error.message : "일정표를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void leaveExpanded();
    };
    const updateOrientationHint = () => {
      setOrientationHint(mobileExpandedRef.current && window.matchMedia("(orientation: portrait)").matches);
    };
    const closeWhenFullscreenEnds = () => {
      if (mobileExpandedRef.current && !document.fullscreenElement && !closingExpandedRef.current) {
        void leaveExpanded();
      }
    };
    const closeOnHistoryBack = () => {
      if (suppressExpandedPopRef.current) {
        suppressExpandedPopRef.current = false;
        return;
      }
      if (mobileExpandedRef.current) void leaveExpanded({ historyAlreadyPopped: true });
    };
    document.body.style.overflow = "hidden";
    updateOrientationHint();
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateOrientationHint);
    window.addEventListener("popstate", closeOnHistoryBack);
    document.addEventListener("fullscreenchange", closeWhenFullscreenEnds);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateOrientationHint);
      window.removeEventListener("popstate", closeOnHistoryBack);
      document.removeEventListener("fullscreenchange", closeWhenFullscreenEnds);
      const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
      orientation.unlock?.();
    };
  }, [expanded]);

  async function leaveExpanded({ historyAlreadyPopped = false }: { historyAlreadyPopped?: boolean } = {}) {
    if (closingExpandedRef.current) return;
    closingExpandedRef.current = true;
    const historyToken = expandedHistoryTokenRef.current;
    const shouldPopHistory = mobileExpandedRef.current
      && !historyAlreadyPopped
      && historyToken
      && history.state?.constructionScheduleExpanded === historyToken;
    setExpanded(false);
    setMobileExpanded(false);
    setOrientationHint(false);
    mobileExpandedRef.current = false;
    expandedHistoryTokenRef.current = "";
    const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
    orientation.unlock?.();
    if (document.fullscreenElement === workspaceRef.current && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch { /* 브라우저 기본 종료 동작을 유지합니다. */ }
    }
    if (shouldPopHistory) {
      suppressExpandedPopRef.current = true;
      history.back();
      window.setTimeout(() => { suppressExpandedPopRef.current = false; }, 500);
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: expandedScrollYRef.current, behavior: "auto" }));
  }

  async function toggleExpanded() {
    if (expanded) {
      await leaveExpanded();
      return;
    }
    const isMobile = window.matchMedia("(max-width: 700px), (max-width: 1000px) and (pointer: coarse)").matches;
    closingExpandedRef.current = false;
    expandedScrollYRef.current = window.scrollY;
    mobileExpandedRef.current = isMobile;
    setMobileExpanded(isMobile);
    setExpanded(true);
    if (!isMobile) return;
    const historyToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const currentState = history.state && typeof history.state === "object" ? history.state : {};
    expandedHistoryTokenRef.current = historyToken;
    history.pushState({ ...currentState, constructionScheduleExpanded: historyToken }, "");
    try {
      await workspaceRef.current?.requestFullscreen?.();
    } catch {
      // 전체화면을 지원하지 않아도 고정형 크게 보기는 계속 제공합니다.
    }
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (mode: "landscape") => Promise<void>;
      };
      await orientation.lock?.("landscape");
    } catch {
      setOrientationHint(window.matchMedia("(orientation: portrait)").matches);
    }
  }

  useEffect(() => {
    if (!onDashboardCounts || loading || !loadSucceeded) return;
    onDashboardCounts(calculateConstructionDashboardCounts(projects, schedules));
  }, [loadSucceeded, loading, onDashboardCounts, projects, schedules]);

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
      .filter((project) => !project.hidden)
      .map((project) => {
        const record = latestByScope.get(scopeKey(project.organization, project.businessRound));
        return {
          project,
          record,
          items: (schedulesByScope.get(scopeKey(project.organization, project.businessRound)) ?? [])
            .sort((a, b) =>
              a.scheduledDate.localeCompare(b.scheduledDate)
              || constructionStageIndex(a.stage || a.label) - constructionStageIndex(b.stage || b.label),
            ),
        };
      })
      .filter(({ project }) => !hideCompleted || !project.completed)
      .filter(({ project, record, items }) => {
        if (mobileStatusFilter === "active") return !project.completed;
        if (mobileStatusFilter === "missingSchedule") return !items.length;
        if (mobileStatusFilter === "completed") return project.completed;
        if (mobileStatusFilter === "missingManager") {
          const manager = record?.progressManager?.trim();
          return !manager || manager === "미정" || manager === "해당 없음";
        }
        return true;
      })
      .filter(({ project, record }) =>
        !keyword ||
        `${project.organization} ${project.workSummary} ${record?.region ?? ""} ${record?.progressManager ?? ""}`
          .toLocaleLowerCase("ko-KR")
          .includes(keyword),
      )
      .sort((a, b) => {
        const firstRelevantDate = (items: ConstructionSchedule[]) => {
          const item = items.find((candidate) => (candidate.endDate || candidate.scheduledDate) >= start);
          if (!item) return "9999-12-31";
          return item.scheduledDate < start ? start : item.scheduledDate;
        };
        const left = firstRelevantDate(a.items);
        const right = firstRelevantDate(b.items);
        return left.localeCompare(right) || a.project.organization.localeCompare(b.project.organization, "ko-KR");
      });
  }, [hideCompleted, latestByScope, mobileStatusFilter, projects, query, schedulesByScope, start]);

  const mobileSummary = useMemo(() => {
    const visibleProjects = projects.filter((project) => !project.hidden);
    return {
      all: visibleProjects.length,
      active: visibleProjects.filter((project) => !project.completed).length,
      missingSchedule: visibleProjects.filter(
        (project) => !(schedulesByScope.get(scopeKey(project.organization, project.businessRound)) ?? []).length,
      ).length,
      completed: visibleProjects.filter((project) => project.completed).length,
      missingManager: visibleProjects.filter((project) => {
        const manager = latestByScope
          .get(scopeKey(project.organization, project.businessRound))
          ?.progressManager?.trim();
        return !manager || manager === "미정" || manager === "해당 없음";
      }).length,
    };
  }, [latestByScope, projects, schedulesByScope]);

  const addCandidates = useMemo(() => {
    const keyword = addQuery.trim().toLocaleLowerCase("ko-KR");
    const registered = new Set(
      projects
        .map((project) => scopeKey(project.organization, project.businessRound)),
    );
    return institutionOptions
      .filter((option) => !registered.has(scopeKey(option.organization, option.businessRound)))
      .filter((option) =>
        !keyword || `${option.organization} ${option.region}`.toLocaleLowerCase("ko-KR").includes(keyword),
      );
  }, [addQuery, institutionOptions, projects]);
  const addOptions = useMemo(
    () => addCandidates.slice(0, addVisibleCount),
    [addCandidates, addVisibleCount],
  );
  const hiddenProjects = useMemo(
    () => projects.filter((project) => project.hidden),
    [projects],
  );

  useEffect(() => {
    setAddVisibleCount(30);
  }, [addQuery]);

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
          workSummary: "",
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

  async function hideCandidate(record: ScheduleRecord) {
    if (!isPrimaryOwner || saving) return;
    if (!window.confirm(`${record.organization} ${record.businessRound}차 사업을 기관 추가 후보에서 숨기시겠습니까? 원본 수주·견적·일정·통계는 변경되지 않습니다.`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hide-construction-candidate",
          organization: record.organization,
          businessRound: record.businessRound,
        }),
      });
      const payload = (await response.json()) as {
        projects?: ConstructionProject[];
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "기관을 숨기지 못했습니다.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setMessage(`${record.organization} ${record.businessRound}차 사업을 기관 추가 후보에서 숨겼습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기관을 숨기지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function restoreHiddenProject(project: ConstructionProject) {
    if (!isPrimaryOwner || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: project.hiddenCandidate
            ? "restore-construction-candidate"
            : "restore-construction-project",
          organization: project.organization,
          businessRound: project.businessRound,
        }),
      });
      const payload = (await response.json()) as {
        projects?: ConstructionProject[];
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "기관을 다시 표시하지 못했습니다.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setMessage(
        project.hiddenCandidate
          ? `${project.organization} ${project.businessRound}차 사업을 기관 추가 후보에 다시 표시합니다.`
          : `${project.organization} ${project.businessRound}차 사업을 일정표에 다시 표시합니다.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기관을 다시 표시하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function openEditor(project: ConstructionProject, selectedDate = today) {
    const current = schedulesByScope.get(scopeKey(project.organization, project.businessRound)) ?? [];
    const toEditorItem = (schedule: ConstructionSchedule): EditorItem => ({
      id: schedule.id,
      key: `saved-${schedule.id}`,
      stage: schedule.stage || schedule.label,
      scheduledDate: schedule.scheduledDate,
      endDate: schedule.endDate || schedule.scheduledDate,
      startTime: schedule.startTime || "",
      endTime: schedule.endTime || "",
      vendorName: schedule.vendorName,
      details: schedule.details,
      active: true,
    });
    const items = current
      .map(toEditorItem)
      .sort((a, b) => constructionStageIndex(a.stage) - constructionStageIndex(b.stage));
    STAGES.forEach((stage) => {
      if (!items.some((item) => item.stage === stage)) {
        items.push({
          key: itemKey(),
          stage,
          scheduledDate: selectedDate,
          endDate: selectedDate,
          startTime: "",
          endTime: "",
          vendorName: "",
          details: "",
          active: false,
        });
      }
    });
    items.sort((a, b) =>
      constructionStageIndex(a.stage) - constructionStageIndex(b.stage)
      || a.scheduledDate.localeCompare(b.scheduledDate),
    );
    setEditor({
      organization: project.organization,
      businessRound: project.businessRound,
      workSummary: project.workSummary,
      workSummaryMode: project.workSummaryMode,
      sourceProductNames: project.sourceProductNames,
      selectedProductNames: project.workSummaryMode === "auto"
        ? project.sourceProductNames
        : project.sourceProductNames.filter((name) => project.workSummary.includes(name)),
      completed: project.completed,
      items,
      customStage: "",
    });
  }

  function updateEditorItem(key: string, patch: Partial<EditorItem>) {
    if (!editor) return;
    setEditor({
      ...editor,
      items: editor.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    });
  }

  function updateEditorStartTime(key: string, startTime: string) {
    updateEditorItem(key, {
      startTime,
      endTime: startTime ? oneHourLater(startTime) : "",
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
          startTime: "",
          endTime: "",
          vendorName: "",
          details: "",
          active: true,
        },
      ],
    });
  }

  function addCustomStage() {
    if (!editor) return;
    const stage = editor.customStage.trim().slice(0, 40);
    if (!stage) return;
    const existing = editor.items.find((item) => item.stage === stage);
    if (existing) {
      setEditor({
        ...editor,
        customStage: "",
        items: editor.items.map((item) => item.key === existing.key
          ? { ...item, active: true }
          : item),
      });
      return;
    }
    setEditor({
      ...editor,
      customStage: "",
      items: [...editor.items, {
        key: itemKey(),
        stage,
        scheduledDate: today,
        endDate: today,
        startTime: "",
        endTime: "",
        vendorName: "",
        details: "",
        active: true,
      }],
    });
  }

  function toggleEditorProduct(name: string) {
    if (!editor) return;
    const selectedProductNames = editor.selectedProductNames.includes(name)
      ? editor.selectedProductNames.filter((item) => item !== name)
      : [...editor.selectedProductNames, name];
    setEditor({
      ...editor,
      selectedProductNames,
      workSummary: summarizeProducts(selectedProductNames),
      workSummaryMode: "manual",
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
      if (activeItems.some((item) => item.endTime && !item.startTime)) {
        throw new Error("종료 시간을 사용하려면 시작 시간도 선택해 주세요.");
      }
      if (activeItems.some((item) => item.startTime && item.endTime && item.scheduledDate === item.endDate && item.endTime <= item.startTime)) {
        throw new Error("같은 날 일정의 종료 시간은 시작 시간보다 늦어야 합니다.");
      }
      const response = await fetch("/api/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-construction",
          organization: editor.organization,
          businessRound: editor.businessRound,
          workSummary: editor.workSummary,
          workSummaryMode: editor.workSummaryMode,
          completed: editor.completed,
          schedules: activeItems,
        }),
      });
      const payload = (await response.json()) as {
        project?: ConstructionProject;
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "일정을 저장하지 못했습니다.");
      const savedScope = scopeKey(editor.organization, editor.businessRound);
      if (payload.project) {
        setProjects((current) => [
          ...current.filter((project) => scopeKey(project.organization, project.businessRound) !== savedScope),
          payload.project as ConstructionProject,
        ]);
      }
      setSchedules((current) => [
        ...current.filter((schedule) => scopeKey(schedule.organization, schedule.businessRound) !== savedScope),
        ...(payload.schedules ?? []),
      ]);
      setEditor(null);
      setMessage("일정이 기관 상세와 HOME에 함께 반영되었습니다.");
      void Promise.resolve(onSchedulesChanged?.()).catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function removeProjectFromBoard(project: ConstructionProject) {
    if (saving) return;
    if (!window.confirm("이 기관을 시공·납품 일정표에서 숨기시겠습니까? 기관·수주·품목·기존 일정·통계는 유지되며 언제든 다시 표시할 수 있습니다.")) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hide-construction-project",
          organization: project.organization,
          businessRound: project.businessRound,
        }),
      });
      const payload = (await response.json()) as {
        projects?: ConstructionProject[];
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "일정표에서 기관을 숨기지 못했습니다.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setMessage("일정표에서 숨겼습니다. 기관·수주·품목·기존 일정·통계는 그대로 유지됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일정표에서 기관을 숨기지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function exportExcel() {
    const exportRows = rows.map(({ project, record, items }) => [
      record?.region || "지역 미등록",
      `${project.organization}\n${project.businessRound}차 사업`,
      displayWorkSummary(project) || "공사·품목 미등록",
      formatManagerName(record?.progressManager || ""),
      ...days.map((day) => items
        .filter((item) => item.scheduledDate <= day && (item.endDate || item.scheduledDate) >= day)
        .map((item) => `${item.stage || item.label}${item.vendorName ? ` (${item.vendorName})` : ""}`)
        .join(" / ")),
    ]);
    downloadConstructionTimelineXlsx({
      filename: `위즈업_시공납품일정_${start}.xlsx`,
      startDate: start,
      endDate: days.at(-1) ?? start,
      headers: ["지역", "기관명", "공사·품목", "담당자", ...dayMetas.map((day) => day.label)],
      rows: exportRows,
      widths: [14, 28, 30, 16, ...days.map(() => 15)],
      fixedColumnCount: 4,
      days: dayMetas,
      filterSummary: `${query.trim() ? `검색: ${query.trim()}` : "전체 기관"} · ${hideCompleted ? "완료 기관 제외" : "완료 기관 포함"}`,
    });
  }

  const updateRangeStart = (nextStart: string) => {
    const wasPastRange = start < today;
    const isPastRange = nextStart < today;
    setStart(nextStart);
    if (isPastRange) {
      setHideCompleted(false);
      setMobileStatusFilter("all");
    } else if (wasPastRange) {
      setHideCompleted(true);
    }
  };

  const shift = (amount: number) => updateRangeStart(addConstructionDays(start, amount));

  const dayClassName = (day: ConstructionDayMeta) => [
    day.isSaturday ? "saturday" : "",
    day.isSunday ? "sunday" : "",
    day.isHoliday ? "holiday" : "",
    day.isToday ? "today" : "",
    day.date < today ? "past" : "",
  ].filter(Boolean).join(" ");

  return (
    <section
      ref={workspaceRef}
      className={`construction-schedule-workspace${embedded ? " is-embedded" : ""}${expanded ? " is-expanded" : ""}${mobileExpanded ? " is-mobile-expanded" : ""}${timelineRange === 31 ? " is-month-range" : ""}`}
      style={{
        "--construction-day-count": timelineDayCount,
        "--construction-date-min-width": `${timelineDayCount * (compactTimeline ? 56 : 60)}px`,
      } as CSSProperties}
    >
      <header className="construction-schedule-header">
        <div>
          <span className="section-kicker">INSTALLATION · DELIVERY</span>
          <h2>시공·납품 일정표</h2>
          <p>기관을 등록하고 단계별 업체와 기간을 한 화면에서 관리합니다.</p>
        </div>
        <div className="construction-schedule-actions">
          <button type="button" className="primary-button" onClick={() => { setAddVisibleCount(30); setHiddenManagerOpen(false); setAddOpen(true); }}>+ 기관 추가</button>
          <button type="button" className="construction-desktop-action" onClick={exportExcel}>엑셀 내보내기</button>
          <button type="button" className="construction-expand-button construction-desktop-action" aria-pressed={expanded} onClick={() => void toggleExpanded()}>{expanded ? "기본 보기" : "크게 보기"}</button>
          <div className="construction-settings-wrap construction-desktop-action">
            <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((current) => !current)}>보기 설정</button>
            {settingsOpen ? <div className="construction-settings-popover">
              <label className="construction-completed-filter">
                <input type="checkbox" checked={hideCompleted} onChange={(event) => setHideCompleted(event.target.checked)} />
                완료 기관 제외
              </label>
              <fieldset className="construction-range-setting">
                <legend>표시 기간</legend>
                <label><input type="radio" name="construction-range" checked={timelineRange === 14} onChange={() => setTimelineRange(14)} /> 한 화면</label>
                <label><input type="radio" name="construction-range" checked={timelineRange === 31} onChange={() => setTimelineRange(31)} /> 31일 전체</label>
              </fieldset>
            </div> : null}
          </div>
          <button type="button" className="construction-mobile-expand-button" aria-pressed={expanded} onClick={() => void toggleExpanded()}>{expanded ? "기본 보기" : "크게 보기"}</button>
        </div>
      </header>
      {expanded && orientationHint ? <div className="construction-orientation-hint" role="status">휴대폰을 가로로 돌리면 PC형 일정표를 더 넓게 볼 수 있습니다.</div> : null}

      <div className="construction-mobile-summary" aria-label="시공 납품 현황 필터">
        {([
          ["all", "전체", mobileSummary.all],
          ["active", "진행", mobileSummary.active],
          ["missingSchedule", "일정 미정", mobileSummary.missingSchedule],
          ["missingManager", "담당 미정", mobileSummary.missingManager],
          ["completed", "완료", mobileSummary.completed],
        ] as const).map(([key, label, count]) => (
          <button
            type="button"
            className={mobileStatusFilter === key ? "active" : ""}
            aria-pressed={mobileStatusFilter === key}
            key={key}
            onClick={() => {
              setMobileStatusFilter(key);
              setHideCompleted(key !== "completed");
            }}
          >
            <span>{label}</span><b>{count}</b>
          </button>
        ))}
      </div>

      <div className="construction-schedule-toolbar">
        <div className="construction-schedule-controls">
          <button type="button" onClick={() => shift(-7)}>이전</button>
          <button type="button" onClick={() => updateRangeStart(today)}>오늘부터</button>
          <button type="button" onClick={() => shift(7)}>다음</button>
          <label>시작일<input type="date" value={start} onChange={(event) => updateRangeStart(event.target.value)} /></label>
        </div>
        <div className="construction-schedule-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기관명·지역·담당자·공사 내용 검색" />
          <span>{rows.length.toLocaleString()}개 기관</span>
        </div>
      </div>

      {message ? <div className="quotation-workspace-message">{message}</div> : null}

      <div className="construction-timeline">
        <div className="construction-timeline-head">
          <div className="construction-fixed-head"><span>기관명·지역</span><span>공사·품목</span><span>담당자</span></div>
          <div className="construction-days">
            {dayMetas.map((day) => (
              <span className={dayClassName(day)} key={day.date} title={day.holidayName || undefined}>
                <b className="construction-day-label">{day.label}</b>
                {day.holidayName ? <small className="construction-holiday-name">{day.holidayName}</small> : null}
                {day.isToday ? <i className="construction-today-badge">오늘</i> : null}
              </span>
            ))}
          </div>
        </div>
        {loading ? <div className="empty-state">일정표를 불러오는 중입니다.</div> : null}
        {!loading && rows.map(({ project, record, items }) => (
          <article className="construction-timeline-row" key={scopeKey(project.organization, project.businessRound)}>
            <div className="construction-fixed-cells">
              <span className="construction-institution-cell">
                <button type="button" className="construction-institution-main" onClick={() => onOpenOrganization(project.organization, project.businessRound)}><strong>{project.organization}</strong><small>{record?.region || "지역 미등록"} · {project.businessRound}차 사업</small><small className="construction-mobile-row-meta">{formatManagerName(record?.progressManager || "")} · {displayWorkSummary(project) || "공사·품목 미등록"}</small></button>
                {isPrimaryOwner ? <button type="button" className="construction-row-remove" aria-label={`${project.organization} 일정표에서 숨김`} title="일정표에서 숨김" disabled={saving} onClick={() => void removeProjectFromBoard(project)}>−</button> : null}
              </span>
              <button
                type="button"
                className="construction-work-summary"
                title={project.sourceProductNames.length ? project.sourceProductNames.join(" · ") : project.workSummary}
                onClick={() => openEditor(project)}
              >
                {displayWorkSummary(project) || "공사·품목 미등록"}
              </button>
              <span>{formatManagerName(record?.progressManager || "")}</span>
            </div>
            <div className="construction-days construction-row-days">
              {days.map((day) => {
                const dayItems = items.filter((item) => item.scheduledDate <= day && (item.endDate || item.scheduledDate) >= day);
                return (
                  <span className={dayClassName(dayMetaByDate.get(day) as ConstructionDayMeta)} key={day} onClick={() => openEditor(project, day)}>
                    {dayItems.map((item) => (
                      <button
                        type="button"
                        className={`construction-event stage-${constructionStageTone(item.stage || item.label)}`}
                        key={item.id}
                        title={`${item.stage || item.label} · ${item.vendorName || "업체 미정"} · ${item.scheduledDate}~${item.endDate || item.scheduledDate}${item.startTime ? ` · ${item.startTime}${item.endTime ? `~${item.endTime}` : ""}` : " · 종일"}`}
                        aria-label={`${item.stage || item.label}, ${item.vendorName || "업체 미정"}, ${item.scheduledDate}부터 ${item.endDate || item.scheduledDate}까지`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditor(project, day);
                        }}
                      >
                        <span>{item.stage || item.label}</span>
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
            <header><button type="button" onClick={() => onOpenOrganization(project.organization, project.businessRound)}>{project.organization}</button><span>{formatManagerName(record?.progressManager || "")}</span>{isPrimaryOwner ? <button type="button" className="construction-row-remove" aria-label={`${project.organization} 일정표에서 숨김`} title="일정표에서 숨김" disabled={saving} onClick={() => void removeProjectFromBoard(project)}>−</button> : null}</header>
            <p>{record?.region || "지역 미등록"} · {displayWorkSummary(project) || "공사·품목 미등록"}</p>
            <div>{items.map((item) => {
              const day = dayMetaByDate.get(item.scheduledDate);
              return <button type="button" className={day ? dayClassName(day) : ""} key={item.id} onClick={() => openEditor(project, item.scheduledDate)}><b>{item.scheduledDate.slice(5).replace("-", "/")}</b>{item.stage || item.label}{item.startTime ? <small>{item.startTime}{item.endTime ? `~${item.endTime}` : ""}</small> : null}{day?.holidayName ? <small>{day.holidayName}</small> : null}</button>;
            })}</div>
            <button className="construction-mobile-edit" type="button" onClick={() => openEditor(project)}>일정 관리</button>
          </article>
        ))}
      </div>

      {addOpen ? (
        <div className="schedule-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAddOpen(false); }}>
          <div className="construction-add-dialog" role="dialog" aria-modal="true">
            <header><div><span className="section-kicker">ADD INSTITUTION</span><h3>시공 일정표에 기관 추가</h3><p>위즈업 수주로 전환된 기관만 검색되며 기관 상세페이지와 그대로 연결됩니다.</p></div><button type="button" onClick={() => setAddOpen(false)}>×</button></header>
            <input autoFocus value={addQuery} onChange={(event) => setAddQuery(event.target.value)} placeholder="위즈업 수주 기관명 또는 지역 검색" />
            <div className="construction-add-summary">
              <span>전체 후보 {addCandidates.length.toLocaleString()}곳 · 현재 {addOptions.length.toLocaleString()}곳 표시</span>
              {isPrimaryOwner && (
                <button type="button" onClick={() => setHiddenManagerOpen((current) => !current)}>
                  숨긴 기관 관리 {hiddenProjects.length.toLocaleString()}곳
                </button>
              )}
            </div>
            {isPrimaryOwner && hiddenManagerOpen && (
              <div className="construction-hidden-manager">
                {hiddenProjects.map((project) => (
                  <div key={scopeKey(project.organization, project.businessRound)}>
                    <span><strong>{project.organization}</strong><small>{project.businessRound}차 사업 · {project.hiddenCandidate ? "기관 추가 후보" : "일정표 기관"}</small></span>
                    <button type="button" disabled={saving} onClick={() => void restoreHiddenProject(project)}>다시 표시</button>
                  </div>
                ))}
                {!hiddenProjects.length && <p>숨긴 기관이 없습니다.</p>}
              </div>
            )}
            <div className="construction-add-results">
              {addOptions.map((option) => (
                <div className="construction-add-result" key={scopeKey(option.organization, option.businessRound)}>
                  <button type="button" disabled={saving} onClick={() => void addProject(option)}>
                    <span><strong>{option.organization}</strong><small>{option.region || "지역 미등록"} · {option.businessRound}차 사업</small></span><b>추가</b>
                  </button>
                  {isPrimaryOwner && (
                    <button type="button" className="construction-candidate-hide" disabled={saving} onClick={() => void hideCandidate(option)}>숨김</button>
                  )}
                </div>
              ))}
              {!addOptions.length ? <p>추가할 수 있는 기관이 없습니다.</p> : null}
              {addOptions.length < addCandidates.length && (
                <button type="button" className="construction-add-more" onClick={() => setAddVisibleCount((current) => current + 30)}>
                  30곳 더 보기 ({(addCandidates.length - addOptions.length).toLocaleString()}곳 남음)
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editor ? (
        <div className="schedule-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditor(null); }}>
          <div className="schedule-editor construction-stage-editor" role="dialog" aria-modal="true">
            <header><div><span className="section-kicker">CONSTRUCTION SCHEDULE</span><h3>{editor.organization}</h3><p>체크한 공정만 저장됩니다. 목록에 없는 공정은 직접 추가할 수 있습니다.</p></div><button type="button" onClick={() => setEditor(null)}>×</button></header>
            <div className="construction-editor-summary">
              <label>공사·품목<input value={editor.workSummary} onChange={(event) => setEditor({ ...editor, workSummary: event.target.value, workSummaryMode: "manual" })} placeholder="예: 스크린·시스템 설치" /></label>
              <label className="construction-project-complete"><input type="checkbox" checked={editor.completed} onChange={(event) => setEditor({ ...editor, completed: event.target.checked })} />기관 일정 완료</label>
            </div>
            {editor.sourceProductNames.length ? (
              <div className="construction-product-picker">
                <div>
                  <strong>상세페이지 등록 품목</strong>
                  <button
                    type="button"
                    onClick={() => setEditor({
                      ...editor,
                      selectedProductNames: editor.sourceProductNames,
                      workSummary: summarizeProducts(editor.sourceProductNames),
                      workSummaryMode: "auto",
                    })}
                  >상세 품목 다시 불러오기</button>
                </div>
                <p>일정표에 표시할 주요 품목만 선택할 수 있습니다. 원본 품목·금액·수수료 정보는 변경되지 않습니다.</p>
                <div>
                  {editor.sourceProductNames.map((name) => (
                    <label key={name}>
                      <input
                        type="checkbox"
                        checked={editor.selectedProductNames.includes(name)}
                        onChange={() => toggleEditorProduct(name)}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="construction-products-empty">상세페이지에 등록된 품목이 없어 공사·품목을 직접 입력해 주세요.</p>
            )}
            <div className="construction-custom-stage">
              <input
                value={editor.customStage}
                maxLength={40}
                onChange={(event) => setEditor({ ...editor, customStage: event.target.value })}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomStage(); } }}
                placeholder="목록에 없는 공정명 직접 입력"
              />
              <button type="button" onClick={addCustomStage}>+ 공정 추가</button>
            </div>
            <div className="construction-stage-table">
              <div className="construction-stage-head"><span>사용</span><span>단계</span><span>시공 업체</span><span>메모</span><span>시작일</span><span>종료일</span><span>시작 시간</span><span>종료 시간</span><span>추가</span></div>
              {editor.items.map((item, index) => (
                <div className={`construction-stage-row${item.active ? " active" : ""}`} key={item.key}>
                  <input aria-label={`${item.stage} 사용`} type="checkbox" checked={item.active} onChange={(event) => updateEditorItem(item.key, { active: event.target.checked })} />
                  <strong>{item.stage}{editor.items.slice(0, index).some((previous) => previous.stage === item.stage) ? " · 추가" : ""}</strong>
                  <input value={item.vendorName} disabled={!item.active} onChange={(event) => updateEditorItem(item.key, { vendorName: event.target.value })} placeholder="업체명" />
                  <input value={item.details} maxLength={500} disabled={!item.active} onChange={(event) => updateEditorItem(item.key, { details: event.target.value })} placeholder="선택 입력" />
                  <input type="date" value={item.scheduledDate} disabled={!item.active} onChange={(event) => updateEditorItem(item.key, { scheduledDate: event.target.value, endDate: item.endDate < event.target.value ? event.target.value : item.endDate })} />
                  <input type="date" value={item.endDate} disabled={!item.active} onChange={(event) => updateEditorItem(item.key, { endDate: event.target.value })} />
                  <select
                    aria-label={`${item.stage} 시작 시간`}
                    value={item.startTime}
                    disabled={!item.active}
                    onInput={(event) => updateEditorStartTime(item.key, event.currentTarget.value)}
                    onChange={(event) => updateEditorStartTime(item.key, event.currentTarget.value)}
                  >
                    <option value="">종일</option>
                    {TIME_OPTIONS.map((time) => <option value={time} key={time}>{time}</option>)}
                  </select>
                  <select aria-label={`${item.stage} 종료 시간`} value={item.endTime} disabled={!item.active || !item.startTime} onChange={(event) => updateEditorItem(item.key, { endTime: event.target.value })}>
                    <option value="">자동(+1시간)</option>
                    {TIME_OPTIONS.map((time) => <option value={time} key={time}>{time}</option>)}
                  </select>
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
