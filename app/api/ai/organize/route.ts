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
  "í™•ì •",
  "ëŒ€í™”ì‹œê° ì¶”ì •",
  "ì›”ë§Œ í™•ì¸",
  "ë‚ ì§œ ë¯¸ìƒ",
];
const categoryValues = ["í•™êµ", "ê¸°ê´€", "í˜‘ë ¥ì‚¬", "ë‚´ë¶€", "ê¸°íƒ€"];
const contactMethodValues = ["ìœ ì„ ", "ë°©ë¬¸", "ì˜¨ë¼ì¸", "ì§„í–‰ ê³µìœ ", "ê¸°íƒ€"];
const temperatureValues = ["ë†’ìŒ", "ì¤‘ê°„", "ë‚®ìŒ"];
const awardStatusValues = ["ë¯¸ì •", "ìœ„ì¦ˆì—… ìˆ˜ì£¼", "í˜‘ë ¥ì‚¬ ìˆ˜ì£¼", "íƒ€ì—…ì²´ ìˆ˜ì£¼"];
const executionTypeValues = ["ì§ì˜", "ì»¨ì†Œ", "í•´ë‹¹ ì—†ìŒ"];
const awardStageValues = [...AWARD_STAGE_OPTIONS];
const detailLevelValues = ["compact", "standard", "detailed"];

const recommendationSchema = {
  type: "object",
  properties: {
    meetingSummary: {
      type: "string",
      description:
        "í™•ì¸ëœ ë¯¸íŒ…Â·TM ì‚¬ì‹¤ë§Œ 2ë¬¸ì¥ ì´ë‚´ë¡œ ìš”ì•½. ì—†ëŠ” ì •ë³´ë‚˜ ìš”ì•½ ê¸°ì¤€ì— ëŒ€í•œ í•´ì„¤ì€ ì“°ì§€ ì•ŠìŒ",
    },
    interests: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
      description: "ê¸°ê´€ì´ ê´€ì‹¬ì„ ë³´ì¸ í•­ëª©ê³¼ í•´ê²°í•´ì•¼ í•  í•„ìš”",
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
            description: "ë¯¸íŒ… ë‚´ìš©ê³¼ ì—°ê²°í•œ ì¶”ì²œ ì´ìœ ",
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
      description: "ë‹¤ìŒ ì—°ë½ì—ì„œ í™•ì¸í•˜ë©´ ì¢‹ì€ êµ¬ì²´ì ì¸ ì§ˆë¬¸",
    },
    recommendedActions: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
      description: "ë‹´ë‹¹ìê°€ ë°”ë¡œ ì‹¤í–‰í•  ìˆ˜ ìˆëŠ” ì§§ì€ í›„ì† í–‰ë™",
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
        "ì‹¤ì œ í†µí™”Â·ë¯¸íŒ…Â·í™œë™ ë‚ ì§œë¥¼ YYYY-MM-DDë¡œ ì‘ì„±. ì…ë ¥ ì œëª©ì´ë‚˜ ë³¸ë¬¸ì— ë‚ ì§œê°€ ìˆìœ¼ë©´ ê·¸ ë‚ ì§œë¥¼ ì‚¬ìš©í•˜ê³ , ê³µì‚¬Â·ì¬ì—°ë½Â·í›„ì† ì¼ì • ë‚ ì§œì™€ í˜¼ë™í•˜ì§€ ì•ŠìŒ",
    },
    dateConfidence: { type: "string", enum: dateConfidenceValues },
    activityType: { type: "string", enum: ["ê¸°íƒ€"] },
    category: { type: "string", enum: categoryValues },
    contactMethod: { type: "string", enum: contactMethodValues },
    region: { type: "string" },
    organization: { type: "string" },
    budgetType: { type: "string" },
    budgetAmount: {
      type: "string",
      description: "ì‚¬ìš©ìê°€ ë§í•œ ë‹¨ìœ„ë¥¼ í¬í•¨í•œ ê¸ˆì•¡. ëª¨ë¥´ë©´ ë¹ˆ ë¬¸ìì—´",
    },
    topic: {
      type: "string",
      description: "í˜¸í™˜ì„±ì„ ìœ„í•´ í•­ìƒ ë¹ˆ ë¬¸ìì—´",
    },
    summary: {
      type: "string",
      description:
        "í™•ì¸ëœ ì¼ì •Â·ê²°ì •Â·í›„ì† í–‰ë™ë§Œ ê°„ê²°í•˜ê²Œ ìš”ì•½. ì—†ëŠ” ì •ë³´ë‚˜ í•´ì„¤ì€ ì“°ì§€ ì•ŠìŒ",
    },
    detailLevel: {
      type: "string",
      enum: detailLevelValues,
      description:
        "ì§§ì€ í™•ì¸ì€ compact, ì¼ë°˜ TMì€ standard, ë¯¸íŒ…Â·ë°©ë¬¸Â·í˜„ì¥ì‹¤ì¸¡ ë˜ëŠ” ì—¬ëŸ¬ ì£¼ì œì™€ ê¸ˆì•¡Â·ì¼ì •ì´ í¬í•¨ëœ ê¸´ ê¸°ë¡ì€ detailed",
    },
    detailSummary: {
      type: "string",
      description:
        "ì›ë¬¸ ì‚¬ì‹¤ì„ ë³´ì¡´í•œ ìƒì„¸ ê¸°ë¡ì˜ í•µì‹¬ ìš”ì•½. compactëŠ” ë¹ˆ ë¬¸ìì—´ ê°€ëŠ¥",
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
    status: { type: "string", enum: ["ìƒë‹´ ì§„í–‰"] },
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
      description: "ì¬ì—°ë½ ì˜ˆì •ì¼ì„ YYYY-MM-DDë¡œ ì‘ì„±. ëª¨ë¥´ë©´ ë¹ˆ ë¬¸ìì—´",
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
            description: "ì§„í–‰ ì¼ìë¥¼ YYYY-MM-DDë¡œ ì‘ì„±",
          },
          startTime: {
            type: "string",
            description: "ì •í™•í•œ ì‹œì‘ ì‹œê°„ì´ í™•ì¸ë˜ë©´ HH:mm, ì—†ìœ¼ë©´ ë¹ˆ ë¬¸ìì—´",
          },
          endTime: {
            type: "string",
            description: "ì •í™•í•œ ì¢…ë£Œ ì‹œê°„ì´ í™•ì¸ë˜ë©´ HH:mm, ì—†ìœ¼ë©´ ë¹ˆ ë¬¸ìì—´",
          },
        },
        required: ["label", "date", "startTime", "endTime"],
        additionalProperties: false,
      },
    },
    contactRole: {
      type: "string",
      description:
        "ê¸°ê´€ ì¸ë¬¼ì˜ ëª…ì‹œëœ ì—­í• . ê³µì‚¬ ë‹´ë‹¹ì, íšŒê³„ ë‹´ë‹¹ì, í–‰ì • ë‹´ë‹¹ìì²˜ëŸ¼ ì…ë ¥ì— ë‚˜ì˜¨ ì—­í• ì„ ê·¸ëŒ€ë¡œ ì‘ì„±. ëª¨ë¥´ë©´ ë¹ˆ ë¬¸ìì—´",
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
        "ì¶”ê°€ ì •ë³´ê°€ í•„ìš”í•˜ë©´ í•œ ê°€ì§€ ì§§ì€ ì§ˆë¬¸. ì•„ë‹ˆë©´ ì •ë¦¬ ì™„ë£Œ ì•ˆë‚´",
    },
    drafts: {
      type: "array",
      description:
        "ê¸°ê´€ë³„ë¡œ ë¶„ë¦¬í•œ ê¸°ë¡ ì´ˆì•ˆ. ê°™ì€ ê¸°ê´€ì€ ë°˜ë“œì‹œ í•œ í•­ëª©ìœ¼ë¡œ í•©ì¹¨",
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
    /ì¼ì •.{0,18}(?:ì´|ì€|ì„|ê°€)?\s*ì·¨ì†Œ\s*(?:ë|ë˜ì—ˆ|ë¨|í•©ë‹ˆë‹¤|ëìŠµë‹ˆë‹¤|ë˜ì—ˆë‹¤|ëë‹¤ê³ )/,
    /ë°©ë¬¸.{0,18}(?:ì´|ì€|ì„|ê°€)?\s*ì·¨ì†Œ\s*(?:ë|ë˜ì—ˆ|ë¨|í•©ë‹ˆë‹¤|ëìŠµë‹ˆë‹¤|ë˜ì—ˆë‹¤|ëë‹¤ê³ )/,
    /ì˜ˆì •.{0,18}(?:ì´|ì€|ì„|ê°€)?\s*ì·¨ì†Œ\s*(?:ë|ë˜ì—ˆ|ë¨|í•©ë‹ˆë‹¤|ëìŠµë‹ˆë‹¤|ë˜ì—ˆë‹¤|ëë‹¤ê³ )/,
  ].some((pattern) => pattern.test(compact));
  if (confirmed) return "confirmed";
  return /ì·¨ì†Œ|ì—°ê¸°|ë³€ê²½\s*ê°€ëŠ¥|ì¼ì •\s*ë¯¸ì •/.test(compact) ? "review" : "none";
}

