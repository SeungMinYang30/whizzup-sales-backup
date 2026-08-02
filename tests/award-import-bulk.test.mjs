import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const {
  applyAwardCompanyToSelectedRows,
  classifyAwardCompany,
  mergeAwardImportRows,
  parseActivityImportFile,
  prepareAwardImportValues,
} = await import("../app/activity-xlsx.ts");
const { parseImportedEquipmentItems } = await import(
  "../lib/imported-equipment.ts"
);

const values = (overrides = {}) => ({
  activityDate: "2025-03-01",
  dateConfidence: "연월 확인",
  activityType: "수주",
  category: "학교",
  contactMethod: "기타",
  region: "경기 성남",
  organization: "예시초등학교",
  businessRound: 1,
  budgetType: "스마트 체험교실",
  budgetAmount: "5,000만원",
  topic: "수주",
  summary: "",
  status: "진행 중",
  temperature: "중간",
  awardStatus: "미정",
  awardCompany: "",
  executionType: "직영",
  consortiumCompany: "",
  awardStage: "미정",
  awardCompletedDate: "",
  progressManager: "",
  followUpRequired: false,
  followUpDate: "",
  nextAction: "",
  progressSchedule: "",
  contactRole: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  sourceChat: "수주 관리 엑셀 등록",
  notes: "",
  address: "경기 성남시 예시로 1",
  installedProducts: "전자칠판",
  ...overrides,
});

test("수주업체는 위즈업, 등록 협력사, 타업체로 자동 분류한다", () => {
  assert.equal(classifyAwardCompany("(주)위즈업", []), "ours");
  assert.equal(
    classifyAwardCompany("주식회사 파트너", ["(주)파트너"]),
    "partner",
  );
  assert.equal(classifyAwardCompany("다른 업체", ["파트너"]), "other");
  assert.equal(classifyAwardCompany("", ["파트너"]), "unknown");
});

test("같은 기관, 수주연월, 수주업체 행은 설치물품을 모아 한 건으로 합친다", () => {
  const result = mergeAwardImportRows([
    { rowNumber: 2, values: values(), errors: [], warnings: [] },
    {
      rowNumber: 3,
      values: values({ installedProducts: "가상현실스포츠실" }),
      errors: [],
      warnings: [],
    },
  ]);

  assert.equal(result.mergedCount, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(
    result.rows[0].values.installedProducts,
    "전자칠판, 가상현실스포츠실",
  );
  assert.equal(result.rows[0].values.budgetAmount, "5,000만원");
});

test("같은 기관과 수주연월이어도 사업 차수가 다르면 합치지 않는다", () => {
  const result = mergeAwardImportRows([
    { rowNumber: 2, values: values({ businessRound: 1 }), errors: [], warnings: [] },
    { rowNumber: 3, values: values({ businessRound: 2 }), errors: [], warnings: [] },
  ]);

  assert.equal(result.mergedCount, 0);
  assert.equal(result.rows.length, 2);
});

test("비어 있는 수주 필수값은 저장 시 기본값으로 보완한다", () => {
  const prepared = prepareAwardImportValues(
    values({
      activityDate: "",
      awardCompany: "주식회사 파트너",
      installedProducts: "스마트 체육시스템",
    }),
    { today: "2026-07-22", registeredPartners: ["(주)파트너"] },
  );

  assert.equal(prepared.activityDate, "2026-07-22");
  assert.equal(prepared.activityType, "수주");
  assert.equal(prepared.awardStatus, "협력사 수주");
  assert.equal(prepared.awardCompany, "주식회사 파트너");
  assert.equal(prepared.executionType, "직영");
  assert.equal(prepared.consortiumCompany, "");
  assert.equal(prepared.awardStage, "납품 완료");
  assert.equal(prepared.awardCompletedDate, "2026-07-22");
  assert.match(prepared.summary, /스마트 체육시스템/);
});

test("수주업체 일괄 적용은 선택 행의 빈칸만 채우고 기존 업체를 보존한다", () => {
  const result = applyAwardCompanyToSelectedRows(
    [
      {
        rowNumber: 2,
        values: values(),
        errors: [],
        warnings: ["수주업체가 없어 수주 구분을 미정으로 저장합니다."],
        selected: true,
        duplicate: false,
      },
      {
        rowNumber: 3,
        values: values({ organization: "다른초", awardCompany: "기존업체" }),
        errors: [],
        warnings: [],
        selected: true,
        duplicate: false,
      },
      {
        rowNumber: 4,
        values: values({ organization: "중복초" }),
        errors: [],
        warnings: [],
        selected: true,
        duplicate: true,
      },
    ],
    "에어패스",
    "empty",
  );

  assert.equal(result.changedCount, 1);
  assert.equal(result.rows[0].values.awardCompany, "에어패스");
  assert.equal(result.rows[1].values.awardCompany, "기존업체");
  assert.equal(result.rows[2].values.awardCompany, "");
  assert.equal(result.rows[0].warnings.length, 0);
});

test("수주업체 전체 변경 후 같은 기관·연월·업체 행은 선택 상태를 유지해 합친다", () => {
  const applied = applyAwardCompanyToSelectedRows(
    [
      {
        rowNumber: 2,
        values: values({ awardCompany: "A업체" }),
        errors: [],
        warnings: [],
        selected: true,
        duplicate: false,
      },
      {
        rowNumber: 3,
        values: values({ awardCompany: "B업체", installedProducts: "스마트짐" }),
        errors: [],
        warnings: [],
        selected: true,
        duplicate: false,
      },
    ],
    "에어패스",
    "overwrite",
  );
  const merged = mergeAwardImportRows(applied.rows);

  assert.equal(applied.overwrittenCount, 2);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0].selected, true);
  assert.equal(merged.rows[0].values.installedProducts, "전자칠판, 스마트짐");
});

