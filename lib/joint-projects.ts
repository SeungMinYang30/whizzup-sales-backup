import { getD1, isPostgresDatabase } from "../db";
import { ensureCollaborationReady } from "./collaboration";
import {
  INSTITUTION_ALIASES_SETTING_KEY,
  institutionIdentityKey,
} from "./institution-names";

const createProjectsSql = `
  CREATE TABLE IF NOT EXISTS joint_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sponsor_organization TEXT NOT NULL,
    campaign_id INTEGER,
    budget_group_id INTEGER,
    budget_type TEXT NOT NULL DEFAULT '',
    project_year INTEGER NOT NULL DEFAULT 0,
    joint_round INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const createMembersSql = `
  CREATE TABLE IF NOT EXISTS joint_project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    organization TEXT NOT NULL,
    institution_key TEXT NOT NULL DEFAULT '',
    business_round INTEGER NOT NULL DEFAULT 1,
    role TEXT NOT NULL DEFAULT 'site',
    activity_id INTEGER,
    campaign_target_id INTEGER,
    budget_amount INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const createEventsSql = `
  CREATE TABLE IF NOT EXISTS joint_project_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export type JointProjectMemberInput = {
  organization: string;
  institutionKey?: string;
  businessRound?: number;
  role?: "sponsor" | "site";
  activityId?: number | null;
  campaignTargetId?: number | null;
  budgetAmount?: number | null;
};

type JointActivityRow = {
  id: number;
  organization: string;
  business_round: number;
  activity_date: string;
  budget_group_id: number | null;
  budget_type: string;
  budget_amount: string;
  budgets_json: string;
  award_status: string;
};

type JointCampaignTargetRow = {
  id: number;
  campaign_id: number;
  organization: string;
  business_round: number;
  budget_amount: number | null;
  selection_date?: string;
  budget_group_id?: number | null;
  budget_type?: string;
};

export type JointProjectActivityCandidate = {
  id: number;
  organization: string;
  activityDate: string;
  budgetType: string;
  businessRound: number;
};

export type JointProjectLinkAudit = {
  scannedMembers: number;
  activityBackfilled: Array<{
    projectId: number;
    memberId: number;
    organization: string;
    activityId: number;
    activityDate: string;
  }>;
  campaignTargetBackfilled: Array<{
    projectId: number;
    memberId: number;
    organization: string;
    campaignTargetId: number;
  }>;
  unresolved: Array<{
    projectId: number;
    memberId: number;
    organization: string;
    reason: "not_found" | "ambiguous";
    candidates: JointProjectActivityCandidate[];
  }>;
};

export class JointProjectActivityAmbiguityError extends Error {
  readonly candidatesByMember: Array<{
    organization: string;
    businessRound: number;
    candidates: JointProjectActivityCandidate[];
  }>;

  constructor(
    candidatesByMember: Array<{
      organization: string;
      businessRound: number;
      candidates: JointProjectActivityCandidate[];
    }>,
  ) {
    super("수주 기록 후보가 여러 건입니다. 기관별 연결 기록을 확인해 주세요.");
    this.name = "JointProjectActivityAmbiguityError";
    this.candidatesByMember = candidatesByMember;
  }
}

function clean(value: unknown, limit = 160) {
  return String(value ?? "").trim().slice(0, limit);
}

function positiveId(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function businessRound(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 99) : 1;
}

function projectYear(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : null;
}

function jointRound(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 99) : 1;
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function yearFromDate(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/\./g, "-").slice(0, 4));
  return Number.isSafeInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : null;
}

function budgetJsonMatches(
  value: unknown,
  budgetGroupId: number | null,
  budgetType: string,
) {
  try {
    const rows = JSON.parse(String(value || "[]")) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return false;
    return rows.some((row) => {
      const groupId = positiveId(row.budgetGroupId ?? row.groupId);
      const name = clean(
        row.budgetType ?? row.canonicalName ?? row.budgetOriginalName,
      );
      return budgetGroupId ? groupId === budgetGroupId : Boolean(name && name === budgetType);
    });
  } catch {
    return false;
  }
}

function activityBudgetMatches(
  row: JointActivityRow,
  budgetGroupId: number | null,
  budgetType: string,
) {
  if (budgetGroupId && Number(row.budget_group_id) === budgetGroupId) return true;
  if (!budgetGroupId && clean(row.budget_type) === budgetType) return true;
  return budgetJsonMatches(row.budgets_json, budgetGroupId, budgetType);
}

async function institutionAliasSetting(d1: ReturnType<typeof getD1>) {
  const row = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(INSTITUTION_ALIASES_SETTING_KEY)
    .first<{ value: string }>();
  return row?.value ?? "";
}

async function resolveActivityLink(
  d1: ReturnType<typeof getD1>,
  input: {
    organization: string;
    businessRound: number;
    activityId?: number | null;
    budgetGroupId: number | null;
    budgetType: string;
    projectYear: number;
    aliasSetting: string;
  },
) {
  const explicitActivityId = positiveId(input.activityId);
  if (explicitActivityId) {
    const explicit = await d1
      .prepare(
        `SELECT id, organization, business_round, activity_date,
                budget_group_id, budget_type, budget_amount, budgets_json,
                award_status
         FROM activities
         WHERE id = ?
         LIMIT 1`,
      )
      .bind(explicitActivityId)
      .first<JointActivityRow>();
    if (explicit?.id) {
      return { status: "resolved" as const, row: explicit, candidates: [explicit] };
    }
  }

  const rows = await d1
    .prepare(
      `SELECT id, organization, business_round, activity_date,
              budget_group_id, budget_type, budget_amount, budgets_json,
              award_status
       FROM activities
       WHERE business_round = ?
         AND COALESCE(award_status, '미정') <> '미정'
       ORDER BY activity_date DESC, id DESC`,
    )
    .bind(input.businessRound)
    .all<JointActivityRow>();
  const requestedKey = institutionIdentityKey(
    input.organization,
    input.aliasSetting,
  );
  const candidates = rows.results.filter(
    (row) =>
      institutionIdentityKey(row.organization, input.aliasSetting) === requestedKey &&
      activityBudgetMatches(row, input.budgetGroupId, input.budgetType),
  );
  candidates.sort(
    (left, right) =>
      Number(yearFromDate(right.activity_date) === input.projectYear) -
        Number(yearFromDate(left.activity_date) === input.projectYear) ||
      right.activity_date.localeCompare(left.activity_date) ||
      Number(right.id) - Number(left.id),
  );
  if (candidates.length === 1) {
    return { status: "resolved" as const, row: candidates[0]!, candidates };
  }
  if (candidates.length > 1) {
    return { status: "ambiguous" as const, row: null, candidates };
  }
  return { status: "not_found" as const, row: null, candidates };
}

async function resolveCampaignTargetLink(
  d1: ReturnType<typeof getD1>,
  input: {
    organization: string;
    businessRound: number;
    campaignTargetId?: number | null;
    budgetGroupId: number | null;
    budgetType: string;
    projectYear: number;
    aliasSetting: string;
  },
) {
  const explicitTargetId = positiveId(input.campaignTargetId);
  if (explicitTargetId) {
    const explicit = await d1
      .prepare(
        `SELECT t.id, t.campaign_id, t.organization, t.business_round,
                t.budget_amount, c.selection_date, c.budget_group_id,
                c.budget_type
         FROM sales_campaign_targets t
         JOIN sales_campaigns c ON c.id = t.campaign_id
         WHERE t.id = ?
         LIMIT 1`,
      )
      .bind(explicitTargetId)
      .first<JointCampaignTargetRow>();
    if (explicit?.id) {
      return { status: "resolved" as const, row: explicit, candidates: [explicit] };
    }
  }
  const rows = await d1
    .prepare(
      `SELECT t.id, t.campaign_id, t.organization, t.business_round,
              t.budget_amount, c.selection_date, c.budget_group_id,
              c.budget_type
       FROM sales_campaign_targets t
       JOIN sales_campaigns c ON c.id = t.campaign_id
       WHERE t.business_round = ?
         AND (
           (?::bigint IS NOT NULL AND c.budget_group_id = ?::bigint)
           OR (?::bigint IS NULL AND c.budget_type = ?::text)
         )
       ORDER BY c.selection_date DESC, t.id DESC`,
    )
    .bind(
      input.businessRound,
      input.budgetGroupId,
      input.budgetGroupId,
      input.budgetGroupId,
      input.budgetType,
    )
    .all<JointCampaignTargetRow>();
  const requestedKey = institutionIdentityKey(
    input.organization,
    input.aliasSetting,
  );
  const candidates = rows.results.filter(
    (row) =>
      institutionIdentityKey(row.organization, input.aliasSetting) === requestedKey,
  );
  candidates.sort(
    (left, right) =>
      Number(yearFromDate(right.selection_date) === input.projectYear) -
        Number(yearFromDate(left.selection_date) === input.projectYear) ||
      String(right.selection_date ?? "").localeCompare(String(left.selection_date ?? "")) ||
      Number(right.id) - Number(left.id),
  );
  if (candidates.length === 1) {
    return { status: "resolved" as const, row: candidates[0]!, candidates };
  }
  return {
    status: candidates.length > 1 ? ("ambiguous" as const) : ("not_found" as const),
    row: null,
    candidates,
  };
}

function publicActivityCandidates(rows: JointActivityRow[]) {
  return rows.map((row) => ({
    id: Number(row.id),
    organization: row.organization,
    activityDate: row.activity_date,
    budgetType: row.budget_type,
    businessRound: Math.max(1, Number(row.business_round) || 1),
  }));
}

async function latestActivity(
  organization: string,
): Promise<JointActivityRow | null> {
  return getD1()
    .prepare(
      `SELECT id, organization, business_round, activity_date,
              budget_group_id, budget_type, budget_amount, budgets_json,
              award_status
       FROM activities
       WHERE organization = ?
       ORDER BY activity_date DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization)
    .first<JointActivityRow>();
}

