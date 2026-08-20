export function formatQuotationItemNameForOutput(value: string) {
  const name = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (name.length < 14) return name;
  const trailingDescriptor = name.match(/^(.{8,}?)\s+(\([가-힣][^()]{1,18}\))$/u);
  return trailingDescriptor ? `${trailingDescriptor[1].trim()}\n${trailingDescriptor[2]}` : name;
}

function normalizedOutputLine(value: unknown) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function formatQuotationRemark(
  supplierVendorName: unknown,
  contractLabel: unknown,
) {
  const lines = [supplierVendorName, contractLabel]
    .map(normalizedOutputLine)
    .filter(Boolean);
  return lines.filter((line, index) => (
    lines.findIndex((candidate) => candidate.toLocaleLowerCase("ko-KR") === line.toLocaleLowerCase("ko-KR")) === index
  )).join("\n");
}

export function formatQuotationProcurementIdentifier(input: {
  procurement?: boolean;
  channel?: unknown;
  number?: unknown;
  fallbackChannel?: string;
}) {
  if (!input.procurement) return "-";
  const channel = normalizedOutputLine(input.channel) || normalizedOutputLine(input.fallbackChannel);
  const number = normalizedOutputLine(input.number);
  return [channel, number].filter(Boolean).join("\n") || "-";
}
