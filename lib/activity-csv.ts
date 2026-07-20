import { getD1 } from "../db";
import type { Member } from "./collaboration";
import { canonicalInstitutionName } from "./institution-names";
import { ensureRecordsReady } from "./records-store";
import {
  canonicalProgressManagerName,
  listRegisteredSalesNames,
} from "./sales-manager-normalization";

const CSV_MAX_ROWS = 5_000;

const CSV_HEADERS = [
  "기록 ID",
  "날짜",
  "날짜 신뢰도",
  "활동 유형",
  "구분",
  "컨택 방식",
  "지역",
  "기관명",
  "예산 종류",
  "예산 금액",
  "주제",
  "요약",
  "상태",
  "온도",
  "수주 결과",
  "수주 업체",
  "사업 방식",
  "컨소 업체",
  "수주 현재 상태",
  "진행 담당자",
  "재연락 필요",
  "재연락 예정일",
  "다음 행동",
  "진행 일정",
  "담당 역할",
  "기관 담당자",
  "기관 전화",
  "기관 메일",
  "출처",
  "메모",
  "입력자",
  "입력자 이메일",
  "생성일",
  "수정일",
] as const;

type CsvActivity = {
  sourceId: number | null;
  activityDate: string | null;
  dateConfidence: string;
  activityType: string;
  category: string;
  contactMethod: string;
  region: string;
  organization: string;
  budgetType: string;
  budgetAmount: string;
  topic: string;
  summary: string;
  status: string;
  temperature: string;
  awardStatus: string;
  awardCompany: string;
  executionType: string;
  consortiumCompany: string;
  awardStage: string;
  progressManager: string;
  followUpRequired: number;
  followUpDate: string | null;
  nextAction: string;
  progressSchedule: string;
  contactRole: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  sourceChat: string;
  notes: string;
  authorName: string;
  authorEmail: string;
  createdAt: string;
  updatedAt: string;
  signature: string;
  sourceRow: number;
};

export type ActivityCsvInspection = {
  totalRows: number;
  importableRows: number;
  duplicateRows: number;
  errorRows: number;
  errors: { row: number; message: string }[];
};

export class ActivityCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityCsvError";
  }
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) {
    throw new ActivityCsvError("CSV 따옴표가 닫히지 않았습니다.");
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function csvDate(value: string, label: string, nullable = true) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "날짜 미상" || trimmed === "미정") {
    return nullable ? null : "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ActivityCsvError(`${label}은 YYYY-MM-DD 형식이어야 합니다.`);
  }
  return trimmed;
}

function csvTimestamp(value: string) {
  const trimmed = value.trim();
  return trimmed && Number.isFinite(Date.parse(trimmed))
    ? trimmed
    : new Date().toISOString();
}

function parseYesNo(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["아니오", "아니요", "no", "n", "0", "false"].includes(normalized)) {
    return 0;
  }
  return 1;
}

function normalizedSignature(row: {
  activityDate: string | null;
  activityType: string;
  organization: string;
  topic: string;
  summary: string;
  budgetType: string;
  progressSchedule: string;
}) {
  return [
    row.activityDate ?? "",
    row.activityType.trim().toLowerCase(),
    canonicalInstitutionName(row.organization).toLowerCase(),
    row.topic.trim().toLowerCase(),
    row.summary.trim().toLowerCase(),
    row.budgetType.trim().toLowerCase(),
    row.progressSchedule.trim().toLowerCase(),
  ].join("|");
}

