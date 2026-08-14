import {
  ActivityCsvError,
  createActivitiesCsv,
  importActivityCsv,
  inspectActivityCsv,
} from "../../../lib/activity-csv";
import {
  BackupValidationError,
  createFullBackup,
  restoreFullBackup,
  validateFullBackup,
} from "../../../lib/backup-store";
import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  createEmergencyRecoveryPackage,
  createOfflineStandalonePackage,
  verifyEmergencyRecoveryPackage,
} from "../../../lib/recovery-packages";
import {
  createDriveResumableUpload,
  downloadDriveFile,
  ensureDrivePath,
  isDriveFolder,
  listDriveChildren,
  uploadDriveFile,
  uploadDriveResumableChunk,
} from "../../../lib/google-drive-storage";
import { gunzipSync, gzipSync } from "node:zlib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
const MAX_COMPRESSED_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_DRIVE_BACKUP_BYTES = 25 * 1024 * 1024;

function todayValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function backupTimestampValue(createdAt: string) {
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
    fileStamp: `${value.year}-${value.month}-${value.day}_${value.hour}${value.minute}${value.second}`,
  };
}

async function archiveFullBackupToDrive() {
  const backup = await createFullBackup();
  const timestamp = backupTimestampValue(backup.createdAt);
  const fileName = `WHIZZUP_full_backup_${timestamp.fileStamp}.json`;
  const file = new File([JSON.stringify(backup, null, 2)], fileName, {
    type: "application/json; charset=utf-8",
  });
  const stored = await uploadDriveFile({
    file,
    folderSegments: [
      "WHIZZUP DB 백업",
      "안전본",
      timestamp.year,
      timestamp.month,
    ],
    contextType: "full-db-backup",
    contextId: backup.checksum,
  });
  return {
    fileName,
    folderPath: `WHIZZUP DB 백업/안전본/${timestamp.year}/${timestamp.month}`,
    createdAt: backup.createdAt,
    checksum: backup.checksum,
    totalRows: Object.values(backup.counts).reduce((sum, count) => sum + count, 0),
    ...stored,
  };
}

function bytesArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytesArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