function cancellationDates(message: string, today: string) {
  const dates = new Set<string>();
  const year = Number(today.slice(0, 4));
  for (const match of message.matchAll(/(20\d{2})[.\-/ë…„]\s*(\d{1,2})[.\-/ì›”]\s*(\d{1,2})ì¼?/g)) {
    dates.add(`${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`);
  }
  for (const match of message.matchAll(/(?:^|\s)(\d{1,2})ì›”\s*(\d{1,2})ì¼/g)) {
    dates.add(`${year}-${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`);
  }
  if (/ë‚´ì¼/.test(message)) {
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
        throw new Error("í•´ë‹¹ ë‚´ìš©ì€ AIê°€ ì •ë¦¬í•  ìˆ˜ ì—†ìŠµë‹ˆë‹¤.");
      }
      if (part.type === "output_text" && part.text?.trim()) {
        return part.text.trim();
      }
    }
  }
  throw new Error("AI ì •ë¦¬ ê²°ê³¼ê°€ ë¹„ì–´ ìˆìŠµë‹ˆë‹¤.");
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
    activityType: "ê¸°íƒ€",
    contactMethod: "ê¸°íƒ€",
    status: "ìƒë‹´ ì§„í–‰",
    temperature: "ì¤‘ê°„",
    followUpRequired: false,
    followUpDate: "",
    progressSchedule,
    equipmentProjectName: "",
    equipmentProjectStatus: "ì œì•ˆ",
    equipmentItems: [],
    sourceChat: "ì‚¬ì´íŠ¸ AI ì…ë ¥",
  };
}

