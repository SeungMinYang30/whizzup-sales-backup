import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  buildCampaignInstitutionBasicsBackfillStatements,
  buildCampaignTargetLegacyAssigneeRepairStatement,
  buildCampaignTargetLegacyLinkRepairStatements,
  buildCampaignTargetLinkedActivitySyncStatement,
} from "../lib/campaign-institution-basics.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

function applyMigration(database, sql) {
  sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => database.exec(statement));
}

test("예산별 기관 목록의 공통 정보 보완 쿼리는 D1에서 실행되고 같은 사업 차수를 우선한다", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      activity_date TEXT NOT NULL,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL DEFAULT 1,
      seed_key TEXT NOT NULL DEFAULT '',
      progress_manager TEXT NOT NULL DEFAULT '',
      contact_role TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT ''
    );

    INSERT INTO activities (
      id, activity_date, organization, business_round, progress_manager,
      contact_role, contact_name, contact_phone, contact_email
    ) VALUES
      (1, '2026-07-01', '동일차수학교', 1, '이전 담당자',
       '교사', '이전 연락처', '010-1000-1000', 'old@example.com'),
      (2, '2026-07-02', '동일차수학교', 2, '현재 담당자',
       '부장', '현재 연락처', '010-2000-2000', 'current@example.com'),
      (4, '2026-07-04', '다른차수학교', 1, '1차 담당자',
       '교사', '1차 연락처', '010-3000-3000', 'first@example.com');

    INSERT INTO activities (
      id, activity_date, organization, business_round, seed_key
    ) VALUES
      (3, '2026-07-03', '동일차수학교', 2, 'campaign:1:3'),
      (5, '2026-07-05', '다른차수학교', 2, 'campaign:1:5');
  `);

  for (const statement of buildCampaignInstitutionBasicsBackfillStatements()) {
    database.exec(statement);
  }

  const sameRound = database
    .prepare(`
      SELECT progress_manager, contact_role, contact_name,
             contact_phone, contact_email
      FROM activities WHERE id = 3
    `)
    .get();
  assert.deepEqual({ ...sameRound }, {
    progress_manager: "",
    contact_role: "부장",
    contact_name: "현재 연락처",
    contact_phone: "010-2000-2000",
    contact_email: "current@example.com",
  });

  const fallback = database
    .prepare(`
      SELECT progress_manager, contact_role, contact_name,
             contact_phone, contact_email
      FROM activities WHERE id = 5
    `)
    .get();
  assert.deepEqual({ ...fallback }, {
    progress_manager: "",
    contact_role: "교사",
    contact_name: "1차 연락처",
    contact_phone: "010-3000-3000",
    contact_email: "first@example.com",
  });

  database.close();
});

test("기존 사업 연결 명단은 연결한 활동의 정확한 기관명과 사업 차수로 소급 정렬한다", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE sales_campaign_targets (
      id INTEGER PRIMARY KEY,
      organization TEXT NOT NULL,
      activity_id INTEGER,
      business_round INTEGER NOT NULL DEFAULT 1,
      created_activity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO activities (id, organization, business_round) VALUES
      (11, '함양 항노화 건강 문화활력센터', 2),
      (12, '함양군청-행복안의봄날센터', 3);
    INSERT INTO sales_campaign_targets (
      id, organization, activity_id, business_round, created_activity
    ) VALUES
      (1, '항노화 건강 문화활력센터', 11, 1, 0),
      (2, '행복안의봄날센터', 12, 1, 0),
      (3, '캠페인에서 새로 만든 기관', 11, 1, 1);
  `);

  database.exec(buildCampaignTargetLinkedActivitySyncStatement());

  const linkedTargets = database
    .prepare(`
      SELECT id, organization, business_round
      FROM sales_campaign_targets
      ORDER BY id
    `)
    .all();
  assert.deepEqual(
    linkedTargets.map((row) => ({ ...row })),
    [
      {
        id: 1,
        organization: "함양 항노화 건강 문화활력센터",
        business_round: 2,
      },
      {
        id: 2,
        organization: "함양군청-행복안의봄날센터",
        business_round: 3,
      },
      {
        id: 3,
        organization: "캠페인에서 새로 만든 기관",
        business_round: 1,
      },
    ],
  );
  database.close();
});

