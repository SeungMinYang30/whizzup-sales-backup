import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import { getOpenAIConfig } from "../../../../lib/openai-config";
import {
  ensureRecordsReady,
  serializeProgressSchedule,
} from "../../../../lib/records-store";
import {
  institutionAliasKey,
  institutionNameWithoutRegionPrefix,
  preferFullInstitutionName,
} from "../../../../lib/institution-names";
import { resolveActivityDateFromMessage } from "../../../../lib/activity-date";
import { productRecommendationContext } from "../../../../lib/product-ai-catalog";
import {
  collapseRepeatedOrganizationRegionPrefix,
  compactShareSummary,
  replaceOrganizationReferences,
} from "../../../../lib/share-text";
import { normalizeAiSuggestedStatus } from "../../../../lib/ai-status";
import {
  AWARD_STAGE_OPTIONS,
} from "../../../../lib/sales-taxonomy";
import { findOfficialSchoolCandidates } from "../../../../lib/school-directory";
import {
  ensureBudgetNamesReady,
  resolveBudgetRecordMetadata,
} from "../../../../lib/budget-names";

export const dynamic = "force-dynamic";

type ConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

type OpenAIResponse = {
  status?: string;
  error?: { message?: string };
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

const dateConfidenceValues = [
  "확정",
  "대화시각 추정",
  "월만 확인",
  "날짜 미상",
];
const categoryValues = ["학교", "기관", "협력사", "내부", "기타"];
const contactMethodValues = ["유선", "방문", "온라인", "진행 공유", "기타"];
const temperatureValues = ["높음", "중간", "낮음"];
const awardStatusValues = ["미정", "위즈업 수주", "협력사 수주", "타업체 수주"];
const executionTypeValues = ["직영", "컨소", "해당 없음"];
const awardStageValues = [...AWARD_STAGE_OPTIONS];
const detailLevelValues = ["compact", "standard", "detailed"];

const recommendationSchema = {
  type: "object",
  properties: {
    meetingSummary: {
      type: "string",
      description:
        "확인된 미팅·TM 사실만 2문장 이내로 요약. 없는 정보나 요약 기준에 대한 해설은 쓰지 않음",
    },
    interests: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
      description: "기관이 관심을 보인 항목과 해결해야 할 필요",
    },
    recommendedProducts: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          reason: {
            type: "string",
            description: "미팅 내용과 연결한 추천 이유",
          },
        },
        required: ["name", "reason"],
        additionalProperties: false,
      },
    },
    followUpQuestions: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
      description: "다음 연락에서 확인하면 좋은 구체적인 질문",
    },
    recommendedActions: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
      description: "담당자가 바로 실행할 수 있는 짧은 후속 행동",
    },
  },
  required: [
    "meetingSummary",
    "interests",
    "recommendedProducts",
    "followUpQuestions",
    "recommendedActions",
  ],
  additionalProperties: false,
};

