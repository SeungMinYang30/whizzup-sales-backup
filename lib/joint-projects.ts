import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";

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
  budget_group_id: number | null;
  budget_type: string;
  budget_amount: string;
};

type JointCampaignTargetRow = {
  id: number;
  organization: string;
  business_round: number;
  budget_amount: number | null;
};

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

async function latestActivity(
  organization: string,
): Promise<JointActivityRow | null> {
  return getD1()
    .prepare(
      `SELECT id, organization, business_round, budget_group_id,
              budget_type, budget_amount
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
           project_id, organization, business_round, role, activity_id,
           campaign_target_id, budget_amount
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        projectId,
        organization,
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
        `WITH ranked_member_activities AS (
           SELECT
             jpm.id AS member_id,
             a.id AS resolved_activity_id,
             a.budget_type,
             a.budget_group_id,
             a.budget_amount,
             a.budgets_json,
             a.award_status,
             a.award_stage,
             a.progress_manager,
             ROW_NUMBER() OVER (
               PARTITION BY jpm.id
               ORDER BY
                 CASE WHEN a.id = jpm.activity_id THEN 0 ELSE 1 END,
                 a.activity_date DESC,
                 a.id DESC
             ) AS row_number
           FROM joint_project_members jpm
           JOIN joint_projects jp
             ON jp.id = jpm.project_id AND jp.status = 'active'
           LEFT JOIN activities a
             ON a.id = jpm.activity_id
             OR (
               a.organization = jpm.organization
               AND a.business_round = jpm.business_round
               AND (
                 (a.budget_group_id IS NOT NULL
                  AND a.budget_group_id = jp.budget_group_id)
                 OR (
                   a.budget_group_id IS NULL
                   AND TRIM(COALESCE(a.budget_type, '')) <> ''
                   AND a.budget_type = jp.budget_type
                 )
               )
               AND CAST(SUBSTR(REPLACE(a.activity_date, '.', '-'), 1, 4) AS INTEGER) =
                   jp.project_year
             )
         )
         SELECT
           jpm.*,
           ranked.resolved_activity_id,
           ranked.budget_type,
           ranked.budget_group_id,
           ranked.budget_amount AS activity_budget_amount,
           ranked.budgets_json,
           ranked.award_status,
           ranked.award_stage,
           ranked.progress_manager
         FROM joint_project_members jpm
         JOIN joint_projects jp ON jp.id = jpm.project_id
         LEFT JOIN ranked_member_activities ranked
           ON ranked.member_id = jpm.id AND ranked.row_number = 1
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
    uniqueMembers.unshift({
      organization: sponsorOrganization,
      businessRound: 1,
      role: "sponsor",
      activityId: null,
      campaignTargetId: null,
      budgetAmount: null,
    });
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
  const name = `${sponsorOrganization} · ${budgetType} · ${selectedProjectYear}년 ${selectedJointRound}차`;
  const conflictConditions = uniqueMembers
    .map(() => "(jpm.organization = ? AND jpm.business_round = ?)")
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
      ...uniqueMembers.flatMap((item) => [item.organization, item.businessRound]),
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
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
  const projectId = Number(inserted.meta.last_row_id);
  try {
    await d1.batch([
      ...uniqueMembers.map((item) =>
        d1
          .prepare(
            `INSERT INTO joint_project_members (
               project_id, organization, business_round, role, activity_id,
               campaign_target_id, budget_amount
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            projectId,
            item.organization,
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
