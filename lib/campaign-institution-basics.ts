type CampaignInstitutionBasicField = {
  name:
    | "progress_manager"
    | "contact_role"
    | "contact_name"
    | "contact_phone"
    | "contact_email";
  sameRoundOnly: boolean;
  excludeNotApplicable: boolean;
};

const campaignInstitutionBasicFields: CampaignInstitutionBasicField[] = [
  {
    name: "progress_manager",
    sameRoundOnly: true,
    excludeNotApplicable: true,
  },
  { name: "contact_role", sameRoundOnly: false, excludeNotApplicable: false },
  { name: "contact_name", sameRoundOnly: false, excludeNotApplicable: false },
  { name: "contact_phone", sameRoundOnly: false, excludeNotApplicable: false },
  { name: "contact_email", sameRoundOnly: false, excludeNotApplicable: false },
];

const legacyCampaignInstitutionLinks = [
  {
    selectionDate: "2026-07-23",
    importedOrganization: "항노화 건강 문화활력센터",
    linkedOrganization: "함양 항노화 건강 문화활력센터",
    linkedOrganizationPattern: "%항노화%문화활력센터%",
    linkedOrganizationRequiredToken: "%함양%",
  },
  {
    selectionDate: "2026-07-23",
    importedOrganization: "행복안의봄날센터",
    linkedOrganization: "함양군청-행복안의봄날센터",
    linkedOrganizationPattern: "%행복안의봄날센터%",
    linkedOrganizationRequiredToken: "%함양%",
  },
];

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildCampaignTargetLegacyLinkRepairStatements() {
  return legacyCampaignInstitutionLinks.map((link) => {
    const linkedOrganization = sqlLiteral(link.linkedOrganization);
    const linkedOrganizationPattern = sqlLiteral(
      link.linkedOrganizationPattern,
    );
    const linkedOrganizationRequiredToken = sqlLiteral(
      link.linkedOrganizationRequiredToken,
    );
    const selectionDate = sqlLiteral(link.selectionDate);
    const selectedActivity = `(
      SELECT linked.id
      FROM activities linked
      JOIN sales_campaigns campaign
        ON campaign.id = sales_campaign_targets.campaign_id
      WHERE TRIM(linked.organization) LIKE ${linkedOrganizationPattern}
        AND TRIM(linked.organization) LIKE ${linkedOrganizationRequiredToken}
        AND (
          sales_campaign_targets.activity_id IS NULL
          OR linked.id <> sales_campaign_targets.activity_id
        )
        AND SUBSTR(campaign.selection_date, 1, 4) =
            SUBSTR(${selectionDate}, 1, 4)
        AND SUBSTR(linked.activity_date, 1, 4) =
            SUBSTR(campaign.selection_date, 1, 4)
      ORDER BY
        CASE
          WHEN TRIM(linked.organization) = ${linkedOrganization} THEN 0
          ELSE 1
        END,
        linked.activity_date DESC,
        linked.id DESC
      LIMIT 1
    )`;

    return `
      UPDATE sales_campaign_targets
      SET organization = (
            SELECT linked.organization
            FROM activities linked
            WHERE linked.id = ${selectedActivity}
          ),
          activity_id = ${selectedActivity},
          business_round = COALESCE((
            SELECT linked.business_round
            FROM activities linked
            WHERE linked.id = ${selectedActivity}
          ), 1),
          created_activity = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE TRIM(organization) LIKE ${linkedOrganizationPattern}
        AND TRIM(organization) NOT LIKE ${linkedOrganizationRequiredToken}
        AND campaign_id IN (
          SELECT campaign.id
          FROM sales_campaigns campaign
          WHERE SUBSTR(campaign.selection_date, 1, 4) =
                SUBSTR(${selectionDate}, 1, 4)
        )
        AND ${selectedActivity} IS NOT NULL
    `;
  });
}

