import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  filterManagerInspectionRows,
  managerInspectionCounts,
} from "../lib/manager-inspection.ts";

function row(name, overrides = {}) {
  return {
    name,
    effectiveContactName: "",
    overdue: false,
    stalled: false,
    ownerless: false,
    missingInfo: false,
    issues: ["점검 필요"],
    latest: {
      progressManager: "",
      contactName: "",
      region: "경기",
      topic: "",
      nextAction: "",
    },
    ...overrides,
  };
}

test("관리자 점검 검색과 상태 필터는 표와 요약 숫자에 같은 결과를 사용한다", () => {
  const active = [
    row("알파초", {
      effectiveContactName: "김담당",
      overdue: true,
      missingInfo: true,
      issues: ["재연락 기한 경과", "기관 담당자 미입력"],
    }),
    row("베타초", {
      stalled: true,
      ownerless: true,
      issues: ["14일간 활동 없음", "진행 담당자 미지정"],
    }),
  ];
  const processed = [
    row("알파유치원", {
      missingInfo: true,
      issues: ["기관 담당자 미입력"],
    }),
  ];

  const counts = managerInspectionCounts(active, processed, "알파");

  assert.equal(counts.attention, 1);
  assert.equal(counts.overdue, 1);
  assert.equal(counts.stalled, 0);
  assert.equal(counts.ownerless, 0);
  assert.equal(counts.missing, 1);
  assert.equal(counts.processed, 1);
  assert.equal(counts.all, 1);
  assert.equal(
    filterManagerInspectionRows(active, processed, "attention", "알파").length,
    counts.attention,
  );
  assert.equal(
    filterManagerInspectionRows(active, processed, "processed", "알파").length,
    counts.processed,
  );
});

test("이전 기록에서 가져온 담당자 이름도 관리자 검색에 포함한다", () => {
  const active = [
    row("감마초", {
      effectiveContactName: "이전담당자",
      issues: ["재연락 기한 경과"],
    }),
  ];

  assert.deepEqual(
    filterManagerInspectionRows(active, [], "attention", "이전담당자").map(
      (item) => item.name,
    ),
    ["감마초"],
  );
});

test("관리자 점검 UI는 기관 한 행에 최근 기록과 연락처 출처를 펼쳐 표시한다", async () => {
  const crm = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(crm, /const map = new Map<string, Activity\[\]>\(\)/);
  assert.match(crm, /institutionAliasKey\(record\.organization\)/);
  assert.match(
    crm,
    /const recentRecords = newestFirst\.slice\(0, 10\)/,
  );
  assert.match(crm, /className="manager-record-history"/);
  assert.match(crm, /이전 기록에서 가져옴/);
  assert.match(crm, /진행 담당자\{" "\}/);
  assert.match(crm, /다음 행동 미지정/);
  assert.match(crm, /재연락 날짜 미지정/);
  assert.match(
    crm,
    /managerOrganizations\.length > 0[\s\S]*<em>\{managerOrganizations\.length\}<\/em>/,
  );
  assert.match(crm, /value: managerCounts\.attention/);
  assert.match(crm, /미처리 전체 \{managerCounts\.all\}곳/);
  assert.match(crm, /처리한 알림 \{managerCounts\.processed\}곳/);
});

test("처리 완료 알림 정리는 원본을 삭제하지 않고 숨김 시각으로 목록에서 제외한다", async () => {
  const [crm, managerAlerts, managerAlertRoute, backupStore, migration] =
    await Promise.all([
      readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../lib/manager-alerts.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/manager-alerts/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../lib/backup-store.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../drizzle/0053_manager_alert_archiving.sql", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(crm, /!acknowledgement\?\.hiddenAt/);
  assert.match(crm, /선택 기록 숨김/);
  assert.match(crm, /30일 지난 알림 정리/);
  assert.match(crm, /원본 영업 기록과 알림 처리 이력은 삭제되지 않습니다/);
  assert.match(managerAlerts, /SET hidden_at = CURRENT_TIMESTAMP/);
  assert.match(managerAlerts, /hidden_at = NULL/);
  assert.match(managerAlerts, /updated_at <= datetime\('now', \?\)/);
  assert.match(managerAlertRoute, /export async function PATCH/);
  assert.match(managerAlertRoute, /olderThanDays !== 30/);
  assert.match(backupStore, /"hidden_at"/);
  assert.match(
    migration,
    /ALTER TABLE `manager_alert_acknowledgements` ADD `hidden_at` text/,
  );
});

test("기관 연락처 fallback은 기관과 사업 차수를 함께 키로 사용한다", async () => {
  const crm = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(crm, /activityReviewInstitutionStateByBusiness/);
  assert.match(
    crm,
    /analyticsBusinessRoundKey\(record\.organization, record\.businessRound\)/,
  );
  assert.match(crm, /resolveInstitutionContactSet\(\s*latest,\s*newestFirst/);
  assert.match(
    crm,
    /record\.businessRound === form\.businessRound/,
  );
  assert.match(
    crm,
    /contactRole: "",\s*contactName: "",\s*contactPhone: "",\s*contactEmail: ""/,
  );
});
