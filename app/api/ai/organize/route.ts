import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import { getOpenAIConfig } from "../../../../lib/openai-config";
import {
  ensureRecordsReady,
  serializeProgressSchedule,
} from "../../../../lib/records-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

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
const activityTypeValues = [
  "TM",
  "TM·통화",
  "학교 미팅",
  "학교 진행 중",
  "기관 미팅",
  "협력사 미팅",
  "방문 미팅",
  "업무 통화",
  "제품 통화",
  "계약 통화",
  "수주",
  "AS 통화",
  "기타",
];
const categoryValues = ["학교", "기관", "협력사", "내부", "기타"];
const contactMethodValues = ["유선", "방문", "온라인", "진행 공유", "기타"];
const statusValues = [
  "재접촉 필요",
  "진행 중",
  "결과 확인",
  "후속 완료",
  "장기 추적",
  "대기",
  "완료",
];
const temperatureValues = ["높음", "중간", "낮음"];
const awardStatusValues = ["미정", "위즈업 수주", "타업체 수주"];
const executionTypeValues = ["미정", "직영", "컨소"];
const awardStageValues = [
  "미정",
  "품의",
  "협상",
  "계약",
  "일정 조율",
  "완공",
  "검수",
  "교육",
];
const equipmentStatusValues = [
  "제안",
  "견적",
  "수주",
  "발주",
  "설치 중",
  "설치 완료",
  "미수주",
  "취소",
];
const equipmentProjectStatusValues = [
  "제안",
  "견적",
  "수주",
  "발주",
  "설치 중",
  "설치 완료",
  "보류",
  "취소",
];

const recordDraftSchema = {
  type: "object",
  properties: {
    activityDate: {
      type: "string",
      description: "확인된 날짜를 YYYY-MM-DD로 작성. 모르면 빈 문자열",
    },
    dateConfidence: { type: "string", enum: dateConfidenceValues },
    activityType: { type: "string", enum: activityTypeValues },
    category: { type: "string", enum: categoryValues },
    contactMethod: { type: "string", enum: contactMethodValues },
    region: { type: "string" },
    organization: { type: "string" },
    budgetType: { type: "string" },
    budgetAmount: {
      type: "string",
      description: "사용자가 말한 단위를 포함한 금액. 모르면 빈 문자열",
    },
    topic: { type: "string" },
    summary: { type: "string" },
    status: { type: "string", enum: statusValues },
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
        },
        required: ["label", "date"],
        additionalProperties: false,
      },
    },
    equipmentProjectName: {
      type: "string",
      description:
        "사용자가 실제로 말한 사업명만 작성. 사업명을 말하지 않았으면 빈 문자열",
    },
    equipmentProjectStatus: {
      type: "string",
      enum: equipmentProjectStatusValues,
      description:
        "전체 대화 내용으로 판단한 사업 진행단계. 명시되지 않으면 가장 가까운 단계",
    },
    equipmentItems: {
      type: "array",
      description:
        "기관에 제안·수주·설치한 장비나 물품. 물품 언급이 없으면 빈 배열",
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          productName: { type: "string" },
          specification: {
            type: "string",
            description: "규격, 크기, 모델명. 모르면 빈 문자열",
          },
          proposedQty: {
            type: "number",
            description: "제안 수량. 모르면 0",
          },
          awardedQty: {
            type: "number",
            description: "수주 확정 수량. 모르면 0",
          },
          installedQty: {
            type: "number",
            description: "실제 설치했거나 설치 중인 수량. 모르면 0",
          },
          unit: {
            type: "string",
            description: "대, 식, 세트 등의 단위. 모르면 대",
          },
          status: { type: "string", enum: equipmentStatusValues },
          notes: { type: "string" },
        },
        required: [
          "productName",
          "specification",
          "proposedQty",
          "awardedQty",
          "installedQty",
          "unit",
          "status",
          "notes",
        ],
        additionalProperties: false,
      },
    },
    contactName: { type: "string" },
    contactPhone: { type: "string" },
    contactEmail: { type: "string" },
    notes: { type: "string" },
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
    "equipmentProjectName",
    "equipmentProjectStatus",
    "equipmentItems",
    "contactName",
    "contactPhone",
    "contactEmail",
    "notes",
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