test("과거 함양 명단 두 건은 원본 수주를 보존하고 명단 연결만 기존 사업으로 복구한다", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE sales_campaigns (
      id INTEGER PRIMARY KEY,
      selection_date TEXT NOT NULL
    );
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL DEFAULT 1,
      activity_date TEXT NOT NULL,
      award_status TEXT NOT NULL DEFAULT '미정'
    );
    CREATE TABLE sales_campaign_targets (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      organization TEXT NOT NULL,
      activity_id INTEGER,
      assigned_member_id INTEGER,
      business_round INTEGER NOT NULL DEFAULT 1,
      created_activity INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE members (
      id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      is_sales INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO sales_campaigns (id, selection_date)
    VALUES (1, '2026.07.23');
    INSERT INTO members (id, display_name, status, is_sales)
    VALUES (3, '양승민 이사', 'approved', 1);
    INSERT INTO activities (
      id, organization, business_round, activity_date, award_status
    ) VALUES
      (21, '항노화 건강 문화활력센터', 1, '2026-07-23', '미정'),
      (22, '함양 항노화 건강 문화활력센터', 1, '2026-07-22', '위즈업 수주'),
      (23, '행복안의봄날센터', 1, '2026-07-23', '미정'),
      (24, '함양군청-행복안의봄날센터', 1, '2026-07-22', '위즈업 수주');
    INSERT INTO sales_campaign_targets (
      id, campaign_id, organization, activity_id, business_round,
      created_activity
    ) VALUES
      (1, 1, ' 항노화 건강 문화활력센터 ', 21, 1, 1),
      (2, 1, '행복안의봄날센터 ', 23, 1, 1);
  `);

  for (const statement of buildCampaignTargetLegacyLinkRepairStatements()) {
    database.exec(statement);
  }
  database.exec(buildCampaignTargetLegacyAssigneeRepairStatement());

  const repaired = database
    .prepare(`
      SELECT id, organization, activity_id, business_round, created_activity,
             assigned_member_id
      FROM sales_campaign_targets
      ORDER BY id
    `)
    .all();
  assert.deepEqual(
    repaired.map((row) => ({ ...row })),
    [
      {
        id: 1,
        organization: "함양 항노화 건강 문화활력센터",
        activity_id: 22,
        business_round: 1,
        created_activity: 0,
        assigned_member_id: 3,
      },
      {
        id: 2,
        organization: "함양군청-행복안의봄날센터",
        activity_id: 24,
        business_round: 1,
        created_activity: 0,
        assigned_member_id: 3,
      },
    ],
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM activities").get().count,
    4,
    "기존 영업·수주 활동은 삭제하지 않는다",
  );
  database.close();
});

test("예산별 기관 스키마는 기존 캠페인과 연결 기록을 보존해 확장한다", async () => {
  const [baseMigration, portfolioMigration] = await Promise.all([
    source("../drizzle/0008_sales-campaigns.sql"),
    source("../drizzle/0054_budget_campaign_portfolio.sql"),
  ]);
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      activity_date TEXT NOT NULL,
      budget_type TEXT NOT NULL DEFAULT '',
      business_round INTEGER NOT NULL DEFAULT 1
    );
  `);
  applyMigration(database, baseMigration);
  database.exec(`
    INSERT INTO sales_campaigns (id, name, created_by)
    VALUES (1, '기존 명단', 1);
    INSERT INTO activities (
      id, activity_date, budget_type, business_round
    ) VALUES (11, '2026-07-23', '가상현실스포츠실', 2);
    INSERT INTO sales_campaign_targets (
      campaign_id, organization, activity_id
    ) VALUES (1, '기존 학교', 11);
  `);

  applyMigration(database, portfolioMigration);

  const campaign = database
    .prepare(
      `SELECT name, budget_type, selection_date
       FROM sales_campaigns WHERE id = 1`,
    )
    .get();
  const target = database
    .prepare(
      `SELECT organization, business_round, created_activity
       FROM sales_campaign_targets WHERE campaign_id = 1`,
    )
    .get();
  assert.deepEqual({ ...campaign }, {
    name: "기존 명단",
    budget_type: "가상현실스포츠실",
    selection_date: "2026-07-23",
  });
  assert.deepEqual({ ...target }, {
    organization: "기존 학교",
    business_round: 2,
    created_activity: 1,
  });
  database.close();
});

