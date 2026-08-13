"use client";

import { useEffect, useMemo, useState } from "react";
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
  if (unique.length <= 5) return unique.join(" Â· ");
  return `${unique.slice(0, 5).join(" Â· ")} ì™¸ ${unique.length - 5}ì¢…`;
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
  formatManagerName = (name) => name || "ë¯¸ì •",
}: {
  records: ScheduleRecord[];
  onOpenOrganization: (organization: string, businessRound: number) => void;
  embedded?: boolean;
  isPrimaryOwner?: boolean;
  onDashboardCounts?: (counts: { planned: number; active: number; completed: number }) => void;
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
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [mobileStatusFilter, setMobileStatusFilter] = useState<
    "all" | "active" | "missingSchedule" | "completed" | "missingManager"
  >("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const dayMetas = useMemo(
    () => getConstructionTimelineDays(start, 31, today),
    [start, today],
  );
  const days = useMemo(() => dayMetas.map((day) => day.date), [dayMetas]);
  const dayMetaByDate = useMemo(
    () => new Map(dayMetas.map((day) => [day.date, day])),
    [dayMetas],
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
        .filter((record) => record.awardStatus === "ìœ„ì¦ˆì—… ìˆ˜ì£¼")
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
      if (!response.ok) throw new Error(payload.error || "ì¼ì •í‘œë¥¼ ë¶ˆëŸ¬ì˜¤ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setLoadSucceeded(true);
      setMessage("");
    } catch (error) {
      setLoadSucceeded(false);
      setMessage(error instanceof Error ? error.message : "ì¼ì •í‘œë¥¼ ë¶ˆëŸ¬ì˜¤ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.");
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
      if (event.key === "Escape") setExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

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
          return !manager || manager === "ë¯¸ì •" || manager === "í•´ë‹¹ ì—†ìŒ";
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
        return !manager || manager === "ë¯¸ì •" || manager === "í•´ë‹¹ ì—†ìŒ";
      }).length,
    };
  }, [latestByScope, projects, schedulesByScope]);

  const addOptions = useMemo(() => {
    const keyword = addQuery.trim().toLocaleLowerCase("ko-KR");
    const registered = new Set(
      projects
        .filter((project) => !project.hidden)
        .map((project) => scopeKey(project.organization, project.businessRound)),
    );
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
          workSummary: "",
        }),
      });
      const payload = (await response.json()) as {
        projects?: ConstructionProject[];
        schedules?: ConstructionSchedule[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "ê¸°ê´€ì„ ì¶”ê°€í•˜ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.");
      setProjects(payload.projects ?? []);
      setSchedules(payload.schedules ?? []);
      setAddOpen(false);
      setAddQuery("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ê¸°ê´€ì„ ì¶”ê°€í•˜ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.");
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
    Ûİµ¶‰Ëkºwµçd¹…Ñ¥Ù•t°(€€€€€€€€€l‰µ¥ÍÍ¥¹M¡•‘Õ±”ˆ°€‹²vó²‚Tƒ®¾ã²‚Tˆ°µ½‰¥±•MÕµµ…Éä¹µ¥ÍÍ¥¹M¡•‘Õ±•t°(€€€€€€€€€l‰µ¥ÍÍ¥¹5…¹…•Èˆ°€‹®.Ó®.äƒ®¾ã²‚Tˆ°µ½‰¥±•MÕµµ…Éä¹µ¥ÍÍ¥¹5…¹…•Ét°(€€€€€€€€€l‰½µÁ±•Ñ•ˆ°€‹²f®0ˆ°µ½‰¥±•MÕµµ…Éä¹½µÁ±•Ñ•‘t°(€€€€€€€t…Ì½¹ÍĞ¤¹µ…À ¡m­•ä°±…‰•°°½Õ¹Ñt¤€ôø€ (€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€±…ÍÍ9…µ”õíµ½‰¥±•MÑ…ÑÕÍ¥±Ñ•È€ôôô­•ä€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô(€€€€€€€€€€€…É¥„µÁÉ•ÍÍ•õíµ½‰¥±•MÑ…ÑÕÍ¥±Ñ•È€ôôô­•åô(€€€€€€€€€€€­•äõí­•åô(€€€€€€€€€€€½¹±¥¬õì ¤€ôøì(€€€€€€€€€€€€€Í•Ñ5½‰¥±•MÑ…ÑÕÍ¥±Ñ•È¡­•ä¤ì(€€€€€€€€€€€€€¥˜€¡­•ä€ôôô€‰½µÁ±•Ñ•ˆ¤Í•Ñ!¥‘•½µÁ±•Ñ•¡™…±Í”¤ì(€€€€€€€€€€€õô(€€€€€€€€€€ø(€€€€€€€€€€€€ñÍÁ…¸ùí±…‰•±ôğ½ÍÁ…¸øñˆùí½Õ¹Ñôğ½ˆø(€€€€€€€€€€ğ½‰ÕÑÑ½¸ø(€€€€€€€€¤¥ô(€€€€€€ğ½‘¥Øø(4(€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÍ¡•‘Õ±”µÑ½½±‰…Èˆø4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÍ¡•‘Õ±”µ½¹ÑÉ½±Ìˆø4(€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ¡¥™Ğ ´ÌÄ¥ôû²vÓ²‚ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ•ÑMÑ…ÉĞ¡Ñ½‘…ä¥ôû²b“®*c®Ú¶Àğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ¡¥™Ğ ÌÄ¥ôû®.“²v0ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€ñ±…‰•°û².s²zG²vğñ¥¹ÁÕĞÑåÁ”ô‰‘…Ñ”ˆÙ…±Õ”õíÍÑ…ÉÑô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•ÑMÑ…ÉĞ¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¥ô€¼øğ½±…‰•°ø4(€€€€€€€€ğ½‘¥Øø4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÍ¡•‘Õ±”µÍ•…É ˆø4(€€€€€€€€€€ñ¥¹ÁÕĞÙ…±Õ”õíÅÕ•Éåô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•ÑEÕ•Éä¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¥ôÁ±…•¡½±‘•Èô‹ªâÃªÒ®ª
ß²²^·
ß®.Ó®.ç²zC
ßªÎ×²
°ƒ®
Ó²j¤ƒªÊ²$ˆ€¼ø4(€€€€€€€€€€ñÍÁ…¸ùíÉ½İÌ¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¥÷ªÂpƒªâÃªÒ ğ½ÍÁ…¸ø4(€€€€€€€€ğ½‘¥Øø4(€€€€€€ğ½‘¥Øø4(4(€€€€€íµ•ÍÍ…”€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÅÕ½Ñ…Ñ¥½¸µİ½É­ÍÁ…”µµ•ÍÍ…”ˆùíµ•ÍÍ…•ôğ½‘¥Øø€è¹Õ±±ô4(4(€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÑ¥µ•±¥¹”ˆø4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÑ¥µ•±¥¹”µ¡•…ˆø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ™¥á•µ¡•…ˆøñÍÁ…¸û²²^´ğ½ÍÁ…¸øñÍÁ…¸ûªâÃªÒ®ªğ½ÍÁ…¸øñÍÁ…¸ûªÎ×²
³
ß¶J#®ª¤ğ½ÍÁ…¸øñÍÁ…¸û®.Ó®.ç²z@ğ½ÍÁ…¸øğ½‘¥Øø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ‘…åÌˆø4(€€€€€€€€€€€í‘…å5•Ñ…Ì¹µ…À ¡‘…ä¤€ôø€ 4(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õí‘…å±…ÍÍ9…µ”¡‘…ä¥ô­•äõí‘…ä¹‘…Ñ•ôÑ¥Ñ±”õí‘…ä¹¡½±¥‘…å9…µ”ñğÕ¹‘•™¥¹•‘ôø4(€€€€€€€€€€€€€€€€ñˆ±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ‘…äµ±…‰•°ˆùí‘…ä¹±…‰•±ôğ½ˆø4(€€€€€€€€€€€€€€€í‘…ä¹¡½±¥‘…å9…µ”€ü€ñÍµ…±°±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ¡½±¥‘…äµ¹…µ”ˆùí‘…ä¹¡½±¥‘…å9…µ•ôğ½Íµ…±°ø€è¹Õ±±ô4(€€€€€€€€€€€€€€€í‘…ä¹¥ÍQ½‘…ä€ü€ñ¤±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÑ½‘…äµ‰…‘”ˆû²b“®*`ğ½¤ø€è¹Õ±±ô4(€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€¤¥ô4(€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€ğ½‘¥Øø4(€€€€€€€í±½…‘¥¹œ€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäµÍÑ…Ñ”ˆû²vó²‚W¶Fs®–ğƒ®Ú#®~³²b“®*Pƒ²’G²z®.#®.¸ğ½‘¥Øø€è¹Õ±±ô4(€€€€€€€ì…±½…‘¥¹œ€˜˜É½İÌ¹µ…À ¡ìÁÉ½©•Ğ°É•½É°¥Ñ•µÌô¤€ôø€ 4(€€€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÑ¥µ•±¥¹”µÉ½Üˆ­•äõíÍ½Á•-•ä¡ÁÉ½©•Ğ¹½É…¹¥é…Ñ¥½¸°ÁÉ½©•Ğ¹‰ÕÍ¥¹•ÍÍI½Õ¹¥ôø4(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ™¥á•µ•±±Ìˆø4(€€€€€€€€€€€€€€ñÍÁ…¸ùíÉ•½Éü¹É•¥½¸ñğ€‹²²^´ƒ®¾ã®NÇ®†t‰ôğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ¥¹ÍÑ¥ÑÕÑ¥½¸µ•±°ˆø4(€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ¥¹ÍÑ¥ÑÕÑ¥½¸µµ…¥¸ˆ½¹±¥¬õì ¤€ôø½¹=Á•¹=É…¹¥é…Ñ¥½¸¡ÁÉ½©•Ğ¹½É…¹¥é…Ñ¥½¸°ÁÉ½©•Ğ¹‰ÕÍ¥¹•ÍÍI½Õ¹¥ôøñÍÑÉ½¹œùíÁÉ½©•Ğ¹½É…¹¥é…Ñ¥½¹ôğ½ÍÑÉ½¹œøñÍµ…±°ùíÁÉ½©•Ğ¹‰ÕÍ¥¹•ÍÍI½Õ¹‘÷²Â ƒ²
³²^ğ½Íµ…±°øğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€€€€í¥ÍAÉ¥µ…Éå=İ¹•È€ü€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÉ½ÜµÉ•µ½Ù”ˆ…É¥„µ±…‰•°õí€‘íÁÉ½©•Ğ¹½É…¹¥é…Ñ¥½¹ôƒ²vó²‚W¶Fpƒ®ª§®†w²^C²pƒ²
·²‚qôÑ¥Ñ±”ô‹²vó²‚W¶Fpƒ®ª§®†w²^C²pƒ²
·²‚pˆ‘¥Í…‰±•õíÍ…Ù¥¹ô½¹±¥¬õì ¤€ôøÙ½¥É•µ½Ù•AÉ½©•ÑÉ½µ	½…É¡ÁÉ½©•Ğ¥ôûŠ"Hğ½‰ÕÑÑ½¸ø€è¹Õ±±ô(€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸4(€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ4(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µİ½É¬µÍÕµµ…Éäˆ4(€€€€€€€€€€€€€€€Ñ¥Ñ±”õíÁÉ½©•Ğ¹Í½ÕÉ•AÉ½‘ÕÑ9…µ•Ì¹±•¹Ñ €üÁÉ½©•Ğ¹Í½ÕÉ•AÉ½‘ÕÑ9…µ•Ì¹©½¥¸ ˆƒ
Ü€ˆ¤€èÁÉ½©•Ğ¹İ½É­MÕµµ…Éåô4(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôø½Á•¹‘¥Ñ½È¡ÁÉ½©•Ğ¥ô4(€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€í‘¥ÍÁ±…å]½É­MÕµµ…Éä¡ÁÉ½©•Ğ¤ñğ€‹ªÎ×²
³
ß¶J#®ª¤ƒ®¾ã®NÇ®†t‰ô4(€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€€€ñÍÁ…¸ùí™½Éµ…Ñ5…¹…•É9…µ”¡É•½Éü¹ÁÉ½É•ÍÍ5…¹…•Èñğ€ˆˆ¥ôğ½ÍÁ…¸ø4(€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ‘…åÌ½¹ÍÑÉÕÑ¥½¸µÉ½Üµ‘…åÌˆø4(€€€€€€€€€€€€€í‘…åÌ¹µ…À ¡‘…ä¤€ôøì4(€€€€€€€€€€€€€€€½¹ÍĞ‘…å%Ñ•µÌ€ô¥Ñ•µÌ¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹Í¡•‘Õ±•‘…Ñ”€ğô‘…ä€˜˜€¡¥Ñ•´¹•¹‘…Ñ”ñğ¥Ñ•´¹Í¡•‘Õ±•‘…Ñ”¤€øô‘…ä¤ì4(€€€€€€€€€€€€€€€É•ÑÕÉ¸€ 4(€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õí‘…å±…ÍÍ9…µ”¡‘…å5•Ñ…	å…Ñ”¹•Ğ¡‘…ä¤…Ì½¹ÍÑÉÕÑ¥½¹…å5•Ñ„¥ô­•äõí‘…åô½¹±¥¬õì ¤€ôø½Á•¹‘¥Ñ½È¡ÁÉ½©•Ğ°‘…ä¥ôø4(€€€€€€€€€€€€€€€€€€€í‘…å%Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôø€ 4(€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸4(€€€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ4(€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí½¹ÍÑÉÕÑ¥½¸µ•Ù•¹ĞÍÑ…”´‘í½¹ÍÑÉÕÑ¥½¹MÑ…•Q½¹”¡¥Ñ•´¹ÍÑ…”ñğ¥Ñ•´¹±…‰•°¥õô4(€€€€€€€€€€€€€€€€€€€€€€€­•äõí¥Ñ•´¹¥‘ô4(€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”õí€‘í¥Ñ•´¹ÍÑ…”ñğ¥Ñ•´¹±…‰•±ôƒ
Ü€‘í¥Ñ•´¹Ù•¹‘½É9…µ”ñğ€‹²^²ÊĞƒ®¾ã²‚T‰ôƒ
Ü€‘í¥Ñ•´¹Í¡•‘Õ±•‘…Ñ•õø‘í¥Ñ•´¹•¹‘…Ñ”ñğ¥Ñ•´¹Í¡•‘Õ±•‘…Ñ•ô‘í¥Ñ•´¹ÍÑ…ÉÑQ¥µ”€ü€ƒ
Ü€‘í¥Ñ•´¹ÍÑ…ÉÑQ¥µ•ô‘í¥Ñ•´¹•¹‘Q¥µ”€üø‘í¥Ñ•´¹•¹‘Q¥µ•õ€€è€ˆ‰õ€€è€ˆƒ
Üƒ²Š²vğ‰õô4(€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°õí€‘í¥Ñ•´¹ÍÑ…”ñğ¥Ñ•´¹±…‰•±ô°€‘í¥Ñ•´¹Ù•¹‘½É9…µ”ñğ€‹²^²ÊĞƒ®¾ã²‚T‰ô°€‘í¥Ñ•´¹Í¡•‘Õ±•‘…Ñ•÷®Ú¶À€‘í¥Ñ•´¹•¹‘…Ñ”ñğ¥Ñ•´¹Í¡•‘Õ±•‘…Ñ•÷ªæ3²ô4(€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡•Ù•¹Ğ¤€ôøì4(€€€€€€€€€€€€€€€€€€€€€€€€€•Ù•¹Ğ¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€½Á•¹‘¥Ñ½È¡ÁÉ½©•Ğ°‘…ä¤ì4(€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ùí¥Ñ•´¹ÍÑ…”ñğ¥Ñ•´¹±…‰•±ôğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€€€€€€€€€¤¥ô4(€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€ô¥ô4(€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€ğ½…ÉÑ¥±”ø4(€€€€€€€€¤¥ô4(€€€€€€€ì…±½…‘¥¹œ€˜˜€…É½İÌ¹±•¹Ñ €ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäµÍÑ…Ñ”ˆû¶Fs².s¶V€ƒªâÃªÒ²vĞƒ²^²*×®.#®.¸ƒŠcªâÃªÒ ƒ²ÚSªÂŠg²^C²pƒ®¢ó²‚ ƒ®NÇ®†w¶VĞƒ²ó²ã²jP¸ğ½‘¥Øø€è¹Õ±±ô4(€€€€€€ğ½‘¥Øø4(4(€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µµ½‰¥±”µ±¥ÍĞˆø4(€€€€€€€íÉ½İÌ¹µ…À ¡ìÁÉ½©•Ğ°É•½É°¥Ñ•µÌô¤€ôø€ 4(€€€€€€€€€€ñ…ÉÑ¥±”­•äõíÍ½Á•-•ä¡ÁÉ½©•Ğ¹½É…¹¥é…Ñ¥½¸°ÁÉ½©•Ğ¹‰ÕÍ¥¹•ÍÍI½Õ¹¥ôø4(€€€€€€€€€€€€ñ¡•…‘•Èøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôø½¹=Á•¹=É…¹¥é…Ñ¥½¸¡ÁÉ½©•Ğ¹½É…¹¥é…Ñ¥½¸°ÁÉ½©•Ğ¹‰ÕÍ¥¹•ÍÍI½Õ¹¥ôùíÁÉ½©•Ğ¹½É…¹¥é…Ñ¥½¹ôğ½‰ÕÑÑ½¸øñÍÁ…¸ùí™½Éµ…Ñ5…¹…•É9…µ”¡É•½Éü¹ÁÉ½É•ÍÍ5…¹…•Èñğ€ˆˆ¥ôğ½ÍÁ…¸ùí¥ÍAÉ¥µ…Éå=İ¹•È€ü€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÉ½ÜµÉ•µ½Ù”ˆ…É¥„µ±…‰•°õí€‘íÁÉ½©•Ğ¹½É…¹¥é…Ñ¥½¹ôƒ²vó²‚W¶Fpƒ®ª§®†w²^C²pƒ²
·²‚qôÑ¥Ñ±”ô‹²vó²‚W¶Fpƒ®ª§®†w²^C²pƒ²
·²‚pˆ‘¥Í…‰±•õíÍ…Ù¥¹ô½¹±¥¬õì ¤€ôøÙ½¥É•µ½Ù•AÉ½©•ÑÉ½µ	½…É¡ÁÉ½©•Ğ¥ôûŠ"Hğ½‰ÕÑÑ½¸ø€è¹Õ±±ôğ½¡•…‘•Èø(€€€€€€€€€€€€ñÀùíÉ•½Éü¹É•¥½¸ñğ€‹²²^´ƒ®¾ã®NÇ®†t‰ôƒ
Üí‘¥ÍÁ±…å]½É­MÕµµ…Éä¡ÁÉ½©•Ğ¤ñğ€‹ªÎ×²
³
ß¶J#®ª¤ƒ®¾ã®NÇ®†t‰ôğ½Àø4(€€€€€€€€€€€€ñ‘¥Øùí¥Ñ•µÌ¹µ…À ¡¥Ñ•´¤€ôøì4(€€€€€€€€€€€€€½¹ÍĞ‘…ä€ô‘…å5•Ñ…	å…Ñ”¹•Ğ¡¥Ñ•´¹Í¡•‘Õ±•‘…Ñ”¤ì4(€€€€€€€€€€€€€É•ÑÕÉ¸€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”õí‘…ä€ü‘…å±…ÍÍ9…µ”¡‘…ä¤€è€ˆ‰ô­•äõí¥Ñ•´¹¥‘ô½¹±¥¬õì ¤€ôø½Á•¹‘¥Ñ½È¡ÁÉ½©•Ğ°¥Ñ•´¹Í¡•‘Õ±•‘…Ñ”¥ôøñˆùí¥Ñ•´¹Í¡•‘Õ±•‘…Ñ”¹Í±¥” Ô¤¹É•Á±…” ˆ´ˆ°€ˆ¼ˆ¥ôğ½ˆùí¥Ñ•´¹ÍÑ…”ñğ¥Ñ•´¹±…‰•±õí¥Ñ•´¹ÍÑ…ÉÑQ¥µ”€ü€ñÍµ…±°ùí¥Ñ•´¹ÍÑ…ÉÑQ¥µ•õí¥Ñ•´¹•¹‘Q¥µ”€üø‘í¥Ñ•´¹•¹‘Q¥µ•õ€€è€ˆ‰ôğ½Íµ…±°ø€è¹Õ±±õí‘…äü¹¡½±¥‘…å9…µ”€ü€ñÍµ…±°ùí‘…ä¹¡½±¥‘…å9…µ•ôğ½Íµ…±°ø€è¹Õ±±ôğ½‰ÕÑÑ½¸øì4(€€€€€€€€€€€ô¥ôğ½‘¥Øø4(€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µµ½‰¥±”µ•‘¥ĞˆÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôø½Á•¹‘¥Ñ½È¡ÁÉ½©•Ğ¥ôû²vó²‚TƒªÒ®š°ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€ğ½…ÉÑ¥±”ø4(€€€€€€€€¤¥ô4(€€€€€€ğ½‘¥Øø4(4(€€€€€í…‘‘=Á•¸€ü€ 4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µ•‘¥Ñ½ÈµÍ¡•±°ˆÉ½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆ½¹5½ÕÍ•½İ¸õì¡•Ù•¹Ğ¤€ôøì¥˜€¡•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ€ôôô•Ù•¹Ğ¹Ñ…É•Ğ¤Í•Ñ‘‘=Á•¸¡™…±Í”¤ìõôø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ…‘µ‘¥…±½œˆÉ½±”ô‰‘¥…±½œˆ…É¥„µµ½‘…°ô‰ÑÉÕ”ˆø4(€€€€€€€€€€€€ñ¡•…‘•Èøñ‘¥ØøñÍÁ…¸±…ÍÍ9…µ”ô‰Í•Ñ¥½¸µ­¥­•Èˆù%9MQ%QUQ%=8ğ½ÍÁ…¸øñ Ìû².sªÎÔƒ²vó²‚W¶Fs²^@ƒªâÃªÒ ƒ²ÚSªÂ ğ½ ÌøñÀû²r²š#²^ƒ²"c²ó®†pƒ²‚¶fc®BpƒªâÃªÒ®0ƒªÊ²'®Bc®¦ÀƒªâÃªÒ ƒ²²ã¶:c²vÓ²²f ƒªŞã®2®†pƒ²^ÃªÊÃ®B§®.#®.¸ğ½Àøğ½‘¥Øøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ•Ñ‘‘=Á•¸¡™…±Í”¥ôû\ğ½‰ÕÑÑ½¸øğ½¡•…‘•Èø4(€€€€€€€€€€€€ñ¥¹ÁÕĞ…ÕÑ½½ÕÌÙ…±Õ”õí…‘‘EÕ•Éåô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘‘EÕ•Éä¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¥ôÁ±…•¡½±‘•Èô‹²r²š#²^ƒ²"c²ğƒªâÃªÒ®ªƒ®bC®*Pƒ²²^´ƒªÊ²$ˆ€¼ø4(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ…‘µÉ•ÍÕ±ÑÌˆø4(€€€€€€€€€€€€€í…‘‘=ÁÑ¥½¹Ì¹µ…À ¡½ÁÑ¥½¸¤€ôø€ 4(€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ­•äõíÍ½Á•-•ä¡½ÁÑ¥½¸¹½É…¹¥é…Ñ¥½¸°½ÁÑ¥½¸¹‰ÕÍ¥¹•ÍÍI½Õ¹¥ô‘¥Í…‰±•õíÍ…Ù¥¹ô½¹±¥¬õì ¤€ôøÙ½¥…‘‘AÉ½©•Ğ¡½ÁÑ¥½¸¥ôø4(€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí½ÁÑ¥½¸¹½É…¹¥é…Ñ¥½¹ôğ½ÍÑÉ½¹œøñÍµ…±°ùí½ÁÑ¥½¸¹É•¥½¸ñğ€‹²²^´ƒ®¾ã®NÇ®†t‰ôƒ
Üí½ÁÑ¥½¸¹‰ÕÍ¥¹•ÍÍI½Õ¹‘÷²Â ƒ²
³²^ğ½Íµ…±°øğ½ÍÁ…¸øñˆû²ÚSªÂ ğ½ˆø4(€€€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€€€¤¥ô4(€€€€€€€€€€€€€ì……‘‘=ÁÑ¥½¹Ì¹±•¹Ñ €ü€ñÀû²ÚSªÂ¶V€ƒ²"`ƒ²z#®*PƒªâÃªÒ²vĞƒ²^²*×®.#®.¸ğ½Àø€è¹Õ±±ô4(€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€ğ½‘¥Øø4(€€€€€€¤€è¹Õ±±ô4(4(€€€€€í•‘¥Ñ½È€ü€ 4(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µ•‘¥Ñ½ÈµÍ¡•±°ˆÉ½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆ½¹5½ÕÍ•½İ¸õì¡•Ù•¹Ğ¤€ôøì¥˜€¡•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ€ôôô•Ù•¹Ğ¹Ñ…É•Ğ¤Í•Ñ‘¥Ñ½È¡¹Õ±°¤ìõôø4(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í¡•‘Õ±”µ•‘¥Ñ½È½¹ÍÑÉÕÑ¥½¸µÍÑ…”µ•‘¥Ñ½ÈˆÉ½±”ô‰‘¥…±½œˆ…É¥„µµ½‘…°ô‰ÑÉÕ”ˆø4(€€€€€€€€€€€€ñ¡•…‘•Èøñ‘¥ØøñÍÁ…¸±…ÍÍ9…µ”ô‰Í•Ñ¥½¸µ­¥­•Èˆù=9MQIUQ%=8M!U1ğ½ÍÁ…¸øñ Ìùí•‘¥Ñ½È¹½É…¹¥é…Ñ¥½¹ôğ½ ÌøñÀû²ÊÓ¶³¶VpƒªÎ×²‚W®0ƒ²‚²z—®B§®.#®.¸ƒ®ª§®†w²^@ƒ²^®*PƒªÎ×²‚W²v ƒ²²‚Dƒ²ÚSªÂ¶V€ƒ²"`ƒ²z#²*×®.#®.¸ğ½Àøğ½‘¥Øøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ½È¡¹Õ±°¥ôû\ğ½‰ÕÑÑ½¸øğ½¡•…‘•Èø4(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µ•‘¥Ñ½ÈµÍÕµµ…Éäˆø4(€€€€€€€€€€€€€€ñ±…‰•°ûªÎ×²
³
ß¶J#®ª¤ñ¥¹ÁÕĞÙ…±Õ”õí•‘¥Ñ½È¹İ½É­MÕµµ…Éåô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È¡ì€¸¸¹•‘¥Ñ½È°İ½É­MÕµµ…Éäè•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”°İ½É­MÕµµ…Éå5½‘”è€‰µ…¹Õ…°ˆô¥ôÁ±…•¡½±‘•Èô‹²b èƒ²*“¶³®šÃ
ß².s²*“¶pƒ²“²æ`ˆ€¼øğ½±…‰•°ø4(€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÁÉ½©•Ğµ½µÁ±•Ñ”ˆøñ¥¹ÁÕĞÑåÁ”ô‰¡•­‰½àˆ¡•­•õí•‘¥Ñ½È¹½µÁ±•Ñ•‘ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È¡ì€¸¸¹•‘¥Ñ½È°½µÁ±•Ñ•è•Ù•¹Ğ¹Ñ…É•Ğ¹¡•­•ô¥ô€¼ûªâÃªÒ ƒ²vó²‚Tƒ²f®0ğ½±…‰•°ø4(€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€í•‘¥Ñ½È¹Í½ÕÉ•AÉ½‘ÕÑ9…µ•Ì¹±•¹Ñ €ü€ 4(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÁÉ½‘ÕĞµÁ¥­•Èˆø4(€€€€€€€€€€€€€€€€ñ‘¥Øø4(€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œû²²ã¶:c²vÓ² ƒ®NÇ®†tƒ¶J#®ª¤ğ½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸4(€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ4(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ½È¡ì4(€€€€€€€€€€€€€€€€€€€€€€¸¸¹•‘¥Ñ½È°4(€€€€€€€€€€€€€€€€€€€€€Í•±•Ñ•‘AÉ½‘ÕÑ9…µ•Ìè•‘¥Ñ½È¹Í½ÕÉ•AÉ½‘ÕÑ9…µ•Ì°4(€€€€€€€€€€€€€€€€€€€€€İ½É­MÕµµ…ÉäèÍÕµµ…É¥é•AÉ½‘ÕÑÌ¡•‘¥Ñ½È¹Í½ÕÉ•AÉ½‘ÕÑ9…µ•Ì¤°4(€€€€€€€€€€€€€€€€€€€€€İ½É­MÕµµ…Éå5½‘”è€‰…ÕÑ¼ˆ°4(€€€€€€€€€€€€€€€€€€€ô¥ô4(€€€€€€€€€€€€€€€€€€û²²àƒ¶J#®ª¤ƒ®.“².pƒ®Ú#®~³²b“ªâÀğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€€€ñÀû²vó²‚W¶Fs²^@ƒ¶Fs².s¶V€ƒ²ó²jPƒ¶J#®ª§®0ƒ²ƒ¶w¶V€ƒ²"`ƒ²z#²*×®.#®.¸ƒ²nC®Îàƒ¶J#®ª§
ßªâ#²V‡
ß²"c²"c®0ƒ²‚W®ÎÓ®*Pƒ®ÎªÊ÷®Bc² ƒ²V+²*×®.#®.¸ğ½Àø4(€€€€€€€€€€€€€€€€ñ‘¥Øø4(€€€€€€€€€€€€€€€€€í•‘¥Ñ½È¹Í½ÕÉ•AÉ½‘ÕÑ9…µ•Ì¹µ…À ¡¹…µ”¤€ôø€ 4(€€€€€€€€€€€€€€€€€€€€ñ±…‰•°­•äõí¹…µ•ôø4(€€€€€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕĞ4(€€€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰¡•­‰½àˆ4(€€€€€€€€€€€€€€€€€€€€€€€¡•­•õí•‘¥Ñ½È¹Í•±•Ñ•‘AÉ½‘ÕÑ9…µ•Ì¹¥¹±Õ‘•Ì¡¹…µ”¥ô4(€€€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì ¤€ôøÑ½±•‘¥Ñ½ÉAÉ½‘ÕĞ¡¹…µ”¥ô4(€€€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€€€€í¹…µ•ô4(€€€€€€€€€€€€€€€€€€€€ğ½±…‰•°ø4(€€€€€€€€€€€€€€€€€€¤¥ô4(€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€¤€è€ 4(€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÁÉ½‘ÕÑÌµ•µÁÑäˆû²²ã¶:c²vÓ²²^@ƒ®NÇ®†w®Bpƒ¶J#®ª§²vĞƒ²^²ZĞƒªÎ×²
³
ß¶J#®ª§²vƒ²²‚Dƒ²z®‚—¶VĞƒ²ó²ã²jP¸ğ½Àø4(€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÕÍÑ½´µÍÑ…”ˆø4(€€€€€€€€€€€€€€ñ¥¹ÁÕĞ4(€€€€€€€€€€€€€€€Ù…±Õ”õí•‘¥Ñ½È¹ÕÍÑ½µMÑ…•ô4(€€€€€€€€€€€€€€€µ…á1•¹Ñ õìĞÁô4(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ‘¥Ñ½È¡ì€¸¸¹•‘¥Ñ½È°ÕÍÑ½µMÑ…”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¥ô4(€€€€€€€€€€€€€€€½¹-•å½İ¸õì¡•Ù•¹Ğ¤€ôøì¥˜€¡•Ù•¹Ğ¹­•ä€ôôô€‰¹Ñ•Èˆ¤ì•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì…‘‘ÕÍÑ½µMÑ…” ¤ìôõô4(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‹®ª§®†w²^@ƒ²^®*PƒªÎ×²‚W®ªƒ²²‚Dƒ²z®‚”ˆ4(€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õí…‘‘ÕÍÑ½µMÑ…•ôø¬ƒªÎ×²‚Tƒ²ÚSªÂ ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÍÑ…”µÑ…‰±”ˆø4(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰½¹ÍÑÉÕÑ¥½¸µÍÑ…”µ¡•…ˆøñÍÁ…¸û²
³²j¤ğ½ÍÁ…¸øñÍÁ…¸û®.£ªÎğ½ÍÁ…¸øñÍÁ…¸û².sªÎÔƒ²^²ÊĞğ½ÍÁ…¸øñÍÁ…¸û®¦S®ª ğ½ÍÁ…¸øñÍÁ…¸û².s²zG²vğğ½ÍÁ…¸øñÍÁ…¸û²Š®3²vğğ½ÍÁ…¸øñÍÁ…¸û².s²zDƒ².sªÂğ½ÍÁ…¸øñÍÁ…¸û²Š®0ƒ².sªÂğ½ÍÁ…¸øñÍÁ…¸û²ÚSªÂ ğ½ÍÁ…¸øğ½‘¥Øø4(€€€€€€€€€€€€€í•‘¥Ñ½È¹¥Ñ•µÌ¹µ…À ¡¥Ñ•´°¥¹‘•à¤€ôø€ 4(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”õí½¹ÍÑÉÕÑ¥½¸µÍÑ…”µÉ½Ü‘í¥Ñ•´¹…Ñ¥Ù”€ü€ˆ…Ñ¥Ù”ˆ€è€ˆ‰õô­•äõí¥Ñ•´¹­•åôø4(€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕĞ…É¥„µ±…‰•°õí€‘í¥Ñ•´¹ÍÑ…•ôƒ²
³²j¥ôÑåÁ”ô‰¡•­‰½àˆ¡•­•õí¥Ñ•´¹…Ñ¥Ù•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•‘¥Ñ½É%Ñ•´¡¥Ñ•´¹­•ä°ì…Ñ¥Ù”è•Ù•¹Ğ¹Ñ…É•Ğ¹¡•­•ô¥ô€¼ø4(€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùí¥Ñ•´¹ÍÑ…•õí•‘¥Ñ½È¹¥Ñ•µÌ¹Í±¥” À°¥¹‘•à¤¹Í½µ” ¡ÁÉ•Ù¥½ÕÌ¤€ôøÁÉ•Ù¥½ÕÌ¹ÍÑ…”€ôôô¥Ñ•´¹ÍÑ…”¤€ü€ˆƒ
Üƒ²ÚSªÂ ˆ€è€ˆ‰ôğ½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕĞÙ…±Õ”õí¥Ñ•´¹Ù•¹‘½É9…µ•ô‘¥Í…‰±•õì…¥Ñ•´¹…Ñ¥Ù•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•‘¥Ñ½É%Ñ•´¡¥Ñ•´¹­•ä°ìÙ•¹‘½É9…µ”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¥ôÁ±…•¡½±‘•Èô‹²^²ÊÓ®ªˆ€¼ø4(€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕĞÙ…±Õ”õí¥Ñ•´¹‘•Ñ…¥±Íôµ…á1•¹Ñ õìÔÀÁô‘¥Í…‰±•õì…¥Ñ•´¹…Ñ¥Ù•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•‘¥Ñ½É%Ñ•´¡¥Ñ•´¹­•ä°ì‘•Ñ…¥±Ìè•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¥ôÁ±…•¡½±‘•Èô‹²ƒ¶tƒ²z®‚”ˆ€¼ø4(€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕĞÑåÁ”ô‰‘…Ñ”ˆÙ…±Õ”õí¥Ñ•´¹Í¡•‘Õ±•‘…Ñ•ô‘¥Í…‰±•õì…¥Ñ•´¹…Ñ¥Ù•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•‘¥Ñ½É%Ñ•´¡¥Ñ•´¹­•ä°ìÍ¡•‘Õ±•‘…Ñ”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”°•¹‘…Ñ”è¥Ñ•´¹•¹‘…Ñ”€ğ•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”€ü•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”€è¥Ñ•´¹•¹‘…Ñ”ô¥ô€¼ø4(€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕĞÑåÁ”ô‰‘…Ñ”ˆÙ…±Õ”õí¥Ñ•´¹•¹‘…Ñ•ô‘¥Í…‰±•õì…¥Ñ•´¹…Ñ¥Ù•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•‘¥Ñ½É%Ñ•´¡¥Ñ•´¹­•ä°ì•¹‘…Ñ”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¥ô€¼ø4(€€€€€€€€€€€€€€€€€€ñÍ•±•Ğ4(€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°õí€‘í¥Ñ•´¹ÍÑ…•ôƒ².s²zDƒ².sªÂô4(€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí¥Ñ•´¹ÍÑ…ÉÑQ¥µ•ô4(€€€€€€€€€€€€€€€€€€€‘¥Í…‰±•õì…¥Ñ•´¹…Ñ¥Ù•ô4(€€€€€€€€€€€€€€€€€€€½¹%¹ÁÕĞõì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•‘¥Ñ½ÉMÑ…ÉÑQ¥µ”¡¥Ñ•´¹­•ä°•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ¹Ù…±Õ”¥ô4(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•‘¥Ñ½ÉMÑ…ÉÑQ¥µ”¡¥Ñ•´¹­•ä°•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ¹Ù…±Õ”¥ô4(€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ôˆˆû²Š²vğğ½½ÁÑ¥½¸ø4(€€€€€€€€€€€€€€€€€€€íQ%5}=AQ%=9L¹µ…À ¡Ñ¥µ”¤€ôø€ñ½ÁÑ¥½¸Ù…±Õ”õíÑ¥µ•ô­•äõíÑ¥µ•ôùíÑ¥µ•ôğ½½ÁÑ¥½¸ø¥ô4(€€€€€€€€€€€€€€€€€€ğ½Í•±•Ğø4(€€€€€€€€€€€€€€€€€€ñÍ•±•Ğ…É¥„µ±…‰•°õí€‘í¥Ñ•´¹ÍÑ…•ôƒ²Š®0ƒ².sªÂôÙ…±Õ”õí¥Ñ•´¹•¹‘Q¥µ•ô‘¥Í…‰±•õì…¥Ñ•´¹…Ñ¥Ù”ñğ€…¥Ñ•´¹ÍÑ…ÉÑQ¥µ•ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÕÁ‘…Ñ•‘¥Ñ½É%Ñ•´¡¥Ñ•´¹­•ä°ì•¹‘Q¥µ”è•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”ô¥ôø4(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸Ù…±Õ”ôˆˆû²zC®>d ¬Ç².sªÂ¤ğ½½ÁÑ¥½¸ø4(€€€€€€€€€€€€€€€€€€€íQ%5}=AQ%=9L¹µ…À ¡Ñ¥µ”¤€ôø€ñ½ÁÑ¥½¸Ù…±Õ”õíÑ¥µ•ô­•äõíÑ¥µ•ôùíÑ¥µ•ôğ½½ÁÑ¥½¸ø¥ô4(€€€€€€€€€€€€€€€€€€ğ½Í•±•Ğø4(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ…É¥„µ±…‰•°õí€‘í¥Ñ•´¹ÍÑ…•ôƒªâÃªÂƒ²ÚSªÂô½¹±¥¬õì ¤€ôø…‘‘MÑ…•I…¹”¡¥Ñ•´¹ÍÑ…”°¥Ñ•´¹•¹‘…Ñ”ñğ¥Ñ•´¹Í¡•‘Õ±•‘…Ñ”¥ôø¬ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€¤¥ô4(€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€ñ™½½Ñ•Èøñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôøÍ•Ñ‘¥Ñ½È¡¹Õ±°¥ôû²Ş£²0ğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ±…ÍÍ9…µ”ô‰ÁÉ¥µ…Éäµ‰ÕÑÑ½¸ˆ‘¥Í…‰±•õíÍ…Ù¥¹ô½¹±¥¬õì ¤€ôøÙ½¥Í…Ù•‘¥Ñ½È ¥ôùíÍ…Ù¥¹œ€ü€‹²‚²z”ƒ²’GŠ˜ˆ€è€‹²“²‚Tƒ²f®0‰ôğ½‰ÕÑÑ½¸øğ½™½½Ñ•Èø4(€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€ğ½‘¥Øø4(€€€€€€¤€è¹Õ±±ô4(€€€€ğ½Í•Ñ¥½¸ø4(€€¤ì4)ô4