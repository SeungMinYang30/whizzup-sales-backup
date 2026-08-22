import { getD1 } from "../db";
import {
  ensureCollaborationReady,
  type Member,
} from "./collaboration";
import {
  downloadDriveFile,
  isGoogleDriveConfigured,
  safeDriveFolderName,
  upsertDriveFileByContext,
} from "./google-drive-storage";

export const SITE_LAYOUT_SCHEMA_VERSION = 3;
export const SITE_LAYOUT_DRIVE_ROOT = "기초도면 전체";

export type SiteLayoutSyncStatus =
  | "queued"
  | "uploading"
  | "ready"
  | "error";

export type SiteLayoutDraft = Record<string, unknown>;

export type SiteLayout = {
  id: number;
  draftUuid: string;
  title: string;
  organizationName: string;
  businessRound: number;
  roomName: string;
  draft: SiteLayoutDraft;
  schemaVersion: number;
  editVersion: number;
  currentRevisionId: number;
  driveSyncStatus: SiteLayoutSyncStatus;
  driveSyncError: string;
  driveSyncToken: string;
  driveJsonName: string;
  drivePdfName: string;
  jsonUrl: string;
  pdfUrl: string;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type SiteLayoutSummary = Omit<
  SiteLayout,
  "draft" | "driveSyncToken"
>;

export type SiteLayoutRevision = {
  id: number;
  siteLayoutId: number;
  revisionNumber: number;
  parentRevisionId: number;
  schemaVersion: number;
  draft: SiteLayoutDraft;
  contentHash: string;
  driveSyncStatus: SiteLayoutSyncStatus;
  driveSyncError: string;
  driveJsonName: string;
  drivePdfName: string;
  createdByName: string;
  createdAt: string;
};

export class SiteLayoutInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "INVALID_SITE_LAYOUT",
  ) {
    super(message);
    this.name = "SiteLayoutInputError";
  }
}

export class SiteLayoutConflictError extends SiteLayoutInputError {
  constructor(public readonly layout: SiteLayout) {
    super(
      "다른 사용자가 이 기초도면을 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.",
      409,
      "EDIT_CONFLICT",
    );
    this.name = "SiteLayoutConflictError";
  }
}

