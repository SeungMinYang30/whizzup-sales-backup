export type AirpassEquipmentKitLine = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  custom?: boolean;
};

export type AirpassEquipmentKit = {
  kind: "airpass-equipment";
  plan: "one" | "two";
  lines: AirpassEquipmentKitLine[];
};

const BASE_LINES = [
  ["축구공 4호", "EA", 12_000, 6, 8],
  ["축구공 2호", "EA", 5_000, 6, 10],
  ["우레탄볼링공", "EA", 43_000, 4, 8],
  ["골프연습세트 (주니어7번아이언, 연습골프공, 골프매트)", "SET", 100_000, 1, 1],
  ["양궁활세트(활 1, 화살 10대)", "SET", 270_000, 2, 2],
  ["어린이용 양궁활세트 (활 1, 화살 10대)", "SET", 36_000, 0, 0],
  ["터치봉(Long 1, Short 1)", "EA", 10_000, 2, 4],
  ["티볼세트 (배팅티, 배트)", "SET", 200_000, 1, 1],
  ["다목적공", "EA", 2_000, 10, 20],
  ["비행원반", "EA", 2_000, 10, 20],
  ["테니스라켓", "EA", 30_000, 1, 1],
  ["테니스연습공", "EA", 3_000, 10, 10],
  ["스포츠용품함(공)", "EA", 30_000, 2, 4],
  ["스포츠용품함(활)", "EA", 50_000, 1, 2],
  ["수납형 의자(3인석)", "EA", 190_000, 0, 0],
] as const;

const safeText = (value: unknown, limit: number) => String(value ?? "").trim().slice(0, limit);
const safeInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

export function isAirpassEquipmentKitProduct(name: string) {
  const compact = name.replace(/\s/g, "").toLocaleLowerCase("ko-KR");
  return compact.endsWith("교구세트") || compact.includes("에어패스교구세트");
}

export function createAirpassEquipmentKit(plan: "one" | "two" = "one"): AirpassEquipmentKit {
  const quantityIndex = plan === "two" ? 4 : 3;
  return {
    kind: "airpass-equipment",
    plan,
    lines: BASE_LINES.map((line, index) => ({
      id: `base-${index + 1}`,
      name: line[0],
      unit: line[1],
      unitPrice: line[2],
      quantity: line[quantityIndex],
    })),
  };
}

export function normalizeAirpassEquipmentKit(value: unknown): AirpassEquipmentKit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (source.kind !== "airpass-equipment" || !Array.isArray(source.lines)) return undefined;
  const plan = source.plan === "two" ? "two" : "one";
  const lines = source.lines.slice(0, 100).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const line = entry as Record<string, unknown>;
    const name = safeText(line.name, 300);
    if (!name) return [];
    return [{
      id: safeText(line.id, 160) || `kit-line-${index + 1}`,
      name,
      quantity: safeInteger(line.quantity),
      unit: safeText(line.unit, 40) || "EA",
      unitPrice: safeInteger(line.unitPrice),
      custom: line.custom === true || undefined,
    }];
  });
  return { kind: "airpass-equipment", plan, lines };
}

export function airpassEquipmentKitTotal(value: AirpassEquipmentKit | undefined) {
  return value?.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) ?? 0;
}

export function airpassEquipmentKitOutputLines(value: AirpassEquipmentKit | undefined) {
  return value?.lines.filter((line) => line.quantity > 0) ?? [];
}
