import {
  accessErrorResponse,
  ensureCollaborationReady,
  normalizeMemberPermissions,
  requireMemberPermission,
} from "../../../lib/collaboration";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireMemberPermission("members:manage");
    const d1 = await ensureCollaborationReady();
    const result = await d1
      .prepare(`
        SELECT
          id, email, display_name, role, permissions, status, created_at,
          approved_at, approved_by, last_seen_at
        FROM members
        ORDER BY
          CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
          created_at DESC
      `)
      .all();
    return Response.json({ members: result.results });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireMemberPermission("members:manage");
    const payload = (await request.json()) as {
      id?: number;
      status?: string;
      role?: string;
      permissions?: unknown;
    };
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1 || id === actor.id) {
      return Response.json(
        { error: "본인 계정은 이 화면에서 변경할 수 없습니다." },
        { status: 400 },
      );
    }
    const status = ["pending", "approved", "suspended"].includes(
      String(payload.status),
    )
      ? String(payload.status)
      : "pending";
    const d1 = await ensureCollaborationReady();
    const target = await d1
      .prepare("SELECT id, role FROM members WHERE id = ?")
      .bind(id)
      .first<{ id: number; role: string }>();
    if (!target) {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    if (target.role === "admin") {
      return Response.json(
        { error: "대표관리자 계정은 변경할 수 없습니다." },
        { status: 400 },
      );
    }
    if (actor.role !== "admin" && target.role !== "member") {
      return Response.json(
        { error: "보조관리자는 일반 구성원만 관리할 수 있습니다." },
        { status: 403 },
      );
    }

    const role =
      actor.role === "admin" && payload.role === "assistant"
        ? "assistant"
        : "member";
    const permissions =
      role === "assistant"
        ? normalizeMemberPermissions(payload.permissions)
        : [];
    const result = await d1
      .prepare(`
        UPDATE members SET
          status = ?,
          role = ?,
          permissions = ?,
          approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, CURRENT_TIMESTAMP) ELSE approved_at END,
          approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END
        WHERE id = ?
        RETURNING *
      `)
      .bind(
        status,
        role,
        JSON.stringify(permissions),
        status,
        status,
        actor.id,
        id,
      )
      .first();
    if (!result) {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    return Response.json({ member: result });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireMemberPermission("members:manage");
    const payload = (await request.json()) as {
      id?: number;
      displayName?: string;
    };
    const id = Number(payload.id);
    const displayName = String(payload.displayName ?? "").trim();

    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "사용자를 확인할 수 없습니다." }, { status: 400 });
    }
    if (!displayName) {
      return Response.json({ error: "표시 이름을 입력해주세요." }, { status: 400 });
    }
    if (displayName.length > 40) {
      return Response.json(
        { error: "표시 이름은 40자 이내로 입력해주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureCollaborationReady();
    const target = await d1
      .prepare("SELECT role FROM members WHERE id = ?")
      .bind(id)
      .first<{ role: string }>();
    if (!target) {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    if (
      actor.role !== "admin" &&
      (target.role === "admin" || target.role === "assistant")
    ) {
      return Response.json(
        { error: "보조관리자는 일반 구성원의 이름만 변경할 수 있습니다." },
        { status: 403 },
      );
    }
    const member = await d1
      .prepare("UPDATE members SET display_name = ? WHERE id = ? RETURNING *")
      .bind(displayName, id)
      .first();
    if (!member) {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    await d1
      .prepare(
        "UPDATE activity_authors SET created_by_name = ? WHERE member_id = ?",
      )
      .bind(displayName, id)
      .run();

    return Response.json({ member });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