const recordDraftSchema = {
  type: "object",
  properties: {
    activityDate: {
      type: "string",
      description:
        "실제 통화·미팅·활동 날짜를 YYYY-MM-DD로 작성. 입력 제목이나 본문에 날짜가 있으면 그 날짜를 사용하고, 공사·재연락·후속 일정 날짜와 혼동하지 않음",
    },
    dateConfidence: { type: "string", enum: dateConfidenceValues },
    activityType: { type: "string", enum: ["기타"] },
    category: { type: "string", enum: categoryValues },
    contactMethod: { type: "string", enum: contactMethodValues },
    region: { type: "string" },
    organization: { type: "string" },
    budgetType: { type: "string" },
    budgetAmount: {
      type: "string",
      description: "사용자가 말한 단위를 포함한 금액. 모르면 빈 문자열",
    },
    topic: {
      type: "string",
      description: "호환성을 위해 항상 빈 문자열",
    },
    summary: {
      type: "string",
      description:
        "확인된 일정·결정·후속 행동만 간결하게 요약. 없는 정보나 해설은 쓰지 않음",
    },
    detailLevel: {
      type: "string",
      enum: detailLevelValues,
      description:
        "짧은 확인은 compact, 일반 TM은 standard, 미팅·방문·현장실측 또는 여러 주제와 금액·일정이 포함된 긴 기록은 detailed",
    },
    detailSummary: {
      type: "string",
      description:
        "원문 사실을 보존한 상세 기록의 핵심 요약. compact는 빈 문자열 가능",
    },
    detailKeyFacts: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          value: { type: "string" },
        },
        required: ["label", "value"],
        additionalProperties: false,
      },
    },
    detailSections: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          items: {
            type: "array",
            maxItems: 20,
            items: { type: "string" },
          },
        },
        required: ["title", "items"],
        additionalProperties: false,
      },
    },
    status: { type: "string", enum: ["상담 진행"] },
    temperature: { type: "string", enum: temperatureValues },
    awardStatus: { type: "string", enum: awardStatusValues },
    awardCompany: { type: "string" },
    executionType: { type: "string", enum: executionTypeValues },
    consortiumCompany: { type: "string" },
    awardStage: { type: "string", enum: awardStageValues },
    progressManager: { type: "string" },
    followUpRequired: { type: "boolean" },
    followUpDate: {
      type: "string",
      description: "재연락 예정일을 YYYY-MM-DD로 작성. 모르면 빈 문자열",
    },
    nextAction: { type: "string" },
    progressSchedule: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          date: {
            type: "string",
            description: "진행 일자를 YYYY-MM-DD로 작성",
          },
          startTime: {
            type: "string",
            description: "정확한 시작 시간이 확인되면 HH:mm, 없으면 빈 문자열",
          },
          endTime: {
            type: "string",
            description: "정확한 종료 시간이 확인되면 HH:mm, 없으면 빈 문자열",
          },
        },
        required: ["label", "date", "startTime", "endTime"],
        additionalProperties: false,
      },
    },
    contactRole: {
      type: "string",
      description:
        "기관 인물의 명시된 역할. 공사 담당자, 회계 담당자, 행정 담당자처럼 입력에 나온 역할을 그대로 작성. 모르면 빈 문자열",
    },
    contactName: { type: "string" },
    contactPhone: { type: "string" },
    contactEmail: { type: "string" },
    notes: { type: "string" },
    recommendation: recommendationSchema,
  },
  required: [
    "activityDate",
    "dateConfidence",
    "activityType",
    "category",
    "contactMethod",
    "region",
    "organization",
    "budgetType",
    "budgetAmount",
    "topic",
    "summary",
    "detailLevel",
    "detailSummary",
    "detailKeyFacts",
    "detailSections",
    "status",
    "temperature",
    "awardStatus",
    "awardCompany",
    "executionType",
    "consortiumCompany",
    "awardStage",
    "progressManager",
    "followUpRequired",
    "followUpDate",
    "nextAction",
    "progressSchedule",
    "contactRole",
    "contactName",
    "contactPhone",
    "contactEmail",
    "notes",
    "recommendation",
  ],
  additionalProperties: false,
};

const responseSchema = {
  type: "object",
  properties: {
    needsClarification: { type: "boolean" },
    assistantMessage: {
      type: "string",
      description:
        "추가 정보가 필요하면 한 가지 짧은 질문. 아니면 정리 완료 안내",
    },
    drafts: {
      type: "array",
      description:
        "기관별로 분리한 기록 초안. 같은 기관은 반드시 한 항목으로 합침",
      maxItems: 50,
      items: recordDraftSchema,
    },
  },
  required: ["needsClarification", "assistantMessage", "drafts"],
  additionalProperties: false,
};

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type ScheduleCancellationIntent = "none" | "confirmed" | "review";

function scheduleCancellationIntent(message: string): ScheduleCancellationIntent {
  const compact = message.replace(/\s+/g, " ").trim();
  const confirmed = [
    /일정.{0,18}(?:이|은|을|가)?\s*취소\s*(?:됐|되었|됨|합니다|됐습니다|되었다|됐다고)/,
    /방문.{0,18}(?:이|은|을|가)?\s*취소\s*(?:됐|되었|됨|합니다|됐습니다|되었다|됐다고)/,
    /예정.{0,18}(?:이|은|을|가)?\s*취소\s*(?:됐|되었|됨|합니다|됐습니다|되었다|됐다고)/,
  ].some((pattern) => pattern.test(compact));
  if (confirmed) return "confirmed";
  return /취소|연기|변경\s*가능|일정\s*미정/.test(compact) ? "review" : "none";
}

function cancellationDates(message: string, today: string) {
  const dates = new Set<string>();
  const year = Number(today.slice(0, 4));
  for (const match of message.matchAll(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?/g)) {
    dates.add(`${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`);
  }
  for (const match of message.matchAll(/(?:^|\s)(\d{1,2})월\s*(\d{1,2})일/g)) {
    dates.add(`${year}-${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`);
  }
  if (/내일/.test(message)) {
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    dates.add(tomorrow.toISOString().slice(0, 10));
  }
  return [...dates];
}

function cleanHistory(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-6)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      const role =
        entry.role === "assistant"
          ? "assistant"
          : entry.role === "user"
            ? "user"
            : null;
      const text =
        typeof entry.text === "string" ? entry.text.trim().slice(0, 2_000) : "";
      return role && text ? { role, text } : null;
    })
    .filter((item): item is ConversationMessage => item !== null);
}