async function archiveEmergencyRecoveryToDrive(createdBy: number) {
  const backup = await createFullBackup();
  const timestamp = backupTimestampValue(backup.createdAt);
  const fileName = `WHIZZUP_emergency_recovery_${timestamp.fileStamp}.zip`;
  const bytes = createEmergencyRecoveryPackage(backup);
  const verification = verifyEmergencyRecoveryPackage(bytes, backup);
  const packageSha256 = await sha256Bytes(bytes);
  const session = await createDriveResumableUpload({
    fileName,
    mimeType: "application/zip",
    sizeBytes: bytes.byteLength,
    folderSegments: [
      "WHIZZUP 비상복구",
      "안전본",
      timestamp.year,
      timestamp.month,
    ],
    contextType: "emergency-recovery",
    contextId: backup.checksum,
    contextCategory: verification.sourceRelease,
    createdBy,
  });
  const uploaded = await uploadDriveResumableChunk({
    uploadUrl: session.uploadUrl,
    body: bytesArrayBuffer(bytes),
    contentRange: `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
    mimeType: "application/zip",
  });
  if (!uploaded.complete) {
    throw new Error("Google Drive 비상복구 패키지 업로드가 완료되지 않았습니다.");
  }
  const storedResponse = await downloadDriveFile(uploaded.file.id);
  if (!storedResponse.ok) {
    throw new Error("Google Drive에 저장한 비상복구 패키지를 다시 확인하지 못했습니다.");
  }
  const storedBytes = new Uint8Array(await storedResponse.arrayBuffer());
  const storedSha256 = await sha256Bytes(storedBytes);
  if (
    storedBytes.byteLength !== bytes.byteLength ||
    storedSha256 !== packageSha256
  ) {
    throw new Error("Google Drive에 저장된 비상복구 패키지의 무결성이 일치하지 않습니다.");
  }
  return {
    fileId: uploaded.file.id,
    fileName,
    folderPath: `WHIZZUP 비상복구/안전본/${timestamp.year}/${timestamp.month}`,
    createdAt: backup.createdAt,
    sizeBytes: storedBytes.byteLength,
    packageSha256,
    verified: true,
    ...verification,
  };
}

async function listFullBackupsFromDrive() {
  const rootId = await ensureDrivePath(["WHIZZUP DB 백업"]);
  const safeFolder = (await listDriveChildren(rootId)).find(
    (file) => isDriveFolder(file) && file.name === "안전본",
  );
  if (!safeFolder) return [];
  const years = (await listDriveChildren(safeFolder.id)).filter(isDriveFolder);
  const backups: Array<{
    fileId: string;
    fileName: string;
    sizeBytes: number;
    folderPath: string;
  }> = [];
  for (const year of years) {
    const months = (await listDriveChildren(year.id)).filter(isDriveFolder);
    for (const month of months) {
      const files = await listDriveChildren(month.id);
      for (const file of files) {
        if (
          isDriveFolder(file) ||
          !file.name?.startsWith("WHIZZUP_full_backup_") ||
          !file.name.endsWith(".json")
        ) {
          continue;
        }
        backups.push({
          fileId: file.id,
          fileName: file.name,
          sizeBytes: Number(file.size) || 0,
          folderPath: `WHIZZUP DB 백업/안전본/${year.name || ""}/${month.name || ""}`,
        });
      }
    }
  }
  return backups.sort((left, right) =>
    right.fileName.localeCompare(left.fileName, "ko-KR"),
  );
}

async function loadFullBackupFromDrive(fileId: string) {
  const backups = await listFullBackupsFromDrive();
  const selected = backups.find((backup) => backup.fileId === fileId);
  if (!selected) {
    throw new BackupValidationError(
      "WHIZZUP DB 백업 폴더에서 선택한 파일을 찾지 못했습니다.",
    );
  }
  if (selected.sizeBytes > MAX_DRIVE_BACKUP_BYTES) {
    throw new BackupValidationError(
      "선택한 Drive 백업이 25MB를 넘어 현재 복원할 수 없습니다.",
    );
  }
  const response = await downloadDriveFile(selected.fileId);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_DRIVE_BACKUP_BYTES) {
    throw new BackupValidationError(
      "선택한 Drive 백업이 25MB를 넘어 현재 복원할 수 없습니다.",
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_DRIVE_BACKUP_BYTES) {
    throw new BackupValidationError(
      "선택한 Drive 백업이 25MB를 넘어 현재 복원할 수 없습니다.",
    );
  }
  try {
    return {
      backup: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      selected,
    };
  } catch {
    throw new BackupValidationError(
      "선택한 Google Drive 파일이 올바른 JSON 백업이 아닙니다.",
    );
  }
}

function downloadHeaders(filename: string, contentType: string) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}

function binaryDownload(bytes: Uint8Array, filename: string) {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: downloadHeaders(filename, "application/zip"),
  });
}

function validationErrorResponse(error: unknown) {
  if (
    error instanceof BackupValidationError ||
    error instanceof ActivityCsvError
  ) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return accessErrorResponse(error);
}

async function readPayload(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/gzip")) {
    return request.json();
  }

  const compressed = new Uint8Array(await request.arrayBuffer());
  if (compressed.byteLength > MAX_COMPRESSED_REQUEST_BYTES) {
    throw new BackupValidationError(
      "압축 업로드 파일이 너무 큽니다. 4MB 이하 파일을 사용해 주세요.",
    );
  }
  return JSON.parse(gunzipSync(compressed).toString("utf8"));
}

export async function GET(request: Request) {
  try {
    await requireMemberPermission("backup:manage");
    const kind = new URL(request.url).searchParams.get("kind") ?? "full";
    if (kind === "activities-csv") {
      const csv = await createActivitiesCsv();
      return new Response(csv, {
        headers: downloadHeaders(
          `WHIZZUP_activities_${todayValue()}.csv`,
          "text/csv; charset=utf-8",
        ),
      });
    }
    if (!["full", "emergency", "offline"].includes(kind)) {
      return Response.json(
        { error: "지원하지 않는 백업 종류입니다." },
        { status: 400 },
      );
    }
    const backup = await createFullBackup();
    if (kind === "emergency") {
      return binaryDownload(
        createEmergencyRecoveryPackage(backup),
        `WHIZZUP_emergency_recovery_${todayValue()}.zip`,
      );
    }
    if (kind === "offline") {
      return binaryDownload(
        createOfflineStandalonePackage(backup),
        `WHIZZUP_offline_edition_${todayValue()}.zip`,
      );
    }
    const compressed = gzipSync(JSON.stringify(backup, null, 2));
    return new Response(compressed, {
      headers: {
        ...downloadHeaders(
          `WHIZZUP_full_backup_${todayValue()}.json`,
          "application/gzip",
        ),
        "X-WHIZZUP-Content-Encoding": "gzip",
      },
    });
  } catch (error) {
    return validationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("backup:manage");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return Response.json(
        { error: "업로드 파일이 너무 큽니다. 15MB 이하 파일을 사용해 주세요." },
        { status: 413 },
      );
    }
    const payload = (await readPayload(request)) as {
      action?: string;
      backup?: unknown;
      csv?: string;
      confirmation?: string;
      safetyBackupDownloaded?: boolean;
      driveFileId?: string;
    };

    if (payload.action === "archive-full-backup") {
      const archive = await archiveFullBackupToDrive();
      return Response.json({ ok: true, archive });
    }
    if (payload.action === "archive-emergency-recovery") {
      const archive = await archiveEmergencyRecoveryToDrive(member.id);
      return Response.json({ ok: true, archive });
    }
    if (payload.action === "list-drive-backups") {
      return Response.json({ backups: await listFullBackupsFromDrive() });
    }
    if (payload.action === "inspect-drive-backup") {
      const { backup, selected } = await loadFullBackupFromDrive(
        String(payload.driveFileId || ""),
      );
      const { inspection } = await validateFullBackup(backup, member);
      return Response.json({ inspection, selected });
    }
    if (payload.action === "restore-drive-backup") {
      if (
        payload.confirmation?.trim() !== "복원" ||
        payload.safetyBackupDownloaded !== true
      ) {
        return Response.json(
          {
            error:
              "현재 DB를 Google Drive에 먼저 안전 백업하고 ‘복원’을 입력해 주세요.",
          },
          { status: 400 },
        );
      }
      const { backup } = await loadFullBackupFromDrive(
        String(payload.driveFileId || ""),
      );
      const inspection = await restoreFullBackup(backup, member);
      return Response.json({ ok: true, inspection });
    }

    if (payload.action === "inspect-backup") {
      const { inspection } = await validateFullBackup(payload.backup, member);
      return Response.json({ inspection });
    }
    if (payload.action === "restore-backup") {
      if (
        payload.confirmation?.trim() !== "복원" ||
        payload.safetyBackupDownloaded !== true
      ) {
        return Response.json(
          {
            error:
              "현재 DB의 복원 직전 백업을 먼저 내려받고 ‘복원’을 입력해 주세요.",
          },
          { status: 400 },
        );
      }
      const inspection = await restoreFullBackup(payload.backup, member);
      return Response.json({ ok: true, inspection });
    }
    if (payload.action === "inspect-csv") {
      if (typeof payload.csv !== "string") {
        throw new ActivityCsvError("CSV 파일 내용이 없습니다.");
      }
      const inspection = await inspectActivityCsv(payload.csv);
      return Response.json({ inspection });
    }
    if (payload.action === "import-csv") {
      if (typeof payload.csv !== "string") {
        throw new ActivityCsvError("CSV 파일 내용이 없습니다.");
      }
      const result = await importActivityCsv(payload.csv, member);
      return Response.json({ ok: true, result });
    }
    return Response.json(
      { error: "지원하지 않는 백업 작업입니다." },
      { status: 400 },
    );
  } catch (error) {
    return validationErrorResponse(error);
  }
}
