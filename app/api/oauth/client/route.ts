import {
  accessErrorResponse,
  ensureCollaborationReady,
  hashSecret,
  randomToken,
  requireAdminMember,
} from "../../../../lib/collaboration";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminMember();
    const d1 = await ensureCollaborationReady();
    const client = await d1
      .prepare(`
        SELECT client_id, name, created_at, rotated_at
        FROM oauth_clients
        ORDER BY id ASC
        LIMIT 1
      `)
      .first();
    return Response.json({ client: client ?? null });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST() {
  try {
    const admin = await requireAdminMember();
    const d1 = await ensureCollaborationReady();
    const existing = await d1
      .prepare("SELECT client_id FROM oauth_clients ORDER BY id ASC LIMIT 1")
      .first<{ client_id: string }>();
    const clientId =
      existing?.client_id ?? `whizzup_gpt_${randomToken(12).toLowerCase()}`;
    const clientSecret = `whizzup_secret_${randomToken(32)}`;
    const secretHash = await hashSecret(clientSecret);

    if (existing) {
      await d1.batch([
        d1
          .prepare(`
            UPDATE oauth_clients
            SET client_secret_hash = ?, rotated_at = CURRENT_TIMESTAMP
            WHERE client_id = ?
          `)
          .bind(secretHash, clientId),
        d1
          .prepare(
            "UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE client_id = ? AND revoked_at IS NULL",
          )
          .bind(clientId),
      ]);
    } else {
      await d1
        .prepare(`
          INSERT INTO oauth_clients (
            client_id, client_secret_hash, name, created_by
          ) VALUES (?, ?, '위즈업 TM 정리 GPT', ?)
        `)
        .bind(clientId, secretHash, admin.id)
        .run();
    }

    return Response.json({
      client: {
        clientId,
        clientSecret,
        name: "위즈업 TM 정리 GPT",
        secretShownOnce: true,
      },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