function databaseSignature(row: Record<string, unknown>) {
  return normalizedSignature({
    activityDate: row.activity_date ? String(row.activity_date) : null,
    activityType: String(row.activity_type ?? ""),
    organization: String(row.organization ?? ""),
    topic: String(row.topic ?? ""),
    summary: String(row.summary ?? ""),
    budgetType: String(row.budget_type ?? ""),
    progressSchedule: String(row.progress_schedule ?? ""),
  });
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

async function analyzeCsv(text: string) {
  const parsed = parseCsv(text);
  if (parsed.length < 2) {
    throw new ActivityCsvError("CSV에 불러올 활동 기록이 없습니다.");
  }
  if (parsed.length - 1 > CSV_MAX_ROWS) {
    throw new ActivityCsvError(
      `한 번에 ${CSV_MAX_ROWS.toLocaleString("ko-KR")}건까지만 불러올 수 있습니다.`,
    );
  }

  const headers = parsed[0].map((header) => header.trim());
  const duplicateHeader = headers.find(
    (header, index) => header && headers.indexOf(header) !== index,
  );
  if (duplicateHeader) {
    throw new ActivityCsvError(`CSV 제목이 중복되었습니다: ${duplicateHeader}`);
  }
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const get = (cells: string[], ...names: string[]) => {
    const index = names
      .map((name) => headerIndex.get(name))
      .find((value) => value !== undefined);
    return index === undefined ? "" : String(cells[index] ?? "").trim();
  };

  if (!headerIndex.has("기관명") || !headerIndex.has("활동 유형")) {
    throw new ActivityCsvError(
      "WHIZZUP 활동 CSV가 아닙니다. ‘기관명’과 ‘활동 유형’ 열이 필요합니다.",
    );
  }

  const d1 = await ensureRecordsReady();
  const existing = await d1
    .prepare(
      `SELECT id, activity_date, activity_type, organization, topic, summary,
              budget_type, progress_schedule
       FROM activities`,
    )
    .all<Record<string, unknown>>();
  const existingIds = new Set(
    existing.results.map((row: Record<string, unknown>) => Number(row.id)),
  );
  const existingSignatures = new Set(
    existing.results.map((row: Record<string, unknown>) =>
      databaseSignature(row),
    ),
  );
  const csvSignatures = new Set<string>();
  const importable: CsvActivity[] = [];
  const errors: { row: number; message: string }[] = [];
  let duplicateRows = 0;

  parsed.slice(1).forEach((cells, offset) => {
    const sourceRow = offset + 2;
    try {
      const sourceIdText = get(cells, "기록 ID", "id");
      const sourceId = sourceIdText ? Number(sourceIdText) : null;
      if (
        sourceId !== null &&
        (!Number.isSafeInteger(sourceId) || sourceId < 1)
      ) {
        throw new ActivityCsvError("기록 ID가 올바르지 않습니다.");
      }
      const organization = canonicalInstitutionName(
        get(cells, "기관명", "organization"),
      );
      const activityType = get(cells, "활동 유형", "activity_type");
      if (!organization) throw new ActivityCsvError("기관명이 비어 있습니다.");
      if (!activityType) {
        throw new ActivityCsvError("활동 유형이 비어 있습니다.");
      }
      const activityDate = csvDate(
        get(cells, "날짜", "activity_date"),
        "날짜",
      );
      const followUpDate = csvDate(
        get(cells, "재연락 예정일", "follow_up_date"),
        "재연락 예정일",
      );
      const draft = {
        sourceId,
        activityDate,
        dateConfidence:
          get(cells, "날짜 신뢰도", "date_confidence") ||
          (activityDate ? "확정" : "미상"),
        activityType,
        category: get(cells, "구분", "category") || "외부",
        contactMethod: get(cells, "컨택 방식", "contact_method"),
        region: get(cells, "지역", "region"),
        organization,
        budgetType: get(cells, "예산 종류", "budget_type"),
        budgetAmount: get(cells, "예산 금액", "budget_amount"),
        topic: get(cells, "주제", "topic"),
        summary: get(cells, "요약", "summary", "내용"),
        status: get(cells, "상태", "status") || "진행 중",
        temperature:
          get(cells, "온도", "관심도", "temperature") || "중간",
        awardStatus: get(cells, "수주 결과", "award_status") || "미정",
        awardCompany: get(cells, "수주 업체", "award_company"),
        executionType:
          get(cells, "사업 방식", "execution_type") === "컨소"
            ? "컨소"
            : "직영",
        consortiumCompany: get(
          cells,
          "컨소 업체",
          "consortium_company",
        ),
        awardStage:
          get(cells, "수주 현재 상태", "award_stage") || "미정",
        progressManager: get(
          cells,
          "진행 담당자",
          "progress_manager",
        ),
        followUpRequired: parseYesNo(
          get(cells, "재연락 필요", "follow_up_required") || "예",
        ),
        followUpDate,
        nextAction: get(cells, "다음 행동", "next_action"),
        progressSchedule: get(cells, "진행 일정", "progress_schedule"),
        contactRole: get(cells, "담당 역할", "contact_role"),
        contactName: get(cells, "기관 담당자", "contact_name"),
        contactPhone: get(cells, "기관 전화", "contact_phone"),
        contactEmail: get(cells, "기관 메일", "contact_email"),
        sourceChat:
          get(cells, "출처", "source_chat") || "CSV 불러오기",
        notes: get(cells, "메모", "notes"),
        authorName: get(cells, "입력자", "created_by_name"),
        authorEmail: get(cells, "입력자 이메일", "created_by_email")
          .toLowerCase(),
        createdAt: csvTimestamp(get(cells, "생성일", "created_at")),
        updatedAt: csvTimestamp(get(cells, "수정일", "updated_at")),
        signature: "",
        sourceRow,
      } satisfies CsvActivity;
      draft.signature = normalizedSignature(draft);

      if (
        (draft.sourceId !== null && existingIds.has(draft.sourceId)) ||
        existingSignatures.has(draft.signature) ||
        csvSignatures.has(draft.signature)
      ) {
        duplicateRows += 1;
        return;
      }
      csvSignatures.add(draft.signature);
      importable.push(draft);
    } catch (error) {
      errors.push({
        row: sourceRow,
        message:
          error instanceof Error
            ? error.message
            : "행 내용을 확인해 주세요.",
      });
    }
  });

  return {
    importable,
    inspection: {
      totalRows: parsed.length - 1,
      importableRows: importable.length,
      duplicateRows,
      errorRows: errors.length,
      errors: errors.slice(0, 20),
    } satisfies ActivityCsvInspection,
  };
}

export async function createActivitiesCsv() {
  const d1 = await ensureRecordsReady();
  const result = await d1
    .prepare(
      `SELECT
         a.*,
         COALESCE(aa.created_by_name, '가져온 기록') AS created_by_name,
         COALESCE(m.email, '') AS created_by_email
       FROM activities a
       LEFT JOIN activity_authors aa ON aa.activity_id = a.id
       LEFT JOIN members m ON m.id = aa.member_id
       ORDER BY a.id`,
    )
    .all<Record<string, unknown>>();

  const rows = result.results.map((row: Record<string, unknown>) =>
    [
      row.id,
      row.activity_date,
      row.date_confidence,
      row.activity_type,
      row.category,
      row.contact_method,
      row.region,
      row.organization,
      row.budget_type,
      row.budget_amount,
      row.topic,
      row.summary,
      row.status,
      row.temperature,
      row.award_status,
      row.award_company,
      row.execution_type,
      row.consortium_company,
      row.award_stage,
      row.progress_manager,
      Number(row.follow_up_required) === 1 ? "예" : "아니오",
      row.follow_up_date,
      row.next_action,
      row.progress_schedule,
      row.contact_role,
      row.contact_name,
      row.contact_phone,
      row.contact_email,
      row.source_chat,
      row.notes,
      row.created_by_name,
      row.created_by_email,
      row.created_at,
      row.updated_at,
    ]
      .map(csvCell)
      .join(","),
  );

  return `\uFEFF${CSV_HEADERS.map(csvCell).join(",")}\r\n${rows.join("\r\n")}`;
}

export async function inspectActivityCsv(text: string) {
  const { inspection } = await analyzeCsv(text);
  return inspection;
}

export async function importActivityCsv(text: string, admin: Member) {
  const { importable, inspection } = await analyzeCsv(text);
  if (!importable.length) {
    return { ...inspection, importedRows: 0 };
  }

  const d1 = getD1();
  const registeredSalesNames = await listRegisteredSalesNames(d1);
  const maximum = await d1
    .prepare("SELECT COALESCE(MAX(id), 0) AS maximum FROM activities")
    .first<{ maximum: number }>();
  const memberRows = await d1
    .prepare("SELECT id, email FROM members")
    .all<{ id: number; email: string }>();
  const membersByEmail = new Map(
    memberRows.results.map((member: { id: number; email: string }) => [
      member.email.trim().toLowerCase(),
      Number(member.id),
    ]),
  );
  const firstId = Number(maximum?.maximum ?? 0) + 1;
  const statements = [];

  for (let index = 0; index < importable.length; index += 1) {
    const row = importable[index];
    const id = firstId + index;
    const seedKey = `csv:${await sha256Hex(row.signature)}`;
    statements.push(
      d1
        .prepare(
          `INSERT INTO activities (
             id, seed_key, activity_date, date_confidence, activity_type,
             category, contact_method, region, organization, budget_type,
             budget_amount, topic, summary, status, temperature, award_status,
             award_company, execution_type, consortium_company, award_stage,
             progress_manager, follow_up_required, follow_up_date, next_action,
             progress_schedule, contact_role, contact_name, contact_phone, contact_email,
             source_chat, notes, created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           )`,
        )
        .bind(
          id,
          seedKey,
          row.activityDate,
          row.dateConfidence,
          row.activityType,
          row.category,
          row.contactMethod,
          row.region,
          row.organization,
          row.budgetType,
          row.budgetAmount,
          row.topic,
          row.summary,
          row.status,
          row.temperature,
          row.awardStatus,
          row.awardCompany,
          row.executionType,
          row.executionType === "컨소" ? row.consortiumCompany : "",
          row.awardStage,
          canonicalProgressManagerName(
            row.progressManager,
            registeredSalesNames,
          ),
          row.followUpRequired,
          row.followUpDate,
          row.nextAction,
          row.progressSchedule,
          row.contactRole,
          row.contactName,
          row.contactPhone,
          row.contactEmail,
          row.sourceChat,
          row.notes,
          row.createdAt,
          row.updatedAt,
        ),
    );
    const matchedMemberId = row.authorEmail
      ? membersByEmail.get(row.authorEmail) ?? null
      : null;
    statements.push(
      d1
        .prepare(
          `INSERT INTO activity_authors (
             activity_id, member_id, created_by_name, created_at
           ) VALUES (?, ?, ?, ?)`,
        )
        .bind(
          id,
          matchedMemberId,
          row.authorName || admin.displayName,
          row.createdAt,
        ),
    );
  }

  await d1.batch(statements);
  return {
    ...inspection,
    importedRows: importable.length,
  };
}