async function ensureGoesanJointProject() {
  const d1 = getD1();
  const organizations = [
    "괴산군청",
    "괴산군노인복지관",
    "괴산군장애인복지관",
  ] as const;
  const existing = await d1
    .prepare(
      `SELECT jp.id
       FROM joint_projects jp
       JOIN joint_project_members sponsor
         ON sponsor.project_id = jp.id
        AND sponsor.role = 'sponsor'
        AND sponsor.organization = ?
       JOIN joint_project_members site_one
         ON site_one.project_id = jp.id
        AND site_one.role = 'site'
        AND site_one.organization = ?
       JOIN joint_project_members site_two
         ON site_two.project_id = jp.id
        AND site_two.role = 'site'
        AND site_two.organization = ?
       LIMIT 1`,
    )
    .bind(...organizations)
    .first<{ id: number }>();
  if (existing?.id) return;

  const activities: Array<JointActivityRow | null> = await Promise.all(
    organizations.map((organization) => latestActivity(organization)),
  );
  if (activities.some((row) => !row?.id)) return;

  const campaign = await d1
    .prepare(
      `SELECT t.campaign_id
       FROM sales_campaign_targets t
       WHERE t.organization IN (?, ?)
       GROUP BY t.campaign_id
       HAVING COUNT(DISTINCT t.organization) = 2
       ORDER BY t.campaign_id DESC
       LIMIT 1`,
    )
    .bind(organizations[1], organizations[2])
    .first<{ campaign_id: number }>();
  const campaignId = positiveId(campaign?.campaign_id);
  const targets: { results: JointCampaignTargetRow[] } = campaignId
    ? await d1
        .prepare(
          `SELECT id, organization, business_round, budget_amount
           FROM sales_campaign_targets
           WHERE campaign_id = ? AND organization IN (?, ?)`,
        )
        .bind(campaignId, organizations[1], organizations[2])
        .all<JointCampaignTargetRow>()
    : { results: [] };
  const targetByOrganization = new Map(
    targets.results.map((row) => [row.organization, row] as const),
  );
  const budgetActivity = activities[1] ?? activities[2] ?? activities[0];
  const actor = await d1
    .prepare(
      `SELECT id, display_name
       FROM members
       WHERE status = 'approved'
       ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id
       LIMIT 1`,
    )
    .first<{ id: number; display_name: string }>();
  if (!actor?.id) return;
  const inserted = await d1
    .prepare(
      `INSERT INTO joint_projects (
         name, sponsor_organization, campaign_id, budget_group_id,
         budget_type, project_year, joint_round, notes, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', ?)`,
    )
    .bind(
      "괴산군 가상현실스포츠실 공동사업",
      organizations[0],
      campaignId,
      budgetActivity?.budget_group_id ?? null,
      clean(budgetActivity?.budget_type),
      2026,
      "괴산군청 주관 · 노인복지관/장애인복지관 각 1개소",
      actor.id,
    )
    .run();
  const projectId = Number(inserted.meta.last_row_id);
  if (!projectId) return;

  const memberStatements = organizations.map((organization, index) => {
    const activity = activities[index]!;
    const target = targetByOrganization.get(organization);
    return d1
      .prepare(
        `INSERT INTO joint_project_members (
           project_id, organization, institution_key, business_round, role, activity_id,
           campaign_target_id, budget_amount
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        projectId,
        organization,
        institutionIdentityKey(organization),
        target?.business_round ?? activity.business_round ?? 1,
        index === 0 ? "sponsor" : "site",
        activity.id,
        target?.id ?? null,
        index === 0
          ? null
          : target?.budget_amount ?? money(activity.budget_amount),
      );
  });
  try {
    await d1.batch([
      ...memberStatements,
      d1
        .prepare(
          `INSERT INTO joint_project_events (
             project_id, action, detail_json, changed_by, changed_by_name
           ) VALUES (?, 'retrofit', ?, ?, ?)`,
        )
        .bind(
          projectId,
          JSON.stringify({
            sponsor: organizations[0],
            sites: organizations.slice(1),
            preservesCampaignTargetCount: true,
          }),
          actor.id,
          `시스템 소급 연결 · ${clean(actor.display_name) || "관리자"}`,
        ),
    ]);
  } catch (error) {
    await d1
      .prepare("DELETE FROM joint_projects WHERE id = ?")
      .bind(projectId)
      .run();
    throw error;
  }
}

type JointProjectAuditRow = {
  project_id: number;
  member_id: number;
  organization: string;
  institution_key: string;
  business_round: number;
  activity_id: number | null;
  campaign_target_id: number | null;
  budget_group_id: number | null;
  budget_type: string;
  project_year: number;
};

async function systemActor(d1: ReturnType<typeof getD1>) {
  return d1
    .prepare(
      `SELECT id, display_name
       FROM members
       WHERE status = 'approved'
       ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id
       LIMIT 1`,
    )
    .first<{ id: number; display_name: string }>();
}

function normalizedIsoDate(value: unknown) {
  return String(value ?? "").trim().replace(/\./g, "-").slice(0, 10);
}

export async function retrofitHamyangSudoActivityLink() {
  const d1 = getD1();
  const project = await d1
    .prepare(
      `SELECT jp.id AS project_id, jp.budget_group_id, jp.budget_type, jp.project_year,
              member.id AS member_id, member.organization,
              member.business_round, member.activity_id
       FROM joint_projects jp
       JOIN joint_project_members sponsor
         ON sponsor.project_id = jp.id
        AND sponsor.role = 'sponsor'
        AND sponsor.organization = '함양군청'
       JOIN joint_project_members member
         ON member.project_id = jp.id
        AND member.role = 'site'
        AND member.organization = '경상남도 함양군(수동면 생기발랄복지센터)'
       JOIN budget_name_groups budget
         ON budget.id = jp.budget_group_id
        AND budget.canonical_name = '가상현실스포츠실'
       WHERE jp.status = 'active'
         AND jp.project_year = 2026
         AND jp.joint_round = 1
       ORDER BY jp.id DESC
       LIMIT 1`,
    )
    .first<JointProjectAuditRow>();
  if (!project?.member_id) {
    return { status: "project_not_found" as const };
  }
  if (positiveId(project.activity_id)) {
    return {
      status: "already_linked" as const,
      projectId: Number(project.project_id),
      memberId: Number(project.member_id),
      activityId: Number(project.activity_id),
    };
  }

  const aliasSetting = await institutionAliasSetting(d1);
  const resolved = await resolveActivityLink(d1, {
    organization: project.organization,
    businessRound: businessRound(project.business_round),
    budgetGroupId: positiveId(project.budget_group_id),
    budgetType: clean(project.budget_type),
    projectYear: 2026,
    aliasSetting,
  });
  if (
    resolved.status !== "resolved" ||
    resolved.candidates.length !== 1 ||
    normalizedIsoDate(resolved.row.activity_date) !== "2025-01-02"
  ) {
    return {
      status:
        resolved.status === "ambiguous"
          ? ("ambiguous" as const)
          : ("activity_not_found" as const),
      projectId: Number(project.project_id),
      memberId: Number(project.member_id),
      candidates: publicActivityCandidates(resolved.candidates),
    };
  }
  const actor = await systemActor(d1);
  if (!actor?.id) {
    return {
      status: "actor_not_found" as const,
      projectId: Number(project.project_id),
      memberId: Number(project.member_id),
    };
  }
  const institutionKey = institutionIdentityKey(project.organization, aliasSetting);
  await d1.batch([
    d1
      .prepare(
        `UPDATE joint_project_members
         SET activity_id = ?, institution_key = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND activity_id IS NULL`,
      )
      .bind(resolved.row.id, institutionKey, project.member_id),
    d1
      .prepare(
        `INSERT INTO joint_project_events (
           project_id, action, detail_json, changed_by, changed_by_name
         )
         SELECT ?, 'retrofit_hamyang_sudo_activity_v1', ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM joint_project_events
           WHERE project_id = ? AND action = 'retrofit_hamyang_sudo_activity_v1'
         )`,
      )
      .bind(
        project.project_id,
        JSON.stringify({
          memberId: project.member_id,
          organization: project.organization,
          activityId: resolved.row.id,
          activityDate: normalizedIsoDate(resolved.row.activity_date),
          preservedFields: [
            "organization",
            "activityDate",
            "projectYear",
            "businessRound",
            "budget",
            "amount",
            "items",
            "quotations",
            "manager",
            "map",
            "accounting",
          ],
        }),
        actor.id,
        `시스템 소급 연결 · ${clean(actor.display_name) || "관리자"}`,
        project.project_id,
      ),
  ]);
  return {
    status: "linked" as const,
    projectId: Number(project.project_id),
    memberId: Number(project.member_id),
    activityId: Number(resolved.row.id),
    activityDate: normalizedIsoDate(resolved.row.activity_date),
  };
}

export async function auditAndBackfillJointProjectLinks({
  apply = false,
}: {
  apply?: boolean;
} = {}): Promise<JointProjectLinkAudit> {
  const d1 = getD1();
  const aliasSetting = await institutionAliasSetting(d1);
  const rows = await d1
    .prepare(
      `SELECT jp.id AS project_id, member.id AS member_id,
              member.organization, member.institution_key,
              member.business_round, member.activity_id,
              member.campaign_target_id, jp.budget_group_id,
              jp.budget_type, jp.project_year
       FROM joint_project_members member
       JOIN joint_projects jp ON jp.id = member.project_id
       WHERE jp.status = 'active'
       ORDER BY jp.id, member.id`,
    )
    .all<JointProjectAuditRow>();
  const audit: JointProjectLinkAudit = {
    scannedMembers: rows.results.length,
    activityBackfilled: [],
    campaignTargetBackfilled: [],
    unresolved: [],
  };
  const statements: Array<ReturnType<typeof d1.prepare>> = [];
  const changedByProject = new Map<number, Array<Record<string, unknown>>>();

  for (const row of rows.results) {
    const key = institutionIdentityKey(row.organization, aliasSetting);
    let activityId = positiveId(row.activity_id);
    if (!activityId) {
      const resolved = await resolveActivityLink(d1, {
        organization: row.organization,
        businessRound: businessRound(row.business_round),
        budgetGroupId: positiveId(row.budget_group_id),
        budgetType: clean(row.budget_type),
        projectYear: Number(row.project_year) || 0,
        aliasSetting,
      });
      if (resolved.status === "resolved" && resolved.candidates.length === 1) {
        activityId = Number(resolved.row.id);
        audit.activityBackfilled.push({
          projectId: Number(row.project_id),
          memberId: Number(row.member_id),
          organization: row.organization,
          activityId,
          activityDate: resolved.row.activity_date,
        });
        if (apply) {
          statements.push(
            d1
              .prepare(
                `UPDATE joint_project_members
                 SET activity_id = COALESCE(activity_id, ?), institution_key = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              )
              .bind(activityId, key, row.member_id),
          );
          const entries = changedByProject.get(Number(row.project_id)) ?? [];
          entries.push({ memberId: row.member_id, activityId, organization: row.organization });
          changedByProject.set(Number(row.project_id), entries);
        }
      } else {
        audit.unresolved.push({
          projectId: Number(row.project_id),
          memberId: Number(row.member_id),
          organization: row.organization,
          reason: resolved.status === "ambiguous" ? "ambiguous" : "not_found",
          candidates: publicActivityCandidates(resolved.candidates),
        });
      }
    } else if (apply && row.institution_key !== key) {
      statements.push(
        d1
          .prepare(
            `UPDATE joint_project_members
             SET institution_key = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND institution_key <> ?`,
          )
          .bind(key, row.member_id, key),
      );
    }

    if (!positiveId(row.campaign_target_id)) {
      const resolvedTarget = await resolveCampaignTargetLink(d1, {
        organization: row.organization,
        businessRound: businessRound(row.business_round),
        budgetGroupId: positiveId(row.budget_group_id),
        budgetType: clean(row.budget_type),
        projectYear: Number(row.project_year) || 0,
        aliasSetting,
      });
      if (resolvedTarget.status === "resolved") {
        audit.campaignTargetBackfilled.push({
          projectId: Number(row.project_id),
          memberId: Number(row.member_id),
          organization: row.organization,
          campaignTargetId: Number(resolvedTarget.row.id),
        });
        if (apply) {
          statements.push(
            d1
              .prepare(
                `UPDATE joint_project_members
                 SET campaign_target_id = COALESCE(campaign_target_id, ?),
                     institution_key = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              )
              .bind(resolvedTarget.row.id, key, row.member_id),
          );
        }
      }
    }
  }

  if (apply && statements.length) {
    const actor = await systemActor(d1);
    if (actor?.id) {
      for (const [projectId, changes] of changedByProject) {
        statements.push(
          d1
            .prepare(
              `INSERT INTO joint_project_events (
                 project_id, action, detail_json, changed_by, changed_by_name
               ) VALUES (?, 'activity_link_backfill', ?, ?, ?)`,
            )
            .bind(
              projectId,
              JSON.stringify({ changes }),
              actor.id,
              `시스템 연결 보완 · ${clean(actor.display_name) || "관리자"}`,
            ),
        );
      }
    }
    await d1.batch(statements);
  }
  return audit;
}

export async function applyJointProjectLinkBackfill() {
  await ensureJointProjectsReady();
  const hamyang = await retrofitHamyangSudoActivityLink();
  const audit = await auditAndBackfillJointProjectLinks({ apply: true });
  return { hamyang, audit };
}

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function ensureJointProjectColumns(d1: ReturnType<typeof getD1>) {
  const columns = await d1
    .prepare("PRAGMA table_info(joint_projects)")
    .all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const statements: Array<ReturnType<typeof d1.prepare>> = [];
  if (!names.has("project_year")) {
    statements.push(
      d1.prepare(
        "ALTER TABLE joint_projects ADD COLUMN project_year INTEGER NOT NULL DEFAULT 0",
      ),
    );
  }
  if (!names.has("joint_round")) {
    statements.push(
      d1.prepare(
        "ALTER TABLE joint_projects ADD COLUMN joint_round INTEGER NOT NULL DEFAULT 1",
      ),
    );
  }
  if (statements.length) await d1.batch(statements);
  const memberColumns = await d1
    .prepare("PRAGMA table_info(joint_project_members)")
    .all<{ name: string }>();
  if (!memberColumns.results.some((column) => column.name === "institution_key")) {
    await d1
      .prepare(
        "ALTER TABLE joint_project_members ADD COLUMN institution_key TEXT NOT NULL DEFAULT ''",
      )
      .run();
  }
  const aliasSetting = await institutionAliasSetting(d1);
  const memberKeys = await d1
    .prepare(
      `SELECT id, organization, institution_key
       FROM joint_project_members
       WHERE TRIM(COALESCE(institution_key, '')) = ''`,
    )
    .all<{ id: number; organization: string; institution_key: string }>();
  if (memberKeys.results.length) {
    await d1.batch(
      memberKeys.results.map((row) =>
        d1
          .prepare(
            `UPDATE joint_project_members
             SET institution_key = ?
             WHERE id = ? AND TRIM(COALESCE(institution_key, '')) = ''`,
          )
          .bind(institutionIdentityKey(row.organization, aliasSetting), row.id),
      ),
    );
  }
  await d1
    .prepare(
      `UPDATE joint_projects
       SET project_year = COALESCE(
         (
           SELECT CAST(SUBSTR(REPLACE(c.selection_date, '.', '-'), 1, 4) AS INTEGER)
           FROM sales_campaigns c
           WHERE c.id = joint_projects.campaign_id
         ),
         CASE
           WHEN CAST(SUBSTR(created_at, 1, 4) AS INTEGER) BETWEEN 2000 AND 2100
             THEN CAST(SUBSTR(created_at, 1, 4) AS INTEGER)
           ELSE CAST(STRFTIME('%Y', 'now') AS INTEGER)
         END
       )
       WHERE project_year IS NULL OR project_year < 2000`,
    )
    .run();
}

async function initialize() {
  const d1 = getD1();
  if (isPostgresDatabase()) {
    await d1.prepare("SELECT 1").all();
    return d1;
  }
  await ensureCollaborationReady();
  await d1.batch([
    d1.prepare(createProjectsSql),
    d1.prepare(createMembersSql),
    d1.prepare(createEventsSql),
  ]);
  await ensureJointProjectColumns(d1);
  await d1.batch([
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS joint_projects_campaign_idx ON joint_projects (campaign_id, status)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS joint_projects_sponsor_idx ON joint_projects (sponsor_organization, status)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS joint_projects_budget_period_idx ON joint_projects (budget_group_id, project_year, joint_round, status)",
    ),
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS joint_project_members_project_business_idx ON joint_project_members (project_id, organization, business_round)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS joint_project_members_business_idx ON joint_project_members (organization, business_round, project_id)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS joint_project_members_campaign_target_idx ON joint_project_members (campaign_target_id)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS joint_project_members_institution_idx ON joint_project_members (institution_key, business_round, project_id)",
    ),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS joint_project_events_project_idx ON joint_project_events (project_id)",
    ),
  ]);
  await ensureGoesanJointProject();
  return d1;
}

export function ensureJointProjectsReady() {
  if (!readyPromise) {
    readyPromise = initialize().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export async function listJointProjects() {
  const d1 = await ensureJointProjectsReady();
  const [projects, members] = await Promise.all([
    d1
      .prepare(
        `SELECT jp.*, m.display_name AS created_by_name,
                SUM(CASE WHEN jpm.role = 'site' THEN 1 ELSE 0 END) AS site_count,
                SUM(CASE WHEN jpm.role = 'site' THEN COALESCE(jpm.budget_amount, 0) ELSE 0 END) AS site_budget_total
         FROM joint_projects jp
         LEFT JOIN members m ON m.id = jp.created_by
         LEFT JOIN joint_project_members jpm ON jpm.project_id = jp.id
         WHERE jp.status = 'active'
         GROUP BY jp.id
         ORDER BY jp.updated_at DESC, jp.id DESC`,
      )
      .all(),
    d1
      .prepare(
        `SELECT
           jpm.*,
           a.id AS resolved_activity_id,
           a.budget_type,
           a.budget_group_id,
           a.budget_amount AS activity_budget_amount,
           a.budgets_json,
           a.award_status,
           a.award_stage,
           a.progress_manager
         FROM joint_project_members jpm
         JOIN joint_projects jp ON jp.id = jpm.project_id
         LEFT JOIN activities a ON a.id = jpm.activity_id
         WHERE jp.status = 'active'
         ORDER BY jpm.project_id DESC,
                  CASE jpm.role WHEN 'sponsor' THEN 0 ELSE 1 END,
                  jpm.organization COLLATE NOCASE`,
      )
      .all(),
  ]);
  return { projects: projects.results, members: members.results };
}

export async function createJointProject(
  input: {
    name?: unknown;
    sponsorOrganization?: unknown;
    campaignId?: unknown;
    budgetGroupId?: unknown;
    budgetType?: unknown;
    projectYear?: unknown;
    jointRound?: unknown;
    notes?: unknown;
    members?: JointProjectMemberInput[];
  },
  member: { id: number; displayName: string },
) {
  const d1 = await ensureJointProjectsReady();
  const sponsorOrganization = clean(input.sponsorOrganization, 120);
  const requestedMembers = Array.isArray(input.members) ? input.members : [];
  const normalizedMembers = requestedMembers
    .map((item) => ({
      organization: clean(item.organization, 120),
      institutionKey: clean(item.institutionKey, 180),
      businessRound: businessRound(item.businessRound),
      role:
        clean(item.organization, 120) === sponsorOrganization
          ? ("sponsor" as const)
          : ("site" as const),
      activityId: positiveId(item.activityId),
      campaignTargetId: positiveId(item.campaignTargetId),
      budgetAmount: money(item.budgetAmount),
    }))
    .filter((item) => item.organization);
  const uniqueMembers = [
    ...new Map(
      normalizedMembers.map((item) => [
        `${item.organization}\u0000${item.businessRound}`,
        item,
      ]),
    ).values(),
  ];
  if (!sponsorOrganization || uniqueMembers.length < 2) {
    throw new Error("주관기관과 설치기관을 합해 두 곳 이상 선택해 주세요.");
  }
  if (!uniqueMembers.some((item) => item.organization === sponsorOrganization)) {
    throw new Error("등록된 주관기관을 선택해 주세요. 없는 기관은 먼저 새 기관으로 등록해 주세요.");
  }
  if (!uniqueMembers.some((item) => item.role === "site")) {
    throw new Error("설치기관을 한 곳 이상 선택해 주세요.");
  }
  const campaignId = positiveId(input.campaignId);
  const budgetGroupId = positiveId(input.budgetGroupId);
  if (!budgetGroupId) {
    throw new Error("관리자가 등록한 활성 표준 예산명을 선택해 주세요.");
  }
  const budget = await d1
    .prepare(
      `SELECT id, canonical_name, budget_kind, amount_mode, default_amount
       FROM budget_name_groups
       WHERE id = ? AND active = 1 AND budget_kind IN ('purpose', 'self')`,
    )
    .bind(budgetGroupId)
    .first<{
      id: number;
      canonical_name: string;
      budget_kind: string;
      amount_mode: string;
      default_amount: number | null;
    }>();
  if (!budget?.id) {
    throw new Error("사용 중인 표준 예산명을 찾지 못했습니다.");
  }
  const selectedProjectYear = projectYear(input.projectYear);
  if (!selectedProjectYear) {
    throw new Error("사업연도를 선택해 주세요.");
  }
  const selectedJointRound = jointRound(input.jointRound);
  const budgetType = clean(budget.canonical_name);
  const aliasSetting = await institutionAliasSetting(d1);
  const ambiguities: JointProjectActivityAmbiguityError["candidatesByMember"] = [];
  for (const item of uniqueMembers) {
    item.institutionKey = institutionIdentityKey(item.organization, aliasSetting);
    const resolvedActivity = await resolveActivityLink(d1, {
      organization: item.organization,
      businessRound: item.businessRound,
      activityId: item.activityId,
      budgetGroupId,
      budgetType,
      projectYear: selectedProjectYear,
      aliasSetting,
    });
    if (resolvedActivity.status === "resolved") {
      item.activityId = Number(resolvedActivity.row.id);
    } else if (resolvedActivity.status === "ambiguous") {
      ambiguities.push({
        organization: item.organization,
        businessRound: item.businessRound,
        candidates: publicActivityCandidates(resolvedActivity.candidates),
      });
    }
    const resolvedTarget = await resolveCampaignTargetLink(d1, {
      organization: item.organization,
      businessRound: item.businessRound,
      campaignTargetId: item.campaignTargetId,
      budgetGroupId,
      budgetType,
      projectYear: selectedProjectYear,
      aliasSetting,
    });
    if (resolvedTarget.status === "resolved") {
      item.campaignTargetId = Number(resolvedTarget.row.id);
    }
  }
  if (ambiguities.length) {
    throw new JointProjectActivityAmbiguityError(ambiguities);
  }
  const unlinkedMember = uniqueMembers.find(
    (item) => !positiveId(item.activityId) && !positiveId(item.campaignTargetId),
  );
  if (unlinkedMember) {
    throw new Error(
      `${unlinkedMember.organization}의 실제 기관 기록을 찾지 못했습니다. 기관을 먼저 등록한 뒤 연결해 주세요.`,
    );
  }
  const name = `${sponsorOrganization} · ${budgetType} · ${selectedProjectYear}년 ${selectedJointRound}차`;
  const conflictConditions = uniqueMembers
    .map(() => "(jpm.institution_key = ? AND jpm.business_round = ?)")
    .join(" OR ");
  const scopeCondition = campaignId
    ? "jp.campaign_id = ? AND jp.budget_group_id = ? AND jp.project_year = ? AND jp.joint_round = ?"
    : budgetGroupId
      ? "jp.campaign_id IS NULL AND jp.budget_group_id = ? AND jp.project_year = ? AND jp.joint_round = ?"
      : "jp.campaign_id IS NULL AND jp.budget_group_id IS NULL AND jp.project_year = ? AND jp.joint_round = ?";
  const scopeBindings = campaignId
    ? [campaignId, budgetGroupId, selectedProjectYear, selectedJointRound]
    : budgetGroupId
      ? [budgetGroupId, selectedProjectYear, selectedJointRound]
      : [selectedProjectYear, selectedJointRound];
  const conflict = await d1
    .prepare(
      `SELECT jp.name, jpm.organization, jpm.business_round
       FROM joint_project_members jpm
       JOIN joint_projects jp ON jp.id = jpm.project_id
       WHERE jp.status = 'active'
         AND (${conflictConditions})
         AND (${scopeCondition})
       LIMIT 1`,
    )
    .bind(
      ...uniqueMembers.flatMap((item) => [item.institutionKey, item.businessRound]),
      ...scopeBindings,
    )
    .first<{ name: string; organization: string; business_round: number }>();
  if (conflict) {
    throw new Error(
      `${conflict.organization} ${conflict.business_round}차 사업은 이미 '${conflict.name}'에 연결되어 있습니다.`,
    );
  }
  const inserted = await d1
    .prepare(
      `INSERT INTO joint_projects (
         name, sponsor_organization, campaign_id, budget_group_id,
         budget_type, project_year, joint_round, notes, status, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
       RETURNING id`,
    )
    .bind(
      name,
      sponsorOrganization,
      campaignId,
      budgetGroupId,
      budgetType,
      selectedProjectYear,
      selectedJointRound,
      clean(input.notes, 1_000),
      member.id,
    )
    .run();
  const projectId = Number(inserted.results[0]?.id ?? inserted.meta.last_row_id);
  try {
    await d1.batch([
      ...uniqueMembers.map((item) =>
        d1
          .prepare(
            `INSERT INTO joint_project_members (
               project_id, organization, institution_key, business_round, role, activity_id,
               campaign_target_id, budget_amount
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            projectId,
            item.organization,
            item.institutionKey,
            item.businessRound,
            item.role,
            item.activityId,
            item.campaignTargetId,
            item.role === "site" ? item.budgetAmount : null,
          ),
      ),
      d1
        .prepare(
          `INSERT INTO joint_project_events (
             project_id, action, detail_json, changed_by, changed_by_name
           ) VALUES (?, 'created', ?, ?, ?)`,
        )
        .bind(
          projectId,
          JSON.stringify({
            sponsorOrganization,
            budgetGroupId,
            budgetType,
            projectYear: selectedProjectYear,
            jointRound: selectedJointRound,
            members: uniqueMembers,
          }),
          member.id,
          member.displayName,
        ),
    ]);
  } catch (error) {
    await d1
      .prepare("DELETE FROM joint_projects WHERE id = ?")
      .bind(projectId)
      .run();
    throw error;
  }
  return projectId;
}

export async function deactivateJointProject(
  projectId: number,
  member: { id: number; displayName: string },
) {
  const d1 = await ensureJointProjectsReady();
  const project = await d1
    .prepare("SELECT id, name FROM joint_projects WHERE id = ? AND status = 'active'")
    .bind(projectId)
    .first<{ id: number; name: string }>();
  if (!project) throw new Error("해제할 공동사업을 찾지 못했습니다.");
  await d1.batch([
    d1
      .prepare(
        "UPDATE joint_projects SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(projectId),
    d1
      .prepare(
        `INSERT INTO joint_project_events (
           project_id, action, detail_json, changed_by, changed_by_name
         ) VALUES (?, 'deactivated', ?, ?, ?)`,
      )
      .bind(
        projectId,
        JSON.stringify({ name: project.name }),
        member.id,
        member.displayName,
      ),
  ]);
}
