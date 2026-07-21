import type { getD1 } from "../db";
import {
  canonicalInstitutionName,
  institutionAliasKey,
} from "./institution-names";

type D1Database = ReturnType<typeof getD1>;
export type InstitutionRelationshipDecision = "related" | "different";

const createTableSql = `CREATE TABLE IF NOT EXISTS institution_name_decisions (
  pair_key TEXT PRIMARY KEY,
  left_key TEXT NOT NULL,
  right_key TEXT NOT NULL,
  left_organization TEXT NOT NULL,
  right_organization TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('related', 'different')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

function pair(valueA: unknown, valueB: unknown) {
  const organizationA = canonicalInstitutionName(valueA);
  const organizationB = canonicalInstitutionName(valueB);
  const entries = [
    { key: institutionAliasKey(organizationA), organization: organizationA },
    { key: institutionAliasKey(organizationB), organization: organizationB },
  ].sort((left, right) => left.key.localeCompare(right.key));
  return {
    pairKey: `${entries[0]?.key ?? ""}|${entries[1]?.key ?? ""}`,
    left: entries[0],
    right: entries[1],
  };
}

export async function ensureInstitutionDecisionsReady(d1: D1Database) {
  await d1.prepare(createTableSql).run();
}

export async function rememberInstitutionDecision(
  d1: D1Database,
  requestedOrganization: unknown,
  candidateOrganization: unknown,
  decision: InstitutionRelationshipDecision,
) {
  const normalized = pair(requestedOrganization, candidateOrganization);
  if (
    !normalized.left?.key ||
    !normalized.right?.key ||
    normalized.left.key === normalized.right.key
  ) {
    return;
  }
  await ensureInstitutionDecisionsReady(d1);
  await d1
    .prepare(
      `INSERT INTO institution_name_decisions (
         pair_key, left_key, right_key, left_organization,
         right_organization, decision, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(pair_key) DO UPDATE SET
         left_organization = excluded.left_organization,
         right_organization = excluded.right_organization,
         decision = excluded.decision,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      normalized.pairKey,
      normalized.left.key,
      normalized.right.key,
      normalized.left.organization,
      normalized.right.organization,
      decision,
    )
    .run();
}

export async function excludedInstitutionCandidates(
  d1: D1Database,
  requestedOrganization: unknown,
) {
  await ensureInstitutionDecisionsReady(d1);
  const requestedKey = institutionAliasKey(requestedOrganization);
  if (!requestedKey) return new Set<string>();
  const rows = await d1
    .prepare(
      `SELECT left_key, right_key
       FROM institution_name_decisions
       WHERE left_key = ? OR right_key = ?`,
    )
    .bind(requestedKey, requestedKey)
    .all<{ left_key: string; right_key: string }>();
  return new Set(
    rows.results.map((row) =>
      row.left_key === requestedKey ? row.right_key : row.left_key,
    ),
  );
}
