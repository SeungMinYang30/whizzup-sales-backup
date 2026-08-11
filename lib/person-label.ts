export type PersonLabelSource = {
  displayName?: unknown;
  display_name?: unknown;
  jobTitle?: unknown;
  job_title?: unknown;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function personDisplayLabel(person: PersonLabelSource) {
  const rawName = String(person.displayName ?? person.display_name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const rawTitle = String(person.jobTitle ?? person.job_title ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!rawTitle) return rawName;

  const title = rawTitle.replace(/님$/u, "").trim();
  if (!title) return rawName;
  const displayTitle = title === "대표" ? "대표님" : title;
  const duplicateTitle = new RegExp(
    `\\s+${escapeRegExp(title)}(?:님)?$`,
    "u",
  );
  const name = rawName.replace(duplicateTitle, "").trim();
  return `${name || rawName} ${displayTitle}`.trim();
}
