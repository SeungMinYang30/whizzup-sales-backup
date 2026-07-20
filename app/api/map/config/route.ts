import {
  accessErrorResponse,
  ensureCollaborationReady,
  requireApprovedMember,
  requireMemberPermission,
} from "../../../../lib/collaboration";

export const dynamic = "force-dynamic";

const KAKAO_SETTING_KEY = "kakao_javascript_key";

function serverJavascriptKey() {
  return String(
    process.env.KAKAO_JAVASCRIPT_KEY ??
      process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY ??
      "",
  ).trim();
}

function keyLast4(value: string) {
  return value ? value.slice(-4) : "";
}

function validJavascriptKey(value: string) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

async function getKakaoSettingsStatus(d1: Awaited<ReturnType<typeof ensureCollaborationReady>>) {
  const row = await d1
    .prepare(
      "SELECT value, updated_at FROM app_settings WHERE key = ? LIMIT 1",
    )
    .bind(KAKAO_SETTING_KEY)
    .first<{ value: string; updated_at: string }>();
  const registeredKey = row?.value?.trim() ?? "";
  const fallbackKey = serverJavascriptKey();
  const javascriptKey = registeredKey || fallbackKey;
  return {
    configured: Boolean(javascriptKey),
    source: registeredKey ? ("registered" as const) : fallbackKey ? ("server" as const) : ("none" as const),
    javascriptKey,
    keyLast4: keyLast4(javascriptKey),
    updatedAt: row?.updated_at ?? "",
    serverFallbackConfigured: Boolean(fallbackKey),
    serverFallbackLast4: keyLast4(fallbackKey),
  };
}

async function testKakaoJavascriptKey(javascriptKey: string) {
  const response = await fetch(
    `https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=${encodeURIComponent(javascriptKey)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error("카카오맵 키로 지도 SDK에 연결하지 못했습니다.");
  }
}

export async function GET() {
  try {
    await requireApprovedMember();
    const d1 = await ensureCollaborationReady();
    return Response.json(await getKakaoSettingsStatus(d1));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireMemberPermission("integration:manage");
    const payload = (await request.json()) as { javascriptKey?: string };
    const javascriptKey = String(payload.javascriptKey ?? "").trim();
    if (!validJavascriptKey(javascriptKey)) {
      return Response.json(
        { error: "카카오 JavaScript 키를 다시 확인해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureCollaborationReady();
    await d1
      .prepare(`
        INSERT INTO app_settings (key, value, updated_by, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(KAKAO_SETTING_KEY, javascriptKey, member.id)
      .run();
    return Response.json({ ok: true, ...(await getKakaoSettingsStatus(d1)) });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("integration:manage");
    const payload = (await request.json()) as {
      action?: "test" | "save" | "revert";
      javascriptKey?: string;
    };
    const action = payload.action;
    const javascriptKey = String(payload.javascriptKey ?? "").trim();
    const d1 = await ensureCollaborationReady();

    if (action === "revert") {
      await d1
        .prepare("DELETE FROM app_settings WHERE key = ?")
        .bind(KAKAO_SETTING_KEY)
        .run();
      return Response.json({
        ok: true,
        message: "서버에 설정된 기존 카카오맵 키로 되돌렸습니다.",
        ...(await getKakaoSettingsStatus(d1)),
      });
    }

    if (!validJavascriptKey(javascriptKey)) {
      return Response.json(
        { error: "카카오 JavaScript 키를 다시 확인해 주세요." },
        { status: 400 },
      );
    }

    await testKakaoJavascriptKey(javascriptKey);
    if (action === "test") {
      return Response.json({
        ok: true,
        message: "카카오맵 키 연결을 확인했습니다.",
        keyLast4: keyLast4(javascriptKey),
      });
    }

    if (action !== "save") {
      return Response.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    }

    await d1
      .prepare(`
        INSERT INTO app_settings (key, value, updated_by, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(KAKAO_SETTING_KEY, javascriptKey, member.id)
      .run();
    return Response.json({
      ok: true,
      message: "새 카카오맵 키를 저장했습니다.",
      ...(await getKakaoSettingsStatus(d1)),
      updatedBy: member.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "카카오맵 연결을 확인하지 못했습니다.";
    if (message.includes("지도 SDK")) {
      return Response.json({ error: message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}
