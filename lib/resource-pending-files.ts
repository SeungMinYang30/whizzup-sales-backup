export type PendingResourceFile = Pick<File, "name" | "size" | "lastModified">;

export function pendingResourceFileKey(file: PendingResourceFile) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

export function mergePendingResourceFiles<T extends PendingResourceFile>(current: T[], selected: T[], limit = 10) {
  const keys = new Set(current.map(pendingResourceFileKey));
  const additions = selected.filter((file) => {
    const key = pendingResourceFileKey(file);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  const combined = [...current, ...additions];
  return {
    files: combined.slice(0, Math.max(0, limit)),
    added: Math.min(additions.length, Math.max(0, limit - current.length)),
    duplicates: selected.length - additions.length,
    overflow: Math.max(0, combined.length - Math.max(0, limit)),
  };
}