class SiteLayoutFinalizeConflictError extends Error {
  constructor() {
    super("The site-layout Drive finalize token is no longer current.");
    this.name = "SiteLayoutFinalizeConflictError";
  }
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS site_layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_uuid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    organization_name TEXT NOT NULL DEFAULT '',
    business_round INTEGER NOT NULL DEFAULT 1,
    room_name TEXT NOT NULL DEFAULT '',
    schema_version INTEGER NOT NULL DEFAULT 3,
    draft_json TEXT NOT NULL DEFAULT '{}',
    edit_version INTEGER NOT NULL DEFAULT 1,
    current_revision_id INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    drive_folder_id TEXT NOT NULL DEFAULT '',
    drive_json_file_id TEXT NOT NULL DEFAULT '',
    drive_json_name TEXT NOT NULL DEFAULT '',
    drive_pdf_file_id TEXT NOT NULL DEFAULT '',
    drive_pdf_name TEXT NOT NULL DEFAULT '',
    drive_sync_status TEXT NOT NULL DEFAULT 'queued',
    drive_sync_error TEXT NOT NULL DEFAULT '',
    drive_sync_token TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT '',
    deleted_by INTEGER NOT NULL DEFAULT 0,
    deleted_by_name TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER NOT NULL,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS site_layouts_updated_idx
   ON site_layouts (deleted_at, updated_at, id)`,
  `CREATE TABLE IF NOT EXISTS site_layout_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_layout_id INTEGER NOT NULL,
    revision_number INTEGER NOT NULL,
    parent_revision_id INTEGER NOT NULL DEFAULT 0,
    schema_version INTEGER NOT NULL DEFAULT 3,
    draft_json TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL DEFAULT '',
    change_summary TEXT NOT NULL DEFAULT '',
    drive_folder_id TEXT NOT NULL DEFAULT '',
    drive_json_file_id TEXT NOT NULL DEFAULT '',
    drive_json_name TEXT NOT NULL DEFAULT '',
    drive_pdf_file_id TEXT NOT NULL DEFAULT '',
    drive_pdf_name TEXT NOT NULL DEFAULT '',
    drive_sync_status TEXT NOT NULL DEFAULT 'queued',
    drive_sync_error TEXT NOT NULL DEFAULT '',
    drive_sync_token TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS site_layout_revisions_number_idx
   ON site_layout_revisions (site_layout_id, revision_number)`,
  `CREATE INDEX IF NOT EXISTS site_layout_revisions_created_idx
   ON site_layout_revisions (site_layout_id, created_at, id)`,
];

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;
const siteLayoutColumnMigrations = [
  "ALTER TABLE site_layouts ADD COLUMN organization_name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE site_layouts ADD COLUMN business_round INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE site_layouts ADD COLUMN room_name TEXT NOT NULL DEFAULT ''",
];

export function ensureSiteLayoutsReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = await ensureCollaborationReady();
      await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
      for (const statement of siteLayoutColumnMigrations) {
        try {
          await d1.prepare(statement).run();
        } catch (error) {
          if (!/duplicate column|already exists/i.test(String(error))) throw error;
        }
      }
      return d1;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

function cleanText(value: unknown, limit: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, limit);
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function syncStatus(value: unknown): SiteLayoutSyncStatus {
  return value === "uploading" || value === "ready" || value === "error"
    ? value
    : "queued";
}

function draftFromInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SiteLayoutInputError("저장할 기초도면 내용이 필요합니다.");
  }
  let json = "";
  try {
    json = JSON.stringify(value);
  } catch {
    throw new SiteLayoutInputError("기초도면 내용을 JSON 형식으로 저장할 수 없습니다.");
  }
  if (!json || new TextEncoder().encode(json).length > 4 * 1024 * 1024) {
    throw new SiteLayoutInputError("기초도면 편집 데이터는 4MB 이하로 저장해 주세요.");
  }
  return { draft: JSON.parse(json) as SiteLayoutDraft, json };
}

function parseDraft(value: unknown): SiteLayoutDraft {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SiteLayoutDraft
      : {};
  } catch {
    return {};
  }
}

function draftSchemaVersion(
  draft: SiteLayoutDraft,
  requested: unknown,
) {
  const value = Number(draft.schemaVersion ?? requested ?? SITE_LAYOUT_SCHEMA_VERSION);
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000
    ? value
    : SITE_LAYOUT_SCHEMA_VERSION;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function revisionFileStem(revisionNumber: number) {
  return `R${String(revisionNumber).padStart(4, "0")}`;
}

function siteLayoutFromRow(row: Record<string, unknown>): SiteLayout {
  const id = positiveInteger(row.id);
  const driveJsonFileId = cleanText(row.drive_json_file_id, 300);
  const drivePdfFileId = cleanText(row.drive_pdf_file_id, 300);
  return {
    id,
    draftUuid: cleanText(row.draft_uuid, 100),
    title: cleanText(row.title, 200),
    organizationName: cleanText(row.organization_name, 160) || "기관 미지정",
    businessRound: positiveInteger(row.business_round) || 1,
    roomName: cleanText(row.room_name, 100) || cleanText(row.title, 200) || "실 미지정",
    draft: parseDraft(row.draft_json),
    schemaVersion: positiveInteger(row.schema_version) || SITE_LAYOUT_SCHEMA_VERSION,
    editVersion: positiveInteger(row.edit_version) || 1,
    currentRevisionId: positiveInteger(row.current_revision_id),
    driveSyncStatus: syncStatus(row.drive_sync_status),
    driveSyncError: cleanText(row.drive_sync_error, 500),
    driveSyncToken: cleanText(row.drive_sync_token, 100),
    driveJsonName: cleanText(row.drive_json_name, 240),
    drivePdfName: cleanText(row.drive_pdf_name, 240),
    jsonUrl: driveJsonFileId ? `/api/site-layouts/files?id=${id}&kind=json` : "",
    pdfUrl: drivePdfFileId ? `/api/site-layouts/files?id=${id}&kind=pdf` : "",
    createdByName: cleanText(row.created_by_name, 160),
    updatedByName: cleanText(row.updated_by_name, 160),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function siteLayoutSummaryFromRow(
  row: Record<string, unknown>,
): SiteLayoutSummary {
  const id = positiveInteger(row.id);
  const driveJsonFileId = cleanText(row.drive_json_file_id, 300);
  const drivePdfFileId = cleanText(row.drive_pdf_file_id, 300);
  return {
    id,
    draftUuid: cleanText(row.draft_uuid, 100),
    title: cleanText(row.title, 200),
    organizationName: cleanText(row.organization_name, 160) || "기관 미지정",
    businessRound: positiveInteger(row.business_round) || 1,
    roomName: cleanText(row.room_name, 100) || cleanText(row.title, 200) || "실 미지정",
    schemaVersion: positiveInteger(row.schema_version) || SITE_LAYOUT_SCHEMA_VERSION,
    editVersion: positiveInteger(row.edit_version) || 1,
    currentRevisionId: positiveInteger(row.current_revision_id),
    driveSyncStatus: syncStatus(row.drive_sync_status),
    driveSyncError: cleanText(row.drive_sync_error, 500),
    driveJsonName: cleanText(row.drive_json_name, 240),
    drivePdfName: cleanText(row.drive_pdf_name, 240),
    jsonUrl: driveJsonFileId ? `/api/site-layouts/files?id=${id}&kind=json` : "",
    pdfUrl: drivePdfFileId ? `/api/site-layouts/files?id=${id}&kind=pdf` : "",
    createdByName: cleanText(row.created_by_name, 160),
    updatedByName: cleanText(row.updated_by_name, 160),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const SITE_LAYOUT_SUMMARY_COLUMNS = [
  "id",
  "draft_uuid",
  "title",
  "organization_name",
  "business_round",
  "room_name",
  "schema_version",
  "edit_version",
  "current_revision_id",
  "drive_json_file_id",
  "drive_json_name",
  "drive_pdf_file_id",
  "drive_pdf_name",
  "drive_sync_status",
  "drive_sync_error",
  "created_by_name",
  "updated_by_name",
  "created_at",
  "updated_at",
].join(", ");

function siteLayoutRevisionFromRow(
  row: Record<string, unknown>,
): SiteLayoutRevision {
  return {
    id: positiveInteger(row.id),
    siteLayoutId: positiveInteger(row.site_layout_id),
    revisionNumber: positiveInteger(row.revision_number),
    parentRevisionId: positiveInteger(row.parent_revision_id),
    schemaVersion: positiveInteger(row.schema_version) || SITE_LAYOUT_SCHEMA_VERSION,
    draft: parseDraft(row.draft_json),
    contentHash: cleanText(row.content_hash, 128),
    driveSyncStatus: syncStatus(row.drive_sync_status),
    driveSyncError: cleanText(row.drive_sync_error, 500),
    driveJsonName: cleanText(row.drive_json_name, 240),
    drivePdfName: cleanText(row.drive_pdf_name, 240),
    createdByName: cleanText(row.created_by_name, 160),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function getSiteLayout(id: number) {
  if (!positiveInteger(id)) return null;
  const d1 = await ensureSiteLayoutsReady();
  const row = await d1
    .prepare("SELECT * FROM site_layouts WHERE id=? AND deleted_at='' LIMIT 1")
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? siteLayoutFromRow(row) : null;
}

export async function listSiteLayouts(input: { query?: unknown } = {}) {
  const d1 = await ensureSiteLayoutsReady();
  const query = cleanText(input.query, 200);
  const rows = query
    ? await d1
        .prepare(`SELECT ${SITE_LAYOUT_SUMMARY_COLUMNS} FROM site_layouts
          WHERE deleted_at='' AND (LOWER(title) LIKE LOWER(?) OR LOWER(organization_name) LIKE LOWER(?) OR LOWER(room_name) LIKE LOWER(?))
          ORDER BY updated_at DESC, id DESC LIMIT 200`)
        .bind(`%${query}%`, `%${query}%`, `%${query}%`)
        .all<Record<string, unknown>>()
    : await d1
        .prepare(`SELECT ${SITE_LAYOUT_SUMMARY_COLUMNS} FROM site_layouts
          WHERE deleted_at=''
          ORDER BY updated_at DESC, id DESC LIMIT 200`)
        .all<Record<string, unknown>>();
  return rows.results.map(siteLayoutSummaryFromRow);
}

export async function listSiteLayoutRevisions(siteLayoutId: number) {
  const d1 = await ensureSiteLayoutsReady();
  const rows = await d1
    .prepare(`SELECT * FROM site_layout_revisions
      WHERE site_layout_id=? ORDER BY revision_number DESC, id DESC`)
    .bind(siteLayoutId)
    .all<Record<string, unknown>>();
  return rows.results.map(siteLayoutRevisionFromRow);
}

export async function saveSiteLayout(
  payload: Record<string, unknown>,
  member: Member,
) {
  const title = cleanText(payload.title, 200);
  if (!title) throw new SiteLayoutInputError("기초도면 제목을 입력해 주세요.");
  const organizationName = cleanText(payload.organizationName, 160) || "기관 미지정";
  const businessRound = positiveInteger(payload.businessRound) || 1;
  const roomName = cleanText(payload.roomName, 100) || title;
  const { draft, json } = draftFromInput(payload.draft);
  const schemaVersion = draftSchemaVersion(draft, payload.schemaVersion);
  const contentHash = await sha256Hex(json);
  const id = positiveInteger(payload.id);
  const baseVersion = positiveInteger(payload.baseVersion);
  const syncToken = crypto.randomUUID();
  const actorName = cleanText(member.displayName, 160) || cleanText(member.email, 160);
  const d1 = await ensureSiteLayoutsReady();

  const saved = await d1.transaction(async (transaction) => {
    if (!id) {
      const draftUuid = crypto.randomUUID();
      const inserted = await transaction
        .prepare(`INSERT INTO site_layouts (
          draft_uuid, title, organization_name, business_round, room_name, schema_version, draft_json, edit_version,
          drive_sync_status, drive_sync_token,
          created_by, created_by_name, updated_by, updated_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'queued', ?, ?, ?, ?, ?)
        RETURNING *`)
        .bind(
          draftUuid,
          title,
          organizationName,
          businessRound,
          roomName,
          schemaVersion,
          json,
          syncToken,
          member.id,
          actorName,
          member.id,
          actorName,
        )
        .first<Record<string, unknown>>();
      if (!inserted) throw new Error("기초도면을 저장하지 못했습니다.");
      const insertedId = positiveInteger(inserted.id);
      const revision = await transaction
        .prepare(`INSERT INTO site_layout_revisions (
          site_layout_id, revision_number, parent_revision_id,
          schema_version, draft_json, content_hash, change_summary,
          drive_sync_status, drive_sync_token, created_by, created_by_name
        ) VALUES (?, 1, 0, ?, ?, ?, ?, 'queued', ?, ?, ?)
        RETURNING *`)
        .bind(
          insertedId,
          schemaVersion,
          json,
          contentHash,
          cleanText(payload.changeSummary, 500),
          syncToken,
          member.id,
          actorName,
        )
        .first<Record<string, unknown>>();
      if (!revision) throw new Error("기초도면 버전을 저장하지 못했습니다.");
      await transaction
        .prepare("UPDATE site_layouts SET current_revision_id=? WHERE id=? AND drive_sync_token=?")
        .bind(revision.id, insertedId, syncToken)
        .run();
      const row = await transaction
        .prepare("SELECT * FROM site_layouts WHERE id=?")
        .bind(insertedId)
        .first<Record<string, unknown>>();
      if (!row) throw new Error("저장한 기초도면을 다시 불러오지 못했습니다.");
      return {
        layout: siteLayoutFromRow(row),
        revision: siteLayoutRevisionFromRow(revision),
      };
    }

    if (!baseVersion) {
      throw new SiteLayoutInputError(
        "수정 저장에는 현재 편집 버전이 필요합니다.",
        400,
        "BASE_VERSION_REQUIRED",
      );
    }
    const before = await transaction
      .prepare("SELECT * FROM site_layouts WHERE id=? AND deleted_at='' LIMIT 1")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!before) {
      throw new SiteLayoutInputError("기초도면을 찾지 못했습니다.", 404, "NOT_FOUND");
    }
    const nextVersion = baseVersion + 1;
    const updated = await transaction
      .prepare(`UPDATE site_layouts SET
        title=?, organization_name=?, business_round=?, room_name=?, schema_version=?, draft_json=?, edit_version=?,
        drive_sync_status='queued', drive_sync_error='', drive_sync_token=?,
        drive_folder_id='', drive_json_file_id='', drive_json_name='',
        drive_pdf_file_id='', drive_pdf_name='',
        updated_by=?, updated_by_name=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND deleted_at='' AND edit_version=?
        RETURNING *`)
      .bind(
        title,
        organizationName,
        businessRound,
        roomName,
        schemaVersion,
        json,
        nextVersion,
        syncToken,
        member.id,
        actorName,
        id,
        baseVersion,
      )
      .first<Record<string, unknown>>();
    if (!updated) {
      const latest = await transaction
        .prepare("SELECT * FROM site_layouts WHERE id=? AND deleted_at='' LIMIT 1")
        .bind(id)
        .first<Record<string, unknown>>();
      if (!latest) {
        throw new SiteLayoutInputError("기초도면을 찾지 못했습니다.", 404, "NOT_FOUND");
      }
      throw new SiteLayoutConflictError(siteLayoutFromRow(latest));
    }
    const revision = await transaction
      .prepare(`INSERT INTO site_layout_revisions (
        site_layout_id, revision_number, parent_revision_id,
        schema_version, draft_json, content_hash, change_summary,
        drive_sync_status, drive_sync_token, created_by, created_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
      RETURNING *`)
      .bind(
        id,
        nextVersion,
        positiveInteger(before.current_revision_id),
        schemaVersion,
        json,
        contentHash,
        cleanText(payload.changeSummary, 500),
        syncToken,
        member.id,
        actorName,
      )
      .first<Record<string, unknown>>();
    if (!revision) throw new Error("기초도면 버전을 저장하지 못했습니다.");
    await transaction
      .prepare(`UPDATE site_layouts
        SET current_revision_id=? WHERE id=? AND drive_sync_token=?`)
      .bind(revision.id, id, syncToken)
      .run();
    const row = await transaction
      .prepare("SELECT * FROM site_layouts WHERE id=?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!row) throw new Error("저장한 기초도면을 다시 불러오지 못했습니다.");
    return {
      layout: siteLayoutFromRow(row),
      revision: siteLayoutRevisionFromRow(revision),
    };
  });

  return { ...saved, syncToken };
}

function driveErrorMessage(error: unknown) {
  return (error instanceof Error
    ? error.message
    : "Google Drive에 기초도면을 저장하지 못했습니다.")
    .trim()
    .slice(0, 500);
}

async function markDriveError(id: number, syncToken: string, error: unknown) {
  const message = driveErrorMessage(error);
  const d1 = await ensureSiteLayoutsReady();
  await d1.transaction(async (transaction) => {
    await transaction
      .prepare(`UPDATE site_layout_revisions
        SET drive_sync_status='error', drive_sync_error=?
        WHERE site_layout_id=? AND drive_sync_token=?`)
      .bind(message, id, syncToken)
      .run();
    await transaction
      .prepare(`UPDATE site_layouts
        SET drive_sync_status='error', drive_sync_error=?
        WHERE id=? AND drive_sync_token=?`)
      .bind(message, id, syncToken)
      .run();
  });
}

export async function syncSiteLayoutDriveFiles(input: {
  id: number;
  syncToken: string;
  pdf?: File | null;
}) {
  const id = positiveInteger(input.id);
  const syncToken = cleanText(input.syncToken, 100);
  if (!id || !syncToken) {
    throw new SiteLayoutInputError("Drive 동기화 대상 정보가 필요합니다.");
  }
  try {
    if (!isGoogleDriveConfigured()) {
      throw new Error("Google Drive 연결 정보가 등록되지 않았습니다.");
    }
    const d1 = await ensureSiteLayoutsReady();
    const lock = await d1
      .prepare(`UPDATE site_layouts SET
        drive_sync_status='uploading', drive_sync_error=''
        WHERE id=? AND drive_sync_token=?
          AND drive_sync_status IN ('queued', 'error')`)
      .bind(id, syncToken)
      .run();
    if (Number(lock.meta.changes) !== 1) {
      const latest = await getSiteLayout(id);
      if (latest?.driveSyncToken === syncToken && latest.driveSyncStatus === "ready") {
        return latest;
      }
      throw new SiteLayoutInputError(
        "더 최신 기초도면 저장 작업이 있어 이전 Drive 작업을 중단했습니다.",
        409,
        "STALE_SYNC",
      );
    }
    await d1
      .prepare(`UPDATE site_layout_revisions SET
        drive_sync_status='uploading', drive_sync_error=''
        WHERE site_layout_id=? AND drive_sync_token=?`)
      .bind(id, syncToken)
      .run();
    const row = await d1
      .prepare(`SELECT l.*, r.id AS revision_id,
          r.revision_number AS current_revision_number,
          r.draft_json AS revision_draft_json
        FROM site_layouts l
        JOIN site_layout_revisions r ON r.id=l.current_revision_id
        WHERE l.id=? AND l.drive_sync_token=? AND l.deleted_at='' LIMIT 1`)
      .bind(id, syncToken)
      .first<Record<string, unknown>>();
    if (!row) {
      throw new SiteLayoutInputError(
        "더 최신 기초도면 저장 작업이 시작되어 이전 Drive 작업을 중단했습니다.",
        409,
        "STALE_SYNC",
      );
    }
    const revisionId = positiveInteger(row.revision_id);
    const revisionNumber = positiveInteger(row.current_revision_number);
    const title = safeDriveFolderName(row.title, "제목 없는 기초도면");
    const uniqueTitleFolder = safeDriveFolderName(
      `${title} (${id})`,
      `제목 없는 기초도면 (${id})`,
    );
    const organizationFolder = safeDriveFolderName(row.organization_name, "기관 미지정");
    const businessRoundFolder = `${positiveInteger(row.business_round) || 1}차 사업`;
    const folderSegments = [SITE_LAYOUT_DRIVE_ROOT, organizationFolder, businessRoundFolder, uniqueTitleFolder];
    const stem = revisionFileStem(revisionNumber);
    const jsonName = `${stem}_기초도면.json`;
    const pdfName = `${stem}_A3_현장실측초안.pdf`;
    const jsonText = JSON.stringify(parseDraft(row.revision_draft_json), null, 2);
    const jsonFile = new File([jsonText], jsonName, {
      type: "application/json;charset=utf-8",
    });
    const contextId = `site-layout:${id}:revision:${revisionId}`;
    const storedJson = await upsertDriveFileByContext({
      file: jsonFile,
      folderSegments,
      contextType: "site-layout-json",
      contextId,
    });
    const downloadedJson = await downloadDriveFile(storedJson.fileId);
    const storedJsonText = await downloadedJson.text();
    if (storedJsonText !== jsonText) {
      throw new Error("Google Drive JSON 원본 검증에 실패했습니다.");
    }
    let storedPdf: Awaited<ReturnType<typeof upsertDriveFileByContext>> | null = null;
    if (input.pdf) {
      if (
        input.pdf.size < 5
        || input.pdf.size > 30 * 1024 * 1024
        || await input.pdf.slice(0, 5).text() !== "%PDF-"
      ) {
        throw new SiteLayoutInputError("A3 PDF는 30MB 이하의 올바른 PDF 파일이어야 합니다.");
      }
      const pdfFile = new File([input.pdf], pdfName, { type: "application/pdf" });
      storedPdf = await upsertDriveFileByContext({
        file: pdfFile,
        folderSegments,
        contextType: "site-layout-pdf",
        contextId,
      });
      const downloadedPdf = await downloadDriveFile(storedPdf.fileId);
      const signature = new TextDecoder().decode(
        new Uint8Array(await downloadedPdf.arrayBuffer()).slice(0, 5),
      );
      if (signature !== "%PDF-") {
        throw new Error("Google Drive A3 PDF 검증에 실패했습니다.");
      }
    }
    let finalizedLayout: SiteLayout;
    try {
      finalizedLayout = await d1.transaction(async (transaction) => {
        const finalizedRow = await transaction
          .prepare(`UPDATE site_layouts SET
            drive_folder_id=?, drive_json_file_id=?, drive_json_name=?,
            drive_pdf_file_id=?, drive_pdf_name=?,
            drive_sync_status='ready', drive_sync_error=''
            WHERE id=? AND current_revision_id=? AND drive_sync_token=?
              AND drive_sync_status='uploading' AND deleted_at=''
            RETURNING *`)
          .bind(
            storedJson.folderId,
            storedJson.fileId,
            jsonName,
            storedPdf?.fileId ?? "",
            storedPdf ? pdfName : "",
            id,
            revisionId,
            syncToken,
          )
          .first<Record<string, unknown>>();
        if (!finalizedRow) throw new SiteLayoutFinalizeConflictError();

        const revisionResult = await transaction
          .prepare(`UPDATE site_layout_revisions SET
            drive_folder_id=?, drive_json_file_id=?, drive_json_name=?,
            drive_pdf_file_id=?, drive_pdf_name=?,
            drive_sync_status='ready', drive_sync_error=''
            WHERE id=? AND site_layout_id=? AND drive_sync_token=?
              AND drive_sync_status='uploading'`)
          .bind(
            storedJson.folderId,
            storedJson.fileId,
            jsonName,
            storedPdf?.fileId ?? "",
            storedPdf ? pdfName : "",
            revisionId,
            id,
            syncToken,
          )
          .run();
        if (Number(revisionResult.meta.changes) !== 1) {
          throw new SiteLayoutFinalizeConflictError();
        }
        return siteLayoutFromRow(finalizedRow);
      });
    } catch (error) {
      if (error instanceof SiteLayoutFinalizeConflictError) {
        const latest = await getSiteLayout(id);
        if (latest) throw new SiteLayoutConflictError(latest);
        throw new SiteLayoutInputError(
          "더 최신 기초도면 저장 작업이 있어 이전 Drive 작업을 중단했습니다.",
          409,
          "STALE_SYNC",
        );
      }
      throw error;
    }
    return finalizedLayout;
  } catch (error) {
    await markDriveError(id, syncToken, error).catch(() => undefined);
    throw error;
  }
}

export async function retrySiteLayoutDriveSync(input: {
  id: number;
  pdf?: File | null;
}) {
  let layout = await getSiteLayout(input.id);
  if (!layout) {
    throw new SiteLayoutInputError("기초도면을 찾지 못했습니다.", 404, "NOT_FOUND");
  }
  if (
    layout.driveSyncStatus === "uploading"
    || (layout.driveSyncStatus === "ready" && input.pdf)
  ) {
    const nextToken = crypto.randomUUID();
    const d1 = await ensureSiteLayoutsReady();
    const queued = await d1.transaction(async (transaction) => {
      const result = await transaction
        .prepare(`UPDATE site_layouts SET
          drive_sync_status='queued', drive_sync_error='', drive_sync_token=?
          WHERE id=? AND current_revision_id=? AND drive_sync_status=?`)
        .bind(
          nextToken,
          layout!.id,
          layout!.currentRevisionId,
          layout!.driveSyncStatus,
        )
        .run();
      if (Number(result.meta.changes) !== 1) return false;
      await transaction
        .prepare(`UPDATE site_layout_revisions SET
          drive_sync_status='queued', drive_sync_error='', drive_sync_token=?
          WHERE id=?`)
        .bind(nextToken, layout!.currentRevisionId)
        .run();
      return true;
    });
    if (!queued) {
      const latest = await getSiteLayout(input.id);
      if (latest) throw new SiteLayoutConflictError(latest);
    }
    layout = await getSiteLayout(input.id) ?? layout;
  }
  return syncSiteLayoutDriveFiles({
    id: layout.id,
    syncToken: layout.driveSyncToken,
    pdf: input.pdf,
  });
}

export function siteLayoutPdfFromBase64(value: unknown) {
  const source = String(value ?? "").trim();
  if (!source) return null;
  if (source.length > 42 * 1024 * 1024) {
    throw new SiteLayoutInputError("A3 PDF는 30MB 이하로 저장해 주세요.");
  }
  const base64 = source.replace(/^data:application\/pdf;base64,/i, "");
  if (!/^[A-Za-z0-9+/\r\n]+=*$/.test(base64)) {
    throw new SiteLayoutInputError("A3 PDF 전송 형식이 올바르지 않습니다.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (
    bytes.length < 5
    || bytes.length > 30 * 1024 * 1024
    || bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new SiteLayoutInputError("A3 PDF는 30MB 이하의 올바른 PDF 파일이어야 합니다.");
  }
  return new File([bytes], "site-layout-a3.pdf", { type: "application/pdf" });
}

export async function trashSiteLayout(
  id: number,
  baseVersion: number,
  member: Member,
) {
  const validId = positiveInteger(id);
  const validVersion = positiveInteger(baseVersion);
  if (!validId || !validVersion) {
    throw new SiteLayoutInputError("삭제할 기초도면과 현재 버전이 필요합니다.");
  }
  const d1 = await ensureSiteLayoutsReady();
  const actorName = cleanText(member.displayName, 160) || cleanText(member.email, 160);
  const result = await d1
    .prepare(`UPDATE site_layouts SET
      deleted_at=CURRENT_TIMESTAMP, deleted_by=?, deleted_by_name=?,
      updated_by=?, updated_by_name=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at='' AND edit_version=?`)
    .bind(member.id, actorName, member.id, actorName, validId, validVersion)
    .run();
  if (Number(result.meta.changes) !== 1) {
    const latest = await getSiteLayout(validId);
    if (latest) throw new SiteLayoutConflictError(latest);
    throw new SiteLayoutInputError("기초도면을 찾지 못했습니다.", 404, "NOT_FOUND");
  }
  return { ok: true };
}

export async function siteLayoutDriveFile(
  id: number,
  kind: "json" | "pdf",
) {
  const d1 = await ensureSiteLayoutsReady();
  const row = await d1
    .prepare("SELECT * FROM site_layouts WHERE id=? AND deleted_at='' LIMIT 1")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new SiteLayoutInputError("기초도면을 찾지 못했습니다.", 404, "NOT_FOUND");
  }
  const fileId = cleanText(
    kind === "pdf" ? row.drive_pdf_file_id : row.drive_json_file_id,
    300,
  );
  const name = cleanText(
    kind === "pdf" ? row.drive_pdf_name : row.drive_json_name,
    240,
  );
  if (!fileId) {
    throw new SiteLayoutInputError(
      `Google Drive에 저장된 ${kind === "pdf" ? "A3 PDF" : "JSON 원본"}이 없습니다.`,
      404,
      "DRIVE_FILE_NOT_FOUND",
    );
  }
  return { response: await downloadDriveFile(fileId), name };
}