test("명단 등록은 같은 연도 위즈업 사업을 단계와 관계없이 정확한 차수로 연결한다", async () => {
  const route = await source("../app/api/map/campaigns/route.ts");

  assert.match(route, /const sameYearRows = existingRows\.filter/);
  assert.match(route, /WHERE organization IN \(\$\{placeholders\}\)/);
  assert.match(
    route,
    /!\["협력사 수주", "타업체 수주"\]\.includes\(clean\(row\.award_status\)\)/,
  );
  assert.match(route, /const linkableBusinessRows = sameYearOwnCompanyRows\.filter/);
  assert.match(route, /target\.businessMatchMode === "link-current"/);
  assert.match(
    route,
    /Number\(row\.id\) === target\.linkedActivityId/,
  );
  assert.match(route, /correctBudget = false/);
  assert.match(route, /upsertCampaignBudget/);
  assert.match(route, /synchronizeBusinessRoundBudgets/);
  assert.match(route, /같은 예산의 기존 사업이 여러 건입니다/);
  assert.match(route, /target\.businessMatchMode !== "new"/);
  assert.match(route, /activityId: linked \? Number\(linked\.id\) : null/);
  assert.match(
    route,
    /createdActivity:[\s\S]*target\.businessMatchMode !== "list-only" && !linked/,
  );
});

test("예산별 기관 명단 집계는 PostgreSQL에서도 표준 예산명과 작성자를 안전하게 묶는다", async () => {
  const route = await source("../app/api/map/campaigns/route.ts");

  assert.match(
    route,
    /GROUP BY c\.id, g\.canonical_name, m\.display_name/,
  );
});

test("잘못 입력된 예산명은 원본을 보존해 같은 사업의 활동과 품목에 함께 반영한다", async () => {
  const route = await source("../app/api/map/campaigns/route.ts");

  assert.match(route, /budget_original_name = CASE/);
  assert.match(
    route,
    /WHERE organization = \? AND business_round = \?[\s\S]*award_status NOT IN \('협력사 수주', '타업체 수주'\)/,
  );
  assert.match(route, /UPDATE equipment_projects/);
  assert.match(route, /campaign_review/);
  assert.match(route, /budget_name_members/);
  assert.match(route, /budget_name_request_records/);
  assert.match(route, /runStatementsInChunks\(d1, correctionStatements\)/);
});

test("명단 삭제는 새로 만든 빈 기록만 제거하고 기존 사업과 후속 데이터는 보존한다", async () => {
  const route = await source("../app/api/map/campaigns/route.ts");

  assert.match(route, /WHERE campaign_id = \? AND created_activity = 1/);
  assert.match(route, /has_equipment/);
  assert.match(route, /has_settlement/);
  assert.match(route, /has_commission/);
  assert.match(route, /has_receipt/);
  assert.match(route, /후속 품목·회계 기록이 연결된/);
  assert.match(route, /기존 사업에 연결한 기록은 유지됩니다/);
});

