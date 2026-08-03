import { ensureAiRecommendationsReady } from "./ai-recommendations";
import { ensureAccountingReady } from "./accounting-store";
import { ensureActivityAssignmentHistoryReady } from "./activity-assignment-history";
import { ensureActivityReviewsReady } from "./activity-reviews";
import { ensureCampaignsReady } from "./campaign-store";
import { ensureEquipmentReady } from "./equipment-store";
import { ensureInstitutionDecisionsReady } from "./institution-decisions";
import { ensureJointProjectsReady } from "./joint-projects";
import {
  INSTITUTION_ALIASES_SETTING_KEY,
  institutionAliasKey,
  preferFullInstitutionName,
  updateInstitutionAliasSetting,
} from "./institution-names";
import { ensureManagerAlertsReady } from "./manager-alerts";
import { ensureMapReady } from "./map-store";
import { ensureQuotationDocumentsReady } from "./quotation-documents";
import { ensureRecordsReady } from "./records-store";
import { ensureOrganizationSchedulesReady } from "./organization-schedules";
import { ensureSchoolDirectoryReady } from "./school-directory";
import { replaceOrganizationReferences } from "./share-text";
import { ensureTrashReady } from "./trash-store";

export type InstitutionMergeCounts = {
  organization: string;
  activityCount: number;
  assignmentHistoryCount: number;
  reviewCount: number;
  recommendationCount: number;
  campaignCount: number;
  equipmentProjectCount: number;
  equipmentItemCount: number;
  managerAlertCount: number;
  quotationCount: number;
  schoolLinkCount: number;
  decisionCount: number;
  trashSnapshotCount: number;
  accountingCount: number;
  hasLocation: boolean;
  locationRegion: string;
  locationAddress: string;
};

export type InstitutionMergeConflict = {
  key: string;
  field: "progressManager" | "location";
  label: string;
  businessRound: number | null;
  recommendedValue: string;
  options: Array<{
    value: string;
    label: string;
    organization: string;
  }>;
};

export type InstitutionMergeResolutions = Record<string, string>;

type EquipmentProjectMergeRow = {
  id: number;
  business_round: number;
  name: string;
};

type OrganizationLocationRow = {
  region: string;
  address: string;
  road_address: string;
  latitude: number | null;
  longitude: number | null;
  place_name: string;
  place_id: string;
};

export function institutionMergeLocationValues(
  location: Partial<OrganizationLocationRow>,
) {
  return {
    region: String(location.region ?? ""),
    address: String(location.address ?? ""),
    roadAddress: String(location.road_address ?? ""),
    latitude:
      typeof location.latitude === "number" &&
      Number.isFinite(location.latitude)
        ? location.latitude
        : null,
    longitude:
      typeof location.longitude === "number" &&
      Number.isFinite(location.longitude)
        ? location.longitude
        : null,
    placeName: String(location.place_name ?? ""),
    placeId: String(location.place_id ?? ""),
  };
}

type InstitutionMergeActivityRow = {
  organization: string;
  business_round: number;
  progress_manager: string;
};

type AiRecommendationMergeRow = {
  id: number;
  interests_json: string;
  recommended_products_json: string;
  follow_up_questions_json: string;
  recommended_actions_json: string;
  applied_products_json: string;
  applied_questions_json: string;
  applied_actions_json: string;
};

type TrashSnapshotMergeRow = {
  id: string;
  display_name: string;
  snapshot_json: string;
};

function replaceNestedOrganizationReferences(
  value: unknown,
  alias: string,
  canonical: string,
): unknown {
  if (typeof value === "string") {
    return replaceOrganizationReferences(value, alias, canonical);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      replaceNestedOrganizationReferences(item, alias, canonical),
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceNestedOrganizationReferences(item, alias, canonical),
      ]),
    );
  }
  return value;
}

function replaceJsonOrganizationReferences(
  value: string,
  alias: string,
  canonical: string,
) {
  try {
    return JSON.stringify(
      replaceNestedOrganizationReferences(
        JSON.parse(value),
        alias,
        canonical,
      ),
    );
  } catch {
    return value;
  }
}

async function ensureInstitutionMergeReady() {
  const d1 = await ensureRecordsReady();
  await Promise.all([
    ensureEquipmentReady(),
    ensureAccountingReady(),
    ensureActivityAssignmentHistoryReady(),
    ensureActivityReviewsReady(),
    ensureMapReady(),
    ensureCampaignsReady(),
    ensureAiRecommendationsReady(),
    ensureQuotationDocumentsReady(),
    ensureManagerAlertsReady(),
    ensureSchoolDirectoryReady(),
    ensureTrashReady(),
    ensureJointProjectsReady(),
    ensureOrganizationSchedulesReady(),
    ensureInstitutionDecisionsReady(d1),
  ]);
  return d1;
}