test("수주 미리보기는 5천 건과 500건 페이지, 전체 선택을 지원한다", async () => {
  const [crm, xlsx] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/activity-xlsx.ts", import.meta.url), "utf8"),
  ]);

  assert.match(crm, /activityImportPageSize = 500/);
  assert.match(crm, /등록 가능한 수주 기록 전체 선택/);
  assert.match(crm, /중복 제외 전체 선택/);
  assert.match(crm, /빈칸에만 적용/);
  assert.match(crm, /선택 행 전체 변경/);
  assert.match(crm, /협력사 관리/);
  assert.match(crm, /이 업체를 협력사로 등록/);
  assert.match(xlsx, /최대 5,000건/);
  const downloadBlock = xlsx.match(
    /export function downloadAwardTemplate\(\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(downloadBlock);
  for (const header of [
    "설치연월일",
    "기관명",
    "사업 차수",
    "주소",
    "설치 장비",
    "수주업체",
  ]) {
    assert.match(downloadBlock[1], new RegExp(header));
    assert.match(xlsx, new RegExp(header));
  }
  assert.doesNotMatch(downloadBlock[1], /"지역"/);
  assert.match(downloadBlock[1], /\[예시—삭제 후 입력\]/);
});

test("지역 없는 설치 완료 엑셀은 주소에서 지역을 만들고 일반 헤더도 읽는다", async () => {
  const csv = [
    "설치일,학교명,차수,도로명주소,설치장비,납품업체",
    "2026-07-22,김포 모담초중학교,2,경기도 김포시 운양로 158,전자칠판 1대; 센서 2개,주식회사 위즈업",
  ].join("\n");
  const [row] = await parseActivityImportFile(
    new File([csv], "완료수주.csv", { type: "text/csv" }),
    { awardMode: true },
  );

  assert.equal(row.values.region, "경기 김포");
  assert.equal(row.values.organization, "김포 모담초중학교");
  assert.equal(row.values.businessRound, 2);
  assert.equal(row.values.installedProducts, "전자칠판 1대; 센서 2개");
  assert.equal(row.values.awardCompany, "주식회사 위즈업");
  assert.equal(row.errors.length, 0);
});