test("예산별 기관 화면은 지도와 같은 등록창을 쓰고 모바일 전용 목록을 제공한다", async () => {
  const [crm, map, styles] = await Promise.all([
    source("../app/crm-app.tsx"),
    source("../app/sales-map.tsx"),
    source("../app/globals.css"),
  ]);

  assert.match(crm, /id: "budget-institutions", label: "예산별 기관"/);
  assert.match(crm, /displayMode=\{\s*view === "budget-institutions" \? "budget" : "map"/);
  assert.match(map, /예산·공고별 기관 명단/);
  assert.match(map, /campaignPdfRef\.current\?\.click\(\)/);
  assert.match(map, /campaignFileRef\.current\?\.click\(\)/);
  assert.match(map, /onClick=\{beginBudgetCardCreate\}/);
  assert.match(map, /예산카드 직접 등록/);
  assert.match(map, /예산카드 수정/);
  assert.match(map, /기관 직접 등록/);
  assert.match(map, /\+ 기관 한 곳 추가/);
  assert.match(map, /campaignLatestRecord/);
  assert.match(map, /단계와 관계없이 선택 가능/);
  assert.match(map, /campaignBusinessStageLabel/);
  assert.match(map, /기존 예산은 유지하고 이번 카드 예산을 같은 사업 차수에 함께 추가합니다/);
  assert.match(map, /신규 사업으로 등록 · 새 사업 차수 생성/);
  assert.match(map, /연결 가능한 동일 연도 기존 사업 없음/);
  assert.match(map, /campaign-institution-suggestions/);
  assert.match(map, /key=\{rowId\}/);
  assert.match(map, /memo\(function CampaignImportRowEditor/);
  assert.match(map, /campaignLatestRecordByOrganization = useMemo/);
  assert.match(map, /campaignLinkableRecordsByOrganizationYear = useMemo/);
  assert.match(map, /EMPTY_CAMPAIGN_RECORDS/);
  assert.match(styles, /\.campaign-import-dialog \{[\s\S]*width: min\(1680px, 100%\)/);
  assert.match(styles, /\.campaign-pdf-preview-row > input[\s\S]*font-size: 12px/);
  assert.match(map, /campaignDateFromText/);
  assert.match(map, /budget-institution-mobile-list/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*budget-institution-mobile-list/);
});

test("수기 등록은 PDF·엑셀과 같은 저장 경로와 기존 기관 확인을 사용한다", async () => {
  const [map, route] = await Promise.all([
    source("../app/sales-map.tsx"),
    source("../app/api/map/campaigns/route.ts"),
  ]);

  assert.match(map, /source: "excel" \| "pdf" \| "manual"/);
  assert.match(map, /function emptyCampaignImportRow/);
  assert.match(map, /function beginManualCampaignImport/);
  assert.match(map, /function addManualCampaignRow/);
  assert.match(map, /clientId: row\.clientId \|\| createCampaignRowId\(\)/);
  assert.match(map, /useDeferredValue\(\s*campaignInstitutionSearch/);
  assert.match(map, /campaignInstitutionOptions[\s\S]*\.slice\(0, 10\)/);
  assert.match(
    map,
    /fetchWithInstitutionConfirmation\("\/api\/map\/campaigns"/,
  );
  assert.match(route, /requestedImportSource === "manual"/);
  assert.match(route, /예산별 기관 직접 등록/);
  assert.match(route, /target\.businessMatchMode === "list-only"/);
  assert.match(
    route,
    /target\.businessMatchMode !== "list-only" && !linked/,
  );
  assert.doesNotMatch(map, /기관만 명단에 등록 · 기존 상태 유지/);
});

test("기존 전체 기관은 상태 필터 없이 검색·복수 선택해 예산 명단에 연결한다", async () => {
  const [map, route, styles] = await Promise.all([
    source("../app/sales-map.tsx"),
    source("../app/api/map/campaigns/route.ts"),
    source("../app/globals.css"),
  ]);

  assert.match(map, /기존 기관 추가/);
  assert.match(map, /기관명·지역·예산명·담당자·전화번호 검색/);
  assert.match(map, /검색 결과 전체 선택/);
  assert.match(map, /CAMPAIGN_EXISTING_PAGE_SIZE = 50/);
  assert.match(map, /method: "PATCH"/);
  assert.doesNotMatch(map, /campaignExistingStatus/);
  assert.match(route, /export async function PATCH\(request: Request\)/);
  assert.match(route, /activityIds/);
  assert.match(route, /institutionAliasKey\(organization\)/);
  assert.match(route, /INSERT OR IGNORE INTO sales_campaign_targets/);
  assert.match(route, /business_round, created_activity[\s\S]*\?, 0\)/);
  assert.match(styles, /\.campaign-existing-dialog/);
  assert.match(styles, /\.budget-institution-table td[\s\S]*font-size: 12px/);
});

test("예산 명단은 기관 최신 기록의 진행 담당자와 수주 후 상태를 함께 표시한다", async () => {
  const [map, route] = await Promise.all([
    source("../app/sales-map.tsx"),
    source("../app/api/map/campaigns/route.ts"),
  ]);

  assert.match(map, /<span>수주 후 진행<\/span>/);
  assert.match(map, /budgetPostAwardInProgressCount/);
  assert.match(
    route,
    /LEFT JOIN activities institution_activity[\s\S]*WHERE a\.organization = t\.organization[\s\S]*ORDER BY a\.activity_date DESC, a\.id DESC/,
  );
  assert.match(
    route,
    /WHERE a\.organization = t\.organization\s+AND a\.business_round = t\.business_round/,
  );
  assert.match(
    route,
    /UPDATE sales_campaign_targets[\s\S]*SET assigned_member_id = \([\s\S]*member\.status = 'approved'[\s\S]*previous\.business_round =\s+sales_campaign_targets\.business_round/,
  );
  assert.match(
    route,
    /LEFT JOIN activities manager_activity[\s\S]*a\.progress_manager <> '해당 없음'/,
  );
  assert.match(
    route,
    /WHERE organization = \? AND business_round = \?[\s\S]*transferActivityAssignment/,
  );
});

test("새 사업 차수는 기관 공통 연락처만 이어받고 진행 담당자는 미지정으로 시작한다", async () => {
  const [route, institutionBasics] = await Promise.all([
    source("../app/api/map/campaigns/route.ts"),
    source("../lib/campaign-institution-basics.ts"),
  ]);

  assert.match(route, /backfillCampaignInstitutionBasics/);
  assert.match(institutionBasics, /WHERE seed_key LIKE 'campaign:%'/);
  assert.match(institutionBasics, /previous\.id <> activities\.id/);
  assert.match(
    institutionBasics,
    /previous\.\$\{field\.name\} <> '해당 없음'/,
  );
  assert.match(route, /const latestInstitutionActivity = existingRows\[0\]/);
  assert.match(route, /const inheritedProgressManager = linkedProgressManager/);
  assert.match(
    route,
    /contactName:[\s\S]*latestInstitutionActivity\?\.contact_name/,
  );
  assert.match(
    route,
    /phone:[\s\S]*latestInstitutionActivity\?\.contact_phone/,
  );
  assert.match(route, /contactRole: plan\.inheritedContactRole/);
  assert.match(route, /contactEmail: plan\.inheritedContactEmail/);
  assert.match(route, /progressManager: plan\.progressManager/);
  assert.doesNotMatch(
    route,
    /linkedProgressManager \|\| \(createdActivity \? latestProgressManager/,
  );
  assert.match(route, /status: "재접촉 필요"/);
  assert.match(route, /awardStatus: "미정"/);
  assert.match(route, /nextAction: "담당자 배정 및 첫 컨택"/);
});

test("표준 예산의 기본 금액은 명단과 새 기관 기록의 빈 예산에 적용된다", async () => {
  const route = await source("../app/api/map/campaigns/route.ts");
  assert.match(
    route,
    /effectiveDefaultBudgetAmount\s*=\s*defaultBudgetAmount \?\? parseMoney\(budgetMetadata\.budgetAmount\)/,
  );
  assert.match(
    route,
    /plan\.target\.budgetAmount \?\? effectiveDefaultBudgetAmount/,
  );
});

test("실제 선정기관 양식의 시설명·행정구역·분류 열을 자동 인식한다", async () => {
  const parser = await source("../app/campaign-xlsx.ts");

  assert.match(parser, /"시설명"/);
  assert.match(parser, /"광역자치단체"/);
  assert.match(parser, /"기초자치단체"/);
  assert.match(parser, /"분류"/);
  assert.match(parser, /previousProvince/);
  assert.match(parser, /previousMunicipality/);
  assert.match(
    parser,
    /for \(let index = 0; index < rows\[headerRow\]\.length; index \+= 1\)/,
  );
  assert.doesNotMatch(
    parser,
    /new Map\(\s*rows\[headerRow\]\.map/,
    "B열부터 시작하는 실제 명단처럼 헤더 앞에 빈 셀이 있어도 Map 생성이 깨지면 안 됩니다.",
  );
});

test("대량 명단은 조회와 후속 저장을 묶고 중단된 등록은 다음 시도에서 안전하게 복구한다", async () => {
  const [route, store, confirmation] = await Promise.all([
    source("../app/api/map/campaigns/route.ts"),
    source("../lib/campaign-store.ts"),
    source("../app/institution-confirmation.ts"),
  ]);

  assert.match(route, /WHERE organization IN \(\$\{placeholders\}\)/);
  assert.match(route, /chunks\(createdPlans, 15\)/);
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /skipOfficialSchoolLookup: true/);
  assert.match(route, /skipInstitutionStateLookup: true/);
  assert.match(route, /skipRelatedWrites: true/);
  assert.match(route, /campaign:\$\{campaignId\}:append:/);
  assert.match(route, /destinationCampaignId/);
  assert.match(route, /skippedExistingCount/);
  assert.match(route, /import_status[\s\S]*'processing'/);
  assert.match(route, /removeIncompleteCampaign/);
  assert.match(route, /SET import_status = 'complete'/);
  assert.match(store, /expected_target_count/);
  assert.match(confirmation, /const responseText = await response\.text\(\)/);
  assert.match(confirmation, /기관 등록 처리 시간이 길어졌습니다/);
});

test("기존 사업을 선택하면 정확한 기관명과 해당 사업 담당자를 명단 연결에 사용한다", async () => {
  const [map, route, institutionBasics] = await Promise.all([
    source("../app/sales-map.tsx"),
    source("../app/api/map/campaigns/route.ts"),
    source("../lib/campaign-institution-basics.ts"),
  ]);

  assert.match(
    map,
    /linkedOrganization = linkableRecords\.find\([\s\S]*\)\?\.organization/,
  );
  assert.match(
    map,
    /confirmedOrganization,[\s\S]*existingOrganizations:/,
  );
  assert.match(route, /const requestedLinkedActivities = new Map/);
  assert.match(
    route,
    /clean\(requestedLinkedActivity\?\.organization\)\.slice\(0, 120\)/,
  );
  assert.match(route, /const linkedProgressManager = linked/);
  assert.match(route, /const inheritedProgressManager =/);
  assert.match(route, /activityBudgetsFromRecord/);
  assert.match(route, /budgets_json/);
  assert.match(
    institutionBasics,
    /WHERE created_activity = 0[\s\S]*activity_id IS NOT NULL/,
  );
});

test("예산 명단은 대표관리자가 일괄 배정하고 잘못된 명단 연결만 복구 가능하게 제외한다", async () => {
  const [map, route] = await Promise.all([
    source("../app/sales-map.tsx"),
    source("../app/api/map/campaigns/route.ts"),
  ]);

  assert.match(map, /현재 검색 결과 전체 선택/);
  assert.match(map, /담당자 미지정만 선택/);
  assert.match(map, /담당자 일괄 변경/);
  assert.match(map, /<option value="unassigned">미지정<\/option>/);
  assert.match(map, /budgetBulkAssigneeId === "unassigned"[\s\S]*\? null/);
  assert.match(map, /잘못 등록된 기관 제외/);
  assert.match(map, /기관 자체와 지도·영업·수주 기록은 삭제되지 않습니다/);
  assert.doesNotMatch(map, /선택 예산 변경/);
  assert.doesNotMatch(map, /다른 표준 예산 명단 선택/);
  assert.doesNotMatch(map, /campaignBudgetCatalog/);
  assert.match(route, /const actor = await requirePrimaryOwner\(\)/);
  assert.match(route, /createTrashBatch/);
  assert.match(route, /sales_campaign_targets: selectedTargets/);
  assert.match(route, /명단 연결은 30일 동안 복원할 수 있습니다/);
  assert.match(route, /budgetCatalog: budgetCatalog\.results/);
});

test("같은 기관은 예산별 명단에 각각 연결되고 전체 통계에서는 고유 기관과 참여 건수를 구분한다", async () => {
  const [map, store] = await Promise.all([
    source("../app/sales-map.tsx"),
    source("../lib/campaign-store.ts"),
  ]);
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE sales_campaign_targets (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      organization TEXT NOT NULL
    );
    CREATE UNIQUE INDEX sales_campaign_targets_campaign_org_idx
      ON sales_campaign_targets (campaign_id, organization);
    INSERT INTO sales_campaign_targets (campaign_id, organization) VALUES
      (1, '김포 모담초중학교'),
      (2, '김포 모담초중학교');
  `);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM sales_campaign_targets").get().count,
    2,
  );
  database.close();

  assert.match(store, /campaign_id, organization/);
  assert.match(map, /예산별 기관 전체 통계/);
  assert.match(map, /학교·기관 중복 제외/);
  assert.match(map, /예산 참여/);
  assert.match(map, /복수 예산 기관/);
});

test("PDF·엑셀·직접 등록은 활성 표준 예산 선택만 허용한다", async () => {
  const [map, selector, route] = await Promise.all([
    source("../app/sales-map.tsx"),
    source("../app/budget-name-selector.tsx"),
    source("../app/api/map/campaigns/route.ts"),
  ]);

  assert.match(map, /<BudgetNameSelector[\s\S]*standardOnly/);
  assert.match(selector, /standardOnly = false/);
  assert.match(
    route,
    /Number\(budgetMetadata\.budgetGroupId\) !== requestedBudgetGroupId/,
  );
  assert.match(route, /관리자가 등록한 활성 표준 예산명을 선택해 주세요/);
});