function mergeProgressSchedules(...vaã^·¶‰ËkºwµçJ³ªÂ ƒ®w®
³®6S®vó®>ƒªÊ²"c
ßªÖC²r„ƒ®bC®*Pƒ²Ös²Šƒ²vãªÎªÂ ƒ®
£²Vƒ²z#²ró®¦ĞƒªÊ²"c
ßªÖC²r„ƒ²¶Z'²ró®†pƒ®FC²ã²jP¸ƒ®
§¶J ƒ²f®3®*Pƒ²
³²j§²zCªÂ ƒ®
§¶J ƒ²f®3
ß²Ös²Šƒ²f®3
ß²
³²^ƒ²Š®3®–ğƒ®ª².s¶Z#ªÆÃ®
`ƒªÊ²"c²f ƒªÖC²r‡ªæ3² ƒ®ª£®F@ƒ®w®
³®.“ªÎ€ƒ®Ú®ª¶z ƒ®C¶VpƒªÊ÷²jÃ²^C®0ƒ²
³²j§¶Vc²ã²jP¸ƒªÊ²"`ƒ²f®0ƒ®bC®*PƒªÖC²r„ƒ²f®0ƒ²’Dƒ¶Vc®
c®0ƒ²Zãªâ'¶VpƒªÊ÷²jÃ²^C®*Pƒ®
§¶J ƒ²f®3®†pƒ²ÚS²â‡¶Vc² ƒ®#²ã²jP¸4)$ƒ²z®‚—²^C²s®*Pƒ²z—®æ
ß®²ó¶J#²v`ƒ¶J#®ª¤°ƒ²"c®~$°ƒªŞsªÊ¤°ƒ²“²æ`ƒ²"c®~'²vÓ®
`ƒ¶J#®ª¤ƒªÒ®š³²j¤ƒ²
³²^ƒ²‚W®ÎÓ®–ğƒ²ÚS²Ús¶VcªÆÃ®
`ƒ®3®N“² ƒ®#²ã²jP¸€‹²*“¶³®šÀƒ²“²æ`ˆƒªÂg²v ƒ¶Fs¶b²v ƒ¶V²jS¶VpƒªÊ÷²jÀƒ².sªÎÔƒ²vó²‚W²v`ƒ®.£ªÎ
ß®¦S®ª ƒ®—®v÷²ró®†s®0ƒ®ÎÓ²†Ó¶VcªÎ€ƒ¶J#®ª¤ƒªÒ®š°ƒ®6Ã²vÓ¶Ã®†pƒ®3®N“² ƒ®#²ã²jP¸4+ªâÃªÒ ƒ²vã®²ó²v`ƒ²^·¶Vƒ²vĞƒªÎ×²
°ƒ®.Ó®.ç²zC
ß¶j3ªÎƒ®.Ó®.ç²zC
ß¶Z'²‚Tƒ®.Ó®.ç²zC²Êc®~ğƒ®ª².s®Bc®¦Ğ½¹Ñ…ÑI½±—²^@ƒªŞàƒ²^·¶Vƒ²vƒªŞã®2®†pƒ®ªÎ€ƒ²vÓ®š
ß²²Æ²v ½¹Ñ…Ñ9…µ—²^@ƒ®²ró²ã²jP¸½¹Ñ…ÑI½±”½½¹Ñ…Ñ9…µ—²^@ƒ®Ú®š³¶VĞƒ®²v ƒŠsªÎ×²
°ƒ®.Ó®.ç²zC®*P==?®†pƒ¶fW²vã®BC®.“ŠtƒªÂg²v ƒ®²ã²z—²v ÍÕµµ…Éç²f É•½µµ•¹‘…Ñ¥½¸¹µ••Ñ¥¹MÕµµ…Éç²^C²pƒ®Âc®Î×¶Vc² ƒ®#²ã²jP¸4)ÁÉ½É•ÍÍ5…¹…•Ë®*Pƒ²r²š#²^ƒ®
Ó®Ú²^C²pƒ²"c²ğƒ¶nƒ²¶Z'²vƒ®‡®*Pƒ²
³®z3²ró®†p°ƒªâÃªÒ²v`½¹Ñ…ÑI½±”½½¹Ñ…Ñ9…µ—ªÎğƒ²‚#®2 ƒ²{² ƒ®#²ã²jP¸ƒªâÃªÒ ƒ®¦S²vó²v ½¹Ñ…Ñµ…¥³²^@ƒ²‚W®š³¶Vc²ã²jP¸4)™½±±½İUÁI•ÅÕ¥É•“®*Pƒ²z®‚”ƒ®
Ó²j§ªÎğƒªÒªÎ²^²vĞƒ¶V·²™…±Í—®†pƒ®FCªÎ€™½±±½İUÁ…Ñ—®*Pƒ¶V·²ƒ®æ ƒ®²ã²zC²^Ó®†pƒ®FC²ã²jP¸ƒ²z³²^Ã®vôƒ¶V²jPƒ²^³®Ú®*Pƒ²
³²j§²zCªÂ ƒ²‚²z”ƒ²‚²^@ƒ²²‚Dƒ²ƒ¶w¶V§®.#®.¸4)ÍÕµµ…Éç²f É•½µµ•¹‘…Ñ¥½¸¹µ••Ñ¥¹MÕµµ…Éç²^C®*PƒªâÃªÒ²vĞƒ²‚®.³¶Vpƒ²
³².°ƒ¶fW²‚Tƒ²vó²‚T°ƒªÊÃ²‚Tƒ²
³¶V´°ƒ¶n²4ƒ¶Z'®>g®0€ÅøË®²ã²z”ƒ²vÓ®
Ó®†pƒ²jS²V÷¶Vc²ã²jP¸4)ÍÕµµ…Éç²f É•½µµ•¹‘…Ñ¥½¸¹µ••Ñ¥¹MÕµµ…Éç®*PƒŠs®ó²vc¶Z#²*×®.#®.“Št°ƒŠs¶fW²vã¶Z#²*×®.#®.“Št°ƒŠs²¶Z'¶V§®.#®.“ŠtƒªÂg²v ƒ²†Ó®2O®@ƒ®ÎÓªÎƒ²ÊÓ®†pƒ²zG²Ç¶Vc²ã²jP¸ƒŠs®ó²vc¶Z#®.“Št°ƒŠs¶fW²vã¶Vs®.“Št°ƒŠs²¶Z'¶V£ŠtƒªÂg²v ƒ®Âc®C
ß®¦S®ª£²ÊĞƒ²ŠªÊÃ²v ƒ²
³²j§¶Vc² ƒ®#²ã²jP¸4+ªâÃªÒ ƒ®.Ó®.ç²zCªÂ ƒ®C¶Vpƒ²¶f§²vƒŠs²‚®.³¶Z#²*×®.#®.“Šw®vóªÎ€ƒ²NÃ² ƒ®#²ã²jP¸ƒªâÃªÒ²v`ƒ²“®ª²v ƒŠs®C²R¶Vc²£²*×®.#®.“Št°ƒŠs²V#®
Ó®Âo²Vc²*×®.#®.“Št°ƒŠs¶fW²vã®BC²*×®.#®.“Šw²Êc®~ğƒ®"ªÂ ƒ®C¶Z#®*S² ƒ²zC²^Ã²*“®~÷ªÊ0ƒ²vÓ¶VÓ®Bc®*Pƒ¶Fs¶b²ró®†pƒ²‚W®š³¶Vc²ã²jP¸ƒŠs²‚®.³¶Z#²*×®.#®.“Šw®*Pƒ²r²š#²^ƒ®.Ó®.ç²zCªÂ ƒ².“²‚s®†pƒ²zC®3®
`ƒ®
Ó²j§²vƒ²‚®.³¶VpƒªÊ÷²jÃ²^C®0ƒ²
³²j§¶Vc²ã²jP¸4+®ç²Ş£ªÂ ƒ®Ú#®ª¶fW¶VcªÆÃ®
`ƒ²b“²vã².w®Bpƒ®.£²ZÓ®*PƒªŞã®2®†pƒ²b»ªâÃªÆÃ®
`ƒ²ÚS²â‡¶VĞƒªÖ³²ÊÓ¶fS¶Vc² ƒ®CªÎ€°ƒ²V{®Jƒ®²ã®—²^C²pƒ¶fW².“¶Vpƒ®ÊS²r²v`ƒ²vó®Âc²‚²vàƒ¶Fs¶b²ró®†pƒ²‚W®š³¶Vc²ã²jP¸ƒ²b#®–ğƒ®N“²ZĞƒ²’®æƒ®2²²vĞƒ®Ú#®ª¶fW¶Vc®¦ĞƒŠsªÖC®
Ğƒ²vó²‚Tƒ²’®æ®†pƒ²^®²ÓªÂ ƒ®Ú²ó¶Vpƒ²¶f§Šw²Êc®~ğƒ²NÃ²ã²jP¸4+²z³²^Ã®v÷²vóªÎğƒ¶n²4ƒ²^Ã®vôƒ²vó²‚W²v ƒ®Î®>ƒªÒ®š°ƒ¶V·®ª§²vÓ®¾®†pÍÕµµ…Éç²f É•½µµ•¹‘…Ñ¥½¸¹µ••Ñ¥¹MÕµµ…Éç²^C®*Pƒ®² ƒ®#²ã²jP¸4+Šs²vó²‚Tƒ¶fW²vã²vĞƒ¶V×².³Št°ƒŠs®Î®>ƒ²z—®æ®
`ƒ²"c²ğƒ²‚W®ÎĞƒ²^²v3Št°ƒŠs²ÚSªÂ ƒ²‚W®ÎĞƒ²^²v3Št°ƒŠs¶*ç²vÓ²
³¶V´ƒ²^²v3Šw²Êc®~ğ'²v`ƒ¶VÓ²“²vÓ®
`ƒ²z®‚—²^@ƒ²^®*Pƒ¶V·®ª§²v`ƒ®Ú²z³®–ğƒ²“®ª¶Vc®*Pƒ®²ã²z—²v ƒ²‚#®2 ƒ®3®N“² ƒ®#²ã²jP¸4+®. °ƒªâÃªÒ²vĞƒ¶*ç²‚Tƒ²z—®æªÂ ƒ¶V²jPƒ²^®.“ªÎ€ƒ²‚®.³¶Z#ªÆÃ®
`ƒ®¾ã²"c²óªÂ ƒ¶fW²‚W®BpƒªÊ²Êc®~ğƒ².“²‚pƒ®Âs²Zã
ßªÊÃ²‚W²^@ƒ¶>³¶V£®Bpƒ®Ú²‚Tƒ²
³².“²v ƒ²w®z×¶Vc² ƒ®#²ã²jP¸4+²²àƒªâÃ®†tƒ²ƒ¶bã®*P€ˆ‘í‘•Ñ…¥±1•Ù•±AÉ•™•É•¹•ô‹²z®.#®.¸…ÕÑ¿²vÓ®¦Ğƒ²Ÿ²v ƒ®.£²"pƒ¶fW²vã²v ½µÁ…Ğ°ƒ²vó®Â`Q7
ß¶×¶fS®*PÍÑ…¹‘…É°ƒ®¾ã¶2
ß®Â§®²ã
ß¶b²z”ƒ².“²â„ƒ®bC®*Pƒ²b#²
Ã
ßªÊ³²‚
ß²‚s¶J#
ßªÎ×ªÂ
ß²"c²ó
ß®
§¶J#
ß²^³®~°ƒ²vó²‚W²Êc®~ğƒ²s®†pƒ®.“®–àƒ²
³².“²vĞƒ²^³®~°ƒªÂpƒ¶>³¶V£®BpƒªâÃ®†w²v ‘•Ñ…¥±•“®†pƒ¶2C®.£¶Vc²ã²jP¸ƒ²ZÓ®*@ƒ²"c²’²vã² ƒ²Vƒ®“¶Vc®¦ĞÍÑ…¹‘…É“®–ğƒ²
³²j§¶Vc²ã²jP¸…ÕÑ¿ªÂ ƒ²V®.#®¦Ğƒ®Âc®Ns².pƒ²²‚W®Bpƒ²²àƒ²"c²’²vƒ²
³²j§¶Vc²ã²jP¸4+²²àƒ²"c²’²v ƒ¶fS®¦Ó²^@ƒ®ÎÓ²vÓ®*Pƒ²s²"€ƒ®Ú®~'®0ƒ²†Ã²‚#¶V§®.#®.¸ƒ²ZÓ®Zƒ²"c²’²vÓ®N€ƒªâÃªÒ®ª°ƒ®
ƒ²p°ƒ²b#²
Ã®ª
ßªâ#²V„°ƒªâÃªÒ ƒ®.Ó®.ç²z@°ƒ²¶Z$ƒ®.Ó®.ç²z@°ƒ²"c²ğƒ²¶p°ƒ¶n²4ƒ²vó²‚Tƒ®NÄƒªÖ³²†Ã¶fPƒ¶V®Ns®*Pƒ²nC®²ã²^C²pƒ¶fW²vã®Bc®*PƒªÂK²vƒ®æƒ²C²^²vĞƒ²ÚS²Ús¶Vc²ã²jP¸4)½µÁ…Ó²vÓ®¦Ğ‘•Ñ…¥±MÕµµ…Éä°‘•Ñ…¥±-•å…ÑÌ°‘•Ñ…¥±M•Ñ¥½¹Ï®–ğƒ®æ²n3®>ƒ®B§®.#®.¸ÍÑ…¹‘…É“²f ‘•Ñ…¥±•“²vÓ®¦Ğ‘•Ñ…¥±MÕµµ…Éç²^@ƒ²‚²ÊĞƒ®—®v÷²v€Éø×®²ã²z—²ró®†pƒ®ÎÓ²†Ó¶VcªÎ€°‘•Ñ…¥±-•å…ÑÏ²^C®*Pƒ²Âã²w²zC
ß²Òw²b#²
Ã
ß²ó²jPƒ²vó²‚W
ß²
³²^®ª²Êc®~ğƒ²nC®²ã²^@ƒ®ª².s®Bpƒ¶V×².°ƒ²
³².“®0ƒ®²ró²ã²jP¸4)‘•Ñ…¥±•“²vÓ®¦Ğ‘•Ñ…¥±M•Ñ¥½¹Ï®–ğƒ²b#²
À°ƒªÖ³²ÚTƒ®Â§¶Z”°ƒªÎ×ªÂ®ÎƒªÊ¶€°ƒªÊ÷²~ƒ²^²ÊĞ°ƒªÎ×²
°ƒ®Â<ƒ²vó²‚T°ƒ¶Z—¶nƒ²¶Z$ƒ®NÄƒ².“²‚pƒ²nC®²ã²^@ƒ²z#®*Pƒ²ó²‚s®†pƒ®
c®"²ã²jP¸ƒ²nC®²ã²^@ƒ²^®*Pƒ²ç²c²v ƒ®3®N“² ƒ®CªÎ€°ƒªâĞƒ²nC®²ã²vƒ²®
c²æcªÊ0ƒ²ÚW²V÷¶Vc² ƒ®#²ã²jP¸ƒ®
ƒ²s
ßªâ#²V‡
ß²‚s¶J#®ª
ß²Âã²w²zC
ß²^²ÊÓ®ª
ß²"c®~'²vƒ²z²vc®†pƒ®ÂSªúãªÆÃ®
`ƒ²ÚSªÂ¶Vc² ƒ®#²ã²jP¸4+ªÂ‘É…™Ó²v`É•½µµ•¹‘…Ñ¥½»²^C®*PƒªÎ×².tƒªâÃ®†w²vƒ²zC®>dƒ®ÎªÊ÷¶Vc² ƒ²V+®*Pƒ®Î®>ƒ²b²^ƒ®2²vDƒ²‚s²V#²vƒ²zG²Ç¶Vc²ã²jP¸4+²ÚS²Êpƒ²‚s¶J#²v ƒ²V®z`ƒ®
Ó®Ú ƒ²‚s¶J ƒ²zC®3²^@ƒ²z#®*Pƒ²‚s¶J#®ª®0ƒ²
³²j§¶VcªÎ€°ƒ®¾ã¶2ƒ®
Ó²j§²^C²pƒ¶fW²vã®Bc®*Pƒ¶V²jS²f ƒ²^ÃªÊÃ®Bc®*PƒªÊ÷²jÃ²^C®0ƒ²Ös®2 €ÓªÂsªæ3² ƒ²ÚS²Ês¶Vc²ã²jP¸4+ªŞóªÆÃªÂ ƒ®Ú²†Ç¶Vc®¦Ğƒ²ÚS²Êpƒ²‚s¶J#²vƒ®æ²n0ƒ®FCªÎ€°ƒªÂªÊ§
ß²vã²šw
ß²†Ã®.³
ß²ÇªÎó®*Pƒ²‚#®2 ƒ²ÚS²â‡¶Vc² ƒ®#²ã²jP¸4+¶n²4ƒ²#®²ã²v ƒªÎ×ªÂ°ƒ®2²ƒ²^Ã®‚ä°ƒ²b#²
ÀƒªÖ³®Ú°ƒ²vó²‚T°ƒ²"c®~'²Êc®~ğƒ®.“²v0ƒ²b²^²^@ƒ².“²‚pƒ®>²n²vĞƒ®Bc®*Pƒ²#®²ã²ró®†pƒ²zG²Ç¶Vc²ã²jP¸4+²ÚS²Êpƒ¶Z'®>g²v ƒ®.Ó®.ç²zCªÂ ƒ®ÂS®†pƒ².“¶Z'¶V€ƒ²"`ƒ²z#®*PƒªÖ³²ÊÓ²‚²vÓªÎ€ƒ²Ÿ²v ƒ®²ã²z—²ró®†pƒ²zG²Ç¶Vc²ã²jP¸4(4)o²r²š#²^ƒ®
Ó®Ú ƒ²‚s¶J ƒ²zC®1t4(‘íÁÉ½‘ÕÑI•½µµ•¹‘…Ñ¥½¹½¹Ñ•áĞ ¥ô4(4)oªÒ®š³²zCªÂ ƒ®NÇ®†w¶Vpƒ¶Fs²’ ƒ²b#²
Ã®ªªÎğƒ®Î²æµt4(‘í‰Õ‘•Ñ…Ñ…±½AÉ½µÁÑô4(4)‰Õ‘•ÑQåÁ—²v ƒ²rƒ®ª§®†w²v`ƒ¶Fs²’®ªƒ®bC®*Pƒ®Î²æ·ªÎğƒ²z®‚”ƒ®
Ó²j§²vĞƒ²‚W¶fW¶z ƒ²vó²æc¶V€ƒ®V3®0ƒªŞàƒªÂK²vƒ²
³²j§¶Vc²ã²jP¸4+®ª§®†w²^@ƒ²^®*Pƒ²vÓ®š²vƒ²z²vc®†pƒ¶Fs²’ ƒ²b#²
Ã®ª²Êc®~ğƒ®ÂSªúãªÆÃ®
`ƒ² ƒ¶Fs²’®ª²vƒ®3®N“² ƒ®#²ã²jP¸4+¶fW².“¶Vc² ƒ²V+²ró®¦Ğƒ²
³²j§²zCªÂ ƒ®C¶Vpƒ²nC®²ã²vƒªŞã®2®†pƒ®ÎÓ²†Ó¶Vc²ã²jP¸ƒ²Ös²Šƒ¶Fs²’ ƒ²^ÃªÊÃ²v ƒ².s²*“¶s²vĞƒ®.“².pƒªÊ²šw¶V§®.#®.¹€°4(€€€€€€€¥¹ÁÕĞ°4(€€€€€€€Ñ•áĞèì4(€€€€€€€€€™½Éµ…Ğèì4(€€€€€€€€€€€ÑåÁ”è€‰©Í½¹}Í¡•µ„ˆ°4(€€€€€€€€€€€¹…µ”è€‰İ¡¥ééÕÁ}Í…±•Í}É•½Éˆ°4(€€€€€€€€€€€‘•ÍÉ¥ÁÑ¥½¸è€‹²r²š#²^Q7
ß®¾ã¶2ƒ²b²^ƒªâÃ®†tƒ²Ò#²V ˆ°4(€€€€€€€€€€€ÍÑÉ¥ĞèÑÉÕ”°4(€€€€€€€€€€€Í¡•µ„èÉ•ÍÁ½¹Í•M¡•µ„°4(€€€€€€€€€ô°4(€€€€€€€ô°4(€€€€€ô¤°4(€€€€€Í¥¹…°è‰½ÉÑM¥¹…°¹Ñ¥µ•½ÕĞ äÁ|ÀÀÀ¤°4(€€€ô¤ì4(4(€€€½¹ÍĞÉ•ÍÁ½¹Í•A…å±½…€ô€¡…İ…¥Ğ½Á•¹%I•ÍÁ½¹Í”¹©Í½¸ ¤¤…Ì=Á•¹%I•ÍÁ½¹Í”ì4(€€€¥˜€ …½Á•¹%I•ÍÁ½¹Í”¹½¬¤ì4(€€€€€¥˜€¡½Á•¹%I•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ€ôôô€ĞÈä¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€€€ì•ÉÉ½Èè€‰$ƒ²
³²j¤ƒ¶Vs®>²^@ƒ®>®.³¶Z#²*×®.#®.¸ƒ²zƒ².pƒ¶nƒ®.“².pƒ².s®>¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€€€ìÍÑ…ÑÕÌè€ĞÈäô°4(€€€€€€€€¤ì4(€€€€€ô4(€€€€€¥˜€¡½Á•¹%I•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ€ôôô€ĞÀÄñğ½Á•¹%I•ÍÁ½¹Í”¹ÍÑ…ÑÕÌ€ôôô€ĞÀÌ¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€€€ì•ÉÉ½Èè€‹ªÒ®š³²z@A$ƒ²^ÃªÊÀƒ²‚W®ÎÓ®–ğƒ¶fW²vã¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€€€ìÍÑ…ÑÕÌè€ÔÀÌô°4(€€€€€€€€¤ì4(€€€€€ô4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‰'ªÂ ƒ®
Ó²j§²vƒ²‚W®š³¶Vc² ƒ®ªï¶Z#²*×®.#®.¸ƒ®.“².pƒ².s®>¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ÔÀÈô°4(€€€€€€¤ì4(€€€ô4(4(€€€½¹ÍĞÁ…ÉÍ•€ô)M=8¹Á…ÉÍ”¡•áÑÉ…Ñ=ÕÑÁÕÑQ•áĞ¡É•ÍÁ½¹Í•A…å±½…¤¤…Ìì4(€€€€€¹••‘Í±…É¥™¥…Ñ¥½¸è‰½½±•…¸ì4(€€€€€…ÍÍ¥ÍÑ…¹Ñ5•ÍÍ…”èÍÑÉ¥¹œì4(€€€€€‘É…™ÑÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½İ¸ùmtì4(€€€ôì4(€€€½¹ÍĞÁ½ÍÑ•‘…Ñ”€ôÑ½‘…å%¹M•½Õ° ¤ì4(€€€½¹ÍĞÕÍ•ÉAÉ½©•ÑQ•áĞ€ôl4(€€€€€€¸¸¹¡¥ÍÑ½Éä4(€€€€€€€€¹™¥±Ñ•È ¡¥Ñ•´¤€ôø¥Ñ•´¹É½±”€ôôô€‰ÕÍ•Èˆ¤4(€€€€€€€€¹µ…À ¡¥Ñ•´¤€ôø¥Ñ•´¹Ñ•áĞ¤°4(€€€€€µ•ÍÍ…”°4(€€€t¹©½¥¸ ‰q¸ˆ¤ì4(€€€½¹ÍĞ…¹•±±…Ñ¥½¹%¹Ñ•¹Ğ€ôÍ¡•‘Õ±•…¹•±±…Ñ¥½¹%¹Ñ•¹Ğ¡µ•ÍÍ…”¤ì(€€€½¹ÍĞ…¹•±±…Ñ¥½¹M¡•‘Õ±•‘…Ñ•Ì€ô…¹•±±…Ñ¥½¹…Ñ•Ì¡µ•ÍÍ…”°Á½ÍÑ•‘…Ñ”¤ì(€€€½¹ÍĞ‘É…™ÑÌèI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½İ¸ùmt€ô¹½Éµ…±¥é•É…™ÑÌ (€€€€€Á…ÉÍ•¹‘É…™ÑÌ°(€€€€¤¹µ…À ¡‘É…™Ğ¤èI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½İ¸ø€ôøì(€€€€€½¹ÍĞÉ•Í½±Ù•‘Ñ¥Ù¥Ñå…Ñ”€ôÉ•Í½±Ù•Ñ¥Ù¥Ñå…Ñ•É½µ5•ÍÍ…”¡ì4(€€€€€€€µ•ÍÍ…”èÕÍ•ÉAÉ½©•ÑQ•áĞ°4(€€€€€€€…¥…Ñ”è‘É…™Ğ¹…Ñ¥Ù¥Ñå…Ñ”°4(€€€€€€€Ñ½‘…äèÁ½ÍÑ•‘…Ñ”°4(€€€€€ô¤ì4(€€€€€½¹ÍĞ…İ…É‘MÑ…ÑÕÌ€ô‘É…™Ğ¹…İ…É‘MÑ…ÑÕÌì4(€€€€€½¹ÍĞ¥Í=Ñ¡•É½µÁ…¹åİ…É€ô…İ…É‘MÑ…ÑÕÌ€ôôô€‹¶²^²ÊĞƒ²"c²ğˆì4(€€€€€½¹ÍĞ¥ÍA…ÉÑ¹•É½µÁ…¹åİ…É€ô…İ…É‘MÑ…ÑÕÌ€ôôô€‹¶bG®‚—²
°ƒ²"c²ğˆì4(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹‘É…™Ğ°(€€€€€€€€¸¸¹É•Í½±Ù•‘Ñ¥Ù¥Ñå…Ñ”°(€€€€€€€ÁÉ½É•ÍÍM¡•‘Õ±”è(€€€€€€€€€…¹•±±…Ñ¥½¹%¹Ñ•¹Ğ€ôôô€‰¹½¹”ˆ€ü‘É…™Ğ¹ÁÉ½É•ÍÍM¡•‘Õ±”€è€ˆˆ°(€€€€€€€¹•áÑÑ¥½¸è(€€€€€€€€€…¹•±±…Ñ¥½¹%¹Ñ•¹Ğ€ôôô€‰½¹™¥Éµ•ˆ€˜˜€…MÑÉ¥¹œ¡‘É…™Ğ¹¹•áÑÑ¥½¸€üü€ˆˆ¤¹ÑÉ¥´ ¤(€€€€€€€€€€€€ü€‹²z³®²ã²v`ƒ®2ªâÀˆ(€€€€€€€€€€€€è‘É…™Ğ¹¹•áÑÑ¥½¸°(€€€€€€€‘•Ñ…¥±1•Ù•°è4(€€€€€€€€€‘•Ñ…¥±1•Ù•±AÉ•™•É•¹”€ôôô€‰…ÕÑ¼ˆ4(€€€€€€€€€€€€ü‘•Ñ…¥±1•Ù•±Y…±Õ•Ì¹¥¹±Õ‘•Ì¡MÑÉ¥¹œ¡‘É…™Ğ¹‘•Ñ…¥±1•Ù•°€üü€ˆˆ¤¤4(€€€€€€€€€€€€€€ü‘É…™Ğ¹‘•Ñ…¥±1•Ù•°4(€€€€€€€€€€€€€€è€‰ÍÑ…¹‘…Éˆ4(€€€€€€€€€€€€è‘•Ñ…¥±1•Ù•±AÉ•™•É•¹”°4(€€€€€€€É…İ%¹ÁÕĞèÕÍ•ÉAÉ½©•ÑQ•áĞ°4(€€€€€€€ÍÑ…ÑÕÌè¹½Éµ…±¥é•¥MÕ•ÍÑ•‘MÑ…ÑÕÌ¡‘É…™Ğ¹ÍÑ…ÑÕÌ°™…±Í”¤°4(€€€€€€€™½±±½İUÁI•ÅÕ¥É•è™…±Í”°4(€€€€€€€™½±±½İUÁ…Ñ”è€ˆˆ°4(€€€€€€€ÁÉ½É•ÍÍ5…¹…•Èè4(€€€€€€€€€¥ÍA…ÉÑ¹•É½µÁ…¹åİ…Éñğ¥Í=Ñ¡•É½µÁ…¹åİ…É4(€€€€€€€€€€€€ü€‹¶VÓ®.äƒ²^²v0ˆ4(€€€€€€€€€€€€èµ•µ‰•È¹¥ÍM…±•Ì4(€€€€€€€€€€€€€€üµ•µ‰•È¹‘¥ÍÁ±…å9…µ”4(€€€€€€€€€€€€€€è€ˆˆ°4(€€€€€€€…İ…É‘MÑ…ÑÕÌ°4(€€€€€€€•á•ÕÑ¥½¹QåÁ”è¥Í=Ñ¡•É½µÁ…¹åİ…É4(€€€€€€€€€€ü€‹¶VÓ®.äƒ²^²v0ˆ4(€€€€€€€€€€è‘É…™Ğ¹•á•ÕÑ¥½¹QåÁ”€ôôô€‹¶VÓ®.äƒ²^²v0ˆ4(€€€€€€€€€€€€ü€‹²²bˆ4(€€€€€€€€€€€€è‘É…™Ğ¹•á•ÕÑ¥½¹QåÁ”°4(€€€€€€€½¹Í½ÉÑ¥Õµ½µÁ…¹äè¥Í=Ñ¡•É½µÁ…¹åİ…É4(€€€€€€€€€€ü€ˆˆ4(€€€€€€€€€€è‘É…™Ğ¹½¹Í½ÉÑ¥Õµ½µÁ…¹ä°4(€€€€€€€…İ…É‘MÑ…”è¥Í=Ñ¡•É½µÁ…¹åİ…É4(€€€€€€€€€€ü€‹®¾ã²‚Tˆ4(€€€€€€€€€€è‘É…™Ğ¹…İ…É‘MÑ…”°4(€€€€€ôì4(€€€ô¤ì4(€€€½¹ÍĞÄ€ô…İ…¥Ğ•¹ÍÕÉ•I•½É‘ÍI•…‘ä ¤ì4(€€€™½È€¡½¹ÍĞ‘É…™Ğ½˜‘É…™ÑÌ¤ì4(€€€€€½¹ÍĞÉ…İ	Õ‘•Ñ9…µ”€ôMÑÉ¥¹œ¡‘É…™Ğ¹‰Õ‘•ÑQåÁ”€üü€ˆˆ¤¹ÑÉ¥´ ¤ì4(€€€€€½¹ÍĞ‰Õ‘•Ñ5•Ñ…‘…Ñ„€ô…İ…¥ĞÉ•Í½±Ù•	Õ‘•ÑI•½É‘5•Ñ…‘…Ñ„¡‰Õ‘•ÑÄ°ì4(€€€€€€€‰Õ‘•ÑQåÁ”èÉ…İ	Õ‘•Ñ9…µ”°4(€€€€€€€…İ…É‘MÑ…ÑÕÌè‘É…™Ğ¹…İ…É‘MÑ…ÑÕÌ°4(€€€€€ô¤ì4(€€€€€‘É…™Ğ¹‰Õ‘•Ñ=É¥¥¹…±9…µ”€ô‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ=É¥¥¹…±9…µ”ì4(€€€€€‘É…™Ğ¹‰Õ‘•ÑQåÁ”€ô‰Õ‘•Ñ5•Ñ…‘…Ñ„¹ÍÑ½É•‘9…µ”ì4(€€€€€‘É…™Ğ¹‰Õ‘•ÑÉ½ÕÁ%€ô‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•ÑÉ½ÕÁ%ì4(€€€€€‘É…™Ğ¹‰Õ‘•Ñ5…Ñ¡MÑ…ÑÕÌ€ô‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ5…Ñ¡MÑ…ÑÕÌì4(€€€€€‘É…™Ğ¹‰Õ‘•Ñ5…Ñ¡5•Ñ¡½€ô‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ5…Ñ¡5•Ñ¡½ì4(€€€€€‘É…™Ğ¹‰Õ‘•Ñ-¥¹€ô‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ-¥¹ì4(€€€€€‘É…™Ğ¹‰Õ‘•Ñµ½Õ¹Ñ5½‘”€ô‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñµ½Õ¹Ñ5½‘”ì4(€€€€€‘É…™Ğ¹‰Õ‘•Ñµ½Õ¹Ñ=Ù•ÉÉ¥‘”€ô‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñµ½Õ¹Ñ=Ù•ÉÉ¥‘”ì4(€€€ô4(€€€½¹ÍĞ•á¥ÍÑ¥¹=É…¹¥é…Ñ¥½¹Ì€ô…İ…¥ĞÄ4(€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€M1P½É…¹¥é…Ñ¥½¸°=U9P ¨¤LÉ•½É‘}½Õ¹Ğ4(€€€€€€€€I=4…Ñ¥Ù¥Ñ¥•Ì4(€€€€€€€€]!I½É…¹¥é…Ñ¥½¸€ğø€œœ4(€€€€€€€€I=U@	d½É…¹¥é…Ñ¥½¹€°4(€€€€€€¤4(€€€€€€¹…±°ñì½É…¹¥é…Ñ¥½¸èÍÑÉ¥¹œìÉ•½É‘}½Õ¹Ğè¹Õµ‰•Èôø ¤ì4(€€€™½È€¡½¹ÍĞ‘É…™Ğ½˜‘É…™ÑÌ¤ì4(€€€€€½¹ÍĞÉ•ÅÕ•ÍÑ•€ôMÑÉ¥¹œ¡‘É…™Ğ¹½É…¹¥é…Ñ¥½¸€üü€ˆˆ¤¹ÑÉ¥´ ¤ì4(€€€€€½¹ÍĞ­•ä€ô¥¹ÍÑ¥ÑÕÑ¥½¹±¥…Í-•ä¡É•ÅÕ•ÍÑ•¤ì4(€€€€€¥˜€ …­•ä¤½¹Ñ¥¹Õ”ì4(€€€€€½¹ÍĞ•á…Ñ±¥…Í•Ì€ô•á¥ÍÑ¥¹=É…¹¥é…Ñ¥½¹Ì¹É•ÍÕ±ÑÌ4(€€€€€€€€¹µ…À ¡É½Ü¤€ôøMÑÉ¥¹œ¡É½Ü¹½É…¹¥é…Ñ¥½¸¤¹ÑÉ¥´ ¤¤4(€€€€€€€€¹™¥±Ñ•È ¡•á¥ÍÑ¥¹œ¤€ôø¥¹ÍÑ¥ÑÕÑ¥½¹±¥…Í-•ä¡•á¥ÍÑ¥¹œ¤€ôôô­•ä¤ì4(€€€€€¥˜€¡•á…Ñ±¥…Í•Ì¹±•¹Ñ ¤ì4(€€€€€€€‘É…™Ğ¹½É…¹¥é…Ñ¥½¸€ôÁÉ•™•ÉÕ±±%¹ÍÑ¥ÑÕÑ¥½¹9…µ” ¸¸¹•á…Ñ±¥…Í•Ì¤ì4(€€€€€ô4(€€€ô4(€€€½¹ÍĞÍ¡½½±½¹™¥Éµ…Ñ¥½¹ÌèÉÉ…äñì4(€€€€€‘É…™Ñ%¹‘•àè¹Õµ‰•Èì4(€€€€€É•ÅÕ•ÍÑ•‘=É…¹¥é…Ñ¥½¸èÍÑÉ¥¹œì4(€€€€€…¹‘¥‘…Ñ•ÌèÉÉ…äñì4(€€€€€€€½™™¥•½‘”èÍÑÉ¥¹œì4(€€€€€€€Í¡½½±½‘”èÍÑÉ¥¹œì4(€€€€€€€¹…µ”èÍÑÉ¥¹œì4(€€€€€€€­¥¹èÍÑÉ¥¹œì4(€€€€€€€É•¥½¸èÍÑÉ¥¹œì4(€€€€€€€…‘‘É•ÍÌèÍÑÉ¥¹œì4(€€€€€€€Á¡½¹”èÍÑÉ¥¹œì4(€€€€€€€½•‘Õ…Ñ¥½¸èÍÑÉ¥¹œì4(€€€€€€€•á¥ÍÑ¥¹=É…¹¥é…Ñ¥½¹ÌèÍÑÉ¥¹mtì4(€€€€€€€•á¥ÍÑ¥¹I•½É‘½Õ¹Ğè¹Õµ‰•Èì4(€€€€€ôøì4(€€€ôø€ômtì4(€€€™½È€¡±•ĞÍÑ…ÉĞ€ô€ÀìÍÑ…ÉĞ€ğ‘É…™ÑÌ¹±•¹Ñ ìÍÑ…ÉĞ€¬ô€à¤ì4(€€€€€½¹ÍĞ¡Õ¹¬€ô‘É…™ÑÌ¹Í±¥”¡ÍÑ…ÉĞ°ÍÑ…ÉĞ€¬€à¤ì4(€€€€€½¹ÍĞµ…Ñ¡•Ì€ô…İ…¥ĞAÉ½µ¥Í”¹…±° 4(€€€€€€€¡Õ¹¬¹µ…À ¡‘É…™Ğ¤€ôø4(€€€€€€€€€™¥¹‘=™™¥¥…±M¡½½±…¹‘¥‘…Ñ•Ì¡‘É…™Ğ¹½É…¹¥é…Ñ¥½¸°‘É…™Ğ¹É•¥½¸¤°4(€€€€€€€€¤°4(€€€€€€¤ì4(€€€€€µ…Ñ¡•Ì¹™½É…  ¡…¹‘¥‘…Ñ•Ì°¡Õ¹­%¹‘•à¤€ôøì4(€€€€€€€¥˜€ ……¹‘¥‘…Ñ•Ì¹±•¹Ñ ¤É•ÑÕÉ¸ì4(€€€€€€€½¹ÍĞ‘É…™Ñ%¹‘•à€ôÍÑ…ÉĞ€¬¡Õ¹­%¹‘•àì4(€€€€€€€½¹ÍĞÉ•ÅÕ•ÍÑ•‘=É…¹¥é…Ñ¥½¸€ôMÑÉ¥¹œ 4(€€€€€€€€€‘É…™ÑÍm‘É…™Ñ%¹‘•átü¹½É…¹¥é…Ñ¥½¸€üü€ˆˆ°4(€€€€€€€€¤¹ÑÉ¥´ ¤ì4(€€€€€€€½¹ÍĞ•¹É¥¡•‘…¹‘¥‘…Ñ•Ì€ô…¹‘¥‘…Ñ•Ì¹µ…À ¡…¹‘¥‘…Ñ”¤€ôøì4(€€€€€€€€€½¹ÍĞ…¹‘¥‘…Ñ•-•ä€ô¥¹ÍÑ¥ÑÕÑ¥½¹±¥…Í-•ä¡…¹‘¥‘…Ñ”¹¹…µ”¤ì4(€€€€€€€€€½¹ÍĞ…±¥…Í•Ì€ô•á¥ÍÑ¥¹=É…¹¥é…Ñ¥½¹Ì¹É•ÍÕ±ÑÌ¹™¥±Ñ•È 4(€€€€€€€€€€€€¡É½Ü¤€ôø4(€€€€€€€€€€€€€¥¹ÍÑ¥ÑÕÑ¥½¹±¥…Í-•ä¡É½Ü¹½É…¹¥é…Ñ¥½¸¤€ôôô…¹‘¥‘…Ñ•-•ä€˜˜4(€€€€€€€€€€€€€É½Ü¹½É…¹¥é…Ñ¥½¸€„ôô…¹‘¥‘…Ñ”¹¹…µ”°4(€€€€€€€€€€¤ì4(€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€€¸¸¹…¹‘¥‘…Ñ”°4(€€€€€€€€€€€•á¥ÍÑ¥¹=É…¹¥é…Ñ¥½¹Ìè…±¥…Í•Ì¹µ…À ¡É½Ü¤€ôøÉ½Ü¹½É…¹¥é…Ñ¥½¸¤°4(€€€€€€€€€€€•á¥ÍÑ¥¹I•½É‘½Õ¹Ğè…±¥…Í•Ì¹É•‘Õ” 4(€€€€€€€€€€€€€€¡Ñ½Ñ…°°É½Ü¤€ôøÑ½Ñ…°€¬9Õµ‰•È¡É½Ü¹É•½É‘}½Õ¹Ğñğ€À¤°4(€€€€€€€€€€€€€€À°4(€€€€€€€€€€€€¤°4(€€€€€€€€€ôì4(€€€€€€€ô¤ì4(€€€€€€€½¹ÍĞ½µÁ…ÑUÍ•ÉQ•áĞ€ôÕÍ•ÉAÉ½©•ÑQ•áĞ¹É•Á±…” ½qÌ¬½œ°€ˆˆ¤ì4(€€€€€€€½¹ÍĞ½™™¥¥…±9…µ•]…Í¹Ñ•É•€ô4(€€€€€€€€€•¹É¥¡•‘…¹‘¥‘…Ñ•Ì¹±•¹Ñ €ôôô€Ä€˜˜4(€€€€€€€€€½µÁ…ÑUÍ•ÉQ•áĞ¹¥¹±Õ‘•Ì 4(€€€€€€€€€€€•¹É¥¡•‘…¹‘¥‘…Ñ•ÍlÁt¹¹…µ”¹É•Á±…” ½qÌ¬½œ°€ˆˆ¤°4(€€€€€€€€€€¤ì4(€€€€€€€¥˜€ 4(€€€€€€€€€½™™¥¥…±9…µ•]…Í¹Ñ•É•€˜˜4(€€€€€€€€€•¹É¥¡•‘…¹‘¥‘…Ñ•ÍlÁt¹•á¥ÍÑ¥¹I•½É‘½Õ¹Ğ€ôôô€À4(€€€€€€€€¤ì4(€€€€€€€€€‘É…™ÑÍm‘É…™Ñ%¹‘•át¹½É…¹¥é…Ñ¥½¸€ô•¹É¥¡•‘…¹‘¥‘…Ñ•ÍlÁt¹¹…µ”ì4(€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€ô4(€€€€€€€Í¡½½±½¹™¥Éµ…Ñ¥½¹Ì¹ÁÕÍ ¡ì4(€€€€€€€€€‘É…™Ñ%¹‘•à°4(€€€€€€€€€É•ÅÕ•ÍÑ•‘=É…¹¥é…Ñ¥½¸°4(€€€€€€€€€…¹‘¥‘…Ñ•Ìè•¹É¥¡•‘…¹‘¥‘…Ñ•Ì°4(€€€€€€€ô¤ì4(€€€€€ô¤ì4(€€€ô4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì(€€€€€¹••‘Í±…É¥™¥…Ñ¥½¸èÁ…ÉÍ•¹¹••‘Í±…É¥™¥…Ñ¥½¸°4(€€€€€…ÍÍ¥ÍÑ…¹Ñ5•ÍÍ…”è(€€€€€€€…¹•±±…Ñ¥½¹%¹Ñ•¹Ğ€ôôô€‰½¹™¥Éµ•ˆ(€€€€€€€€€€ü€‘íÁ…ÉÍ•¹…ÍÍ¥ÍÑ…¹Ñ5•ÍÍ…•ôƒªâÃ®†w²vƒ²‚²z—¶Vpƒ®JƒªâÃ²†Ğƒ²vó²‚W²v`ƒ²Ş£²0ƒ®2²²vƒ¶fW²vã¶V§®.#®.¹€(€€€€€€€€€€è…¹•±±…Ñ¥½¹%¹Ñ•¹Ğ€ôôô€‰É•Ù¥•Üˆ(€€€€€€€€€€€€ü€‘íÁ…ÉÍ•¹…ÍÍ¥ÍÑ…¹Ñ5•ÍÍ…•ôƒ²Ş£²3
ß²^ÃªâÀƒ²^³®ÚªÂ ƒ®Ú#®ª¶fW¶VĞƒªâÃ²†Ğƒ²vó²‚W²v ƒ²rƒ²¶VcªÎ€ƒ¶fW²vã²vĞƒ¶V²jS¶V§®.#®.¹€(€€€€€€€€€€€€èÁ…ÉÍ•¹…ÍÍ¥ÍÑ…¹Ñ5•ÍÍ…”°(€€€€€‘É…™ÑÌ°4(€€€€€‘É…™Ğè‘É…™ÑÍlÁt°4(€€€€€Í¡½½±½¹™¥Éµ…Ñ¥½¹Ì°(€€€€€Í¡•‘Õ±•…¹•±±…Ñ¥½¸è…¹•±±…Ñ¥½¹%¹Ñ•¹Ğ€ôôô€‰¹½¹”ˆ(€€€€€€€€üÕ¹‘•™¥¹•(€€€€€€€€èì(€€€€€€€€€€€¥¹Ñ•¹Ğè…¹•±±…Ñ¥½¹%¹Ñ•¹Ğ°(€€€€€€€€€€€½É…¹¥é…Ñ¥½¹Ìè‘É…™ÑÌ(€€€€€€€€€€€€€€¹µ…À ¡‘É…™Ğ¤€ôøMÑÉ¥¹œ¡‘É…™Ğ¹½É…¹¥é…Ñ¥½¸€üü€ˆˆ¤¹ÑÉ¥´ ¤¤(€€€€€€€€€€€€€€¹™¥±Ñ•È¡	½½±•…¸¤°(€€€€€€€€€€€Í¡•‘Õ±•‘…Ñ•Ìè…¹•±±…Ñ¥½¹M¡•‘Õ±•‘…Ñ•Ì°(€€€€€€€€€€€É•…Í½¸èµ•ÍÍ…”¹Í±¥” À°€Å|ÔÀÀ¤°(€€€€€€€€€ô°(€€€€€µ½‘•°°4(€€€€€ÕÍ…”èì4(€€€€€€€¥¹ÁÕÑQ½­•¹Ìè9Õµ‰•È¡É•ÍÁ½¹Í•A…å±½…¹ÕÍ…”ü¹¥¹ÁÕÑ}Ñ½­•¹Ì€üü€À¤°4(€€€€€€€½ÕÑÁÕÑQ½­•¹Ìè9Õµ‰•È¡É•ÍÁ½¹Í•A…å±½…¹ÕÍ…”ü¹½ÕÑÁÕÑ}Ñ½­•¹Ì€üü€À¤°4(€€€€€€€Ñ½Ñ…±Q½­•¹Ìè9Õµ‰•È¡É•ÍÁ½¹Í•A…å±½…¹ÕÍ…”ü¹Ñ½Ñ…±}Ñ½­•¹Ì€üü€À¤°4(€€€€€ô°4(€€€ô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€¥˜€¡•ÉÉ½È¥¹ÍÑ…¹•½˜Må¹Ñ…áÉÉ½È¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‰$ƒ²‚W®š°ƒªÊÃªÎó®–ğƒ²v÷² ƒ®ªï¶Z#²*×®.#®.¸ƒ®.“².pƒ².s®>¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ÔÀÈô°4(€€€€€€¤ì4(€€€ô4(€€€¥˜€¡•ÉÉ½È¥¹ÍÑ…¹•½˜=5á•ÁÑ¥½¸€˜˜•ÉÉ½È¹¹…µ”€ôôô€‰Q¥µ•½ÕÑÉÉ½Èˆ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‰$ƒ²vG®.Ôƒ².sªÂ²vĞƒªâã²ZÓ²†3²*×®.#®.¸ƒ®.“².pƒ².s®>¶VĞƒ²ó²ã²jP¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ÔÀĞô°4(€€€€€€¤ì4(€€€ô4(€€€É•ÑÕÉ¸…•ÍÍÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(