import { getD1 } from "../db";
import { resolveRegisteredSalesName } from "./sales-names";

type D1 = ReturnType<typeof getD1>;
type ProgressManagerReplacement = {
  current: string;
  canonical: string;
};

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function listRegisteredSalesNames(d1: D1) {
  const result = await d1
    .prepare(
      `SELECT display_name
       FROM members
       WHERE status = 'approved' AND is_sales = 1
       ORDER BY display_name COLLATE NOCASE, id`,
    )
    .all<{ display_name: string }>();
  return result.results
    .map((member: { display_name: string }) => cleanName(member.display_name))
    .filter(Boolean);
}

export function canonicalProgressManagerName(
  value: unknown,
  registeredNames: string[],
) {
  const current = cleanName(value);
  if (!current) return "";
  return resolveRegisteredSalesName(current, registeredNames) ?? current;
}

export async function normalizeHistoricalProgressManagers(d1: D1) {
  const registeredNames = await listRegisteredSalesNames(d1);
  if (!registeredNames.length) return [];

  const result = await d1
    .prepare(
      `SELECT DISTINCT progress_manager
       FROM activities
       WHERE TRIM(COALESCE(progress_manager, '')) <> ''`,
    )
    .all<{ progress_manager: string }>();
  const replacements: ProgressManagerReplacement[] = result.results.flatMap(
    (row: { progress_manager: string }): ProgressManagerReplacement[] => {
      const current = cleanName(row.progress_manager);
      const canonical = canonicalProgressManagerName(current, registeredNames);
      return canonical && canonical !== current
        ? [{ current: row.progress_manager, canonical }]
        : [];
    },
  );

  for (let index = 0; index < replacements.length; index += 50) {
    const chunk = replacements.slice(index, index + 50);
    await d1.batch(
      chunk.map(
        ({ current, canonical }: ProgressManagerReplacement) =>
          d1
            .prepare(
              `UPDATE activities
               SET progress_manager = ?
               WHERE progress_manager = ?`,
            )
            .bind(canonical, current),
      ),
    );
  }
  return replacements;
}
