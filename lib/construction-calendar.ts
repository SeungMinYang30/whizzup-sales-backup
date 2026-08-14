export type ConstructionDayMeta = {
  date: string;
  label: string;
  holidayName: string;
  isHoliday: boolean;
  isSaturday: boolean;
  isSunday: boolean;
  isToday: boolean;
};

const DAY_LABEL = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});

const LUNAR_MONTH_DAY = new Intl.DateTimeFormat("en-US-u-ca-chinese", {
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

const FIXED_HOLIDAYS = new Map([
  ["01-01", "신정"],
  ["03-01", "삼일절"],
  ["05-01", "노동절"],
  ["05-05", "어린이날"],
  ["06-06", "현충일"],
  ["07-17", "제헌절"],
  ["08-15", "광복절"],
  ["10-03", "개천절"],
  ["10-09", "한글날"],
  ["12-25", "기독탄신일"],
]);

const SUBSTITUTE_ELIGIBLE = new Set([
  "삼일절",
  "노동절",
  "어린이날",
  "제헌절",
  "광복절",
  "개천절",
  "한글날",
  "부처님오신날",
  "기독탄신일",
]);

const holidayCache = new Map<number, Map<string, string>>();

export const addConstructionDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const utcDate = (value: string) => new Date(`${value}T00:00:00Z`);

function lunarMonthDay(value: string) {
  const parts = LUNAR_MONTH_DAY.formatToParts(utcDate(value));
  const monthValue = parts.find((part) => part.type === "month")?.value ?? "";
  const dayValue = parts.find((part) => part.type === "day")?.value ?? "";
  if (!/^\d+$/.test(monthValue) || !/^\d+$/.test(dayValue)) return null;
  return { month: Number(monthValue), day: Number(dayValue) };
}

function addHoliday(target: Map<string, string[]>, date: string, name: string) {
  const names = target.get(date) ?? [];
  if (!names.includes(name)) names.push(name);
  target.set(date, names);
}

function isWeekend(date: string) {
  const day = utcDate(date).getUTCDay();
  return day === 0 || day === 6;
}

function nextSubstituteDate(date: string, occupied: Map<string, string[]>) {
  let candidate = addConstructionDays(date, 1);
  while (isWeekend(candidate) || occupied.has(candidate)) {
    candidate = addConstructionDays(candidate, 1);
  }
  return candidate;
}

function buildKoreanHolidays(year: number) {
  const holidays = new Map<string, string[]>();
  let date = `${year}-01-01`;
  const lastDate = `${year}-12-31`;

  while (date <= lastDate) {
    const fixed = FIXED_HOLIDAYS.get(date.slice(5));
    if (fixed) addHoliday(holidays, date, fixed);

    const lunar = lunarMonthDay(date);
    const previousLunar = lunarMonthDay(addConstructionDays(date, -1));
    const nextLunar = lunarMonthDay(addConstructionDays(date, 1));
    if (nextLunar?.month === 1 && nextLunar.day === 1) addHoliday(holidays, date, "설날 연휴");
    if (lunar?.month === 1 && lunar.day === 1) addHoliday(holidays, date, "설날");
    if (previousLunar?.month === 1 && previousLunar.day === 1) addHoliday(holidays, date, "설날 연휴");
    if (lunar?.month === 4 && lunar.day === 8) addHoliday(holidays, date, "부처님오신날");
    if (lunar?.month === 8 && lunar.day === 14) addHoliday(holidays, date, "추석 연휴");
    if (lunar?.month === 8 && lunar.day === 15) addHoliday(holidays, date, "추석");
    if (lunar?.month === 8 && lunar.day === 16) addHoliday(holidays, date, "추석 연휴");

    date = addConstructionDays(date, 1);
  }

  for (const groupName of ["설날", "추석"]) {
    const groupDates = [...holidays.entries()]
      .filter(([, names]) => names.some((name) => name.startsWith(groupName)))
      .map(([holidayDate]) => holidayDate)
      .sort();
    const needsSubstitute = groupDates.some((holidayDate) => {
      const names = holidays.get(holidayDate) ?? [];
      return utcDate(holidayDate).getUTCDay() === 0 || names.length > 1;
    });
    if (needsSubstitute && groupDates.length) {
      addHoliday(
        holidays,
        nextSubstituteDate(groupDates.at(-1) as string, holidays),
        `${groupName} 대체공휴일`,
      );
    }
  }

  const individualDates = [...holidays.entries()]
    .filter(([, names]) => names.some((name) => SUBSTITUTE_ELIGIBLE.has(name)))
    .map(([holidayDate, names]) => ({ holidayDate, names: [...names] }));
  for (const { holidayDate, names } of individualDates) {
    const eligibleName = names.find((name) => SUBSTITUTE_ELIGIBLE.has(name));
    if (!eligibleName) continue;
    if (isWeekend(holidayDate) || names.length > 1) {
      addHoliday(
        holidays,
        nextSubstituteDate(holidayDate, holidays),
        `${eligibleName} 대체공휴일`,
      );
    }
  }

  return new Map(
    [...holidays.entries()].map(([holidayDate, names]) => [holidayDate, names.join(" · ")]),
  );
}

export function getKoreanHolidayName(date: string) {
  const year = Number(date.slice(0, 4));
  if (!holidayCache.has(year)) holidayCache.set(year, buildKoreanHolidays(year));
  return holidayCache.get(year)?.get(date) ?? "";
}

export function getConstructionDayMeta(date: string, today: string): ConstructionDayMeta {
  const day = utcDate(date).getUTCDay();
  const holidayName = getKoreanHolidayName(date);
  return {
    date,
    label: DAY_LABEL.format(utcDate(date)),
    holidayName,
    isHoliday: Boolean(holidayName),
    isSaturday: day === 6,
    isSunday: day === 0,
    isToday: date === today,
  };
}

export function getConstructionTimelineDays(start: string, length: number, today: string) {
  return Array.from({ length }, (_, index) =>
    getConstructionDayMeta(addConstructionDays(start, index), today),
  );
}

const STAGE_ORDER = [
  "철거",
  "전기",
  "설비",
  "목공",
  "도장",
  "바닥",
  "벽체",
  "유리",
  "가구",
  "집기",
  "시스템",
  "전자칠판",
  "사인",
  "청소",
  "이사",
  "이동",
  "납품",
  "검수",
  "교육",
];

export function constructionStageTone(stage: string) {
  const normalized = stage.replaceAll(" ", "");
  const index = STAGE_ORDER.findIndex((candidate) => normalized.includes(candidate));
  return index >= 0 ? index % 5 : 0;
}
