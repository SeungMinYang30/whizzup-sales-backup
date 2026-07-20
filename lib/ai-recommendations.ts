import type { Member } from "./collaboration";
import {
  removeUnselectedLegacyAiEquipment,
  saveAiSelectedEquipmentAsPlanned,
} from "./equipment-store";
import { ensureRecordsReady } from "./records-store";
import {
  compactShareSummary,
  replaceOrganizationReferences,
} from "./share-text";

export type AiRecommendedProduct = {
  name: string;
  reason: string;
};

export type AiRecommendationInput = {
  meetingSummary: string;
  interests: string[];
  recommendedProducts: AiRecommendedProduct[];
  followUpQuestions: string[];
  recommendedActions: string[];
};

export type AiRecommendationRecord = AiRecommendationInput & {
  id: number;
  activityId: number;
  organization: string;
  appliedProducts: string[];
  appliedQuestions: string[];
  appliedActions: string[];
  followUpDate: string;
  createdAt: string;
  updatedAt: string;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS ai_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL UNIQUE,
    organization TEXT NOT NULL,
    meeting_summary TEXT NOT NULL DEFAULT '',
    interests_json TEXT NOT NULL DEFAULT '[]',
    recommended_products_json TEXT NOT NULL DEFAULT '[]',
    follow_up_questions_json TEXT NOT NULL DEFAULT '[]',
    recommended_actions_json TEXT NOT NULL DEFAULT '[]',
    applied_products_json TEXT NOT NULL DEFAULT '[]',
    applied_questions_json TEXT NOT NULL DEFAULT '[]',
    applied_actions_json TEXT NOT NULL DEFAULT '[]',
    follow_up_date TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

function clean(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanList(value: unknown, maxItems = 8, maxLength = 240) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .slice(0, maxItems)
        .map((item) => clean(item, maxLength))
        .filter(Boolean),
    ),
  ];
}

function cleanProducts(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, AiRecommendedProduct>();
  value.slice(0, 6).forEach((item) => {
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const name = clean(row.name, 120);
    const reason = clean(row.reason, 500);
    if (!name) return;
    unique.set(name.toLocaleLowerCase("ko-KR"), { name, reason });
  });
  return [...unique.values()];
}

function parseList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return cleanList(parsed);
  } catch {
    return [];
  }
}

function parseProducts(value: unknown) {
  try {
    return cleanProducts(JSON.parse(String(value || "[]")));
  } catch {
    return [];
  }
}

