import { ensureRecordsReady } from "./records-store";

const REPAIR_KEY = "business-round-rollover-2026-08-13-v2";

type RepairRow = {
  id: number;
  activityDate: string;
  activityType: string;
  category: string;
  contactMethod: string;
  organization: string;
  businessRound: number;
  topic: string;
  summary: string;
  rawInput: string;
  notes: string;
  status: string;
  awardStatus: string;
  awardCompany: string;
  awardStage: string;
  awardCompletedDate: string;
  executionType: string;
  consortiumCompany: string;
  sourceChat: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessRoundRepairCandidate = RepairRow & {
  originalBusinessRound: number;
  targetBusinessRound: number;
  completionDate: string;
};

const NEW_OPPORTUNITY_SIGNAL =
  /문의|방문|영업|미팅|상담|예산|견적|제안|시연|신규\s*(?:접촉|사업)|재영업/;
const AFTERCARE_ONLY =
  /설치|시공|납품|검수|교육|하자|A\/?S|청소|철거|공사\s*진행|사후\s*관리/;
const EXCLUDED_SYSTEM_SOURCE =
  /캠페인|선정기관|수주\s*등록|공동사업|데이터\s*(?:이전|복원)/;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedInstitution(value: unknown) {
  return clean(value).replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function completed(value: unknown) {
  return ["납품 완료", "완공"].includes(clean(value));
}

function recordDate(row: RepairRow) {
  return clean(row.activityDate) || clean(row.createdAt).slice(0, 10);
}

function isNewOpportunity(row: RepairRow) {
  if (EXCLUDED_SYSTEM_SOURCE.test(clean(row.sourceChat))) return false;
  const text = [
    row.activityType,
    row.category,
    row.contactMethod,
    row.topic,
    row.summary,
    row.rawInput,
    row.notes,
    row.status,
  ]
    .map(clean)
    .join(" ");
  if (!NEW_OPPORTUNITY_SIGNAL.test(text)) return false;
  if (
    AFTERCARE_ONLY.test(text) &&
    !/문의|방문|영업|미팅|상담|예산|견적|제안|시연|재영업/.test(text)
  ) {
    return false;
  }
  return true;
}

function completionMarker(rows: RepairRow[]) {
  const completedRows = rows
    .filter((row) => completed(row.awardStage))
    .sort((left, right) => {
      const dateOrder = recordDate(left).localeCompare(recordDate(right));
      return dateOrder || left.id - right.id;
    });
  if (!completedRows.length) return null;
  const explicitDate = rows
    .map((row) => clean(row.awardCompletedDate))
    .filter(Boolean)
    .sort()[0];
  const marker = completedRows[0];
  return {
    id: marker.id,
    date: explicitDate || recordDate(marker),
  };
}

function happenedAfterCompletion(
  row: RepairRow,
  marker: { id: number; date: string },
) {
  const date = recordDate(row);
  return date > marker.date || (date === marker.date && row.id > marker.id);
}

async function listRepairRows() {
  const d1 = await ensureRecordsReady();
  const rows = await d1
    .prepare(
      `SELECT id,
              activity_date AS "activityDate",
              activity_type AS "activityType",
              category,
              contact_method AS "contactMethod",
              organization,
              business_round AS "businessRound",
              topic, summary,
              raw_input AS "rawInput",
              notes, status,
              award_status AS "awardStatus",
              award_company AS "awardCompany",
              award_stage AS "awardStage",
              award_completed_date AS "awardCompletedDate",
              execution_type AS "executionType",
              consortium_company AS "consortiumCompany",
              source_chat AS "sourceChat",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM activities
        ORDER BY organization, business_round, activity_date, id`,
    )
    .all<RepairRow>();
  return rows.results ?? [];
}

export async function previewBusinessRoundRolloverRepair() {
  const rows = await listRepairRows();
  const byInstitution = new Map<string, RepairRow[]>();
  for (const row of rows) {
    const key = normalizedInstitution(row.organization);
    if (!key) continue;
    const current = byInstitution.get(key) ?? [];
    current.push(row);
    byInstitution.set(key, current);
  }

  const candidates = new Map<number, BusinessRoundRepairCandidate>();
  for (const institutionRows of byInstitution.values()) {
    const byRound = new Map<number, RepairRow[]>();
    for (const row of institutionRows) {
      const round = Math.max(1, Number(row.businessRound) || 1);
      const current = byRound.get(round) ?? [];
      current.push(row);
      byRound.set(round, current);
    }
    const completedRounds = [...byRound.entries()]
      .filter(([, roundRows]) => roundRows.some((row) => completed(row.awardStage)))
      .map(([round]) => round)
      .sort((left, right) => left - right);

    for (const originalBusinessRound of completedRounds) {
      const originalRows = byRound.get(originalBusinessRound) ?? [];
      const marker = completionMarker(originalRows);
      if (!marker) continue;
      const activeNextRound = [...byRound.entries()]
        .filter(
          ([round, roundRows]) =>
            round > originalBusinessRound &&
            !roundRows.some((row) => completed(row.awardStage)),
        )
        .map(([round]) => round)
        .sort((left, right) => left - right)[0];
      const targetBusinessRound =
        activeNextRound ?? Math.min(99, originalBusinessRound + 1);

      for (const row of originalRows) {
        if (!happenedAfterCompletion(row, marker) || !isNewOpportunity(row)) {
          continue;
        }
        candidates.set(row.id, {
          ...row,
          originalBusinessRound,
          targetBusinessRound,
          completionDate: marker.date,
        });
      }
    }
  }

  return {
    repairKey: REPAIR_KEY,
    candidates: [...candidates.values()].sort((left, right) => left.id - right.id),
  };
}

export async function applyBusinessRoundRolloverRepair() {
  const preview = await previewBusinessRoundRolloverRepair();
  if (!preview.candidates.length) return { ...preview, applied: 0 };
  const d1 = await ensureRecordsReady();
  await d1
    .prepare(
      `CREATE TABLE IF NOT EXISTS business_round_rollover_repair_backups (
         repair_key TEXT NOT NULL,
         activity_id BIGINT NOT NULL,
         organization TEXT NOT NULL,
         original_business_round INTEGER NOT NULL,
         target_business_round INTEGER NOT NULL,
         snapshot_json JSONB NOT NULL,
         repaired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (repair_key, activity_id)
       )`,
    )
    .run();

  let applied = 0;
  await d1.transaction(async (transaction) => {
    for (const candidate of preview.candidates) {
      await transaction
        .prepare(
          `INSERT INTO business_round_rollover_repair_backups
             (repair_key, activity_id, organization, original_business_round,
              target_business_round, snapshot_json)
           VALUES (?, ?, ?, ?, ?, ?::jsonb)
           ON CONFLICT (repair_key, activity_id) DO NOTHING`,
        )
        .bind(
          REPAIR_KEY,
          candidate.id,
          candidate.organization,
          candidate.originalBusinessRound,
          candidate.targetBusinessRound,
          JSON.stringify(candidate),
        )
        .run();
      const result = await transaction
        .prepare(
          `UPDATE activities
              SET business_round = ?,
                  award_status = '미정', award_company = '', award_stage = '미정',
                  award_stage_manual = 0, award_completed_date = '',
                  execution_type = '직영', consortium_company = '',
                  status = '상담 진행', status_manual = 0,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND business_round = ?`,
        )
        .bind(
          candidate.targetBusinessRound,
          candidate.id,
          candidate.originalBusinessRound,
        )
        .run();
      applied += Number(result.meta?.changes ?? 0);
    }
  });
  return { ...preview, applied };
}
