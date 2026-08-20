export function isApprovedShowroomAutoSchedule(label: unknown) {
  const normalized = String(label ?? "").replace(/\s+/g, " ").trim();
  return /(?:쇼룸|시연)/u.test(normalized)
    && /(?:위즈업|에어패스)/u.test(normalized)
    && !/(?:타\s*업체|다른\s*업체|문의|검토|가능성|미정|취소)/u.test(normalized);
}

export function isAllowedAiAutoSchedule(
  label: unknown,
  options: { allowConstruction: boolean; isConstruction: boolean },
) {
  return (options.allowConstruction && options.isConstruction)
    || isApprovedShowroomAutoSchedule(label);
}
