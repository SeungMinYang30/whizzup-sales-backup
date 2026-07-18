import { createHash } from "node:crypto";
import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../lib/collaboration";
import { ensureRecordsReady } from "../../../lib/records-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;

const REQUIRED_HEADERS = [
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
  "기관 담당자",
  "기관 전화",
  "기관 메일",
  "출처",
  "메모",
  "입력자",
] as const;

type Header = (typeof REQUIRED_HEADERS)[number];
type CsvRecord = Record<Header, string>;

type ActivityImportRow = {
  seedKey: string;
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
  followUpRequired: boolean;
  followUpDate: string | null;
  nextAction: string;
  progressSchedule: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  sourceChat: string;
  notes: string;
  createdByName: string;
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  while (
    rows.length &&
    rows[rows.length - 1].every((value) => value.trim() === "")
  ) {
    rows.pop();
  }
  return rows;
}

function clean(value: string, maximumLength = 20_000) {
  return value.replaceAll("\u0000", "").trim().slice(0, maximumLength);
}

function restoreProgressSchedule(value: string) {
  return clean(value)
    .split(/\r?\n/)
    .map((line) => {
      const normalized = line.trim();
      const match = normalized.match(/^(.*?)\s+(\d{4}-\d{2}-\d{2})$/);
      return match ? `${match[1].trim()}\t${match[2]}` : normalized;
    })
    .filter(Boolean)
    .join("\n");
}

