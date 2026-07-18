import {
  accessErrorResponse,
  requireApprovedMember,
  requireMemberPermission,
} from "../../../../lib/collaboration";
import { ensureCampaignsReady } from "../../../../lib/campaign-store";
import {
  clean,
  ensureRecordsReady,
  insertActivity,
} from "../../../../lib/records-store";
import { regionFromAddress } from "../../../../lib/region-from-address";

export const dynamic = "force-dynamic";

type CampaignTargetInput = {
  organization?: unknown;
  region?: unknown;
  address?: unknown;
  phone?: unknown;
  contactName?: unknown;
  notes?: unknown;
  assignedMemberId?: unknown;
};

function localDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function cleanTarget(value: CampaignTargetInput) {
  const address = clean(value.address).slice(0, 500);
  return {
    organization: clean(value.organization).slice(0, 120),
    region:
      clean(value.region).slice(0, 120) ||
      regionFromAddress(address),
    address,
    phone: clean(value.phone).slice(0, 100),
    contactName: clean(value.contactName).slice(0, 120),
    notes: clean(value.notes).slice(0, 1000),
    assignedMemberId: Number(value.assignedMemberId) || null,
  };
}

export async function GET() {
  try {
    await requireApprovedMember();
    await ensureRecordsReady();
    const d1 = await ensureCampaignsReady();
    const [campaigns, targets, members] = await Promise.all([
      d1
        .prepare(`
          SELECT
            c.*,
            m.display_name AS created_by_name,
            COUNT(t.id) AS target_count,
            SUM(CASE WHEN t.assigned_member_id IS NOT NULL THEN 1 ELSE 0 END) AS assigned_count
          FROM sales_campaigns c
          LEFT JOIN members m ON m.id = c.created_by
          LEFT JOIN sales_campaign_targets t ON t.campaign_id = c.id
          GROUP BY c.id, m.display_name
          ORDER BY c.created_at DESC, c.id DESC
        `)
        .all(),
      d1
        .prepare(`
          SELECT
            t.*,
            m.display_name AS assigned_member_name
          FROM sales_campaign_targets t
          LEFT JOIN members m
            ON m.id = t.assigned_member_id
           AND m.status = 'approved'
          ORDER BY t.campaign_id DESC, t.organization COLLATE NOCASE
        `)
        .all(),
      d1
        .prepare(`
          SELECT id, display_name, email
          FROM members
          WHERE status = 'approved'
          ORDER BY display_name COLLATE NOCASE
        `)
        .all(),
    ]);
    return Response.json({
      campaigns: campaigns.results,
      targets: targets.results,
      members: members.results,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const createdActivityIds: number[] = [];
  let campaignId = 0;
  try {
    const member = await requireMemberPermission("map:manage");
    const payload = (await request.json()) as {
      name?: unknown;
      notes?: unknown;
      targets?: CampaignTargetInput[];
    };
    const name = clean(payload.name).slice(0, 120);
    const notes = clean(payload.notes).slice(0, 1000);
    const targets = [
      ...new Map(
        (Array.isArray(payload.targets) ? payload.targets : [])
          .slice(0, 500)
          .map(cleanTarget)
          .filter((target) => target.organization)
          .map((target) => [
            target.organization.replace(/\s+/g, "").toLocaleLowerCase("ko-KR"),
            target,
          ]),
      ).values(),
    ];
    if (!name || !targets.length) {
      return Response.json(
        { error: "카테고리 이름과 기관이 한 곳 이상 필요합니다." },
        { status: 400 },
      );
    }

    const d1 = await ensureCampaignsReady();
    await ensureRecordsReady();
    const existing = await d1
      .prepare("SELECT id FROM sales_campaigns WHERE name = ?")
      .bind(name)
      .first();
    if (existing) {
      return Response.json(
        { error: "같은 이름의 영업 카테고리가 이미 있습니다." },
        { status: 409 },
      );
    }
    const campaign = await d1
      .prepare(`
        INSERT INTO sales_campaigns (name, notes, created_by)
        VALUES (?, ?, ?)
        RETURNING *
      `)
      .bind(name, notes, member.id)
      .first<Record<string, unknown>>();
    campaignId = Number(campaign?.id);
    if (!campaignId) throw new Error("영업 카테고리를 만들지 못했습니다.");

    const approvedMembers = await d1
      .prepare("SELECT id FROM members WHERE status = 'approved'")
      .all<{ id: number }>();
    const approvedMemberIds = new Set(
      approvedMembers.results.map((row: { id: number }) => Number(row.id)),
    );

    for (const target of targets) {
      const assignedMemberId =
        target.assignedMemberId &&
        approvedMemberIds.has(target.assignedMemberId)
          ? target.assignedMemberId
          : null;
      const record = await insertActivity(
        {
          activityDate: localDate(),
          dateConfidence: "확정",
          activityType: "영업 대상",
          category: "영업 캠페인",
          contactMethod: "기타",
          region: target.region,
          organization: target.organization,
          topic: name,
          summary: `${name} 영업 대상 등록`,
          status: "재접촉 필요",
          temperature: "중간",
          followUpRequired: true,
          nextAction: "담당자 배정 및 첫 컨택",
          contactName: target.contactName,
          contactPhone: target.phone,
          sourceChat: "영업지도 엑셀 가져오기",
          notes: [target.address && `주소: ${target.address}`, target.notes]
            .filter(Boolean)
            .join("\n"),
          progressManager: "",
        },
        member,
        "영업지도 엑셀 가져오기",
      );
      const activityId = Number(record.id);
      createdActivityIds.push(activityId);
      await d1
        .prepare(`
          INSERT INTO sales_campaign_targets (
            campaign_id, organization, region, address, phone,
            contact_name, notes, assigned_member_id, activity_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          campaignId,
          target.organization,
          target.region,
          target.address,
          target.phone,
          target.contactName,
          target.notes,
          assignedMemberId,
          activityId,
        )
        .run();
    }

    return Response.json(
      {
        campaign,
        targetCount: targets.length,
      },
      { status: 201 },
    );
  } catch (error) {
    if (campaignId) {
      try {
        const d1 = await ensureCampaignsReady();
        if (createdActivityIds.length) {
          const placeholders = createdActivityIds.map(() => "?").join(", ");
          await d1.batch([
            d1
              .prepare(
                `DELETE FROM activity_authors WHERE activity_id IN (${placeholders})`,
              )
              .bind(...createdActivityIds),
            d1
              .prepare(`DELETE FROM activities WHERE id IN (${placeholders})`)
              .bind(...createdActivityIds),
          ]);
        }
        await d1.batch([
          d1
            .prepare("DELETE FROM sales_campaign_targets WHERE campaign_id = ?")
            .bind(campaignId),
          d1.prepare("DELETE FROM sales_campaigns WHERE id = ?").bind(campaignId),
        ]);
      } catch {
        // Preserve the original error response.
      }
    }
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireApprovedMember();
    const payload = (await request.json()) as {
      targetId?: unknown;
      assignedMemberId?: unknown;
    };
    const targetId = Number(payload.targetId);
    const assignedMemberId =
      payload.assignedMemberId === null ||
      payload.assignedMemberId === undefined ||
      payload.assignedMemberId === ""
        ? null
        : Number(payload.assignedMemberId);
    if (
      !Number.isInteger(targetId) ||
      targetId < 1 ||
      (assignedMemberId !== null &&
        (!Number.isInteger(assignedMemberId) || assignedMemberId < 1))
    ) {
      return Response.json(
        { error: "기관과 담당자를 다시 선택해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureCampaignsReady();
    if (assignedMemberId !== null) {
      const member = await d1
        .prepare("SELECT id FROM members WHERE id = ? AND status = 'approved'")
        .bind(assignedMemberId)
        .first();
      if (!member) {
        return Response.json(
          { error: "승인된 구성원만 담당자로 지정할 수 있습니다." },
          { status: 400 },
        );
      }
    }
    const target = await d1
      .prepare(`
        UPDATE sales_campaign_targets
        SET assigned_member_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        RETURNING *
      `)
      .bind(assignedMemberId, targetId)
      .first();
    if (!target) {
      return Response.json(
        { error: "영업 대상 기관을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    return Response.json({ target });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireMemberPermission("map:manage");
    const payload = (await request.json()) as { campaignId?: unknown };
    const campaignId = Number(payload.campaignId);
    if (!Number.isInteger(campaignId) || campaignId < 1) {
      return Response.json(
        { error: "삭제할 영업 카테고리를 선택해 주세요." },
        { status: 400 },
      );
    }
    const d1 = await ensureCampaignsReady();
    const campaign = await d1
      .prepare("SELECT name FROM sales_campaigns WHERE id = ?")
      .bind(campaignId)
      .first<{ name: string }>();
    if (!campaign) {
      return Response.json(
        { error: "영업 카테고리를 찾지 못했습니다." },
        { status: 404 },
      );
    }
    await d1.batch([
      d1
        .prepare("DELETE FROM sales_campaign_targets WHERE campaign_id = ?")
        .bind(campaignId),
      d1.prepare("DELETE FROM sales_campaigns WHERE id = ?").bind(campaignId),
    ]);
    return Response.json({
      ok: true,
      message: `${campaign.name} 카테고리를 삭제했습니다. 기관별 기록은 유지됩니다.`,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
