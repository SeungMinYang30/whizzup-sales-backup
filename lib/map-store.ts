import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";
import { regionFromAddress } from "./region-from-address";

export async function ensureMapReady() {
  await ensureCollaborationReady();
  return getD1();
}

export async function resolveMappedRegion(
  organization: string,
  requestedRegion = "",
) {
  const d1 = await ensureMapReady();
  const location = await d1
    .prepare(
      `SELECT region, address, road_address
       FROM organization_locations
       WHERE organization = ?
       LIMIT 1`,
    )
    .bind(organization)
    .first<{
      region: string;
      address: string;
      road_address: string;
    }>();
  if (!location) return requestedRegion.trim();
  const mappedRegion =
    regionFromAddress(location.road_address || location.address) ||
    String(location.region ?? "").trim();
  return mappedRegion || requestedRegion.trim();
}

export async function syncRegionsFromMappedLocations() {
  const d1 = await ensureMapReady();
  const mapped = await d1
    .prepare(
      `SELECT
         l.organization,
         l.region,
         l.address,
         l.road_address,
         EXISTS (
           SELECT 1
           FROM activities a
           WHERE a.organization = l.organization
             AND TRIM(COALESCE(a.region, '')) <> TRIM(COALESCE(l.region, ''))
         ) AS has_region_mismatch
       FROM organization_locations l
       WHERE TRIM(COALESCE(l.road_address, '')) <> ''
          OR TRIM(COALESCE(l.address, '')) <> ''
       ORDER BY l.organization`,
    )
    .all<{
      organization: string;
      region: string;
      address: string;
      road_address: string;
      has_region_mismatch: number;
    }>();

  const updates = [];
  let updatedLocations = 0;
  let updatedOrganizations = 0;
  for (const location of mapped.results) {
    const region = regionFromAddress(
      location.road_address || location.address,
    );
    if (!region) continue;
    const mappedRegionChanged =
      String(location.region ?? "").trim() !== region;
    if (mappedRegionChanged) {
      updates.push(
        d1
          .prepare(
            `UPDATE organization_locations
             SET region = ?, updated_at = CURRENT_TIMESTAMP
             WHERE organization = ?`,
          )
          .bind(region, location.organization),
      );
      updatedLocations += 1;
    }
    if (mappedRegionChanged || Number(location.has_region_mismatch)) {
      updates.push(
        d1
          .prepare(
            `UPDATE activities
             SET region = ?, updated_at = CURRENT_TIMESTAMP
             WHERE organization = ?
               AND TRIM(COALESCE(region, '')) <> ?`,
          )
          .bind(region, location.organization, region),
      );
      updatedOrganizations += 1;
    }
  }

  for (let index = 0; index < updates.length; index += 50) {
    await d1.batch(updates.slice(index, index + 50));
  }
  return { updatedLocations, updatedOrganizations };
}
