function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function explicitlyNamedProgressManager(
  payload: Record<string, unknown>,
  registeredNames: string[],
) {
  const source = [payload.rawInput, payload.summary, payload.detailSummary]
    .map((value) => cleanName(value))
    .filter(Boolean)
    .join("\n");
  if (!source) return "";

  for (const registeredName of registeredNames) {
    const aliases = Array.from(new Set([
      registeredName,
      registeredName.replace(
        /\s+(?:대표이사|부대표|대표|사장|부사장|전무|상무|본부장|센터장|실장|팀장|부장|차장|과장|대리|주임|사원|이사)\s*$/u,
        "",
      ),
    ].map((value) => value.trim()).filter(Boolean)));
    if (aliases.some((alias) => new RegExp(
      `(?:진행\\s*담당(?:자)?|내부\\s*담당(?:자)?)\\s*(?:은|는|이|가|:)?\\s*${escapeRegExp(alias)}(?:\\s|$|[,.])`,
      "iu",
    ).test(source))) return registeredName;
  }
  return "";
}