function mapRecommendation(row: Record<string, unknown>): AiRecommendationRecord {
  return {
    id: Number(row.id),
    activityId: Number(row.activity_id),
    organization: String(row.organization ?? ""),
    meetingSummary: String(row.meeting_summary ?? ""),
    interests: parseList(row.interests_json),
    recommendedProducts: parseProducts(row.recommended_products_json),
    followUpQuestions: parseList(row.follow_up_questions_json),
    recommendedActions: parseList(row.recommended_actions_json),
    appliedProducts: parseList(row.applied_products_json),
    appliedQuestions: parseList(row.applied_questions_json),
    appliedActions: parseList(row.applied_actions_json),
    followUpDate: String(row.follow_up_date ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function normalizeAiRecommendation(value: unknown): AiRecommendationInput {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    meetingSummary: compactShareSummary(clean(source.meetingSummary, 1_000)),
    interests: cleanList(source.interests),
    recommendedProducts: cleanProducts(source.recommendedProducts),
    followUpQuestions: cleanList(source.followUpQuestions),
    recommendedActions: cleanList(source.recommendedActions),
  };
}

let aiRecommendationsReadyPromise: Promise<
  Awaited<ReturnType<typeof ensureRecordsReady>>
> | null = null;

async function initializeAiRecommendations() {
  const d1 = await ensureRecordsReady();
  await d1.batch([
    d1.prepare(createTableSql),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS ai_recommendations_org_idx ON ai_recommendations (organization, updated_at)",
    ),
  ]);
  return d1;
}

export function ensureAiRecommendationsReady() {
  return ensureRecordsReady();
}

export async function saveAiRecommendation(
  activityId: number,
  value: unknown,
  member: Member,
) {
  const d1 = await ensureAiRecommendationsReady();
  const activity = await d1
    .prepare("SELECT organization, summary FROM activities WHERE id = ?")
    .bind(activityId)
    .first<{ organization: string; summary: string }>();
  if (!activity) throw new Error("AI 제안을 연결할 영업 기록을 찾지 못했습니다.");

  const normalized = normalizeAiRecommendation(value);
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const meetingSummary =
    compactShareSummary(
      replaceOrganizationReferences(
        normalized.meetingSummary,
        source.sourceOrganization,
        activity.organization,
      ),
    ) || activity.summary;
  const row = await d1
    .prepare(
      `INSERT INTO ai_recommendations (
         activity_id, organization, meeting_summary, interests_json,
         recommended_products_json, follow_up_questions_json,
         recommended_actions_json, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET
         organization = excluded.organization,
         meeting_summary = excluded.meeting_summary,
         interests_json = excluded.interests_json,
         recommended_products_json = excluded.recommended_products_json,
         follow_up_questions_json = excluded.follow_up_questions_json,
         recommended_actions_json = excluded.recommended_actions_json,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
    )
    .bind(
      activityId,
      activity.organization,
      meetingSummary,
      JSON.stringify(normalized.interests),
      JSON.stringify(normalized.recommendedProducts),
      JSON.stringify(normalized.followUpQuestions),
      JSON.stringify(normalized.recommendedActions),
      member.id,
    )
    .first<Record<string, unknown>>();
  if (!row) throw new Error("AI 대응 제안을 저장하지 못했습니다.");
  await removeUnselectedLegacyAiEquipment(activity.organization);
  return mapRecommendation(row);
}

export async function listAiRecommendations(organization: string) {
  const d1 = await ensureAiRecommendationsReady();
  const result = await d1
    .prepare(
      `SELECT *
       FROM ai_recommendations
       WHERE organization = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 30`,
    )
    .bind(organization)
    .all<Record<string, unknown>>();
  return result.results.map(mapRecommendation);
}

function appendUniqueLine(current: string, value: string) {
  const cleanValue = value.trim();
  if (!cleanValue || current.includes(cleanValue)) return current;
  return [current.trim(), cleanValue].filter(Boolean).join("\n");
}

export async function applyAiRecommendation(
  activityId: number,
  payload: Record<string, unknown>,
) {
  const d1 = await ensureAiRecommendationsReady();
  const recommendation = await d1
    .prepare("SELECT * FROM ai_recommendations WHERE activity_id = ?")
    .bind(activityId)
    .first<Record<string, unknown>>();
  const activity = await d1
    .prepare(
      `SELECT organization, budget_type, next_action, notes, follow_up_date
       FROM activities
       WHERE id = ?`,
    )
    .bind(activityId)
    .first<{
      organization: string;
      budget_type: string;
      next_action: string;
      notes: string;
      follow_up_date: string | null;
    }>();
  if (!recommendation || !activity) {
    throw new Error("반영할 AI 대응 제안을 찾지 못했습니다.");
  }

  const allowedProducts = new Set(
    parseProducts(recommendation.recommended_products_json).map((item) => item.name),
  );
  const allowedQuestions = new Set(parseList(recommendation.follow_up_questions_json));
  const allowedActions = new Set(parseList(recommendation.recommended_actions_json));
  const products = cleanList(payload.products).filter((item) =>
    allowedProducts.has(item),
  );
  const questions = cleanList(payload.questions).filter((item) =>
    allowedQuestions.has(item),
  );
  const actions = cleanList(payload.actions).filter((item) =>
    allowedActions.has(item),
  );
  const followUpDate = /^\d{4}-\d{2}-\d{2}$/.test(clean(payload.followUpDate, 10))
    ? clean(payload.followUpDate, 10)
    : "";

  let nextAction = activity.next_action || "";
  actions.forEach((item) => {
    nextAction = appendUniqueLine(nextAction, item);
  });
  if (questions.length) {
    nextAction = appendUniqueLine(
      nextAction,
      `다음 확인 질문: ${questions.join(" / ")}`,
    );
  }
  let notes = activity.notes || "";
  if (products.length) {
    notes = appendUniqueLine(notes, `AI 추천 제품: ${products.join(", ")}`);
  }
  const hasAppliedItem =
    products.length > 0 || questions.length > 0 || actions.length > 0;

  await d1.batch([
    d1
      .prepare(
        `UPDATE activities
         SET next_action = ?, notes = ?,
             follow_up_required = CASE WHEN ? THEN 1 ELSE follow_up_required END,
             follow_up_date = CASE WHEN ? <> '' THEN ? ELSE follow_up_date END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        nextAction,
        notes,
        hasAppliedItem || Boolean(followUpDate) ? 1 : 0,
        followUpDate,
        followUpDate,
        activityId,
      ),
    d1
      .prepare(
        `UPDATE ai_recommendations
         SET applied_products_json = ?, applied_questions_json = ?,
             applied_actions_json = ?, follow_up_date = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE activity_id = ?`,
      )
      .bind(
        JSON.stringify(products),
        JSON.stringify(questions),
        JSON.stringify(actions),
        followUpDate || null,
        activityId,
      ),
  ]);
  if (products.length) {
    const recommendedProducts = parseProducts(
      recommendation.recommended_products_json,
    );
    const selectedProducts = products.map((name) => ({
      name,
      reason:
        recommendedProducts.find((product) => product.name === name)?.reason ??
        "",
    }));
    await saveAiSelectedEquipmentAsPlanned({
      organization: String(recommendation.organization ?? activity.organization),
      budgetType: activity.budget_type,
      projectName: activity.budget_type,
      products: selectedProducts,
      createdBy: Number(recommendation.created_by),
    });
  }

  const updated = await d1
    .prepare("SELECT * FROM ai_recommendations WHERE activity_id = ?")
    .bind(activityId)
    .first<Record<string, unknown>>();
  if (!updated) throw new Error("AI 대응 제안을 반영하지 못했습니다.");
  return mapRecommendation(updated);
}
