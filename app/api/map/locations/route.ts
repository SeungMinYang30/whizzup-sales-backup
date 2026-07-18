import {
  accessErrorResponse,
  requireApprovedMember,
  requireMemberPermission,
} from "../../../../lib/collaboration";
import {
  clean,
  ensureRecordsReady,
} from "../../../../lib/records-store";
import {
  ensureMapReady,
  syncRegionsFromMappedLocations,
} from "../../../../lib/map-store";
import { regionFromAddress } from "../../../../lib/region-from-address";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedMember();
    await ensureRecordsReady();
    const d1 = await ensureMapReady();
    await syncRegionsFromMappedLocations();
    await d1
      .prepare(
        `DELETE FROM organization_locations
         WHERE NOT EXISTS (
           SELECT 1 FROM activities
           WHERE activities.organization = organization_locations.organization
         )`,
      )
      .run();
    const result = await d1
      .prepare(
        `SELECT organization_locations.*
         FROM organization_locations
         WHERE EXISTS (
           SELECT 1 FROM activities
           WHERE activities.organization = organization_locations.organization
         )
         ORDER BY organization COLLATE NOCASE`,
      )
      .all();
    return Response.json({ locations: result.results });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireMemberPermission("map:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const organization = clean(payload.organization);
    const address = clean(payload.address).slice(0, 500);
    const roadAddress = clean(payload.roadAddress).slice(0, 500);
    const region =
      regionFromAddress(roadAddress || address) ||
      clean(payload.region).slice(0, 120);
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    if (
      !organization ||
      organization.length > 120 ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return Response.json(
        { error: "기관명과 지도 위치를 다시 확인해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureRecordsReady();
    await ensureMapReady();
    const institutionExists = await d1
      .prepare(
        "SELECT 1 AS found FROM activities WHERE organization = ? LIMIT 1",
      )
      .bind(organization)
      .first();
    if (!institutionExists) {
      return Response.json(
        { error: "기관별 관리에 등록된 기관만 지도 위치를 저장할 수 있습니다." },
        { status: 404 },
      );
    }
    const location = await d1
      .prepare(`
        INSERT INTO organization_locations (
          organization, region, address, road_address, latitude, longitude,
          place_name, place_id, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(organization) DO UPDATE SET
          region = excluded.region,
          address = excluded.address,
          road_address = excluded.road_address,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          place_name = excluded.place_name,
          place_id = excluded.place_id,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `)
      .bind(
        organization,
        region,
        address,
        roadAddress,
        latitude,
        longitude,
        clean(payload.placeName).slice(0, 200),
        clean(payload.placeId).slice(0, 100),
        admin.id,
      )
      .first();
    if (region) {
      await d1
        .prepare(
          `UPDATE activities
           SET region = ?, updated_at = CURRENT_TIMESTAMP
           WHERE organization = ?`,
        )
        .bind(region, organization)
        .run();
    }
    return Response.json({ location });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
