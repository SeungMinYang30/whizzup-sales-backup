import { createFullBackup } from "../../../lib/backup-store";
import { createStandbyCredentialSnapshot } from "../../../lib/standby-credentials";

export const dynamic = "force-dynamic";

function runtimeSecret() {
  return (
    process.env.PRIMARY_EXPORT_SECRET?.trim() ||
    process.env.STANDBY_EXPORT_SECRET?.trim() ||
    ""
  );
}

function secureEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function authorized(request: Request) {
  const secret = runtimeSecret();
  const authorization = request.headers.get("authorization") ?? "";
  return Boolean(secret) && secureEqual(authorization, `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
  }

  try {
    const [backup, memberCredentials] = await Promise.all([
      createFullBackup(),
      createStandbyCredentialSnapshot(),
    ]);
    return Response.json({ ...backup, memberCredentials }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-WHIZZUP-Backup-Checksum": backup.checksum,
        "X-WHIZZUP-Backup-Created-At": backup.createdAt,
      },
    });
  } catch (error) {
    console.error("Standby export failed", error);
    return Response.json(
      { error: "대기 서버용 백업을 만들지 못했습니다." },
      { status: 500 },
    );
  }
}