function extractOutputText(payload: OpenAIResponse) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "refusal" && part.refusal) {
        throw new Error("해당 내용은 AI가 정리할 수 없습니다.");
      }
      if (part.type === "output_text" && part.text?.trim()) {
        return part.text.trim();
      }
    }
  }
  throw new Error("AI 정리 결과가 비어 있습니다.");
}

function normalizeDraft(
  value: unknown,
): Record<string, unknown> {
  const draft =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const progressSchedule = serializeProgressSchedule(draft.progressSchedule);
  const recommendation =
    draft.recommendation && typeof draft.recommendation === "object"
      ? (draft.recommendation as Record<string, unknown>)
      : {};
  const rawOrganization = String(draft.organization ?? "").trim();
  const region = String(draft.region ?? "").trim();
  const organization = institutionNameWithoutRegionPrefix(
    rawOrganization,
    region,
  );
  const normalizeOrganizationText = (value: unknown, maxLength = 4_000) =>
    collapseRepeatedOrganizationRegionPrefix(
      replaceOrganizationReferences(
        String(value ?? "").trim().slice(0, maxLength),
        rawOrganization,
        organization,
      ),
      organization,
      region,
    );
  const requestedDetailLevel = detailLevelValues.includes(
    String(draft.detailLevel ?? ""),
  )
    ? String(draft.detailLevel)
    : "compact";
  return {
    ...draft,
    organization,
    region,
    summary: normalizeOrganizationText(compactShareSummary(draft.summary), 800),
    detailLevel: requestedDetailLevel,
    detailSummary: normalizeOrganizationText(draft.detailSummary),
    detailKeyFacts: Array.isArray(draft.detailKeyFacts)
      ? draft.detailKeyFacts.slice(0, 12).map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const fact = entry as Record<string, unknown>;
          return { ...fact, value: normalizeOrganizationText(fact.value, 800) };
        })
      : [],
    detailSections: Array.isArray(draft.detailSections)
      ? draft.detailSections.slice(0, 12).map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const section = entry as Record<string, unknown>;
          return {
            ...section,
            items: Array.isArray(section.items)
              ? section.items.slice(0, 20).map((item) => normalizeOrganizationText(item, 800))
              : [],
          };
        })
      : [],
    nextAction: normalizeOrganizationText(draft.nextAction, 800),
    notes: normalizeOrganizationText(draft.notes),
    recommendation: {
      ...recommendation,
      meetingSummary: normalizeOrganizationText(
        compactShareSummary(recommendation.meetingSummary),
        800,
      ),
    },
    activityType: "기타",
    contactMethod: "기타",
    status: "상담 진행",
    temperature: "중간",
    followUpRequired: false,
    followUpDate: "",
    progressSchedule,
    equipmentProjectName: "",
    equipmentProjectStatus: "제안",
    equipmentItems: [],
    sourceChat: "사이트 AI 입력",
  };
}

function mergeProgressSchedules(...values: unknown[]) {
  const uniqueLines = new Set<string>();
  values.forEach((value) => {
    serializeProgressSchedule(value)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => uniqueLines.add(line));
  });
  return [...uniqueLines].join("\n");
}

function mergeUniqueText(...values: unknown[]) {
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .filter((value, index, rows) => rows.indexOf(value) === index)
    .join("\n");
}

function mergeDetailFacts(...values: unknown[]) {
  const facts = new Map<string, { label: string; value: string }>();
  values.forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const row = entry as Record<string, unknown>;
      const label = String(row.label ?? "").trim();
      const factValue = String(row.value ?? "").trim();
      if (!label || !factValue) return;
      const key = label.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
      const previous = facts.get(key);
      facts.set(key, {
        label: previous?.label || label,
        value: mergeUniqueText(previous?.value, factValue),
      });
    });
  });
  return [...facts.values()].slice(0, 12);
}

function mergeDetailSections(...values: unknown[]) {
  const sections = new Map<string, { title: string; items: string[] }>();
  values.forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const row = entry as Record<string, unknown>;
      const title = String(row.title ?? "").trim();
      const items = Array.isArray(row.items)
        ? row.items.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [];
      if (!title || !items.length) return;
      const key = title.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
      const previous = sections.get(key);
      sections.set(key, {
        title: previous?.title || title,
        items: [...new Set([...(previous?.items ?? []), ...items])].slice(0, 20),
      });
    });
  });
  return [...sections.values()].slice(0, 12);
}

function mostDetailedLevel(...values: unknown[]) {
  const rank = new Map([
    ["compact", 0],
    ["standard", 1],
    ["detailed", 2],
  ]);
  return values.reduce<string>(
    (best, value) =>
      (rank.get(String(value)) ?? -1) > (rank.get(best) ?? -1)
        ? String(value)
        : best,
    "compact",
  );
}

