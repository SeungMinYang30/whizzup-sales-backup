import { ensureAiRecommendationsReady } from "./ai-recommendations";
import { ensureCampaignsReady } from "./campaign-store";
import { ensureEquipmentReady } from "./equipment-store";
import {
  INSTITUTION_ALIASES_SETTING_KEY,
  preferFullInstitutionName,
  updateInstitutionAliasSetting,
} from "./institution-names";
import { ensureMapReady } from "./map-store";
import { ensureRecordsReady } from "./records-store";
import { ensureQuotationDocumentsReady } from "./quotation-documents";

export type InstitutionMergeCounts = {
  organization: string;
  activityCount: number;
  recommendationCount: number;
  campaignCount: number;
  equipmentProjectCount: number;
  equipmentItemCount: number;
  hasLocation: boolean;
};

async function countsForOrganization(organization: string) {
  const d1 = await ensureRecordsReady();
  const [
    activities,
    recommendations,
    campaigns,
    projects,
    items,
    location,
  ] = await Promise.all([
    d1
      .prepare("SELECT COUNT(*) AS count FROM activities WHERE organization = ?")
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
        "SELECT COUNT(*) AS count FROM organization_locations WHERE organization = ?",
      )
      .bind(organization)
      .first<{ count: number }>(),
  ]);
  return {
    organization,
    activityCount: Number(activities?.count ?? 0),
    recommendationCount: Number(recommendations?.count ?? 0),
    campaignCount: Number(campaigns?.count ?? 0),
    equipmentProjectCount: Number(projects?.count ?? 0),
    equipmentItemCount: Number(items?.count ?? 0),
    hasLocation: Number(location?.count ?? 0) > 0,
  } satisfies InstitutionMergeCounts;
}

export async function inspectInstitutionMerge(organizations: string[]) {
  await Promise.all([
    ensureEquipmentReady(),
    ensureMapReady(),
    ensureCampaignsReady(),
    ensureAiRecommendationsReady(),
    ensureQuotationDocumentsReady(),
  ]);
  const counts = await Promise.all(
    organizations.map((organization) => countsForOrganization(organization)),
  );
  return {
    organizations: counts,
    recommendedTarget: preferFullInstitutionName(...organizations),
  };
}

export async function mergeInstitutionRecords(
  alias: string,
  canonical: string,
  memberId: number,
) {
  if (!alias || !canonical || alias === canonical) {
    throw new Error("서로 다른 두 기관을 선택해 주세요.");
  }
  const d1 = await ensureRecordsReady();
  await Promise.all([
    ensureEquipmentReady(),
    ensureMapReady(),
    ensureCampaignsReady(),
    ensureAiRecommendationsReady(),
    ensureQuotationDocumentsReady(),
  ]);
  const duplicates = await d1
    .prepare(
      `SELECT source.id AS source_id, target.id AS target_id
       FROM equipment_projects source
       JOIN equipment_projects target
         ON target.organization = ? AND target.name = source.name
       WHERE source.organization = ?`,
    )
    .bind(canonical, alias)
    .all<{ source_id: number; target_id: number }>();
  for (const project of duplicates.results) {
    await d1.batch([
      d1
        .prepare("UPDATE equipment_items SET project_id = ? WHERE project_id = ?")
        .bind(project.target_id, project.source_id),
      d1
        .prepare("DELETE FROM equipment_projects WHERE id = ?")
        .bind(project.source_id),
    ]);
  }
  const currentAliasSetting = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(INSTITUTION_ALIASES_SETTING_KEY)
    .first<{ value: string }>();
  const nextAliasSetting = updateInstitutionAliasSetting(
    currentAliasSetting?.value,
    alias,
    canonical,
  );
  await d1.batch([
    d1
      .prepare(
        `UPDATE activities SET
           organization = ?,
           topic = REPLACE(topic, ?, ?),
           summary = REPLACE(summary, ?, ?),
           next_action = REPLACE(next_action, ?, ?),
           progress_schedule = REPLACE(progress_schedule, ?, ?),
           notes = REPLACE(notes, ?, ?),
           updated_at = CURRENT_TIMESTAMP
         WHERE organization = ?`,
      )
      .bind(
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
        "DELETE FROM organization_locations WHERE organization = ? AND EXISTS (SELECT 1 FROM organization_locations WHERE organization = ?)",
      )
      .bind(alias, canonical),
    d1
      .prepare(
        "UPDATE organization_locations SET organization = ?, updated_at = CURRENT_TIMESTAMP WHERE organization = ?",
      )
      .bind(canonical, alias),
    d1
      .prepare(
        "DELETE FROM manager_alert_acknowledgements WHERE organization = ? AND member_id IN (SELECT member_id FROM manager_alert_acknowledgements WHERE organization = ?)",
      )
      .bind(alias, canonical),
    d1
      .prepare(
        "UPDATE manager_alert_acknowledgements SET organization = ?, updated_at = CURRENT_TIMESTAMP WHERE organization = ?",
      )
      .bind(canonical, alias),
    d1
      .prepare(
        "DELETE FROM sales_campaign_targets WHERE organization = ? AND campaign_id IN (SELECT campaign_id FROM sales_campaign_targets WHERE organization = ?)",
      )
      .bind(alias, canonical),
    d1
      .prepare(
        "UPDATE sales_campaign_targets SET organization = ?, updated_at = CURRENT_TIMESTAMP WHERE organization = ?",
      )
      .bind(canonical, alias),
    d1
      .prepare(
        "UPDATE equipment_projects SET organization = ?, updated_at = CURRENT_TIMESTAMP WHERE organization = ?",
      )
      .bind(canonical, alias),
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
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        INSTITUTION_ALIASES_SETTING_KEY,
        nextAliasSetting,
        memberId,
      ),
  ]);
  return countsForOrganization(canonical);
}

