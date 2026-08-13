export function formatQuotationItemNameForOutput(value: string) {
  const name = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (name.length < 14) return name;
  const trailingDescriptor = name.match(/^(.{8,}?)\s+(\([가-힣][^()]{1,18}\))$/u);
  return trailingDescriptor ? `${trailingDescriptor[1].trim()}\n${trailingDescriptor[2]}` : name;
}
