export function chunkValues<T>(
  values: readonly T[],
  size: number,
): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("묶음 크기는 1 이상의 정수여야 합니다.");
  }
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return chunks;
}
