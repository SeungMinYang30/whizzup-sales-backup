import {
  accessErrorResponse,
  ensureCollaborationReady,
  memberPermissionsJsonExpression,
  normalizeMemberPermissions,
  requireApprovedMember,
  requireMemberPermission,
} from "../../../lib/collaboration";
import { ensureActivityChangeLedgerReady } from "../../../lib/activity-change-ledger";
import {
  ensureDirectAuthReady,
  setMemberPassword,
} from "../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope === "assignees") {
      await requireApprovedMember();
      const d1 = await ensureCollaborationReady();
      const result = await d1
        .prepare(
          `SELECT id, display_name, job_title, role, status
           FROM members
           WHERE status = 'approved' AND is_sales = 1
           ORDER BY display_name COLLATE NOCASE, id`,
        )
        .all();
      return Response.json({ members: result.results });
    }
    await requireMemberPermission("members:manage");
    const d1 = await ensureDirectAuthReady();
    const result = await d1
      .prepare(`
        SELECT
          m.id, m.email, m.username, m.display_name, m.job_title, m.role, m.permissions,
          m.status, m.is_sales, m.created_at, m.approved_at, m.approved_by,
          m.last_seen_at,
          EXISTS(
            SELECT 1 FROM member_password_reset_requests r
            WHERE r.member_id = m.id AND r.status = 'pending'
          ) AS password_reset_pending
        FROM members m
        ORDER BY
          CASE m.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
          m.created_at DESC
      `)
      .all();
    return Response.json({ members: result.results });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireMemberPermission("members:manage");
    const payload = (await request.json()) as {
      email?: string;
      displayName?: string;
      jobTitle?: string;
    };
    const email = String(payload.email ?? "").trim().toLowerCase();
    const displayName = String(payload.displayName ?? "").trim();
    const jobTitle = String(payload.jobTitle ?? "").trim().slice(0, 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json(
        { error: "등록할 이메일 주소를 확인해 주세요." },
        { status: 400 },
      );
    }
    if (!displayName) {
      return Response.json(
        { error: "구성원 이름을 입력해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureCollaborationReady();
    await d1
      .prepare("DELETE FROM member_rejections WHERE lower(email) = ?")
      .bind(email)
      .run();
    const existing = await d1
      .prepare("SELECT * FROM members WHERE LOWER(email) = ?")
      .bind(email)
      .first<Record<string, unknown>>();
    if (existing) {
      const approvedNow = String(existing.status) !== "approved";
      const member = await d1
        .prepare(`
          UPDATE members SET
            display_name = ?,
            job_title = ?,
            status = 'approved',
            approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
            approved_by = COALESCE(approved_by, ?)
          WHERE id = ?
          RETURNING *
        `)
        .bind(displayName, jobTitle, actor.id, Number(existing.id))
        .first();
      return Response.json({ member, created: false, approvedNow });
    }

    const member = await d1
      .prepare(`
        INSERT INTO members (
          email, display_name, job_title, role, permissions, status, is_sales,
          approved_at, approved_by, last_seen_at
        ) VALUES (?, ?, ?, 'member', '[]', 'approved', 0, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
        RETURNING *
      `)
      .bind(email, displayName, jobTitle, actor.id)
      .first();
    return Response.json(
      { member, created: true, approvedNow: true },
      { status: 201 },
    );
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
      .prepare("SELECT id, role, is_sales FROM members WHERE id = ?")
      .bind(id)
      .first<{ id: number; role: string; is_sales: number }>();
    if (!target) {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    if (target.role === "admin") {
      return Response.json(
        { error: "운영자 계정은 변경할 수 없습니다." },
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
    const requestedPermissions = normalizeMemberPermissions(payload.permissions);
    const aiInputPermissions = requestedPermissions.filter((permission) =>
      ["ai:voice", "ai:images"].includes(permission),
    );
    const permissions =
      role === "assistant" ? requestedPermissions : aiInputPermissions;
    const result = await d1
      .prepare(`
        UPDATE members SET
          status = ?,
          role = ?,
          permissions = ${memberPermissionsJsonExpression(permissions)},
          approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, CURRENT_TIMESTAMP) ELSE approved_at END,
          approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END
        WHERE id = ?
        RETURNING *
      `)
      .bind(
        status,
        role,
        ...permissions,
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
      jobTitle?: string;
      isSales?: boolean;
      temporaryPassword?: string;
    };
    const id = Number(payload.id);

    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "사용자를 확인할 수 없습니다." }, { status: 400 });
    }
    const d1 = await ensureCollaborationReady();
    const target = await d1
      .prepare("SELECT role FROM members WHERE id = ?")
      .bind(id)
      .first<{ role: string }>();
    if (!target) {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    if (typeof payload.temporaryPassword === "string") {
      if (actor.role !== "admin") {
        return Response.json(
          { error: "비밀번호 초기화는 운영자만 할 수 있습니다." },
          { status: 403 },
        );
      }
      await setMemberPassword(id, payload.temporaryPassword);
      await d1
        .prepare(`
          UPDATE member_password_reset_requests
          SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
          WHERE member_id = ? AND status = 'pending'
        `)
        .bind(actor.id, id)
        .run();
      return Response.json({ ok: true });
    }

    if (typeof payload.isSales === "boolean") {
      if (actor.role !== "admin") {
        return Response.json(
          { error: "영업 담당자 지정은 운영자만 할 수 있습니다." },
          { status: 403 },
        );
      }
      const member = await d1
        .prepare("UPDATE members SET is_sales = ? WHERE id = ? RETURNING *")
        .bind(payload.isSales ? 1 : 0, id)
        .first();
      return Response.json({ member });
    }

    const displayName = String(payload.displayName ?? "").trim();
    if (!displayName) {
      return Response.json({ error: "표시 이름을 입력해주세요." }, { status: 400 });
    }
    if (displayName.length > 40) {
      return Response.json(
        { error: "표시 이름은 40자 이내로 입력해주세요." },
        { status: 400 },
      );
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
    const jobTitle =
      typeof payload.jobTitle === "string"
        ? payload.jobTitle.trim().slice(0, 40)
        : null;
    const member = await d1
      .prepare(`
        UPDATE members SET
          display_name = ?,
          job_title = COALESCE(?, job_title)
        WHERE id = ? RETURNING *
      `)
      .bind(displayName, jobTitle, id)
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

export async function DELETE(request: Request) {
  try {
    const actor = await requireMemberPermission("members:manage");
    if (actor.role !== "admin") {
      return Response.json(
        { error: "계정 영구 삭제는 운영자만 할 수 있습니다." },
        { status: 403 },
      );
    }

    const payload = (await request.json()) as { id?: number };
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1 || id === actor.id) {
      return Response.json(
        { error: "본인 계정은 삭제할 수 없습니다." },
        { status: 400 },
      );
    }

    const d1 = await ensureCollaborationReady();
    const target = await d1
      .prepare("SELECT * FROM members WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!target) {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    if (String(target.role) === "admin") {
      return Response.json(
        { error: "운영자 계정은 삭제할 수 없습니다." },
        { status: 400 },
      );
    }
    await ensureActivityChangeLedgerReady();
    const archivedTarget = { ...target };
    delete archivedTarget.password_hash;
    delete archivedTarget.password_salt;
    await d1.transaction(async (tx) => {
      await tx
        .prepare(
          `INSERT INTO member_account_archives
           (original_member_id, member_json, archived_by, archived_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .bind(id, JSON.stringify(archivedTarget), actor.id)
        .run();
      await tx.batch([
        tx
          .prepare(`
            INSERT INTO member_rejections (email, rejected_by, rejected_at)
            VALUES (lower(?), ?, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET
              rejected_by = excluded.rejected_by,
              rejected_at = CURRENT_TIMESTAMP
          `)
          .bind(String(target.email), actor.id),
        tx
        .prepare("UPDATE members SET approved_by = ? WHERE approved_by = ?")
        .bind(actor.id, id),
        tx
        .prepare("UPDATE activity_authors SET member_id = NULL WHERE member_id = ?")
        .bind(id),
        tx
        .prepare(
          "UPDATE activity_assignment_history SET to_member_id = ? WHERE to_member_id = ?",
        )
        .bind(actor.id, id),
        tx
        .prepare(
          "UPDATE activity_assignment_history SET changed_by_member_id = ? WHERE changed_by_member_id = ?",
        )
        .bind(actor.id, id),
        tx
        .prepare(
          "UPDATE activity_change_batches SET actor_member_id = ? WHERE actor_member_id = ?",
        )
        .bind(actor.id, id),
        tx
        .prepare(
          "UPDATE activity_change_batches SET undone_by_member_id = ? WHERE undone_by_member_id = ?",
        )
        .bind(actor.id, id),
        tx
        .prepare(
          "UPDATE activity_change_items SET undone_by_member_id = ? WHERE undone_by_member_id = ?",
        )
        .bind(actor.id, id),
        tx
        .prepare("DELETE FROM manager_alert_acknowledgements WHERE member_id = ?")
        .bind(id),
        tx
        .prepare("DELETE FROM activity_review_acknowledgements WHERE member_id = ?")
        .bind(id),
        tx
        .prepare("UPDATE ai_recommendations SET created_by = ? WHERE created_by = ?")
        .bind(actor.id, id),
        tx
        .prepare("UPDATE oauth_clients SET created_by = ? WHERE created_by = ?")
        .bind(actor.id, id),
        tx.prepare("DELETE FROM oauth_codes WHERE member_id = ?").bind(id),
        tx.prepare("DELETE FROM oauth_tokens WHERE member_id = ?").bind(id),
        tx.prepare("DELETE FROM local_auth_sessions WHERE member_id = ?").bind(id),
        tx
        .prepare("UPDATE app_settings SET updated_by = ? WHERE updated_by = ?")
        .bind(actor.id, id),
        tx
        .prepare("UPDATE api_credentials SET updated_by = ? WHERE updated_by = ?")
        .bind(actor.id, id),
        tx
        .prepare(
          "UPDATE organization_locations SET updated_by = ? WHERE updated_by = ?",
        )
        .bind(actor.id, id),
        tx
        .prepare("UPDATE sales_campaigns SET created_by = ? WHERE created_by = ?")
        .bind(actor.id, id),
        tx
        .prepare(
          "UPDATE sales_campaign_targets SET assigned_member_id = NULL WHERE assigned_member_id = ?",
        )
        .bind(id),
        tx
        .prepare("UPDATE equipment_projects SET created_by = ? WHERE created_by = ?")
        .bind(actor.id, id),
        tx
          .prepare("UPDATE complex_projects SET manager_member_id = NULL WHERE manager_member_id = ?")
          .bind(id),
        tx
          .prepare("UPDATE complex_projects SET created_by = ? WHERE created_by = ?")
          .bind(actor.id, id),
        tx
          .prepare("UPDATE complex_projects SET updated_by = ? WHERE updated_by = ?")
          .bind(actor.id, id),
        tx.prepare("DELETE FROM members WHERE id = ?").bind(id),
      ]);
    });

    return Response.json({
      ok: true,
      deleted: { id: Number(target.id), displayName: String(target.display_name) },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
