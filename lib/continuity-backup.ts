import "server-only";

import { createFullBackup } from "./backup-store";
import { uploadDriveFile } from "./google-drive-storage";

function timestampParts(createdAt: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(createdAt));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: value.year,
    month: value.month,
    stamp: `${value.year}-${value.month}-${value.day}_${value.hour}${value.minute}${value.second}`,
  };
}

export async function archivePreFailbackBackup() {
  const backup = await createFullBackup();
  const timestamp = timestampParts(backup.createdAt);
  const fileName = `WHIZZUP_pre_failback_${timestamp.stamp}.json`;
  const file = new File([JSON.stringify(backup, null, 2)], fileName, {
    type: "application/json; charset=utf-8",
  });
  const stored = await uploadDriveFile({
    file,
    folderSegments: [
      "WHIZZUP DB 백업",
      "전환 안전본",
      timestamp.year,
      timestamp.month,
    ],
    contextType: "continuity-pre-failback",
    contextId: backup.checksum,
  });
  return {
    ...stored,
    fileName,
    checksum: backup.checksum,
    createdAt: backup.createdAt,
  };
}