function compactMentionText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function institutionAliasKey(value: string) {
  const name = value.replace(/\s+/g, "").trim();
  if (
    name === "성남초병설유치원" ||
    name === "성남초등학교병설유치원"
  ) {
    return "성남초병설유치원";
  }
  if (!name || /병설유치원|분교/.test(name)) return "";
  return name
    .replace(/초등학교$|초$/, "초")
    .replace(/중학교$|중$/, "중")
    .replace(/고등학교$|고$/, "고");
}

function preferFullInstitutionName(...values: string[]) {
  if (
    values.some(
      (value) =>
        value.replace(/\s+/g, "") === "성남초병설유치원" ||
        value.replace(/\s+/g, "") === "성남초등학교병설유치원",
    )
  ) {
    return "성남초 병설유치원";
  }
  return [...values].sort((a, b) => {
    const aFull = /초등학교$|중학교$|고등학교$/.test(a) ? 1 : 0;
    const bFull = /초등학교$|중학교$|고등학교$/.test(b) ? 1 : 0;
    return bFull - aFull || b.length - a.length;
  })[0];
}

function explicitProjectName(value: unknown, userText: string) {
  const projectName = String(value ?? "").trim();
  if (!projectName) return "";
  const projectKey = compactMentionText(projectName);
  const explicitlyNamed = userText.split(/\r?\n/).some(
    (line) =>
      /사업|프로젝트/.test(line) &&
      compactMentionText(line).includes(projectKey),
  );
  return projectKey && explicitlyNamed
    ? projectName
    : "";
}

function inferredEquipmentItemsFromSchedule(value: unknown) {
  const excluded = new Set([
    "철거",
    "목공",
    "전기",
    "시스템",
    "바닥",
    "네트워크",
    "통신",
    "공사",
    "현장",
    "교육",
    "검수",
    "준공",
    "완공",
  ]);
  return serializeProgressSchedule(value)
    .split(/\r?\n/)
    .map((line) => line.split("\t")[0]?.trim() ?? "")
    .map((label) => {
      const match = label.match(
        /^(.+?)\s*(?:설치|납품|시공)(?:\s*(?:중|완료|예정))?$/,
      );
      const productName = match?.[1]?.trim() ?? "";
      if (!productName || excluded.has(productName)) return null;
      return {
        productName,
        specification: "",
        proposedQty: 0,
        awardedQty: 0,
        installedQty: 0,
        unit: "대",
        status: /완료/.test(label) ? "설치 완료" : "설치 중",
        notes: "",
      };
    })
    .filter((item) => item !== null);
}

function normalizeDraft(
  value: unknown,
  userText = "",
): Record<string, unknown> {
  const draft =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const progressSchedule = serializeProgressSchedule(draft.progressSchedule);
  return {
    ...draft,
    progressSchedule,
    equipmentProjectName: explicitProjectName(
      draft.equipmentProjectName,
      userText,
    ),
    equipmentProjectStatus: equipmentProjectStatusValues.includes(
      String(draft.equipmentProjectStatus),
    )
      ? String(draft.equipmentProjectStatus)
      : "제안",
    equipmentItems: mergeEquipmentItems(
      draft.equipmentItems,
      inferredEquipmentItemsFromSchedule(progressSchedule),
    ),
    sourceChat: "사이트 AI 입력",
  };
}

function normalizeEquipmentItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  const grouped = new Map<string, Record<string, unknown>>();
  value.slice(0, 100).forEach((item) => {
    const row =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {};
    const productName = String(row.productName ?? "")
      .trim()
      .replace(/\s*(?:설치|납품|시공)(?:\s*(?:중|완료|예정))?$/, "")
      .trim();
    if (!productName) return;
    const specification = String(row.specification ?? "").trim();
    const key = `${productName}|${specification}`
      .replace(/\s+/g, "")
      .toLocaleLowerCase("ko-KR");
    const previous = grouped.get(key);
    grouped.set(key, {
      productName,
      specification,
      proposedQty: Math.max(
        Number(previous?.proposedQty ?? 0),
        Math.max(0, Number(row.proposedQty) || 0),
      ),
      awardedQty: Math.max(
        Number(previous?.awardedQty ?? 0),
        Math.max(0, Number(row.awardedQty) || 0),
      ),
      installedQty: Math.max(
        Number(previous?.installedQty ?? 0),
        Math.max(0, Number(row.installedQty) || 0),
      ),
      unit: String(row.unit ?? previous?.unit ?? "대").trim() || "대",
      status:
        equipmentStatusValues.includes(String(row.status))
          ? String(row.status)
          : String(previous?.status ?? "제안"),
      notes: [String(previous?.notes ?? "").trim(), String(row.notes ?? "").trim()]
        .filter(Boolean)
        .filter((note, index, notes) => notes.indexOf(note) === index)
        .join(" · "),
    });
  });
  return [...grouped.values()];
}

