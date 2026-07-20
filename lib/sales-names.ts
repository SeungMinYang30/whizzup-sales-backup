export const salesJobTitleSuffix =
  /\s+(?:대표이사|부대표|대표|사장|부사장|전무|상무|본부장|센터장|실장|팀장|부장|차장|과장|대리|주임|사원|이사)\s*$/u;

export function compactSalesName(value: string) {
  return value.trim().replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

export function salesNameAliasKey(value: string) {
  return compactSalesName(value.trim().replace(salesJobTitleSuffix, ""));
}

export function resolveRegisteredSalesName(
  recordedName: string,
  registeredNames: string[],
) {
  const exactKey = compactSalesName(recordedName);
  if (!exactKey) return null;
  const exact = registeredNames.find(
    (name) => compactSalesName(name) === exactKey,
  );
  if (exact) return exact;

  const aliasKey = salesNameAliasKey(recordedName);
  const aliasMatches = registeredNames.filter(
    (name) => salesNameAliasKey(name) === aliasKey,
  );
  return aliasMatches.length === 1 ? aliasMatches[0] : null;
}
