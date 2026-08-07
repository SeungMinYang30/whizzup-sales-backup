import {
  accessErrorResponse,
  ensureCollaborationReady,
  requirePrimaryOwner,
} from "../../../../lib/collaboration";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "freeyang30@gmail.com";

export async function POST() {
  try {
    const actor = await requirePrimaryOwner();
    if (actor.email.trim().toLowerCase() !== OWNER_EMAIL) {
      return Response.json(
        { error: "지정된 대표 관리자 계정에서만 정리할 수 있습니다." },
        { status: 403 },
      );
    }
    const d1 = await ensureCollaborationReady();
    // Keep this as one database round trip. The previous per-table batch held a
    // scarce Supabase pool connection long enough for Vercel requests to time
    // out when the site was busy.
    const result = await d1
      .prepare(
        `WITH
         params AS (
           SELECT ?::bigint AS actor_id, lower(?)::text AS owner_email
         ),
         targets AS MATERIALIZED (
           SELECT m.*
           FROM members m, params p
           WHERE lower(m.email) <> p.owner_email AND m.id <> p.actor_id
         ),
         archived AS (
           INSERT INTO member_account_archives
             (original_member_id, member_json, archived_by, archived_at)
           SELECT t.id,
                  ((to_jsonb(t) - 'password_hash') - 'password_salt')::text,
                  p.actor_id,
                  CURRENT_TIMESTAMP
           FROM targets t CROSS JOIN params p
           RETURNING 1
         ),
         update_member_approvers AS (
           UPDATE members SET approved_by = (SELECT actor_id FROM params)
           WHERE approved_by IN (SELECT id FROM targets) RETURNING 1
         ),
         update_activity_authors AS (
           UPDATE activity_authors SET member_id = NULL
           WHERE member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         update_assignment_targets AS (
           UPDATE activity_assignment_history SET to_member_id = (SELECT actor_id FROM params)
           WHERE to_member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         update_assignment_actors AS (
           UPDATE activity_assignment_history SET changed_by_member_id = (SELECT actor_id FROM params)
           WHERE changed_by_member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         update_batch_actors AS (
           UPDATE activity_change_batches SET actor_member_id = (SELECT actor_id FROM params)
           WHERE actor_member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         update_batch_undo AS (
           UPDATE activity_change_batches SET undone_by_member_id = (SELECT actor_id FROM params)
           WHERE undone_by_member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         update_item_undo AS (
           UPDATE activity_change_items SET undone_by_member_id = (SELECT actor_id FROM params)
           WHERE undone_by_member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         update_ai AS (
           UPDATE ai_recommendations SET created_by = (SELECT actor_id FROM params)
           WHERE created_by IN (SELECT id FROM targets) RETURNING 1
         ),
         update_oauth_clients AS (
           UPDATE oauth_clients SET created_by = (SELECT actor_id FROM params)
           WHERE created_by IN (SELECT id FROM targets) RETURNING 1
         ),
         update_settings AS (
           UPDATE app_settings SET updated_by = (SELECT actor_id FROM params)
           WHERE updated_by IN (SELECT id FROM targets) RETURNING 1
         ),
         update_credentials AS (
           UPDATE api_credentials SET updated_by = (SELECT actor_id FROM params)
           WHERE updated_by IN (SELECT id FROM targets) RETURNING 1
         ),
         update_locations AS (
           UPDATE organization_locations SET updated_by = (SELECT actor_id FROM params)
           WHERE updated_by IN (SELECT id FROM targets) RETURNING 1
         ),
         update_campaigns AS (
           UPDATE sales_campaigns SET created_by = (SELECT actor_id FROM params)
           WHERE created_by IN (SELECT id FROM targets) RETURNING 1
         ),
         clear_campaign_assignees AS (
           UPDATE sales_campaign_targets SET assigned_member_id = NULL
           WHERE assigned_member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         update_equipment_projects AS (
           UPDATE equipment_projects SET created_by = (SELECT actor_id FROM params)
           WHERE created_by IN (SELECT id FROM targets) RETURNING 1
         ),
         clear_complex_managers AS (
           UPDATE complex_projects SET manager_member_id = NULL
           WHERE manager_member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         update_complex_creators AS (
           UPDATE complex_projects SET created_by = (SELECT actor_id FROM params)
           WHERE created_by IN (SELECT id FROM targets) RETURNING 1
         ),
         update_complex_editors AS (
           UPDATE complex_projects SET updated_by = (SELECT actor_id FROM params)
           WHERE updated_by IN (SELECT id FROM targets) RETURNING 1
         ),
         delete_alert_acks AS (
           DELETE FROM manager_alert_acknowledgements
           WHERE member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         delete_review_acks AS (
           DELETE FROM activity_review_acknowledgements
           WHERE member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         delete_codes AS (
           DELETE FROM oauth_codes WHERE member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         delete_tokens AS (
           DELETE FROM oauth_tokens WHERE member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         delete_sessions AS (
           DELETE FROM local_auth_sessions WHERE member_id IN (SELECT id FROM targets) RETURNING 1
         ),
         deleted AS (
           DELETE FROM members WHERE id IN (SELECT id FROM targets) RETURNING 1
         )
         SELECT COUNT(*)::integer AS deleted_count,
                COALESCE(array_agg(COALESCE(display_name, email) ORDER BY id), ARRAY[]::text[]) AS names
         FROM targets`,
      )
      .bind(actor.id, OWNER_EMAIL)
      .first<{ deleted_count: number; names: string[] }>();
    return Response.json({
      ok: true,
      deletedCount: Number(result?.deleted_count ?? 0),
      names: result?.names ?? [],
      ownerEmail: OWNER_EMAIL,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