test("설치 장비 수량은 장비 목록 저장 단위로 안전하게 분리한다", () => {
  assert.deepEqual(
    parseImportedEquipmentItems(
      "가상현실스포츠실 1식, 전자칠판 2대\n전자칠판 1대; 센서",
    ),
    [
      { productName: "가상현실스포츠실", quantity: 1, unit: "식" },
      { productName: "전자칠판", quantity: 3, unit: "대" },
      { productName: "센서", quantity: 1, unit: "대" },
    ],
  );
});

test("수주 엑셀은 기존 기관 확인을 건너뛰지 않고 주소와 장비를 후속 데이터에 연결한다", async () => {
  const [crm, route, map] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sales-map.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(crm, /institutionSeparate:\s*creatingAward/);
  assert.match(route, /syncImportedAwardEquipment/);
  assert.match(route, /installedProducts:\s*payload\.installedProducts/);
  assert.match(map, /recordAddressHint/);
  assert.match(map, /geocoder\.addressSearch\(item\.addressHint/);
});

test("수주 정보 일괄변경은 최대 5천 건을 500건씩 순차 처리한다", async () => {
  const crm = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(crm, /const AWARD_BULK_BATCH_SIZE = 500;/);
  assert.match(crm, /const AWARD_BULK_MAX_COUNT = 5_000;/);
  assert.match(crm, /offset \+= AWARD_BULK_BATCH_SIZE/);
  assert.match(crm, /attempt <= 3/);
  assert.match(crm, /awardBulkProgress\.completed/);
});

test("bulk award updates use one bounded SQL statement per ID chunk", async () => {
  const route = await readFile(
    new URL("../app/api/records/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /const RECORD_BULK_UPDATE_CHUNK_SIZE = 40;/);
  assert.match(route, /WHERE id IN \(\$\{placeholders\}\)/);
  assert.match(route, /statements\.push\(prepareBulkUpdate\(chunk\)\)/);
  assert.match(route, /await prepareBulkUpdate\(chunk\)\.run\(\)/);
  assert.doesNotMatch(route, /\.map\(prepareBulkUpdate\)/);
});

test("수주 일괄변경은 한 묶음으로 기록하고 변경 이력에서 안전하게 되돌린다", async () => {
  const crm = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(crm, /const operationId = window\.crypto\.randomUUID\(\);/);
  assert.match(crm, /operationTotal: selectedAwardIds\.length/);
  assert.match(
    crm,
    /\/api\/activity-changes\?scope=all&limit=25&offset=\$\{offset\}/,
  );
  assert.match(crm, /operationScope: "awards"/);
  assert.match(crm, /operationScope: "pre_awards"/);
  assert.match(crm, /canManageActivityHistory/);
  assert.match(crm, /이전 변경 이력 더 보기/);
  assert.match(crm, /setAwardBulkExecutionEnabled\(false\)/);
  assert.match(crm, /JSON\.stringify\(\{ action: "undo", batchId: batch\.id \}\)/);
  assert.match(crm, /변경 후 다시 수정된 항목만 건너뛰고/);
  assert.match(crm, /위즈업 수금·채권·회계 및 위즈업 수주 통계 대상에서 제외/);
});

test("수주관리에서는 같은 기관의 서로 다른 수주 기록을 모두 유지한다", async () => {
  const crm = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    crm,
    /const sourceRecords = view === "awards" \? latestAwardRecords : records/,
  );
  assert.match(
    crm,
    /analyticsBusinessRoundKey\(\s*organization,\s*record\.businessRound/,
  );
  assert.match(crm, /byBusinessRound\.set\(businessKey, record\)/);
});
