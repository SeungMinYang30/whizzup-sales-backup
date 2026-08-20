export const CONSTRUCTION_STAGES = [
  "철거",
  "전기·설비",
  "목공",
  "도장",
  "바닥",
  "벽체·유리",
  "가구·집기",
  "시스템",
  "사인물",
  "청소",
  "이사·이동",
  "검수",
  "교육",
  "기타 시공",
] as const;

const constructionWorkPattern =
  /(?:철거|전기|전기매트|배선|설비|목공|도장|도색|페인트|바닥|마루|벽체|유리|타공판|가구|집기|수납장|시스템|전자칠판|스크린|프로젝터|설치|시공|공사|사인|간판|청소|정리|이사|이동|운반|납품|검수|교육)/;

/** 기존 활동 기록을 시공 일정으로 분류할 때 사용하는 보수적인 판별식입니다. */
export function isConstructionStage(value: string) {
  const stage = value.trim();
  return (CONSTRUCTION_STAGES as readonly string[]).includes(stage)
    || constructionWorkPattern.test(stage);
}

/** 시공 화면에서 사용자가 직접 만든 공정명도 안전하게 저장할 수 있게 합니다. */
export function isValidConstructionStage(value: string) {
  const stage = value.trim();
  return Boolean(stage && stage.length <= 40 && !/[\t\r\n]/.test(stage));
}

export function constructionStageIndex(value: string) {
  const index = (CONSTRUCTION_STAGES as readonly string[]).indexOf(value.trim());
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
