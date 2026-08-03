export const CONSTRUCTION_STAGES = [
  "철거",
  "목공",
  "도장",
  "바닥",
  "시스템",
  "검수",
  "교육",
] as const;

export function isConstructionStage(value: string) {
  return (CONSTRUCTION_STAGES as readonly string[]).includes(value.trim());
}

export function constructionStageIndex(value: string) {
  const index = (CONSTRUCTION_STAGES as readonly string[]).indexOf(value.trim());
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
