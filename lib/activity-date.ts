function isoDate(year: number, month: number, day: number) {
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  ) {
    return "";
  }
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return "";
  }
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function dateFromMatch(match: RegExpMatchArray | null, fallbackYear: number) {
  if (!match) return "";
  if (match.length >= 4) {
    return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return isoDate(fallbackYear, Number(match[1]), Number(match[2]));
}

export function isValidActivityDate(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return Boolean(dateFromMatch(match, 0));
}

export function extractActivityHeaderDate(
  text: unknown,
  fallbackYear: number,
) {
  const firstLine = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";

  const header = firstLine.replace(/^[\[(【]\s*/, "").slice(0, 120);
  const fullKorean = dateFromMatch(
    header.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/),
    fallbackYear,
  );
  if (fullKorean) return fullKorean;

  const fullSeparated = dateFromMatch(
    header.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})(?:\D|$)/),
    fallbackYear,
  );
  if (fullSeparated) return fullSeparated;

  if (!/(?:미팅|통화|TM|기록|진행|상담|내용|정리)/i.test(header)) {
    return "";
  }
  return dateFromMatch(
    header.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일/),
    fallbackYear,
  );
}

export function messageContainsActivityDate(text: unknown, isoValue: unknown) {
  const value = String(isoValue ?? "").trim();
  if (!isValidActivityDate(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const source = String(text ?? "");
  return [
    new RegExp(`${year}\\s*년\\s*0?${month}\\s*월\\s*0?${day}\\s*일`),
    new RegExp(
      `${year}[.\\-/]\\s*0?${month}[.\\-/]\\s*0?${day}(?:\\D|$)`,
    ),
  ].some((pattern) => pattern.test(source));
}

export function resolveActivityDateFromMessage({
  message,
  aiDate,
  today,
}: {
  message: unknown;
  aiDate: unknown;
  today: string;
}) {
  const currentYear = Number(today.slice(0, 4));
  const headerDate = extractActivityHeaderDate(message, currentYear);
  if (headerDate) {
    return { activityDate: headerDate, dateConfidence: "확정" };
  }
  if (
    isValidActivityDate(aiDate) &&
    messageContainsActivityDate(message, aiDate)
  ) {
    return {
      activityDate: String(aiDate).trim(),
      dateConfidence: "확정",
    };
  }
  return { activityDate: today, dateConfidence: "대화시각 추정" };
}
