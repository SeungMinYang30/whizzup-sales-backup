import { getD1 } from "../db";
import { ensureCampaignsReady } from "./campaign-store";
import {
  ensureCollaborationReady,
  type Member,
} from "./collaboration";
import { ensureEquipmentReady } from "./equipment-store";
import { ensureMapReady } from "./map-store";
import { ensureManagerAlertsReady } from "./manager-alerts";
import { ensureActivityReviewsReady } from "./activity-reviews";
import { ensureActivityAssignmentHistoryReady } from "./activity-assignment-history";
import { ensureRecordsReady } from "./records-store";
import { ensureAiRecommendationsReady } from "./ai-recommendations";

export const BACKUP_FORMAT = "whizzup-full-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = "2026-07-20";
const LEGACY_BACKUP_SCHEMA_VERSIONS = new Set(["2026-07-18"]);
export const BACKUP_MAX_ROWS = 20_000;

type BackupRow = Record<string, unknown>;

type BackupTableDefinition = {
  name: string;
  columns: readonly string[];
  orderBy: string;
};

export const BACKUP_TABLES = [
  {
    name: "members",
    columns: [
      "id",
      "email",
      "display_name",
      "role",
      "permissions",
      "status",
      "is_sales",
      "created_at",
      "approved_at",
      "approved_by",
      "last_seen_at",
    ],
    orderBy: "id",
  },
  {
    name: "activities",
    columns: [
      "id",
      "seed_key",
      "activity_date",
      "date_confidence",
      "activity_type",
      "category",
      "contact_method",
      "region",
      "organization",
      "budget_type",
      "budget_amount",
      "topic",
      "summary",
      "status",
      "temperature",
      "award_status",
      "award_company",
      "execution_type",
      "consortium_company",
      "award_stage",
      "progress_manager",
      "follow_up_required",
      "follow_up_date",
      "next_action",
      "progress_schedule",
      "contact_role",
      "contact_name",
      "contact_phone",
      "contact_email",
      "source_chat",
      "notes",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "activity_authors",
    columns: ["activity_id", "member_id", "created_by_name", "created_at"],
    orderBy: "activity_id",
  },
  {
    name: "activity_assignment_history",
    columns: [
      "id",
      "activity_id",
      "from_manager",
      "to_member_id",
      "to_manager",
      "changed_by_member_id",
      "changed_by_name",
      "created_at",
    ],
    orderBy: "id",
  },
  {
    name: "manager_alert_acknowledgements",
    columns: [
      "id",
      "member_id",
      "organization",
      "issue_signature",
      "snoozed_until",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "activity_review_acknowledgements",
    columns: [
      "id",
      "member_id",
      "activity_id",
      "issue_signature",
      "snoozed_until",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "ai_recommendations",
    columns: [
      "id",
      "activity_id",
      "organization",
      "meeting_summary",
      "interests_json",
      "recommended_products_json",
      "follow_up_questions_json",
      "recommended_actions_json",
      "applied_products_json",
      "applied_questions_json",
      "applied_actions_json",
      "follow_up_date",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "app_settings",
    columns: ["key", "value", "updated_by", "updated_at"],
    orderBy: "key",
  },
  {
    name: "organization_locations",
    columns: [
      "organization",
      "region",
      "address",
      "road_address",
      "latitude",
      "longitude",
      "place_name",
      "place_id",
      "updated_by",
      "updated_at",
    ],
    orderBy: "organization",
  },
  {
    name: "sales_campaigns",
    columns: [
      "id",
      "name",
      "notes",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "sales_campaign_targets",
    columns: [
      "id",
      "campaign_id",
      "organization",
      "region",
      "address",
      "phone",
      "contact_name",
      "notes",
      "assigned_member_id",
      "activity_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "equipment_projects",
    columns: [
      "id",
      "organization",
      "name",
      "status",
      "budget_type",
      "notes",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
  {
    name: "equipment_items",
    columns: [
      "id",
      "project_id",
      "product_name",
      "specification",
      "proposed_qty",
      "awarded_qty",
      "installed_qty",
      "unit",
      "status",
      "notes",
      "sort_order",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  },
] as const satisfies readonly BackupTableDefinition[];

export type BackupTableName = (typeof BACKUP_TABLES)[number]["name"];

export type FullBackup = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  createdAt: string;
  source: {
    application: "WHIZZUP Sales Hub";
    project: "whizzup-sales-hub";
  };
  security: {
    includesBusinessData: true;
    excludes: string[];
  };
  counts: Record<BackupTableName, number>;
  checksum: string;
  data: Record<BackupTableName, BackupRow[]>;
};

export type BackupInspection = {
  valid: true;
  formatVersion: number;
  schemaVersion: string;
  createdAt: string;
  checksum: string;
  totalRows: number;
  counts: Record<BackupTableName, number>;
  excluded: string[];
};

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

async function ensureBackupReady() {
  await ensureCollaborationReady();
  await ensureRecordsReady();
  await ensureMapReady();
  await ensureCampaignsReady();
  await ensureEquipmentReady();
  await ensureAiRecommendationsReady();
  await ensureManagerAlertsReady();
  await ensureActivityReviewsReady();
  await ensureActivityAssignmentHistoryReady();
  return getD1();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

function checksumSource(backup: Omit<FullBackup, "checksum">) {
  return {
    format: backup.format,
    formatVersion: backup.formatVersion,
    schemaVersion: backup.schemaVersion,
    createdAt: backup.createdAt,
    source: backup.source,
    security: backup.security,
    counts: backup.counts,
    data: backup.data,
  };
}

async function checksumBackup(backup: Omit<FullBackup, "checksum">) {
  return sha256Hex(canonicalJson(checksumSource(backup)));
}

function asInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new BackupValidationError(`${label} 값이 올바르지 않습니다.`);
  }
  return number;
}

function nullableInteger(value: unknown, label: string) {
  if (value === null || value === "") return null;
  return asInteger(value, label);
}

function requiredText(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new BackupValidationError(`${label} 값이 비어 있습니다.`);
  }
  return text;
}

function assertUnique(
  rows: BackupRow[],
  key: (row: BackupRow) => string,
  label: string,
) {
  const values = new Set<string>();
  rows.forEach((row) => {
    const value = key(row);
    if (values.has(value)) {
      throw new BackupValidationError(`${label} 중복 값이 있습니다: ${value}`);
    }
    values.add(value);
  });
}

function rowSet(rows: BackupRow[], column: string, label: string) {
  return new Set(
    rows.map((row) => String(asInteger(row[column], `${label}.${column}`))),
  );
}

function assertReference(
  value: unknown,
  validValues: Set<string>,
  label: string,
  nullable = false,
) {
  if (nullable && (value === null || value === "")) return;
  const normalized = String(asInteger(value, label));
  if (!validValues.has(normalized)) {
    throw new BackupValidationError(`${label} 연결 정보가 없습니다.`);
  }
}

function validateRows(
  data: Record<BackupTableName, BackupRow[]>,
  currentAdmin?: Pick<Member, "id" | "email">,
) {
  const totalRows = BACKUP_TABLES.reduce(
    (sum, table) => sum + data[table.name].length,
    0,
  );
  if (totalRows > BACKUP_MAX_ROWS) {
    throw new BackupValidationError(
      `백업 데이터가 ${BACKUP_MAX_ROWS.toLocaleString("ko-KR")}행을 넘어 복원할 수 없습니다.`,
    );
  }

  BACKUP_TABLES.forEach((table) => {
    const allowedColumns = new Set<string>(table.columns);
    data[table.name].forEach((row, index) => {
      if (!isPlainObject(row)) {
        throw new BackupValidationError(
          `${table.name} ${index + 1}행 형식이 올바르지 않습니다.`,
        );
      }
      const unknownColumn = Object.keys(row).find(
        (column) => !allowedColumns.has(column),
      );
      if (unknownColumn) {
        throw new BackupValidationError(
          `${table.name}에 알 수 없는 항목이 있습니다: ${unknownColumn}`,
        );
      }
      const missingColumn = table.columns.find(
        (column) => !(column in row),
      );
      if (missingColumn) {
        throw new BackupValidationError(
          `${table.name}에 필요한 항목이 없습니다: ${missingColumn}`,
        );
      }
      Object.entries(row).forEach(([column, value]) => {
        if (
          value !== null &&
          typeof value !== "string" &&
          typeof value !== "number"
        ) {
          throw new BackupValidationError(
            `${table.name}.${column} 값 형식이 올바르지 않습니다.`,
          );
        }
      });
    });
  });

  const members = data.members;
  const activities = data.activities;
  const campaigns = data.sales_campaigns;
  const projects = data.equipment_projects;

  assertUnique(members, (row) => String(asInteger(row.id, "members.id")), "구성원 ID");
  assertUnique(
    members,
    (row) => requiredText(row.email, "members.email").toLowerCase(),
    "구성원 이메일",
  );
  assertUnique(
    activities,
    (row) => String(asInteger(row.id, "activities.id")),
    "활동 ID",
  );
  assertUnique(
    data.activity_authors,
    (row) => String(asInteger(row.activity_id, "activity_authors.activity_id")),
    "활동 작성자 연결",
  );
  assertUnique(
    data.activity_assignment_history,
    (row) => String(asInteger(row.id, "activity_assignment_history.id")),
    "진행 담당자 변경 이력 ID",
  );
  assertUnique(
    data.manager_alert_acknowledgements,
    (row) =>
      String(asInteger(row.id, "manager_alert_acknowledgements.id")),
    "관리자 처리 알림 ID",
  );
  assertUnique(
    data.manager_alert_acknowledgements,
    (row) =>
      `${asInteger(row.member_id, "manager_alert_acknowledgements.member_id")}|${requiredText(
        row.organization,
        "manager_alert_acknowledgements.organization",
      )}`,
    "관리자 처리 알림",
  );
  assertUnique(
    data.activity_review_acknowledgements,
    (row) =>
      String(asInteger(row.id, "activity_review_acknowledgements.id")),
    "내 기록 점검 ID",
  );
  assertUnique(
    data.activity_review_acknowledgements,
    (row) =>
      `${asInteger(row.member_id, "activity_review_acknowledgements.member_id")}|${asInteger(
        row.activity_id,
        "activity_review_acknowledgements.activity_id",
      )}`,
    "구성원별 내 기록 점검",
  );
  assertUnique(
    data.app_settings,
    (row) => requiredText(row.key, "app_settings.key"),
    "설정 키",
  );
  assertUnique(
    data.organization_locations,
    (row) => requiredText(row.organization, "organization_locations.organization"),
    "기관 위치",
  );
  assertUnique(
    campaigns,
    (row) => String(asInteger(row.id, "sales_campaigns.id")),
    "영업 묶음 ID",
  );
  assertUnique(
    campaigns,
    (row) => requiredText(row.name, "sales_campaigns.name"),
    "영업 묶음명",
  );
  assertUnique(
    data.sales_campaign_targets,
    (row) => String(asInteger(row.id, "sales_campaign_targets.id")),
    "영업 대상 ID",
  );
  assertUnique(
    data.sales_campaign_targets,
    (row) =>
      `${asInteger(row.campaign_id, "sales_campaign_targets.campaign_id")}|${requiredText(
        row.organization,
        "sales_campaign_targets.organization",
      )}`,
    "영업 묶음별 기관",
  );
  assertUnique(
    projects,
    (row) => String(asInteger(row.id, "equipment_projects.id")),
    "사업 ID",
  );
  assertUnique(
    projects,
    (row) =>
      `${requiredText(row.organization, "equipment_projects.organization")}|${requiredText(
        row.name,
        "equipment_projects.name",
      )}`,
    "기관별 사업명",
  );
  assertUnique(
    data.equipment_items,
    (row) => String(asInteger(row.id, "equipment_items.id")),
    "품목 ID",
  );

  const memberIds = rowSet(members, "id", "members");
  const activityIds = rowSet(activities, "id", "activities");
  const campaignIds = rowSet(campaigns, "id", "sales_campaigns");
  const projectIds = rowSet(projects, "id", "equipment_projects");

  members.forEach((row) => {
    const approvedBy = nullableInteger(row.approved_by, "members.approved_by");
    if (approvedBy !== null) {
      assertReference(approvedBy, memberIds, "members.approved_by");
    }
  });
  data.activity_authors.forEach((row) => {
    assertReference(
      row.activity_id,
      activityIds,
      "activity_authors.activity_id",
    );
    assertReference(
      row.member_id,
      memberIds,
      "activity_authors.member_id",
      true,
    );
  });
  data.manager_alert_acknowledgements.forEach((row) => {
    assertReference(
      row.member_id,
      memberIds,
      "manager_alert_acknowledgements.member_id",
    );
    requiredText(
      row.issue_signature,
      "manager_alert_acknowledgements.issue_signature",
    );
  });
  data.activity_assignment_history.forEach((row) => {
    assertReference(
      row.activity_id,
      activityIds,
      "activity_assignment_history.activity_id",
    );
    assertReference(
      row.to_member_id,
      memberIds,
      "activity_assignment_history.to_member_id",
    );
    assertReference(
      row.changed_by_member_id,
      memberIds,
      "activity_assignment_history.changed_by_member_id",
    );
    requiredText(
      row.to_manager,
      "activity_assignment_history.to_manager",
    );
    requiredText(
      row.changed_by_name,
      "activity_assignment_history.changed_by_name",
    );
  });
  data.activity_review_acknowledgements.forEach((row) => {
    assertReference(
      row.member_id,
      memberIds,
      "activity_review_acknowledgements.member_id",
    );
    assertReference(
      row.activity_id,
      activityIds,
      "activity_review_acknowledgements.activity_id",
    );
    requiredText(
      row.issue_signature,
      "activity_review_acknowledgements.issue_signature",
    );
  });
  data.app_settings.forEach((row) =>
    assertReference(
      row.updated_by,
      memberIds,
      "app_settings.updated_by",
      true,
    ),
  );
  data.organization_locations.forEach((row) => {
    assertReference(
      row.updated_by,
      memberIds,
      "organization_locations.updated_by",
      true,
    );
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BackupValidationError(
        `${String(row.organization)}의 지도 좌표가 올바르지 않습니다.`,
      );
    }
  });
  campaigns.forEach((row) =>
    assertReference(row.created_by, memberIds, "sales_campaigns.created_by"),
  );
  data.sales_campaign_targets.forEach((row) => {
    assertReference(
      row.campaign_id,
      campaignIds,
      "sales_campaign_targets.campaign_id",
    );
    assertReference(
      row.assigned_member_id,
      memberIds,
      "sales_campaign_targets.assigned_member_id",
      true,
    );
    assertReference(
      row.activity_id,
      activityIds,
      "sales_campaign_targets.activity_id",
      true,
    );
  });
  projects.forEach((row) =>
    assertReference(row.created_by, memberIds, "equipment_projects.created_by"),
  );
  data.equipment_items.forEach((row) =>
    assertReference(row.project_id, projectIds, "equipment_items.project_id"),
  );

  if (currentAdmin) {
    const email = currentAdmin.email.trim().toLowerCase();
    const backupAdmin = members.find(
      (row) => String(row.email).trim().toLowerCase() === email,
    );
    if (
      !backupAdmin ||
      Number(backupAdmin.id) !== currentAdmin.id ||
      String(backupAdmin.role) !== "admin" ||
      String(backupAdmin.status) !== "approved"
    ) {
      throw new BackupValidationError(
        "현재 대표관리자 계정이 같은 ID의 승인된 대표관리자로 포함된 백업만 복원할 수 있습니다.",
      );
    }
  }
}

export async function createFullBackup(): Promise<FullBackup> {
  const d1 = await ensureBackupReady();
  const data = {} as Record<BackupTableName, BackupRow[]>;
  const counts = {} as Record<BackupTableName, number>;

  for (const table of BACKUP_TABLES) {
    const result = await d1
      .prepare(`SELECT * FROM ${table.name} ORDER BY ${table.orderBy}`)
      .all<BackupRow>();
    data[table.name] = result.results;
    counts[table.name] = result.results.length;
  }

  const unsigned: Omit<FullBackup, "checksum"> = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      application: "WHIZZUP Sales Hub",
      project: "whizzup-sales-hub",
    },
    security: {
      includesBusinessData: true,
      excludes: [
        "로그인 세션",
        "OAuth 인증코드·토큰·비밀키",
        "OPENAI_API_KEY 등 서버 환경 비밀값",
        "화면에서 등록한 OpenAI API 키",
      ],
    },
    counts,
    data,
  };

  return {
    ...unsigned,
    checksum: await checksumBackup(unsigned),
  };
}

export async function validateFullBackup(
  input: unknown,
  currentAdmin?: Pick<Member, "id" | "email">,
): Promise<{ backup: FullBackup; inspection: BackupInspection }> {
  if (!isPlainObject(input)) {
    throw new BackupValidationError("전체 백업 파일 형식이 아닙니다.");
  }
  if (input.format !== BACKUP_FORMAT) {
    throw new BackupValidationError("WHIZZUP 전체 백업 파일이 아닙니다.");
  }
  if (input.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupValidationError(
      `지원하지 않는 백업 버전입니다. 현재 지원 버전은 ${BACKUP_FORMAT_VERSION}입니다.`,
    );
  }
  if (
    input.schemaVersion !== BACKUP_SCHEMA_VERSION &&
    !LEGACY_BACKUP_SCHEMA_VERSIONS.has(String(input.schemaVersion))
  ) {
    throw new BackupValidationError(
      "현재 사이트 구조와 다른 백업 파일입니다. 먼저 사이트 버전을 확인해 주세요.",
    );
  }
  if (!isPlainObject(input.data) || !isPlainObject(input.counts)) {
    throw new BackupValidationError("백업 데이터 또는 개수 정보가 없습니다.");
  }
  if (
    typeof input.createdAt !== "string" ||
    !Number.isFinite(Date.parse(input.createdAt))
  ) {
    throw new BackupValidationError("백업 생성 시간이 올바르지 않습니다.");
  }
  if (typeof input.checksum !== "string" || input.checksum.length !== 64) {
    throw new BackupValidationError("백업 무결성 코드가 없습니다.");
  }
  if (!isPlainObject(input.source) || !isPlainObject(input.security)) {
    throw new BackupValidationError("백업 설명 정보가 올바르지 않습니다.");
  }

  const originalUnsigned = {
    format: input.format,
    formatVersion: input.formatVersion,
    schemaVersion: input.schemaVersion,
    createdAt: input.createdAt,
    source: input.source,
    security: input.security,
    counts: input.counts,
    data: input.data,
  } as Omit<FullBackup, "checksum">;
  const originalChecksum = await checksumBackup(originalUnsigned);
  if (originalChecksum !== input.checksum) {
    throw new BackupValidationError(
      "백업 파일이 손상되었거나 내용이 변경되어 무결성 검사를 통과하지 못했습니다.",
    );
  }

  const data = {} as Record<BackupTableName, BackupRow[]>;
  const counts = {} as Record<BackupTableName, number>;
  for (const table of BACKUP_TABLES) {
    const rows = input.data[table.name];
    if (
      (table.name === "ai_recommendations" ||
        table.name === "manager_alert_acknowledgements" ||
        table.name === "activity_review_acknowledgements" ||
        table.name === "activity_assignment_history") &&
      rows === undefined &&
      input.counts[table.name] === undefined
    ) {
      data[table.name] = [];
      counts[table.name] = 0;
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new BackupValidationError(`${table.name} 데이터가 없습니다.`);
    }
    data[table.name] = (
      table.name === "members" && input.schemaVersion === "2026-07-18"
        ? rows.map((row) =>
            isPlainObject(row) && !("is_sales" in row)
              ? { ...row, is_sales: 0 }
              : row,
          )
        : table.name === "activities"
          ? rows.map((row) =>
              isPlainObject(row) && !("contact_role" in row)
                ? { ...row, contact_role: "" }
                : row,
            )
          : rows
    ) as BackupRow[];
    counts[table.name] = rows.length;
    if (Number(input.counts[table.name]) !== rows.length) {
      throw new BackupValidationError(
        `${table.name}의 행 개수 정보가 일치하지 않습니다.`,
      );
    }
  }

  const backup = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: input.createdAt,
    source: input.source,
    security: input.security,
    counts,
    checksum: input.checksum,
    data,
  } as FullBackup;

  validateRows(data, currentAdmin);
  const totalRows = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const excluded = Array.isArray(backup.security.excludes)
    ? backup.security.excludes.map(String)
    : [];

  return {
    backup,
    inspection: {
      valid: true,
      formatVersion: backup.formatVersion,
      schemaVersion: backup.schemaVersion,
      createdAt: backup.createdAt,
      checksum: backup.checksum,
      totalRows,
      counts,
      excluded,
    },
  };
}

function insertStatement(
  d1: ReturnType<typeof getD1>,
  table: (typeof BACKUP_TABLES)[number],
  row: BackupRow,
) {
  const placeholders = table.columns.map(() => "?").join(", ");
  return d1
    .prepare(
      `INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES (${placeholders})`,
    )
    .bind(...table.columns.map((column) => row[column] ?? null));
}

async function replaceDatabaseFromBackup(backup: FullBackup) {
  const d1 = await ensureBackupReady();
  const statements = [
    d1.prepare("DELETE FROM activity_authors"),
    d1.prepare("DELETE FROM activity_assignment_history"),
    d1.prepare("DELETE FROM activity_review_acknowledgements"),
    d1.prepare("DELETE FROM manager_alert_acknowledgements"),
    d1.prepare("DELETE FROM ai_recommendations"),
    d1.prepare("DELETE FROM equipment_items"),
    d1.prepare("DELETE FROM sales_campaign_targets"),
    d1.prepare("DELETE FROM organization_locations"),
    d1.prepare("DELETE FROM equipment_projects"),
    d1.prepare("DELETE FROM sales_campaigns"),
    d1.prepare("DELETE FROM app_settings"),
    d1.prepare("DELETE FROM activities"),
    d1.prepare("DELETE FROM members"),
  ];

  const insertOrder: BackupTableName[] = [
    "members",
    "manager_alert_acknowledgements",
    "activities",
    "activity_assignment_history",
    "activity_review_acknowledgements",
    "app_settings",
    "organization_locations",
    "sales_campaigns",
    "equipment_projects",
    "activity_authors",
    "ai_recommendations",
    "sales_campaign_targets",
    "equipment_items",
  ];

  insertOrder.forEach((tableName) => {
    const table = BACKUP_TABLES.find((item) => item.name === tableName);
    if (!table) return;
    backup.data[tableName].forEach((row) => {
      statements.push(insertStatement(d1, table, row));
    });
  });

  [
    "members",
    "activities",
    "manager_alert_acknowledgements",
    "activity_assignment_history",
    "activity_review_acknowledgements",
    "sales_campaigns",
    "equipment_projects",
    "ai_recommendations",
    "sales_campaign_targets",
    "equipment_items",
  ].forEach((tableName) => {
    statements.push(
      d1.prepare(
        `SELECT setval(
           pg_get_serial_sequence('public.${tableName}', 'id'),
           COALESCE((SELECT MAX(id) FROM ${tableName}), 1),
           EXISTS (SELECT 1 FROM ${tableName})
         )`,
      ),
    );
  });

  await d1.batch(statements);
}

export async function restoreFullBackup(
  input: unknown,
  currentAdmin: Pick<Member, "id" | "email">,
) {
  const { backup, inspection } = await validateFullBackup(
    input,
    currentAdmin,
  );
  await replaceDatabaseFromBackup(backup);
  return inspection;
}

export async function restoreReplicaBackup(input: unknown) {
  const { backup, inspection } = await validateFullBackup(input);
  await replaceDatabaseFromBackup(backup);
  return inspection;
}
