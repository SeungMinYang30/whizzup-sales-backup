function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 기관명이 최종 확정되면 요약·후속 업무에 남은 이전 표기도 함께 바꾼다.
 * 띄어쓰기만 다른 표기도 같은 기관명으로 취급한다.
 */
export function replaceOrganizationReferences(
  value: unknown,
  previousOrganization: unknown,
  nextOrganization: unknown,
) {
  const text = String(value ?? "");
  const previous = String(previousOrganization ?? "").trim();
  const next = String(nextOrganization ?? "").trim();
  if (!text || !previous || !next || previous === next) return text;

  const exactReplaced = text.split(previous).join(next);
  const compactPrevious = previous.replace(/\s+/g, "");
  if (compactPrevious.length < 2) return exactReplaced;

  const whitespaceFlexiblePattern = compactPrevious
    .split("")
    .map((character) => escapeRegExp(character))
    .join("\\s*");
  return exactReplaced.replace(
    new RegExp(whitespaceFlexiblePattern, "gu"),
    next,
  );
}

function isShareMetaSentence(value: string) {
  const sentence = value.replace(/[.!?]+$/g, "").trim();
  if (!sentence) return true;

  return (
    /^(?:일정|날짜)\s*확인(?:이|가|은|는)?\s*(?:핵심|중요)/.test(
      sentence,
    ) ||
    /^(?:핵심|중요한\s*점)(?:은|이)?\s*(?:일정|날짜)\s*확인/.test(
      sentence,
    ) ||
    /(?:장비|품목|수주|예산)[^.!?]*(?:정보|내용)[^.!?]*(?:없|미확인)/.test(
      sentence,
    ) ||
    /^(?:별도|추가|기타)[^.!?]*(?:사항|정보|내용)[^.!?]*(?:없|미확인)/.test(
      sentence,
    )
  );
}

/** 단톡 공유 문구에서는 확인된 사실만 남기고 AI의 해설·부재 설명을 뺀다. */
export function compactShareSummary(value: unknown) {
  return String(value ?? "")
    .split(/\r?\n+/)
    .flatMap((line) => line.trim().split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((sentence) => !isShareMetaSentence(sentence))
    .join(" ")
    .trim();
}

const contactRolePattern =
  /(?:공사|기관|시설(?:\s*관리)?|행정|회계|교육|정보|전산|구매|계약|현장|설치|예산|실무|업무|영업|수주|안전|총무|설계|감리)\s*담당자/u;

/** 기존 기록의 본문에만 남아 있는 담당 역할도 공유 문구에서 복원한다. */
export function resolveContactRole(
  explicitRole: unknown,
  ...contextValues: unknown[]
) {
  const role = String(explicitRole ?? "").replace(/\s+/g, " ").trim();
  if (role) return role;

  const matched = contextValues
    .map((value) => String(value ?? ""))
    .join("\n")
    .match(contactRolePattern);
  return matched?.[0]?.replace(/\s+/g, " ").trim() ?? "";
}

/**
 * 역할·이름을 별도 줄로 보여줄 때 본문에 반복된
 * “공사 담당자는 홍길동으로 확인됐다” 같은 문장만 제거한다.
 */
export function removeRepeatedContactStatement(
  value: unknown,
  contactRole: unknown,
  contactName: unknown,
) {
  const text = String(value ?? "");
  const role = String(contactRole ?? "").trim();
  const name = String(contactName ?? "").trim();
  if (!text || !role || !name) return text.trim();

  const rolePattern = escapeRegExp(role).replace(/\s+/g, "\\s*");
  const namePattern = escapeRegExp(name).replace(/\s+/g, "\\s*");
  const repeatedStatement = new RegExp(
    `^${rolePattern}\\s*(?:은|는|이|가|:|：)?\\s*${namePattern}\\s*(?:으로|로)?\\s*(?:확인(?:됐다|됐습니다|되었다|되었습니다|됐음|됨|했다|했습니다)|담당(?:한다|합니다|함|이다|입니다)|지정(?:됐다|됐습니다|되었다|되었습니다|됨))\\s*[.!?]?$`,
    "u",
  );

  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.trim().split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((sentence) => !repeatedStatement.test(sentence))
    .join(" ")
    .trim();
}

function formalizeShareSentence(value: string) {
  const punctuation = value.match(/[.!?]$/)?.[0] ?? "";
  const sentence = value.replace(/[.!?]+$/g, "").trim();
  if (!sentence || /(?:습니다|입니다|합니다|됩니다|드립니다|세요)$/.test(sentence)) {
    return value;
  }

  const endings: Array<[RegExp, string]> = [
    [/하기로\s*함$/, "하기로 했습니다"],
    [/하기로\s*했다$/, "하기로 했습니다"],
    [/하였다$/, "했습니다"],
    [/했다$/, "했습니다"],
    [/되었다$/, "됐습니다"],
    [/됐다$/, "됐습니다"],
    [/한다$/, "합니다"],
    [/하다$/, "합니다"],
    [/이다$/, "입니다"],
    [/있다$/, "있습니다"],
    [/없다$/, "없습니다"],
    [/필요함$/, "필요합니다"],
    [/가능함$/, "가능합니다"],
    [/예정임$/, "예정입니다"],
    [/됨$/, "됐습니다"],
    [/함$/, "했습니다"],
  ];
  const ending = endings.find(([pattern]) => pattern.test(sentence));
  if (!ending) return value;
  const formal = sentence.replace(ending[0], ending[1]);
  return `${formal}${punctuation || "."}`;
}

/** 단톡 공유 문장을 존댓말 보고체로 통일한다. */
export function formalizeShareSummary(value: unknown) {
  return String(value ?? "")
    .split(/\r?\n+/)
    .flatMap((line) => line.trim().split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map(formalizeShareSentence)
    .join(" ")
    .trim();
}