function mergeEquipmentItems(...values: unknown[]) {
  return normalizeEquipmentItems(
    values.flatMap((value) => (Array.isArray(value) ? value : [])),
  );
}

function advancedEquipmentProjectStatus(...values: unknown[]) {
  const statuses = values.map((value) => String(value ?? ""));
  const explicitException = [...statuses]
    .reverse()
    .find((status) => status === "보류" || status === "취소");
  if (explicitException) return explicitException;
  const rank = new Map(
    ["제안", "견적", "수주", "발주", "설치 중", "설치 완료"].map(
      (status, index) => [status, index],
    ),
  );
  return statuses.reduce(
    (best, status) =>
      (rank.get(status) ?? -1) > (rank.get(best) ?? -1) ? status : best,
    "제안",
  );
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

function normalizeDrafts(
  value: unknown,
  userText = "",
): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const grouped = new Map<string, Record<string, unknown>>();

  value.slice(0, 50).forEach((entry) => {
    const normalized = normalizeDraft(entry, userText);
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
      progressSchedule: mergeProgressSchedules(
        existing.progressSchedule,
        normalized.progressSchedule,
      ),
      equipmentProjectName:
        String(existing.equipmentProjectName ?? "").trim() ||
        String(normalized.equipmentProjectName ?? "").trim(),
      equipmentProjectStatus: advancedEquipmentProjectStatus(
        existing.equipmentProjectStatus,
        normalized.equipmentProjectStatus,
      ),
      equipmentItems: mergeEquipmentItems(
        existing.equipmentItems,
        normalized.equipmentItems,
      ),
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

    const { apiKey, model, configured } = getOpenAIConfig();
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
오늘 날짜는 ${todayInSeoul()}입니다.
사용자의 현재 메시지와 직전 대화만 근거로 기관별 영업 기록 초안을 만드세요.
여러 기관의 표, 목록, 복사한 셀, 여러 줄 일정을 한 번에 받으면 drafts에 기관별로 한 항목씩 정확히 분리하세요.
같은 기관이 여러 줄에 나오면 하나의 draft로 합치고 그 기관의 progressSchedule에 일정만 모으세요.
직전 질문에서 사용자가 같은 기관이라고 확인했다면 기존의 축약하지 않은 정식 기관명을 사용하세요.
같은 기관의 장비·물품은 equipmentItems에 품목별로 나누고 중복 품목은 하나로 합치세요.
기관명에 "외 15건", "외 N건", "등 여러 곳" 같은 묶음 표현을 절대 사용하지 마세요.
각 일정은 해당 기관에만 넣고, 같은 기관·일정명·날짜 조합은 한 번만 넣으세요.
기관명이 없거나 어느 기관인지 판단할 수 없을 때만 needsClarification을 true로 하고 한 가지 짧은 질문을 하며 drafts는 빈 배열로 두세요.
그 외에는 needsClarification을 false로 하고 assistantMessage에 "N개 기관으로 정리했습니다. 내용을 확인해 주세요."처럼 기관 수를 포함해 짧게 답하세요.
전화·TM은 유선, 직접 대면은 방문, 화상은 온라인으로 정리하세요.
수주 후 공사·설치·교육 일정이나 진행 상황을 기관·학교에 전달하고 공유한 기록이면 contactMethod를 진행 공유로 정리하세요.
학교 영업이 계속 진행 중이면 활동유형은 학교 진행 중을 사용하세요.
수주 후 "목공 6/17, 시스템 6/19" 같은 일정은 progressSchedule에 각각 나누어 넣으세요.
progressSchedule에 일정이 하나라도 있으면 위즈업이 수주한 건이므로 awardStatus는 반드시 위즈업 수주로 정리하세요.
현재 연도가 생략된 월/일은 ${todayInSeoul().slice(0, 4)}년으로 정리하세요.
모르는 값은 추측하지 말고 빈 문자열로 두세요.
타업체 수주인데 업체명을 모르면 awardStatus를 미정으로 두고 notes에 확인 필요라고 적으세요.
사업방식은 executionType에 미정, 직영, 컨소 중 하나로 정리하고 컨소라면 consortiumCompany에 함께하는 업체명을 넣으세요.
수주 현재 상태는 awardStage에 미정, 품의, 협상, 계약, 일정 조율, 완공, 검수, 교육 중 하나로 정리하세요.
사용자가 제안·견적·수주·설치 장비나 물품을 말하면 equipmentItems에 반드시 정리하세요.
equipmentProjectName은 사용자가 사업명이나 프로젝트명을 실제로 말한 경우에만 그대로 작성하세요. 사업명이 없으면 기관명·예산·주제·공사 일정으로 이름을 만들지 말고 반드시 빈 문자열로 두세요.
일정에 "스크린 설치", "아이핏 설치"처럼 품목명 뒤에 설치·납품·시공이 나오면 스크린, 아이핏을 각각 equipmentItems의 productName으로 넣으세요. 수량과 규격을 말하지 않았으면 0과 빈 문자열로 두세요. 목공·철거·바닥·전기·시스템·검수·교육·완공은 그 자체를 장비 품목으로 만들지 마세요.
equipmentProjectStatus는 대화 전체를 보고 제안·견적·수주·발주·설치 중·설치 완료·보류·취소 중 하나로 판단하세요.
완공·검수 완료·교육 완료는 설치 완료, 공사·설치·목공·시스템 작업 진행은 설치 중, 계약·수주 확정은 수주로 판단하세요. 장비나 품목을 말하지 않았다면 equipmentItems는 빈 배열로 두세요.
각 품목은 제안 수량, 수주 수량, 설치 수량을 서로 덮어쓰지 말고 별도로 기록하세요.
예를 들어 "전자칠판 3대 제안, 2대 수주해 1대 설치"는 proposedQty 3, awardedQty 2, installedQty 1입니다.
수량을 모르면 0으로 두고, 품목 상태는 제안·견적·수주·발주·설치 중·설치 완료·미수주·취소 중 하나를 사용하세요.
기관 담당자와 기관 메일은 contactName과 contactEmail에, 수주 후 진행을 맡는 사람은 progressManager에 정리하세요.
사용자가 재연락 불필요 또는 완료라고 명시했을 때만 followUpRequired를 false로 두세요.
summary는 기관별 핵심 사실만 1~2문장 이내의 한국어로 요약하세요.`,
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
    const drafts = normalizeDrafts(parsed.drafts, userProjectText).map(
      (draft): Record<string, unknown> => {
        const hasProgressSchedule = Boolean(
          String(draft.progressSchedule ?? "").trim(),
        );
        return {
          ...draft,
          activityDate: postedDate,
          dateConfidence: "대화시각 추정",
          progressManager: member.displayName,
          awardStatus: hasProgressSchedule ? "위즈업 수주" : draft.awardStatus,
          equipmentProjectStatus:
            hasProgressSchedule &&
            ["제안", "견적"].includes(
              String(draft.equipmentProjectStatus ?? ""),
            )
              ? "수주"
              : draft.equipmentProjectStatus,
        };
      },
    );
    const d1 = await ensureRecordsReady();
    const existingOrganizations = await d1
      .prepare("SELECT DISTINCT organization FROM activities WHERE organization <> ''")
      .all<{ organization: string }>();
    const negativeAliasAnswer =
      /^(아니|아니요|아닙니다|별도|다른)/.test(message) &&
      history.some(
        (item) =>
          item.role === "assistant" && item.text.includes("같은 기관"),
      );
    if (!negativeAliasAnswer) {
      for (const draft of drafts) {
        const requested = String(draft.organization ?? "").trim();
        const key = institutionAliasKey(requested);
        if (!key) continue;
        const aliases = existingOrganizations.results
          .map((row) => String(row.organization).trim())
          .filter(
            (existing) =>
              existing !== requested &&
              institutionAliasKey(existing) === key,
          );
        if (aliases.length) {
          const canonical = preferFullInstitutionName(requested, ...aliases);
          return Response.json({
            needsClarification: true,
            assistantMessage: `입력한 기관: ${requested}\n기존 기관: ${canonical}\n두 이름을 같은 기관으로 합칠까요? 같으면 “네”, 별도 기관이면 “아니요”라고 알려주세요.`,
            drafts: [],
          });
        }
      }
    }
    return Response.json({
      needsClarification: parsed.needsClarification,
      assistantMessage: parsed.assistantMessage,
      drafts,
      draft: drafts[0],
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
