import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import { chunkValues } from "../../../../lib/d1-bulk";
import {
  clean,
  ensureRecordsReady,
} from "../../../../lib/records-store";
import { ensureMapReady } from "../../../../lib/map-store";
import { regionFromAddress } from "../../../../lib/region-from-address";

export const dynamic = "force-dynamic";

const LOCATION_BATCH_LIMIT = 300;
const LOCATION_QUERY_CHUNK_SIZE = 50;
const LOCATION_WRITE_CHUNK_SIZE = 50;

type NormalizedLocation = {
  organization: string;
  address: string;
  roadAddress: string;
  region: string;
  latitude: number;
  longitude: number;
  placeName: string;
  placeId: string;
};

type LocationFailure = {
  organization: string;
  error: string;
};

function locationValidationError(row: NormalizedLocation) {
  if (!row.organization || row.organization.length > 120) {
    return "기관명을 다시 확인해 주세요.";
  }
  if (
    !Number.isFinite(row.latitude) ||
    row.latitude < -90 ||
    row.latitude > 90 ||
    !Number.isFinite(row.longitude) ||
    row.longitude < -180 ||
    row.longitude > 180
  ) {
    return "위도·경도를 다시 확인해 주세요.";
  }
  return "";
}

function readableError(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "위치를 저장하지 못했습니다.";
}

export async function GET() {
  try {
    await requireApprovedMember();
    await ensureRecordsReady();
    const d1 = await ensureMapReady();
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
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const bulkMode = Array.isArray(payload.locations);
    const sourceRows = bulkMode
      ? (payload.locations as unknown[])
      : [payload];
    if (!sourceRows.length || sourceRows.length > LOCATION_BATCH_LIMIT) {
      return Response.json(
        { error: "한 번에 1곳부터 300곳까지 위치를 저장할 수 있습니다." },
        { status: 400 },
      );
    }

    const normalized: NormalizedLocation[] = sourceRows.map((source) => {
      const row = (source && typeof source === "object"
        ? source
        : {}) as Record<string, unknown>;
      const organization = clean(row.organization);
      const address = clean(row.address).slice(0, 500);
      const roadAddress = clean(row.roadAddress).slice(0, 500);
      return {
        organization,
        address,
        roadAddress,
        region:
          regionFromAddress(roadAddress || address) ||
          clean(row.region).slice(0, 120),
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        placeName: clean(row.placeName).slice(0, 200),
        placeId: clean(row.placeId).slice(0, 100),
      };
    });
    const failures: LocationFailure[] = [];
    const validRows = normalized.filter((row) => {
      const error = locationValidationError(row);
      if (!error) return true;
      failures.push({
        organization: row.organization || "(기관명 없음)",
        error,
      });
      return false;
    });
    if (!bulkMode && failures.length) {
      return Response.json({ error: failures[0].error }, { status: 400 });
    }
    const locations = [
      ...new Map(validRows.map((row) => [row.organization, row])).values(),
    ];

    const d1 = await ensureRecordsReady();
    await ensureMapReady();
    const existing = new Set<string>();
    for (const chunk of chunkValues(
      locations.map((row) => row.organization),
      LOCATION_QUERY_CHUNK_SIZE,
    )) {
      const institutions = await d1
        .prepare(
          `SELECT organization
           FROM activities
           WHERE organization IN (${chunk.map(() => "?").join(", ")})
           GROUP BY organization`,
        )
        .bind(...chunk)
        .all<{ organization: string }>();
      institutions.results.forEach((row) =>
        existing.add(String(row.organization)),
      );
    }
    const missing = locations
      .map((row) => row.organization)
      .filter((organization) => !existing.has(organization));
    if (!bulkMode && missing.length) {
      return Response.json(
        { error: "기관별 관리에 없는 기관은 저장할 수 없습니다." },
        { status: 404 },
      );
    }
    missing.forEach((organization) =>
      failures.push({
        organization,
        error: "기관별 관리에서 기관을 찾지 못했습니다.",
      }),
    );
    const saveTargets = locations.filter((row) =>
      existing.has(row.organization),
    );

    const statementsFor = (row: NormalizedLocation) => {
      const save = d1
        .prepare(
          `INSERT INTO organization_locations (
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
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          row.organization,
          row.region,
          row.address,
          row.roadAddress,
          row.latitude,
          row.longitude,
          row.placeName,
          row.placeId,
          member.id,
        );
      if (!row.region) return [save];
      return [
        save,
        d1
          .prepare(
            `UPDATE activities
             SET region = ?, updated_at = CURRENT_TIMESTAMP
             WHERE organization = ?`,
          )
          .bind(row.region, row.organization),
      ];
    };

    const savedOrganizations = new Set<string>();
    for (const chunk of chunkValues(
      saveTargets,
      LOCATION_WRITE_CHUNK_SIZE,
    )) {
      try {
        await d1.batch(chunk.flatMap(statementsFor));
        chunk.forEach((row) => savedOrganizations.add(row.organization));
      } catch {
        for (const row of chunk) {
          try {
            await d1.batch(statementsFor(row));
            savedOrganizations.add(row.organization);
          } catch (error) {
            failures.push({
              organization: row.organization,
              error: readableError(error),
            });
          }
        }
      }
    }

    const savedRows: Record<string, unknown>[] = [];
    for (const chunk of chunkValues(
      [...savedOrganizations],
      LOCATION_QUERY_CHUNK_SIZE,
    )) {
      const saved = await d1
        .prepare(
          `SELECT *
           FROM organization_locations
           WHERE organization IN (${chunk.map(() => "?").join(", ")})`,
        )
        .bind(...chunk)
        .all<Record<string, unknown>>();
      savedRows.push(...saved.results);
    }
    savedRows.sort((left, right) =>
      String(left.organization).localeCompare(
        String(right.organization),
        "ko",
      ),
    );

    return bulkMode
      ? Response.json({
          locations: savedRows,
          savedCount: savedRows.length,
          failedCount: failures.length,
          failures,
        })
      : Response.json({ location: savedRows[0] });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