function normalizeDrafts(value: unknown) {
  if (!Array.isArray(value)) return [];
  const grouped = new Map<string, Record<string, unknown>>();

  value.slice(0, 50).forEach((entry) => {
    const normalized = normalizeDraft(entry);
    const organization = String(normalized.organization ?? "").trim();
    if (!organization) return;
    const key = organization.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, normalized);
      return;
    }

    const existingSummary = String(existing.summary ?? "").trim();
    const incomingSummary = String(normalized.summary ?? "").trim();
    grouped.set(key, {
      ...normalized,
      ...existing,
      summary:
        incomingSummary && !existingSummary.includes(incomingSummary)
          ? [existingSummary, incomingSummary].filter(Boolean).join(" ")
          : existingSummary || incomingSummary,
      detailLevel: mostDetailedLevel(
        existing.detailLevel,
        normalized.detailLevel,
      ),
      detailSummary: mergeUniqueText(
        existing.detailSummary,
        normalized.detailSummary,
      ),
      detailKeyFacts: mergeDetailFacts(
        existing.detailKeyFacts,
        normalized.detailKeyFacts,
      ),
      detailSections: mergeDetailSections(
        existing.detailSections,
        normalized.detailSections,
      ),
      progressSchedule: mergeProgressSchedules(
        existing.progressSchedule,
        normalized.progressSchedule,
      ),
      equipmentProjectName: "",
      equipmentProjectStatus: "제안",
      equipmentItems: [],
    });
  });

  return [...grouped.values()];
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const body = (await request.json()) as Record<string, unknown>;
    const message =
      typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 20_000) {
      return Response.json(
        {
          error: "정리할 내용을 입력해 주세요. 글은 20,000자 이내로 작성해 주세요.",
        },
        { status: 400 },
      );
    }

    const budgetD1 = await ensureBudgetNamesReady();
    const budgetCatalogRows = await budgetD1
      .prepare(
        `SELECT g.canonical_name AS canonicalName,
                GROUP_CONCAT(a.alias_name, ' | ') AS aliases
         FROM budget_name_groups g
         LEFT JOIN budget_name_aliases a
           ON a.group_id = g.id AND a.active = 1
         WHERE g.active = 1
         GROUP BY g.id, g.canonical_name, g.sort_order
         ORDER BY g.sort_order, g.canonical_name
         LIMIT 300`,
      )
      .all<{ canonicalName: string; aliases: string | null }>();
    const budgetCatalogPrompt =
      budgetCatalogRows.results.length > 0
        ? budgetCatalogRows.results
            .map((row) =>
              row.aliases
                ? `- ${row.canonicalName} (별칭: ${row.aliases})`
                : `- ${row.canonicalName}`,
            )
            .join("\n")
        : "- 등록된 표준 예산명 없음";

    const { apiKey, model, configured } = await getOpenAIConfig();
    if (!configured) {
      return Response.json(
        {
          error:
            "사이트 AI 연결 준비 중입니다. 관리자 API 키를 연결한 뒤 사용할 수 있습니다.",
          code: "AI_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    const history = cleanHistory(body.history);
    const detailLevelPreference = [
      "auto",
      "compact",
      "standard",
      "detailed",
    ].includes(String(body.detailLevelPreference ?? ""))
      ? String(body.detailLevelPreference)
      : "auto";
    const input = [
      ...history.map((item) => ({
        role: item.role,
        content: item.text,
      })),
      {
        role: "user" as const,
        content: message,
      },
    ];
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 12_000,
        instructions: `당신은 위즈업의 TM·미팅 영업 기록 정리 도우미입니다.
상담 분류는 사용하지 않습니다. 호환성 필드인 topic은 항상 빈 문자열로 두고, 실제 상담 내용은 summary에만 정리하세요.
오늘 날짜는 ${todayInSeoul()}입니다.
사용자의 현재 메시지와 직전 대화만 근거로 기관별 영업 기록 초안을 만드세요.
사용자가 입력 제목이나 본문에 실제 통화·미팅·업무 날짜를 적었다면 며칠 뒤에 기록하더라도 activityDate에는 반드시 그 날짜를 넣고 dateConfidence는 확정으로 두세요.
예를 들어 "[2026년 6월 4일 성남 장안초등학교 미팅 내용 정리]"는 activityDate가 2026-06-04입니다. 오늘 날짜로 바꾸지 마세요.
여러 기관에 공통 날짜가 제목에 한 번만 적혀 있으면 모든 draft에 그 날짜를 적용하고, 기관별 날짜가 따로 적혀 있으면 각 draft에 해당 날짜를 적용하세요.
공사·설치·재연락·후속 일정 날짜는 activityDate가 아니라 progressSchedule 또는 followUpDate에 넣으세요.
여러 기관의 표, 목록, 복사한 셀, 여러 줄 일정을 한 번에 받으면 drafts에 기관별로 한 항목씩 정확히 분리하세요.
같은 기관이 여러 줄에 나오면 하나의 draft로 합치고 그 기관의 progressSchedule에 일정만 모으세요.
직전 질문에서 사용자가 같은 기관이라고 확인했다면 기존의 축약하지 않은 정식 기관명을 사용하세요.
기관명이 정정되거나 기존 기관명으로 확정되면 organization뿐 아니라 summary, nextAction, recommendation.meetingSummary 등 기관명을 언급하는 모든 필드에 최종 기관명을 동일하게 사용하세요. 이전 오타나 이전 명칭을 함께 쓰거나 남기지 마세요.
  지역은 region에 “경기 광주”, “경남 함양”처럼 따로 기록하고 organization에는 기관의 고유 명칭만 적으세요. 예를 들어 “경기도 광주 도수초”는 region “경기 광주”, organization “도수초등학교”로, “경남 함양군청”은 region “경남 함양”, organization “함양군청”으로 정리하세요. 군청·시청·학교처럼 기관 종류만 남기지 말고 지역 고유명은 유지하세요. 기관 고유명 자체에 지역명이 포함된 “서울대학교” 같은 이름은 훼손하지 마세요.
기관명에 "외 15건", "외 N건", "등 여러 곳" 같은 묶음 표현을 절대 사용하지 마세요.
각 일정은 해당 기관에만 넣고, 같은 기관·일정명·날짜 조합은 한 번만 넣으세요.
기관명이 없거나 어느 기관인지 판단할 수 없을 때만 needsClarification을 true로 하고 한 가지 짧은 질문을 하며 drafts는 빈 배열로 두세요.
그 외에는 needsClarification을 false로 하고 assistantMessage에 "N개 기관으로 정리했습니다. 내용을 확인해 주세요."처럼 기관 수를 포함해 짧게 답하세요.
호환성 필드인 activityType은 기타, contactMethod는 기타, status는 상담 진행으로 고정하세요. 활동 유형과 영업 진행상황을 추측하거나 분류하지 마세요.
위즈업 수주 후 일정에서 날짜와 현장 작업이 함께 확인되면 목록에 없는 공정도 사용자가 말한 공정명 그대로 progressSchedule에 각각 나누어 넣으세요. 철거·전기설비·목공·도장·바닥·벽체유리·가구집기·시스템·사인물·청소·이사이동·검수·교육뿐 아니라 수납장 체결, 기자재 이동처럼 누가 봐도 현장 시공 과정인 일정도 포함합니다. "시스템 문의"처럼 날짜 없는 단순 언급은 일정으로 만들지 마세요.
일정의 정확한 시간이 확인되면 startTime과 endTime을 24시간제 HH:mm으로 작성하세요. 10분 단위로 맞추고, 시간이 없으면 둘 다 빈 문자열로 두세요. 시작 시간만 확인되면 startTime만 작성하고 endTime은 빈 문자열로 두세요.
progressSchedule에 일정이 있다는 이유만으로 수주 주체를 위즈업으로 추정하지 마세요. 위즈업 수주가 명시된 경우에만 awardStatus를 위즈업 수주로, 협력사 수주가 명시된 경우에만 협력사 수주로 정리하고, 수주 주체가 명확하지 않으면 미정으로 두세요.
현재 연도가 생략된 월/일은 ${todayInSeoul().slice(0, 4)}년으로 정리하세요.
모르는 값은 추측하지 말고 빈 문자열로 두세요.
협력사 수주이면 awardStatus를 협력사 수주로, 실제 진행 업체명을 awardCompany에 적으세요. 업체명을 모르면 awardStatus를 미정으로 두고 notes에 확인 필요라고 적으세요.
타업체 수주인데 업체명을 모르면 awardStatus를 미정으로 두고 notes에 확인 필요라고 적으세요.
타업체 수주라면 executionType은 해당 없음, consortiumCompany는 빈 값, awardStage는 미정으로 정리하세요.
그 외 사업방식은 컨소와 업체명이 명시된 경우만 executionType을 컨소로 정리하고 consortiumCompany에 업체명을 넣으세요. 나머지는 executionType을 직영으로 정리하세요.
수주 현재 상태는 awardStage에 미정, 협상, 계약, 일정 조율, 설치·공사 진행, 검수·교육 진행, 납품 완료 중 하나로 정리하세요.
설치나 공사가 끝났더라도 검수·교육 또는 최종 인계가 남아 있으면 검수·교육 진행으로 두세요. 납품 완료는 사용자가 납품 완료·최종 완료·사업 종료를 명시했거나 검수와 교육까지 모두 끝났다고 분명히 말한 경우에만 사용하세요. 검수 완료 또는 교육 완료 중 하나만 언급한 경우에는 납품 완료로 추측하지 마세요.
AI 입력에서는 장비·물품의 품목, 수량, 규격, 설치 수량이나 품목 관리용 사업 정보를 추출하거나 만들지 마세요. "스크린 설치" 같은 표현은 필요한 경우 시공 일정의 단계·메모 맥락으로만 보존하고 품목 관리 데이터로 만들지 마세요.
기관 인물의 역할이 공사 담당자·회계 담당자·행정 담당자처럼 명시되면 contactRole에 그 역할을 그대로 넣고 이름·직책은 contactName에 넣으세요. contactRole/contactName에 분리해 넣은 “공사 담당자는 OOO로 확인됐다” 같은 문장은 summary와 recommendation.meetingSummary에서 반복하지 마세요.
progressManager는 위즈업 내부에서 수주 후 진행을 맡는 사람으로, 기관의 contactRole/contactName과 절대 섞지 마세요. 기관 메일은 contactEmail에 정리하세요.
followUpRequired는 입력 내용과 관계없이 항상 false로 두고 followUpDate는 항상 빈 문자열로 두세요. 재연락 필요 여부는 사용자가 저장 전에 직접 선택합니다.
summary와 recommendation.meetingSummary에는 기관이 전달한 사실, 확정 일정, 결정 사항, 후속 행동만 1~2문장 이내로 요약하세요.
summary와 recommendation.meetingSummary는 “논의했습니다”, “확인했습니다”, “진행합니다” 같은 존댓말 보고체로 작성하세요. “논의했다”, “확인한다”, “진행함” 같은 반말·메모체 종결은 사용하지 마세요.
기관 담당자가 말한 상황을 “전달했습니다”라고 쓰지 마세요. 기관의 설명은 “말씀하셨습니다”, “안내받았습니다”, “확인됐습니다”처럼 누가 말했는지 자연스럽게 이해되는 표현으로 정리하세요. “전달했습니다”는 위즈업 담당자가 실제로 자료나 내용을 전달한 경우에만 사용하세요.
녹취가 불명확하거나 오인식된 단어는 그대로 옮기거나 추측해 구체화하지 말고, 앞뒤 문맥에서 확실한 범위의 일반적인 표현으로 정리하세요. 예를 들어 준비 대상이 불명확하면 “교내 일정 준비로 업무가 분주한 상황”처럼 쓰세요.
재연락일과 후속 연락 일정은 별도 관리 항목이므로 summary와 recommendation.meetingSummary에는 넣지 마세요.
“일정 확인이 핵심”, “별도 장비나 수주 정보 없음”, “추가 정보 없음”, “특이사항 없음”처럼 AI의 해설이나 입력에 없는 항목의 부재를 설명하는 문장은 절대 만들지 마세요.
단, 기관이 특정 장비가 필요 없다고 전달했거나 미수주가 확정된 것처럼 실제 발언·결정에 포함된 부정 사실은 생략하지 마세요.
상세 기록 선호는 "${detailLevelPreference}"입니다. auto이면 짧은 단순 확인은 compact, 일반 TM·통화는 standard, 미팅·방문·현장 실측 또는 예산·견적·제품·공간·수주·납품·여러 일정처럼 서로 다른 사실이 여러 개 포함된 기록은 detailed로 판단하세요. 어느 수준인지 애매하면 standard를 사용하세요. auto가 아니면 반드시 지정된 상세 수준을 사용하세요.
상세 수준은 화면에 보이는 서술 분량만 조절합니다. 어떤 수준이든 기관명, 날짜, 예산명·금액, 기관 담당자, 진행 담당자, 수주 상태, 후속 일정 등 구조화 필드는 원문에서 확인되는 값을 빠짐없이 추출하세요.
compact이면 detailSummary, detailKeyFacts, detailSections를 비워도 됩니다. standard와 detailed이면 detailSummary에 전체 맥락을 2~5문장으로 보존하고, detailKeyFacts에는 참석자·총예산·주요 일정·사업명처럼 원문에 명시된 핵심 사실만 넣으세요.
detailed이면 detailSections를 예산, 구축 방향, 공간별 검토, 경쟁 업체, 공사 및 일정, 향후 진행 등 실제 원문에 있는 주제로 나누세요. 원문에 없는 섹션은 만들지 말고, 긴 원문을 지나치게 축약하지 마세요. 날짜·금액·제품명·참석자·업체명·수량을 임의로 바꾸거나 추가하지 마세요.
각 draft의 recommendation에는 공식 기록을 자동 변경하지 않는 별도 영업 대응 제안을 작성하세요.
추천 제품은 아래 내부 제품 자료에 있는 제품명만 사용하고, 미팅 내용에서 확인되는 필요와 연결되는 경우에만 최대 4개까지 추천하세요.
근거가 부족하면 추천 제품을 비워 두고, 가격·인증·조달·성과는 절대 추측하지 마세요.
후속 질문은 공간, 대상 연령, 예산 구분, 일정, 수량처럼 다음 영업에 실제 도움이 되는 질문으로 작성하세요.
추천 행동은 담당자가 바로 실행할 수 있는 구체적이고 짧은 문장으로 작성하세요.

[위즈업 내부 제품 자료]
${productRecommendationContext()}

[관리자가 등록한 표준 예산명과 별칭]
${budgetCatalogPrompt}

budgetType은 위 목록의 표준명 또는 별칭과 입력 내용이 정확히 일치할 때만 그 값을 사용하세요.
목록에 없는 이름을 임의로 표준 예산명처럼 바꾸거나 새 표준명을 만들지 마세요.
확실하지 않으면 사용자가 말한 원문을 그대로 보존하세요. 최종 표준 연결은 시스템이 다시 검증합니다.`,
        input,
        text: {
          format: {
            type: "json_schema",
            name: "whizzup_sales_record",
            description: "위즈업 TM·미팅 영업 기록 초안",
            strict: true,
            schema: responseSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    const responsePayload = (await openAIResponse.json()) as OpenAIResponse;
    if (!openAIResponse.ok) {
      if (openAIResponse.status === 429) {
        return Response.json(
          { error: "AI 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요." },
          { status: 429 },
        );
      }
      if (openAIResponse.status === 401 || openAIResponse.status === 403) {
        return Response.json(
          { error: "관리자 API 연결 정보를 확인해 주세요." },
          { status: 503 },
        );
      }
      return Response.json(
        { error: "AI가 내용을 정리하지 못했습니다. 다시 시도해 주세요." },
        { status: 502 },
      );
    }

    const parsed = JSON.parse(extractOutputText(responsePayload)) as {
      needsClarification: boolean;
      assistantMessage: string;
      drafts: Record<string, unknown>[];
    };
    const postedDate = todayInSeoul();
    const userProjectText = [
      ...history
        .filter((item) => item.role === "user")
        .map((item) => item.text),
      message,
    ].join("\n");
    const cancellationIntent = scheduleCancellationIntent(message);
    const cancellationScheduledDates = cancellationDates(message, postedDate);
    const drafts: Record<string, unknown>[] = normalizeDrafts(
      parsed.drafts,
    ).map((draft): Record<string, unknown> => {
      const resolvedActivityDate = resolveActivityDateFromMessage({
        message: userProjectText,
        aiDate: draft.activityDate,
        today: postedDate,
      });
      const awardStatus = draft.awardStatus;
      const isOtherCompanyAward = awardStatus === "타업체 수주";
      const isPartnerCompanyAward = awardStatus === "협력사 수주";
      return {
        ...draft,
        ...resolvedActivityDate,
        progressSchedule:
          cancellationIntent === "none" ? draft.progressSchedule : "",
        nextAction:
          cancellationIntent === "confirmed" && !String(draft.nextAction ?? "").trim()
            ? "재문의 대기"
            : draft.nextAction,
        detailLevel:
          detailLevelPreference === "auto"
            ? detailLevelValues.includes(String(draft.detailLevel ?? ""))
              ? draft.detailLevel
              : "standard"
            : detailLevelPreference,
        rawInput: userProjectText,
        status: normalizeAiSuggestedStatus(draft.status, false),
        followUpRequired: false,
        followUpDate: "",
        progressManager:
          isPartnerCompanyAward || isOtherCompanyAward
            ? "해당 없음"
            : member.isSales
              ? member.displayName
              : "",
        awardStatus,
        executionType: isOtherCompanyAward
          ? "해당 없음"
          : draft.executionType === "해당 없음"
            ? "직영"
            : draft.executionType,
        consortiumCompany: isOtherCompanyAward
          ? ""
          : draft.consortiumCompany,
        awardStage: isOtherCompanyAward
          ? "미정"
          : draft.awardStage,
      };
    });
    const d1 = await ensureRecordsReady();
    for (const draft of drafts) {
      const rawBudgetName = String(draft.budgetType ?? "").trim();
      const budgetMetadata = await resolveBudgetRecordMetadata(budgetD1, {
        budgetType: rawBudgetName,
        awardStatus: draft.awardStatus,
      });
      draft.budgetOriginalName = budgetMetadata.budgetOriginalName;
      draft.budgetType = budgetMetadata.storedName;
      draft.budgetGroupId = budgetMetadata.budgetGroupId;
      draft.budgetMatchStatus = budgetMetadata.budgetMatchStatus;
      draft.budgetMatchMethod = budgetMetadata.budgetMatchMethod;
      draft.budgetKind = budgetMetadata.budgetKind;
      draft.budgetAmountMode = budgetMetadata.budgetAmountMode;
      draft.budgetAmountOverride = budgetMetadata.budgetAmountOverride;
    }
    const existingOrganizations = await d1
      .prepare(
        `SELECT organization, COUNT(*) AS record_count
         FROM activities
         WHERE organization <> ''
         GROUP BY organization`,
      )
      .all<{ organization: string; record_count: number }>();
    for (const draft of drafts) {
      const requested = String(draft.organization ?? "").trim();
      const key = institutionAliasKey(requested);
      if (!key) continue;
      const exactAliases = existingOrganizations.results
        .map((row) => String(row.organization).trim())
        .filter((existing) => institutionAliasKey(existing) === key);
      if (exactAliases.length) {
        draft.organization = preferFullInstitutionName(...exactAliases);
      }
    }
    const schoolConfirmations: Array<{
      draftIndex: number;
      requestedOrganization: string;
      candidates: Array<{
        officeCode: string;
        schoolCode: string;
        name: string;
        kind: string;
        region: string;
        address: string;
        phone: string;
        coeducation: string;
        existingOrganizations: string[];
        existingRecordCount: number;
      }>;
    }> = [];
    for (let start = 0; start < drafts.length; start += 8) {
      const chunk = drafts.slice(start, start + 8);
      const matches = await Promise.all(
        chunk.map((draft) =>
          findOfficialSchoolCandidates(draft.organization, draft.region),
        ),
      );
      matches.forEach((candidates, chunkIndex) => {
        if (!candidates.length) return;
        const draftIndex = start + chunkIndex;
        const requestedOrganization = String(
          drafts[draftIndex]?.organization ?? "",
        ).trim();
        const enrichedCandidates = candidates.map((candidate) => {
          const candidateKey = institutionAliasKey(candidate.name);
          const aliases = existingOrganizations.results.filter(
            (row) =>
              institutionAliasKey(row.organization) === candidateKey &&
              row.organization !== candidate.name,
          );
          return {
            ...candidate,
            existingOrganizations: aliases.map((row) => row.organization),
            existingRecordCount: aliases.reduce(
              (total, row) => total + Number(row.record_count || 0),
              0,
            ),
          };
        });
        const compactUserText = userProjectText.replace(/\s+/g, "");
        const officialNameWasEntered =
          enrichedCandidates.length === 1 &&
          compactUserText.includes(
            enrichedCandidates[0].name.replace(/\s+/g, ""),
          );
        if (
          officialNameWasEntered &&
          enrichedCandidates[0].existingRecordCount === 0
        ) {
          drafts[draftIndex].organization = enrichedCandidates[0].name;
          return;
        }
        schoolConfirmations.push({
          draftIndex,
          requestedOrganization,
          candidates: enrichedCandidates,
        });
      });
    }
    return Response.json({
      needsClarification: parsed.needsClarification,
      assistantMessage:
        cancellationIntent === "confirmed"
          ? `${parsed.assistantMessage} 기록을 저장한 뒤 기존 일정의 취소 대상을 확인합니다.`
          : cancellationIntent === "review"
            ? `${parsed.assistantMessage} 취소·연기 여부가 불명확해 기존 일정은 유지하고 확인이 필요합니다.`
            : parsed.assistantMessage,
      drafts,
      draft: drafts[0],
      schoolConfirmations,
      scheduleCancellation: cancellationIntent === "none"
        ? undefined
        : {
            intent: cancellationIntent,
            organizations: drafts
              .map((draft) => String(draft.organization ?? "").trim())
              .filter(Boolean),
            scheduledDates: cancellationScheduledDates,
            reason: message.slice(0, 1_500),
          },
      model,
      usage: {
        inputTokens: Number(responsePayload.usage?.input_tokens ?? 0),
        outputTokens: Number(responsePayload.usage?.output_tokens ?? 0),
        totalTokens: Number(responsePayload.usage?.total_tokens ?? 0),
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "AI 정리 결과를 읽지 못했습니다. 다시 시도해 주세요." },
        { status: 502 },
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return Response.json(
        { error: "AI 응답 시간이 길어졌습니다. 다시 시도해 주세요." },
        { status: 504 },
      );
    }
    return accessErrorResponse(error);
  }
}
