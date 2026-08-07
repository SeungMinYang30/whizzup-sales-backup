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

    const actorId = Number(actor.id);
    if (!Number.isSafeInteger(actorId) || actorId <= 0) {
      return Response.json({ error: "대표 관리자 정보를 확인하지 못했습니다." }, { status: 400 });
    }

    const d1 = await ensureCollaborationReady();
    const ownerEmailSql = OWNER_EMAIL.replaceAll("'", "''");
    const targets = await d1.transaction(async (tx) => {
      const targetRows = await tx
        .prepare(
          `SELECT id, COALESCE(display_name, email) AS name
           FROM members
           WHERE lower(email) <> lower(?) AND id <> ?
           ORDER BY id`,
        )
        .bind(OWNER_EMAIL, actorId)
        .all<{ id: number; name: string }>();

      if (!targetRows.results.length) return targetRows.results;

      // One ordered server-side block keeps the scarce Supabase pool
      // connection short-lived while ensuring foreign-key references move
      // before the member rows are deleted.
      await tx
        .prepare(
          `DO $cleanup$
           DECLARE
             owner_id bigint := ${actorId};
             target_ids bigint[];
           BEGIN
             SELECT COALESCE(array_agg(id), ARRAY[]::bigint[])
               INTO target_ids
               FROM members
              WHERE lower(email) <> lower('${ownerEmailSql}') AND id <> owner_id;

             INSERT INTO member_account_archives
               (original_member_id, member_json, archived_by, archived_at)
             SELECT m.id,
                    ((to_jsonb(m) - 'password_hash') - 'password_salt')::text,
                    owner_id,
                    CURRENT_TIMESTAMP
               FROM members m
              WHERE m.id = ANY(target_ids);

             UPDATE members SET approved_by = owner_id WHERE approved_by = ANY(target_ids);
             UPDATE activity_authors SET member_id = NULL WHERE member_id = ANY(target_ids);
             UPDATE activity_assignment_history SET to_member_id = owner_id WHERE to_member_id = ANY(target_ids);
             UPDATE activity_assignment_history SET changed_by_member_id = owner_id WHERE changed_by_member_id = ANY(target_ids);
             UPDATE activity_change_batches SET actor_member_id = owner_id WHERE actor_member_id = ANY(target_ids);
             UPDATE activity_change_batches SET undone_by_member_id = owner_id WHERE undone_by_member_id = ANY(target_ids);
             UPDATE activity_change_items SET undone_by_member_id = owner_id WHERE undone_by_member_id = ANY(target_ids);
             UPDATE ai_recommendations SET created_by = owner_id WHERE created_by = ANY(target_ids);
             UPDATE oauth_clients SET created_by = owner_id WHERE created_by = ANY(target_ids);
             UPDATE app_settings SET updated_by = owner_id WHERE updated_by = ANY(target_ids);
             UPDATE api_credentials SET updated_by = owner_id WHERE updated_by = ANY(target_ids);
             UPDATE organization_locations SET updated_by = owner_id WHERE updated_by = ANY(target_ids);
             UPDATE sales_campaigns SET created_by = owner_id WHERE created_by = ANY(target_ids);
             UPDATE sales_campaign_targets SET assigned_member_id = NULL WHERE assigned_member_id = ANY(target_ids);
             UPDATE equipment_projects SET created_by = owner_id WHERE created_by = ANY(target_ids);
             UPDATE complex_projects SET manager_member_id = NULL WHERE manager_member_id = ANY(target_ids);
             UPDATE complex_projects SET created_by = owner_id WHERE created_by = ANY(target_ids);
             UPDATE complex_projects SET updated_by = owner_id WHERE updated_by = ANY(target_ids);

             DELETE FROM manager_alert_acknowledgements WHERE member_id = ANY(target_ids);
             DELETE FROM activity_review_acknowledgements WHERE member_id = ANY(target_ids);
             DELETE FROM oauth_codes WHERE member_id = ANY(target_ids);
             DELETE FROM oauth_tokens WHERE member_id = ANY(target_ids);
             DELETE FROM local_auth_sessions WHERE member_id = ANY(target_ids);
             DELETE FROM members WHERE id = ANY(target_ids);
           END
           $cleanup$`,
        )
        .run();

      return targetRows.results;
    });

    return Response.json({
      ok: true,
      deletedCount: targets.length,
      names: targets.map((row) => row.name),
      ownerEmail: OWNER_EMAIL,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
