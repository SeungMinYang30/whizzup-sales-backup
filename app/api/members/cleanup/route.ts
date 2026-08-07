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
    const result = await d1.transaction(async (tx) => {
      const targets = await tx
        .prepare(
          `SELECT * FROM members
           WHERE lower(email) <> lower(?) AND id <> ?
           ORDER BY id`,
        )
        .bind(OWNER_EMAIL, actor.id)
        .all<Record<string, unknown>>();
      if (!targets.results.length) return { deletedCount: 0, names: [] as string[] };
      const targetIds = targets.results.map((row) => Number(row.id));
      for (const row of targets.results) {
        const archivedRow = { ...row };
        delete archivedRow.password_hash;
        delete archivedRow.password_salt;
        await tx
          .prepare(
            `INSERT INTO member_account_archives
             (original_member_id, member_json, archived_by, archived_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          )
          .bind(Number(row.id), JSON.stringify(archivedRow), actor.id)
          .run();
      }
      for (const id of targetIds) {
        await tx.prepare("UPDATE members SET approved_by = ? WHERE approved_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE activity_authors SET member_id = NULL WHERE member_id = ?").bind(id).run();
        await tx.prepare("UPDATE activity_assignment_history SET to_member_id = ? WHERE to_member_id = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE activity_assignment_history SET changed_by_member_id = ? WHERE changed_by_member_id = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE activity_change_batches SET actor_member_id = ? WHERE actor_member_id = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE activity_change_batches SET undone_by_member_id = ? WHERE undone_by_member_id = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE activity_change_items SET undone_by_member_id = ? WHERE undone_by_member_id = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE ai_recommendations SET created_by = ? WHERE created_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE oauth_clients SET created_by = ? WHERE created_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE app_settings SET updated_by = ? WHERE updated_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE api_credentials SET updated_by = ? WHERE updated_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE organization_locations SET updated_by = ? WHERE updated_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE sales_campaigns SET created_by = ? WHERE created_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE sales_campaign_targets SET assigned_member_id = NULL WHERE assigned_member_id = ?").bind(id).run();
        await tx.prepare("UPDATE equipment_projects SET created_by = ? WHERE created_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE complex_projects SET manager_member_id = NULL WHERE manager_member_id = ?").bind(id).run();
        await tx.prepare("UPDATE complex_projects SET created_by = ? WHERE created_by = ?").bind(actor.id, id).run();
        await tx.prepare("UPDATE complex_projects SET updated_by = ? WHERE updated_by = ?").bind(actor.id, id).run();
        await tx.prepare("DELETE FROM manager_alert_acknowledgements WHERE member_id = ?").bind(id).run();
        await tx.prepare("DELETE FROM activity_review_acknowledgements WHERE member_id = ?").bind(id).run();
        await tx.prepare("DELETE FROM oauth_codes WHERE member_id = ?").bind(id).run();
        await tx.prepare("DELETE FROM oauth_tokens WHERE member_id = ?").bind(id).run();
        await tx.prepare("DELETE FROM local_auth_sessions WHERE member_id = ?").bind(id).run();
        await tx.prepare("DELETE FROM members WHERE id = ?").bind(id).run();
      }
      return {
        deletedCount: targets.results.length,
        names: targets.results.map((row) => String(row.display_name ?? row.email)),
      };
    });
    return Response.json({ ok: true, ...result, ownerEmail: OWNER_EMAIL });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