export function buildCampaignTargetLegacyAssigneeRepairStatement() {
  const organizationConditions = legacyCampaignInstitutionLinks
    .map(
      (link) =>
        `TRIM(sales_campaign_targets.organization) LIKE ${sqlLiteral(
          link.linkedOrganizationPattern,
        )}`,
    )
    .join("\n        OR ");

  return `
    UPDATE sales_campaign_targets
    SET assigned_member_id = COALESCE((
          SELECT member.id
          FROM members member
          WHERE member.display_name = '양승민 이사'
            AND member.status = 'approved'
            AND member.is_sales = 1
          ORDER BY member.id
          LIMIT 1
        ), 3),
        updated_at = CURRENT_TIMESTAMP
    WHERE assigned_member_id IS NULL
      AND (
        ${organizationConditions}
      )
  `;
}

export function buildCampaignTargetLinkedActivitySyncStatement() {
  return `
    UPDATE sales_campaign_targets
    SET organization = (
          SELECT linked.organization
          FROM activities linked
          WHERE linked.id = sales_campaign_targets.activity_id
        ),
        business_round = COALESCE((
          SELECT linked.business_round
          FROM activities linked
          WHERE linked.id = sales_campaign_targets.activity_id
        ), 1),
        updated_at = CURRENT_TIMESTAMP
    WHERE created_activity = 0
      AND activity_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM activities linked
        WHERE linked.id = sales_campaign_targets.activity_id
      )
      AND (
        organization <> (
          SELECT linked.organization
          FROM activities linked
          WHERE linked.id = sales_campaign_targets.activity_id
        )
        OR business_round <> COALESCE((
          SELECT linked.business_round
          FROM activities linked
          WHERE linked.id = sales_campaign_targets.activity_id
        ), 1)
      )
  `;
}

function inheritedValueSubquery(
  field: CampaignInstitutionBasicField,
  sameRound: boolean,
) {
  const validValueCondition = field.excludeNotApplicable
    ? `AND previous.${field.name} <> '해당 없음'`
    : "";
  const sameRoundCondition = sameRound
    ? "AND previous.business_round = activities.business_round"
    : "";

  return `(
    SELECT NULLIF(TRIM(previous.${field.name}), '')
    FROM activities previous
    WHERE previous.organization = activities.organization
      AND previous.id <> activities.id
      AND TRIM(COALESCE(previous.${field.name}, '')) <> ''
      ${validValueCondition}
      ${sameRoundCondition}
    ORDER BY previous.activity_date DESC, previous.id DESC
    LIMIT 1
  )`;
}

export function buildCampaignInstitutionBasicsBackfillStatements() {
  return campaignInstitutionBasicFields.map((field) => {
    const preferredSameRoundValue = inheritedValueSubquery(field, true);
    const fallbackValue = field.sameRoundOnly
      ? "NULL"
      : inheritedValueSubquery(field, false);
    const validValueCondition = field.excludeNotApplicable
      ? `AND previous.${field.name} <> '해당 없음'`
      : "";
    const sameRoundCondition = field.sameRoundOnly
      ? "AND previous.business_round = activities.business_round"
      : "";

    return `
      UPDATE activities
      SET ${field.name} = COALESCE(
        ${preferredSameRoundValue},
        ${fallbackValue},
        ${field.name}
      )
      WHERE seed_key LIKE 'campaign:%'
        AND TRIM(COALESCE(${field.name}, '')) = ''
        AND EXISTS (
          SELECT 1
          FROM activities previous
          WHERE previous.organization = activities.organization
            AND previous.id <> activities.id
            AND TRIM(COALESCE(previous.${field.name}, '')) <> ''
            ${validValueCondition}
            ${sameRoundCondition}
        )
    `;
  });
}