async function countsForOrganization(organization: string) {
  const d1 = await ensureInstitutionMergeReady();
  const organizationKey = institutionAliasKey(organization);
  const [
    activities,
    assignments,
    reviews,
    recommendations,
    campaigns,
    projects,
    items,
    alerts,
    quotations,
    schoolLinks,
    decisions,
    trashSnapshots,
    accounting,
    location,
  ] = await Promise.all([
    d1
      .prepare("SELECT COUNT(*) AS count FROM activities WHERE organization = ?")
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        `SELECT COUNT(*) AS count
         FROM activity_assignment_history
         WHERE activity_id IN (
           SELECT id FROM activities WHERE organization = ?
         )`,
      )
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        `SELECT COUNT(*) AS count
         FROM activity_review_acknowledgements
         WHERE activity_id IN (
           SELECT id FROM activities WHERE organization = ?
         )`,
      )
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        "SELECT COUNT(*) AS count FROM ai_recommendations WHERE organization = ?",
      )
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        "SELECT COUNT(*) AS count FROM sales_campaign_targets WHERE organization = ?",
      )
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        "SELECT COUNT(*) AS count FROM equipment_projects WHERE organization = ?",
      )
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        `SELECT COUNT(*) AS count
         FROM equipment_items
         WHERE project_id IN (
           SELECT id FROM equipment_projects WHERE organization = ?
         )`,
      )
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        "SELECT COUNT(*) AS count FROM manager_alert_acknowledgements WHERE organization = ?",
      )
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        "SELECT COUNT(*) AS count FROM quotation_documents WHERE organization = ?",
      )
      .bind(organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        `SELECT COUNT(*) AS count
         FROM organization_school_links
         WHERE organization = ? OR organization_key = ?`,
      )
      .bind(organization, organizationKey)
      .first<{ count: number }>(),
    d1
      .prepare(
        `SELECT COUNT(*) AS count
         FROM institution_name_decisions
         WHERE left_key = ? OR right_key = ?
            OR left_organization = ? OR right_organization = ?`,
      )
      .bind(organizationKey, organizationKey, organization, organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        `SELECT COUNT(*) AS count
         FROM deletion_batches
         WHERE restored_at IS NULL
           AND (INSTR(display_name, ?) > 0 OR INSTR(snapshot_json, ?) > 0)`,
      )
      .bind(organization, organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM accounting_settlements
            WHERE activity_id IN (
              SELECT id FROM activities WHERE organization = ?
            ))
           + (SELECT COUNT(*) FROM accounting_commission_entries
              WHERE activity_id IN (
                SELECT id FROM activities WHERE organization = ?
              ))
           + (SELECT COUNT(*) FROM accounting_collection_receipts
              WHERE activity_id IN (
                SELECT id FROM activities WHERE organization = ?
              )) AS count`,
      )
      .bind(organization, organization, organization)
      .first<{ count: number }>(),
    d1
      .prepare(
        `SELECT TRIM(region) AS region, TRIM(address) AS address,
                TRIM(road_address) AS road_address,
                latitude, longitude, TRIM(place_name) AS place_name,
                TRIM(place_id) AS place_id
         FROM organization_locations
         WHERE organization = ?
         LIMIT 1`,
      )
      .bind(organization)
      .first<OrganizationLocationRow>(),
  ]);
  return {
    organization,
    activityCount: Number(activities?.count ?? 0),
    assignmentHistoryCount: Number(assignments?.count ?? 0),
    reviewCount: Number(reviews?.count ?? 0),
    recommendationCount: Number(recommendations?.count ?? 0),
    campaignCount: Number(campaigns?.count ?? 0),
    equipmentProjectCount: Number(projects?.count ?? 0),
    equipmentItemCount: Number(items?.count ?? 0),
    managerAlertCount: Number(alerts?.count ?? 0),
    quotationCount: Number(quotations?.count ?? 0),
    schoolLinkCount: Number(schoolLinks?.count ?? 0),
    decisionCount: Number(decisions?.count ?? 0),
    trashSnapshotCount: Number(trashSnapshots?.count ?? 0),
    accountingCount: Number(accounting?.count ?? 0),
    hasLocation: Boolean(location),
    locationRegion: String(location?.region ?? ""),
    locationAddress: String(location?.road_address || location?.address || ""),
  } satisfies InstitutionMergeCounts;
}

async function inspectInstitutionMergeValues(
  d1: Awaited<ReturnType<typeof ensureInstitutionMergeReady>>,
  organizations: string[],
  recommendedTarget: string,
) {
  const placeholders = organizations.map(() => "?").join(", ");
  const [activityRows, targetAssignmentRows, locationRows] = await Promise.all([
    d1
      .prepare(
        `SELECT organization, business_round,
                TRIM(COALESCE(progress_manager, '')) AS progress_manager
         FROM activities
         WHERE organization IN (${placeholders})
         ORDER BY activity_date DESC, id DESC`,
      )
      .bind(...organizations)
      .all<InstitutionMergeActivityRow>(),
    d1
      .prepare(
        `SELECT target.organization, target.business_round,
                TRIM(member.display_name) AS progress_manager
         FROM sales_campaign_targets target
         JOIN members member
           ON member.id = target.assigned_member_id
          AND member.status = 'approved'
          AND member.is_sales = 1
         WHERE target.organization IN (${placeholders})
         ORDER BY target.updated_at DESC, target.id DESC`,
      )
      .bind(...organizations)
      .all<InstitutionMergeActivityRow>(),
    d1
      .prepare(
        `SELECT organization, TRIM(region) AS region,
                TRIM(address) AS address, TRIM(road_address) AS road_address,
                latitude, longitude, TRIM(place_name) AS place_name,
                TRIM(place_id) AS place_id
         FROM organization_locations
         WHERE organization IN (${placeholders})`,
      )
      .bind(...organizations)
      .all<OrganizationLocationRow & { organization: string }>(),
  ]);
  const activities = [
    ...(activityRows.results as InstitutionMergeActivityRow[]),
    ...(targetAssignmentRows.results as InstitutionMergeActivityRow[]),
  ];
  const mappedLocations = locationRows.results as Array<
    OrganizationLocationRow & { organization: string }
  >;

  const conflicts: InstitutionMergeConflict[] = [];
  const autoFilledFields: string[] = [];
  const latestManagerByOrganizationRound = new Map<string, string>();
  for (const row of activities) {
    const manager = String(row.progress_manager ?? "").trim();
    if (!manager || manager === "해당 없음") continue;
    const round = Math.max(1, Number(row.business_round) || 1);
    const key = `${row.organization}\u001f${round}`;
    if (!latestManagerByOrganizationRound.has(key)) {
      latestManagerByOrganizationRound.set(key, manager);
    }
  }

  const rounds = [
    ...new Set(
      activities.map((row) =>
        Math.max(1, Number(row.business_round) || 1),
      ),
    ),
  ].sort((left, right) => left - right);
  for (const round of rounds) {
    const options = organizations
      .map((organization) => ({
        organization,
        value:
          latestManagerByOrganizationRound.get(
            `${organization}\u001f${round}`,
          ) ?? "",
      }))
      .filter((option) => option.value);
    const uniqueOptions = [
      ...new Map(options.map((option) => [option.value, option])).values(),
    ];
    if (uniqueOptions.length > 1) {
      const recommended =
        options.find((option) => option.organization === recommendedTarget) ??
        uniqueOptions[0];
      conflicts.push({
        key: `progressManager:${round}`,
        field: "progressManager",
        label: "진행 담당자",
        businessRound: round,
        recommendedValue: recommended.value,
        options: uniqueOptions.map((option) => ({
          ...option,
          label: `${option.value} · ${option.organization}`,
        })),
      });
    } else if (
      uniqueOptions.length === 1 &&
      options.length < organizations.length
    ) {
      autoFilledFields.push(`${round}차 사업 진행 담당자`);
    }
  }

  const locations = mappedLocations.map((row) => ({
    ...row,
    displayAddress: String(row.road_address || row.address || "").trim(),
  }));
  const distinctLocations = [
    ...new Map(
      locations
        .filter((location) => location.displayAddress)
        .map((location) => [location.displayAddress, location]),
    ).values(),
  ];
  if (distinctLocations.length > 1) {
    const recommended =
      locations.find(
        (location) =>
          location.organization === recommendedTarget &&
          location.displayAddress,
      ) ?? distinctLocations[0];
    conflicts.push({
      key: "location",
      field: "location",
      label: "지도 위치·주소",
      businessRound: null,
      recommendedValue: recommended.organization,
      options: distinctLocations.map((location) => ({
        value: location.organization,
        label: `${location.displayAddress} · ${location.organization}`,
        organization: location.organization,
      })),
    });
  } else if (
    distinctLocations.length === 1 &&
    locations.length < organizations.length
  ) {
    autoFilledFields.push("지도 위치·주소");
  }

  return {
    conflicts,
    autoFilledFields,
    latestManagerByOrganizationRound,
    locations,
  };
}

export async function inspectInstitutionMerge(organizations: string[]) {
  const d1 = await ensureInstitutionMergeReady();
  const counts = await Promise.all(
    organizations.map((organization) => countsForOrganization(organization)),
  );
  const recommendedTarget = preferFullInstitutionName(...organizations);
  const valueInspection = await inspectInstitutionMergeValues(
    d1,
    organizations,
    recommendedTarget,
  );
  return {
    organizations: counts,
    recommendedTarget,
    conflicts: valueInspection.conflicts,
    autoFilledFields: valueInspection.autoFilledFields,
  };
}

/**
 * 기관명 변경과 기관 합치기가 반드시 같은 경로를 사용하도록 한다.
 * D1 batch는 한 트랜잭션으로 실행되므로 어느 한 문장이라도 실패하면
 * 기관명과 연결 데이터 변경 전체가 롤백된다.
 */
export async function mergeInstitutionRecords(
  alias: string,
  canonical: string,
  memberId: number,
  resolutions: InstitutionMergeResolutions = {},
) {
  if (!alias || !canonical || alias === canonical) {
    throw new Error("서로 다른 두 기관명을 선택해 주세요.");
  }
  const d1 = await ensureInstitutionMergeReady();
  const aliasKey = institutionAliasKey(alias);
  const canonicalKey = institutionAliasKey(canonical);
  const [
    currentAliasSetting,
    aliasRegions,
    canonicalRegions,
    aliasLocation,
    canonicalLocation,
    aliasProjects,
    canonicalProjects,
    aliasRecommendations,
    trashSnapshots,
  ] = await Promise.all([
    d1
      .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
      .bind(INSTITUTION_ALIASES_SETTING_KEY)
      .first<{ value: string }>(),
    d1
      .prepare(
        `SELECT DISTINCT TRIM(region) AS region
         FROM activities
         WHERE organization = ? AND TRIM(region) <> ''
         LIMIT 20`,
      )
      .bind(alias)
      .all<{ region: string }>(),
    d1
      .prepare(
        `SELECT DISTINCT TRIM(region) AS region
         FROM activities
         WHERE organization = ? AND TRIM(region) <> ''
         LIMIT 20`,
      )
      .bind(canonical)
      .all<{ region: string }>(),
    d1
      .prepare(
        `SELECT TRIM(region) AS region, TRIM(address) AS address,
                TRIM(road_address) AS road_address,
                latitude, longitude, TRIM(place_name) AS place_name,
                TRIM(place_id) AS place_id
         FROM organization_locations
         WHERE organization = ?
         LIMIT 1`,
      )
      .bind(alias)
      .first<OrganizationLocationRow>(),
    d1
      .prepare(
        `SELECT TRIM(region) AS region, TRIM(address) AS address,
                TRIM(road_address) AS road_address,
                latitude, longitude, TRIM(place_name) AS place_name,
                TRIM(place_id) AS place_id
         FROM organization_locations
         WHERE organization = ?
         LIMIT 1`,
      )
      .bind(canonical)
      .first<OrganizationLocationRow>(),
    d1
      .prepare(
        `SELECT id, business_round, name
         FROM equipment_projects
         WHERE organization = ?
         ORDER BY id`,
      )
      .bind(alias)
      .all<EquipmentProjectMergeRow>(),
    d1
      .prepare(
        `SELECT id, business_round, name
         FROM equipment_projects
         WHERE organization = ?
         ORDER BY id`,
      )
      .bind(canonical)
      .all<EquipmentProjectMergeRow>(),
    d1
      .prepare(
        `SELECT id, interests_json, recommended_products_json,
                follow_up_questions_json, recommended_actions_json,
                applied_products_json, applied_questions_json,
                applied_actions_json
         FROM ai_recommendations
         WHERE organization = ?
         ORDER BY id`,
      )
      .bind(alias)
      .all<AiRecommendationMergeRow>(),
    d1
      .prepare(
        `SELECT id, display_name, snapshot_json
         FROM deletion_batches
         WHERE restored_at IS NULL
           AND (INSTR(display_name, ?) > 0 OR INSTR(snapshot_json, ?) > 0)
         ORDER BY deleted_at, id`,
      )
      .bind(alias, alias)
      .all<TrashSnapshotMergeRow>(),
  ]);
  const valueInspection = await inspectInstitutionMergeValues(
    d1,
    [alias, canonical],
    canonical,
  );
  const locationConflict = valueInspection.conflicts.find(
    (conflict) => conflict.field === "location",
  );
  const selectedLocationOrganization =
    resolutions.location ||
    locationConflict?.recommendedValue ||
    (canonicalLocation ? canonical : alias);
  const selectedLocation =
    selectedLocationOrganization === alias ? aliasLocation : canonicalLocation;

  const managerByRound = new Map<number, string>();
  for (const [key, manager] of valueInspection.latestManagerByOrganizationRound) {
    const separatorIndex = key.lastIndexOf("\u001f");
    const organization = key.slice(0, separatorIndex);
    const round = Math.max(1, Number(key.slice(separatorIndex + 1)) || 1);
    const existing = managerByRound.get(round);
    if (!existing || organization === canonical) {
      managerByRound.set(round, manager);
    }
  }
  for (const conflict of valueInspection.conflicts) {
    if (
      conflict.field !== "progressManager" ||
      conflict.businessRound === null
    ) {
      continue;
    }
    managerByRound.set(
      conflict.businessRound,
      resolutions[conflict.key] || conflict.recommendedValue,
    );
  }

  const rememberedRegions = [
    ...aliasRegions.results.map((row: { region: string }) => row.region),
    aliasLocation?.region ?? "",
  ].filter(Boolean);
  const fallbackRegions = canonicalRegions.results
    .map((row: { region: string }) => row.region)
    .filter(Boolean);
  const aliasScopes = rememberedRegions.length
    ? [...new Set(rememberedRegions)]
    : fallbackRegions.length
      ? [...new Set(fallbackRegions)]
      : [""];
  const nextAliasSetting = aliasScopes.reduce(
    (setting, region) =>
      updateInstitutionAliasSetting(setting, alias, canonical, region),
    currentAliasSetting?.value ?? "",
  );
  const preferredRegion = String(
    selectedLocation?.region ||
      canonicalLocation?.region ||
      canonicalRegions.results[0]?.region ||
      "",
  );
  const preferredAddress = String(
    selectedLocation?.road_address ||
      selectedLocation?.address ||
      canonicalLocation?.road_address ||
      canonicalLocation?.address ||
      "",
  );

  const statements = [
    d1
      .prepare(
        `UPDATE organization_schedules
         SET organization = ?, updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?`,
      )
      .bind(canonical, alias),
    d1
      .prepare(
        `UPDATE joint_project_members
         SET activity_id = COALESCE(activity_id, (
               SELECT source.activity_id
               FROM joint_project_members source
               WHERE source.project_id = joint_project_members.project_id
                 AND source.business_round = joint_project_members.business_round
                 AND source.organization = ?
               LIMIT 1
             )),
             campaign_target_id = COALESCE(campaign_target_id, (
               SELECT source.campaign_target_id
               FROM joint_project_members source
               WHERE source.project_id = joint_project_members.project_id
                 AND source.business_round = joint_project_members.business_round
                 AND source.organization = ?
               LIMIT 1
             )),
             role = CASE
               WHEN role = 'sponsor' OR EXISTS (
                 SELECT 1 FROM joint_project_members source
                 WHERE source.project_id = joint_project_members.project_id
                   AND source.business_round = joint_project_members.business_round
                   AND source.organization = ? AND source.role = 'sponsor'
               ) THEN 'sponsor'
               ELSE role
             END,
             budget_amount = CASE
               WHEN role = 'sponsor' OR EXISTS (
                 SELECT 1 FROM joint_project_members source
                 WHERE source.project_id = joint_project_members.project_id
                   AND source.business_round = joint_project_members.business_round
                   AND source.organization = ? AND source.role = 'sponsor'
               ) THEN NULL
               ELSE COALESCE(budget_amount, (
                 SELECT source.budget_amount
                 FROM joint_project_members source
                 WHERE source.project_id = joint_project_members.project_id
                   AND source.business_round = joint_project_members.business_round
                   AND source.organization = ?
                 LIMIT 1
               ))
             END,
             institution_key = ?, updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?
           AND EXISTS (
             SELECT 1 FROM joint_project_members source
             WHERE source.project_id = joint_project_members.project_id
               AND source.business_round = joint_project_members.business_round
               AND source.organization = ?
           )`,
      )
      .bind(
        alias,
        alias,
        alias,
        alias,
        alias,
        canonicalKey,
        canonical,
        alias,
      ),
    d1
      .prepare(
        `DELETE FROM joint_project_members
         WHERE organization = ?
           AND EXISTS (
             SELECT 1 FROM joint_project_members target
             WHERE target.project_id = joint_project_members.project_id
               AND target.business_round = joint_project_members.business_round
               AND target.organization = ?
           )`,
      )
      .bind(alias, canonical),
    d1
      .prepare(
        `UPDATE joint_project_members
         SET organization = ?, institution_key = ?, updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?`,
      )
      .bind(canonical, canonicalKey, alias),
    d1
      .prepare(
        `UPDATE joint_projects
         SET sponsor_organization = ?, updated_at = CURRENT_TIMESTAMP
         WHERE sponsor_organization = ?`,
      )
      .bind(canonical, alias),
    d1
      .prepare(
        `UPDATE activities SET
           organization = ?,
           region = CASE WHEN ? <> '' THEN ? ELSE region END,
           topic = REPLACE(topic, ?, ?),
           summary = REPLACE(summary, ?, ?),
           detail_summary = REPLACE(detail_summary, ?, ?),
           detail_key_facts_json = REPLACE(detail_key_facts_json, ?, ?),
           detail_sections_json = REPLACE(detail_sections_json, ?, ?),
           raw_input = REPLACE(raw_input, ?, ?),
           next_action = REPLACE(next_action, ?, ?),
           progress_schedule = REPLACE(progress_schedule, ?, ?),
           notes = REPLACE(notes, ?, ?),
           updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?`,
      )
      .bind(
        canonical,
        preferredRegion,
        preferredRegion,
        alias,
        canonical,
        alias,
        canonical,
        alias,
        canonical,
        alias,
        canonical,
        alias,
        canonical,
        alias,
        canonical,
        alias,
        canonical,
        alias,
        canonical,
        alias,
        canonical,
        alias,
      ),
    d1
      .prepare(
        `DELETE FROM manager_alert_acknowledgements
         WHERE organization = ?
           AND member_id IN (
             SELECT member_id
             FROM manager_alert_acknowledgements
             WHERE organization = ?
           )`,
      )
      .bind(alias, canonical),
    d1
      .prepare(
        `UPDATE manager_alert_acknowledgements SET
           organization = ?,
           issue_signature = REPLACE(issue_signature, ?, ?),
           updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?`,
      )
      .bind(canonical, alias, canonical, alias),
    d1
      .prepare(
        `UPDATE sales_campaign_targets
         SET
           region = CASE
             WHEN TRIM(COALESCE(region, '')) = '' THEN COALESCE((
               SELECT NULLIF(TRIM(source.region), '')
               FROM sales_campaign_targets source
               WHERE source.campaign_id = sales_campaign_targets.campaign_id
                 AND source.organization = ?
               LIMIT 1
             ), region)
             ELSE region
           END,
           address = CASE
             WHEN TRIM(COALESCE(address, '')) = '' THEN COALESCE((
               SELECT NULLIF(TRIM(source.address), '')
               FROM sales_campaign_targets source
               WHERE source.campaign_id = sales_campaign_targets.campaign_id
                 AND source.organization = ?
               LIMIT 1
             ), address)
             ELSE address
           END,
           phone = CASE
             WHEN TRIM(COALESCE(phone, '')) = '' THEN COALESCE((
               SELECT NULLIF(TRIM(source.phone), '')
               FROM sales_campaign_targets source
               WHERE source.campaign_id = sales_campaign_targets.campaign_id
                 AND source.organization = ?
               LIMIT 1
             ), phone)
             ELSE phone
           END,
           contact_name = CASE
             WHEN TRIM(COALESCE(contact_name, '')) = '' THEN COALESCE((
               SELECT NULLIF(TRIM(source.contact_name), '')
               FROM sales_campaign_targets source
               WHERE source.campaign_id = sales_campaign_targets.campaign_id
                 AND source.organization = ?
               LIMIT 1
             ), contact_name)
             ELSE contact_name
           END,
           notes = CASE
             WHEN TRIM(COALESCE(notes, '')) = '' THEN COALESCE((
               SELECT NULLIF(TRIM(source.notes), '')
               FROM sales_campaign_targets source
               WHERE source.campaign_id = sales_campaign_targets.campaign_id
                 AND source.organization = ?
               LIMIT 1
             ), notes)
             ELSE notes
           END,
           assigned_member_id = COALESCE(assigned_member_id, (
             SELECT source.assigned_member_id
             FROM sales_campaign_targets source
             WHERE source.campaign_id = sales_campaign_targets.campaign_id
               AND source.organization = ?
             LIMIT 1
           )),
           activity_id = COALESCE(activity_id, (
             SELECT source.activity_id
             FROM sales_campaign_targets source
             WHERE source.campaign_id = sales_campaign_targets.campaign_id
               AND source.organization = ?
             LIMIT 1
           )),
           budget_amount = COALESCE(budget_amount, (
             SELECT source.budget_amount
             FROM sales_campaign_targets source
             WHERE source.campaign_id = sales_campaign_targets.campaign_id
               AND source.organization = ?
             LIMIT 1
           )),
           school_level = CASE
             WHEN TRIM(COALESCE(school_level, '')) = '' THEN COALESCE((
               SELECT NULLIF(TRIM(source.school_level), '')
               FROM sales_campaign_targets source
               WHERE source.campaign_id = sales_campaign_targets.campaign_id
                 AND source.organization = ?
               LIMIT 1
             ), school_level)
             ELSE school_level
           END,
           supply_items = CASE
             WHEN TRIM(COALESCE(supply_items, '')) = '' THEN COALESCE((
               SELECT NULLIF(TRIM(source.supply_items), '')
               FROM sales_campaign_targets source
               WHERE source.campaign_id = sales_campaign_targets.campaign_id
                 AND source.organization = ?
               LIMIT 1
             ), supply_items)
             ELSE supply_items
           END,
           review_note = CASE
             WHEN TRIM(COALESCE(review_note, '')) = '' THEN COALESCE((
               SELECT NULLIF(TRIM(source.review_note), '')
               FROM sales_campaign_targets source
               WHERE source.campaign_id = sales_campaign_targets.campaign_id
                 AND source.organization = ?
               LIMIT 1
             ), review_note)
             ELSE review_note
           END,
           updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?
           AND EXISTS (
             SELECT 1
             FROM sales_campaign_targets source
             WHERE source.campaign_id = sales_campaign_targets.campaign_id
               AND source.organization = ?
           )`,
      )
      .bind(
        alias,
        alias,
        alias,
        alias,
        alias,
        alias,
        alias,
        alias,
        alias,
        alias,
        alias,
        canonical,
        alias,
      ),
    d1
      .prepare(
        `DELETE FROM sales_campaign_targets
         WHERE organization = ?
           AND campaign_id IN (
             SELECT campaign_id
             FROM sales_campaign_targets
             WHERE organization = ?
           )`,
      )
      .bind(alias, canonical),
    d1
      .prepare(
        `UPDATE sales_campaign_targets SET
           organization = ?,
           region = CASE WHEN ? <> '' THEN ? ELSE region END,
           address = CASE WHEN ? <> '' THEN ? ELSE address END,
           notes = REPLACE(notes, ?, ?),
           updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?`,
      )
      .bind(
        canonical,
        preferredRegion,
        preferredRegion,
        preferredAddress,
        preferredAddress,
        alias,
        canonical,
        alias,
      ),
    d1
      .prepare(
        `UPDATE equipment_items SET
           specification = REPLACE(specification, ?, ?),
           notes = REPLACE(notes, ?, ?),
           updated_at = CURRENT_TIMESTAMP
         WHERE project_id IN (
           SELECT id FROM equipment_projects
           WHERE organization IN (?, ?)
         )`,
      )
      .bind(alias, canonical, alias, canonical, alias, canonical),
    d1
      .prepare(
        `UPDATE ai_recommendations SET
           organization = ?,
           meeting_summary = REPLACE(meeting_summary, ?, ?),
           updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?`,
      )
      .bind(canonical, alias, canonical, alias),
    d1
      .prepare(
        "UPDATE quotation_documents SET organization = ? WHERE organization = ?",
      )
      .bind(canonical, alias),
    d1
      .prepare(
        `DELETE FROM organization_school_links
         WHERE organization = ?
           AND EXISTS (
             SELECT 1 FROM organization_school_links
             WHERE organization = ?
           )`,
      )
      .bind(alias, canonical),
    d1
      .prepare(
        `UPDATE organization_school_links SET
           link_key = ? || SUBSTR(link_key, LENGTH(?) + 1),
           organization = ?,
           organization_key = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?`,
      )
      .bind(canonicalKey, aliasKey, canonical, canonicalKey, alias),
    d1
      .prepare(
        `DELETE FROM institution_name_decisions
         WHERE left_organization = ? OR right_organization = ?`,
      )
      .bind(alias, alias),
    d1
      .prepare(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(INSTITUTION_ALIASES_SETTING_KEY, nextAliasSetting, memberId),
  ];

  if (aliasLocation && canonicalLocation) {
    const location = institutionMergeLocationValues(
      selectedLocation ?? canonicalLocation,
    );
    statements.splice(
      1,
      0,
      d1
        .prepare(
          `UPDATE organization_locations SET
             region = ?,
             address = ?,
             road_address = ?,
             latitude = ?,
             longitude = ?,
             place_name = REPLACE(?, ?, ?),
             place_id = ?,
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE organization = ?`,
        )
        .bind(
          location.region,
          location.address,
          location.roadAddress,
          location.latitude,
          location.longitude,
          location.placeName,
          alias,
          canonical,
          location.placeId,
          memberId,
          canonical,
        ),
      d1
        .prepare("DELETE FROM organization_locations WHERE organization = ?")
        .bind(alias),
    );
  } else if (aliasLocation) {
    statements.splice(
      1,
      0,
      d1
        .prepare(
          `UPDATE organization_locations SET
             organization = ?,
             place_name = REPLACE(place_name, ?, ?),
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE organization = ?`,
        )
        .bind(canonical, alias, canonical, memberId, alias),
    );
  }

  for (const [businessRound, manager] of managerByRound) {
    statements.push(
      d1
        .prepare(
          `UPDATE activities SET
             progress_manager = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE organization = ?
             AND business_round = ?
             AND seed_key LIKE 'campaign:%'
             AND (
               TRIM(COALESCE(progress_manager, '')) = ''
               OR progress_manager = '해당 없음'
             )`,
        )
        .bind(manager, canonical, businessRound),
      d1
        .prepare(
          `UPDATE sales_campaign_targets
           SET assigned_member_id = COALESCE((
                 SELECT id
                 FROM members
                 WHERE display_name = ?
                   AND status = 'approved'
                   AND is_sales = 1
                 ORDER BY id
                 LIMIT 1
               ), assigned_member_id),
               updated_at = CURRENT_TIMESTAMP
           WHERE organization = ?
             AND business_round = ?`,
        )
        .bind(manager, canonical, businessRound),
    );
  }

  for (const recommendation of aliasRecommendations.results) {
    statements.unshift(
      d1
        .prepare(
          `UPDATE ai_recommendations SET
             interests_json = ?,
             recommended_products_json = ?,
             follow_up_questions_json = ?,
             recommended_actions_json = ?,
             applied_products_json = ?,
             applied_questions_json = ?,
             applied_actions_json = ?
           WHERE id = ?`,
        )
        .bind(
          replaceJsonOrganizationReferences(
            recommendation.interests_json,
            alias,
            canonical,
          ),
          replaceJsonOrganizationReferences(
            recommendation.recommended_products_json,
            alias,
            canonical,
          ),
          replaceJsonOrganizationReferences(
            recommendation.follow_up_questions_json,
            alias,
            canonical,
          ),
          replaceJsonOrganizationReferences(
            recommendation.recommended_actions_json,
            alias,
            canonical,
          ),
          replaceJsonOrganizationReferences(
            recommendation.applied_products_json,
            alias,
            canonical,
          ),
          replaceJsonOrganizationReferences(
            recommendation.applied_questions_json,
            alias,
            canonical,
          ),
          replaceJsonOrganizationReferences(
            recommendation.applied_actions_json,
            alias,
            canonical,
          ),
          recommendation.id,
        ),
    );
  }
  for (const trashSnapshot of trashSnapshots.results) {
    statements.unshift(
      d1
        .prepare(
          `UPDATE deletion_batches SET
             display_name = ?,
             snapshot_json = ?
           WHERE id = ? AND restored_at IS NULL`,
        )
        .bind(
          replaceOrganizationReferences(
            trashSnapshot.display_name,
            alias,
            canonical,
          ),
          replaceJsonOrganizationReferences(
            trashSnapshot.snapshot_json,
            alias,
            canonical,
          ),
          trashSnapshot.id,
        ),
    );
  }

  const projectTargetByKey = new Map(
    canonicalProjects.results.map((project: EquipmentProjectMergeRow) => [
      `${Math.max(1, Number(project.business_round) || 1)}\u001f${project.name}`,
      project.id,
    ]),
  );
  for (const project of aliasProjects.results) {
    const businessRound = Math.max(1, Number(project.business_round) || 1);
    const nextName = replaceOrganizationReferences(
      project.name,
      alias,
      canonical,
    );
    const key = `${businessRound}\u001f${nextName}`;
    const targetProjectId = projectTargetByKey.get(key);
    if (targetProjectId) {
      statements.unshift(
        d1
          .prepare(
            "UPDATE equipment_items SET project_id = ? WHERE project_id = ?",
          )
          .bind(targetProjectId, project.id),
        d1
          .prepare("DELETE FROM equipment_projects WHERE id = ?")
          .bind(project.id),
      );
      continue;
    }
    projectTargetByKey.set(key, project.id);
    statements.unshift(
      d1
        .prepare(
          `UPDATE equipment_projects SET
             organization = ?,
             name = ?,
             notes = REPLACE(notes, ?, ?),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(canonical, nextName, alias, canonical, project.id),
    );
  }

  await d1.batch(statements);
  return countsForOrganization(canonical);
}