function recordsFromCsv(text: string) {
  const matrix = parseCsv(text);
  if (matrix.length < 2) throw new Error("가져올 활동기록이 없습니다.");
  if (matrix.length - 1 > MAX_ROWS) {
    throw new Error(`한 번에 최대 ${MAX_ROWS}건까지 가져올 수 있습니다.`);
  }

  const headers = matrix[0].map((value, index) =>
    clean(index === 0 ? value.replace(/^\uFEFF/, "") : value),
  );
  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !headers.includes(header),
  );
  if (missingHeaders.length) {
    throw new Error(`필수 열이 없습니다: ${missingHeaders.join(", ")}`);
  }

  const headerIndexes = new Map(
    REQUIRED_HEADERS.map((header) => [header, headers.indexOf(header)]),
  );
  const csvRecords: CsvRecord[] = matrix.slice(1).map((values) => {
    const record = {} as CsvRecord;
    for (const header of REQUIRED_HEADERS) {
      record[header] = clean(values[headerIndexes.get(header) ?? -1] ?? "");
    }
    return record;
  });

  const duplicateOccurrences = new Map<string, number>();
  const errors: string[] = [];
  const rows: ActivityImportRow[] = [];
  const validAwardStatuses = new Set(["미정", "위즈업 수주", "타업체 수주"]);
  const validExecutionTypes = new Set(["미정", "직영", "컨소"]);
  const validAwardStages = new Set([
    "미정",
    "품의",
    "협상",
    "계약",
    "일정 조율",
    "완공",
    "검수",
    "교육",
  ]);

  csvRecords.forEach((record, index) => {
    const rowNumber = index + 2;
    const organization = record["기관명"];
    const activityType = record["활동 유형"];
    const activityDate = record["날짜"];
    const followUpDate = record["재연락 예정일"];
    const followUp = record["재연락 필요"];
    const awardStatus = record["수주 결과"];
    const executionType = record["사업 방식"];
    const awardStage = record["수주 현재 상태"];

    if (!organization) errors.push(`${rowNumber}행: 기관명이 없습니다.`);
    if (!activityType) errors.push(`${rowNumber}행: 활동 유형이 없습니다.`);
    if (activityDate && !/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
      errors.push(`${rowNumber}행: 날짜 형식이 올바르지 않습니다.`);
    }
    if (followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) {
      errors.push(`${rowNumber}행: 재연락 예정일 형식이 올바르지 않습니다.`);
    }
    if (!["예", "아니오"].includes(followUp)) {
      errors.push(`${rowNumber}행: 재연락 필요 값은 예 또는 아니오여야 합니다.`);
    }
    if (!validAwardStatuses.has(awardStatus)) {
      errors.push(`${rowNumber}행: 수주 결과 값이 올바르지 않습니다.`);
    }
    if (!validExecutionTypes.has(executionType)) {
      errors.push(`${rowNumber}행: 사업 방식 값이 올바르지 않습니다.`);
    }
    if (!validAwardStages.has(awardStage)) {
      errors.push(`${rowNumber}행: 수주 현재 상태 값이 올바르지 않습니다.`);
    }
    if (awardStatus === "타업체 수주" && !record["수주 업체"]) {
      errors.push(`${rowNumber}행: 타업체 수주 업체명이 없습니다.`);
    }
    if (executionType === "컨소" && !record["컨소 업체"]) {
      errors.push(`${rowNumber}행: 컨소 업체명이 없습니다.`);
    }

    const canonical = REQUIRED_HEADERS.map((header) => record[header]).join(
      "\u001F",
    );
    const fingerprint = createHash("sha256")
      .update(canonical, "utf8")
      .digest("hex")
      .slice(0, 32);
    const occurrence = (duplicateOccurrences.get(fingerprint) ?? 0) + 1;
    duplicateOccurrences.set(fingerprint, occurrence);

    rows.push({
      seedKey: `sites-csv-v1:${fingerprint}:${occurrence}`,
      activityDate: activityDate || null,
      dateConfidence: record["날짜 신뢰도"] || "확정",
      activityType,
      category: record["구분"] || "외부",
      contactMethod: record["컨택 방식"],
      region: record["지역"],
      organization,
      budgetType: record["예산 종류"],
      budgetAmount: record["예산 금액"],
      topic: record["주제"],
      summary: record["요약"],
      status: record["상태"] || "진행 중",
      temperature: record["온도"] || "중간",
      awardStatus,
      awardCompany:
        awardStatus === "위즈업 수주"
          ? "위즈업"
          : awardStatus === "타업체 수주"
            ? record["수주 업체"]
            : "",
      executionType,
      consortiumCompany:
        executionType === "컨소" ? record["컨소 업체"] : "",
      awardStage,
      progressManager: record["진행 담당자"],
      followUpRequired: followUp === "예",
      followUpDate: followUpDate || null,
      nextAction: record["다음 행동"],
      progressSchedule: restoreProgressSchedule(record["진행 일정"]),
      contactName: record["기관 담당자"],
      contactPhone: record["기관 전화"],
      contactEmail: record["기관 메일"],
      sourceChat: record["출처"] || "기존 Sites CSV 이전",
      notes: record["메모"],
      createdByName: record["입력자"] || "가져온 기록",
    });
  });

  if (errors.length) {
    const displayed = errors.slice(0, 20);
    const suffix =
      errors.length > displayed.length
        ? ` 외 ${errors.length - displayed.length}개 오류`
        : "";
    throw new Error(`${displayed.join("\n")}${suffix}`);
  }
  return rows;
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function page(message = "", error = false) {
  const status = message
    ? `<section class="${error ? "error" : "success"}"><pre>${escapeHtml(message)}</pre></section>`
    : "";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>기존 활동기록 안전 이전</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#17213d;font-family:system-ui,-apple-system,"Noto Sans KR",sans-serif}
    main{max-width:760px;margin:56px auto;padding:36px;background:#fff;border:1px solid #dfe5f0;border-radius:20px;box-shadow:0 18px 50px rgba(28,48,100,.08)}
    h1{margin:0 0 12px;font-size:30px}p{line-height:1.65;color:#52607a}.notice{padding:16px 18px;background:#eef4ff;border-radius:12px}
    form{margin-top:26px;padding:22px;border:1px solid #dfe5f0;border-radius:14px}input{display:block;width:100%;padding:14px;border:1px solid #b8c4da;border-radius:10px;background:#fff}
    .actions{display:flex;gap:12px;margin-top:18px}.actions button{flex:1;padding:14px;border:0;border-radius:10px;font-weight:800;cursor:pointer}
    .validate{background:#e7edfb;color:#223363}.commit{background:#3548f5;color:#fff}.success,.error{margin-top:22px;padding:18px;border-radius:12px}
    .success{background:#e9fbf2;color:#11613a}.error{background:#fff0ee;color:#9e2d25}pre{white-space:pre-wrap;margin:0;font-family:inherit}
    a{color:#3548f5;font-weight:700}
  </style>
</head>
<body><main>
  <h1>기존 활동기록 안전 이전</h1>
  <p class="notice">관리자만 사용할 수 있습니다. 기존 행은 수정하거나 삭제하지 않으며, 동일 CSV를 다시 실행해도 중복 행은 건너뜁니다.</p>
  ${status}
  <form method="post" enctype="multipart/form-data">
    <label><strong>기존 사이트에서 내보낸 CSV</strong><input name="file" type="file" accept=".csv,text/csv" required></label>
    <div class="actions">
      <button class="validate" name="action" value="validate">1. 검증만 하기</button>
      <button class="commit" name="action" value="import">2. 검증 후 실제 가져오기</button>
    </div>
  </form>
  <p><a href="/">대시보드로 돌아가기</a></p>
</main></body></html>`;
}

function htmlResponse(message = "", error = false, status = 200) {
  return new Response(page(message, error), {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  try {
    await requireMemberPermission("records:manage");
    return htmlResponse();
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return htmlResponse("요청 출처를 확인할 수 없습니다.", true, 403);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const action = formData.get("action");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) {
      return htmlResponse("CSV 파일을 선택해 주세요.", true, 400);
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      return htmlResponse("CSV 파일 크기를 확인해 주세요.", true, 400);
    }

    const rows = recordsFromCsv(await file.text());
    if (action !== "import") {
      return htmlResponse(
        `검증 완료: ${rows.length}건\n오류가 없습니다. 같은 파일을 다시 선택해 실제 가져오기를 실행하세요.`,
      );
    }

    const d1 = await ensureRecordsReady();
    const result = await d1.transaction(async (transaction) => {
      const before = await transaction
        .prepare("SELECT COUNT(*) AS count FROM activities")
        .first<{ count: number | string }>();
      const valueTemplate = `(${Array.from({ length: 29 }, () => "?").join(", ")})`;
      const parameters = rows.flatMap((row) => [
        row.seedKey,
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
        row.consortiumCompany,
        row.awardStage,
        row.progressManager,
        row.followUpRequired,
        row.followUpDate,
        row.nextAction,
        row.progressSchedule,
        row.contactName,
        row.contactPhone,
        row.contactEmail,
        row.sourceChat,
        row.notes,
      ]);
      const inserted = await transaction
        .prepare(`
          INSERT INTO activities (
            seed_key, activity_date, date_confidence, activity_type, category,
            contact_method, region, organization, budget_type, budget_amount,
            topic, summary, status, temperature, award_status, award_company,
            execution_type, consortium_company, award_stage, progress_manager,
            follow_up_required, follow_up_date, next_action, progress_schedule,
            contact_name, contact_phone, contact_email, source_chat, notes
          ) VALUES ${rows.map(() => valueTemplate).join(", ")}
          ON CONFLICT (seed_key) DO NOTHING
          RETURNING id, seed_key
        `)
        .bind(...parameters)
        .all<{ id: number; seed_key: string }>();

      if (inserted.results.length) {
        const importedKeys = new Set(
          inserted.results.map((record) => record.seed_key),
        );
        const authors = rows.filter((row) => importedKeys.has(row.seedKey));
        const authorTemplate = "(?, ?)";
        await transaction
          .prepare(`
            INSERT INTO activity_authors (
              activity_id, member_id, created_by_name, created_at
            )
            SELECT activities.id, NULL, imported.created_by_name, CURRENT_TIMESTAMP
            FROM (
              VALUES ${authors.map(() => authorTemplate).join(", ")}
            ) AS imported(seed_key, created_by_name)
            JOIN activities ON activities.seed_key = imported.seed_key
            ON CONFLICT (activity_id) DO NOTHING
          `)
          .bind(
            ...authors.flatMap((row) => [row.seedKey, row.createdByName]),
          )
          .run();
      }

      const after = await transaction
        .prepare("SELECT COUNT(*) AS count FROM activities")
        .first<{ count: number | string }>();
      return {
        before: Number(before?.count ?? 0),
        after: Number(after?.count ?? 0),
        inserted: inserted.results.length,
      };
    });

    console.info("Legacy activity CSV import completed", {
      memberId: member.id,
      fileHash: createHash("sha256")
        .update(Buffer.from(await file.arrayBuffer()))
        .digest("hex")
        .slice(0, 16),
      total: rows.length,
      inserted: result.inserted,
      skipped: rows.length - result.inserted,
    });
    return htmlResponse(
      [
        "가져오기 완료",
        `CSV 기록: ${rows.length}건`,
        `새로 저장: ${result.inserted}건`,
        `중복으로 건너뜀: ${rows.length - result.inserted}건`,
        `DB 전체 건수: ${result.before}건 → ${result.after}건`,
      ].join("\n"),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "가져오기를 완료하지 못했습니다.";
    console.error("Legacy activity CSV import failed", {
      message: message.slice(0, 500),
    });
    return htmlResponse(message, true, 400);
  }
}