export function buildCampaignAssignmentBackfillStatements() {
  const activityMemberId = `(
    SELECT member.id
    FROM activities current
    JOIN members member
      ON member.display_name = TRIM(current.progress_manager)
     AND member.status = 'approved'
     AND member.is_sales = 1
    WHERE current.organization = sales_campaign_targets.organization
      AND current.business_round = sales_campaign_targets.business_round
      AND TRIM(COALESCE(current.progress_manager, '')) NOT IN ('', '해당 없음')
    ORDER BY current.activity_date DESC, current.id DESC
    LIMIT 1
  )`;

  const activityUpdatedAt = `(
    SELECT current.updated_at
    FROM activities current
    WHERE current.organization = sales_campaign_targets.organization
      AND current.business_round = sales_campaign_targets.business_round
    ORDER BY current.activity_date DESC, current.id DESC
    LIMIT 1
  )`;

  const preferredTargetId = `(
    SELECT target.id
    FROM sales_campaign_targets target
    JOIN members member
      ON member.id = target.assigned_member_id
     AND member.status = 'approved'
     AND member.is_sales = 1
    WHERE target.organization = activities.organization
      AND target.business_round = activities.business_round
    ORDER BY
      target.updated_at DESC,
      target.id DESC
    LIMIT 1
  )`;

  const targetMemberName = `(
    SELECT member.display_name
    FROM sales_campaign_targets target
    JOIN members member
      ON member.id = target.assigned_member_id
     AND member.status = 'approved'
     AND member.is_sales = 1
    WHERE target.organization = activities.organization
      AND target.business_round = activities.business_round
    ORDER BY
      target.updated_at DESC,
      target.id DESC
    LIMIT 1
  )`;

  const targetUpdatedAt = `(
    SELECT target.updated_at
    FROM sales_campaign_targets target
    JOIN members member
      ON member.id = target.assigned_member_id
     AND member.status = 'approved'
     AND member.is_sales = 1
    WHERE target.organization = activities.organization
      AND target.business_round = activities.business_round
    ORDER BY
      target.updated_at DESC,
      target.id DESC
    LIMIT 1
  )`;

  return [
    `
      UPDATE sales_campaign_targets
      SET activity_id = (
            SELECT latest.id
            FROM activities latest
            WHERE latest.organization = sales_campaign_targets.organization
              AND latest.business_round =
                  sales_campaign_targets.business_round
            ORDER BY latest.activity_date DESC, latest.id DESC
            LIMIT 1
          )
      WHERE activity_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM activities latest
          WHERE latest.organization = sales_campaign_targets.organization
            AND latest.business_round =
                sales_campaign_targets.business_round
        )
    `,
    `
      UPDATE activities
      SET progress_manager = ${targetMemberName},
          progress_manager_locked = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = (
          SELECT latest.id
          FROM activities latest
          WHERE latest.organization = activities.organization
            AND latest.business_round = activities.business_round
          ORDER BY latest.activity_date DESC, latest.id DESC
          LIMIT 1
        )
        AND ${preferredTargetId} IS NOT NULL
        AND TRIM(COALESCE(progress_manager, '')) <> ${targetMemberName}
        AND (
          TRIM(COALESCE(progress_manager, '')) IN ('', '해당 없음')
          OR COALESCE(${targetUpdatedAt}, '') >= COALESCE(updated_at, '')
        )
    `,
    `
      UPDATE sales_campaign_targets
      SET assigned_member_id = ${activityMemberId},
          updated_at = CURRENT_TIMESTAMP
      WHERE ${activityMemberId} IS NOT NULL
        AND (
          assigned_member_id IS NULL
          OR (
            assigned_member_id <> ${activityMemberId}
            AND COALESCE(${activityUpdatedAt}, '') >
                COALESCE(updated_at, '')
          )
        )
    `,
  ];
}

export async function syncCampaignTargetsFromActivity(
  d1: D1Database,
  activityId: number,
) {
  const activity = await d1
    .prepare(
      `SELECT id, organization, business_round, progress_manager
       FROM activities
       WHERE id = ?`,
    )
    .bind(activityId)
    .first<{
      id: number;
      organization: string;
      business_round: number;
      progress_manager: string;
    }>();
  if (!activity) return;

  const memberName = activity.progress_manager.trim();
  const member =
    memberName && memberName !== "해당 없음"
      ? await d1
          .prepare(
            `SELECT id
             FROM members
             WHERE display_name = ?
               AND status = 'approved'
               AND is_sales = 1
             ORDER BY id
             LIMIT 1`,
          )
          .bind(memberName)
          .first<{ id: number }>()
      : null;

  await d1
    .prepare(
      `UPDATE sales_campaign_targets
       SET assigned_member_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE activity_id = ?
          OR (
            organization = ?
            AND business_round = ?
          )`,
    )
    .bind(
      member?.id ?? null,
      activity.id,
      activity.organization,
      activity.business_round,
    )
    .run();
}
