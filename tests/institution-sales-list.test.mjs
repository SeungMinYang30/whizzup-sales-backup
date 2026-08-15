import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crm = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("기관별 관리에서 진행·미수주·전체 탭을 표시하지 않는다", () => {
  assert.doesNotMatch(crm, /type InstitutionListMode/);
  assert.doesNotMatch(crm, /institution-mode-tabs/);
  assert.doesNotMatch(crm, /label: "진행 기관"/);
  assert.doesNotMatch(crm, /label: "미수주 기관"/);
});

test("기관별 관리는 수주 후와 동일한 사업 차수를 수주 전에서 제외한다", () => {
  assert.match(
    crm,
    /const awardedBusinessKeys = useMemo\([\s\S]*latestAwardRecords\.map\(\(record\) =>[\s\S]*analyticsBusinessRoundKey\([\s\S]*record\.organization,[\s\S]*record\.businessRound/,
  );
  assert.match(
    crm,
    /const preAwardInstitutionRows = useMemo\([\s\S]*const businessKey = analyticsBusinessRoundKey\([\s\S]*record\.organization,[\s\S]*record\.businessRound[\s\S]*if \(awardedBusinessKeys\.has\(businessKey\)\) return \[\];/,
  );
});

test("수주 전 기관 목록은 이미 제외된 수주 결과를 다시 필터링하지 않는다", () => {
  const followupStart = crm.indexOf("const followupRows = useMemo");
  const followupEnd = crm.indexOf("const followupDisplayGroups", followupStart);
  const followupSource = crm.slice(followupStart, followupEnd);
  const workspaceStart = crm.indexOf(
    '<div className="data-list-workspace institution-list-workspace">',
  );
  const workspaceEnd = crm.indexOf("{currentInstitutionPageSelected", workspaceStart);
  const workspaceSource = crm.slice(workspaceStart, workspaceEnd);

  assert.doesNotMatch(followupSource, /record\.awardStatus === awardFilter/);
  assert.doesNotMatch(workspaceSource, /aria-label="수주 결과 필터"/);
  assert.doesNotMatch(workspaceSource, /<option>타업체 수주<\/option>/);
});

test("마지막 활동 기록을 지운 기관도 마스터 정보로 상세 화면을 연다", () => {
  assert.match(
    crm,
    /const detailRegistryRecord = useMemo\([\s\S]*institutionMasterRows\.find/,
  );
  assert.match(
    crm,
    /detailLatest \?\? detailCampaignRegistration \?\? detailRegistryRecord/,
  );
  assert.match(crm, /기관 등록 · 아직 컨택 기록 없음/);
});

test("기관 표는 탭 추가 전의 고정 폭과 제목 행 구조를 사용한다", () => {
  assert.match(
    crm,
    /<div className="data-list-workspace institution-list-workspace">\s+<div className="filter-row">/,
  );
  assert.doesNotMatch(crm, /<colgroup>/);
  assert.doesNotMatch(styles, /\.institution-mode-bar/);
  assert.match(
    styles,
    /\.followup-table \{ min-width: 1520px; table-layout: fixed; \}/,
  );
  assert.match(styles, /\.followup-table th \{ height: 48px; font-size: 12px; \}/);
  assert.match(
    styles,
    /\.followup-table th:nth-child\(5\), \.followup-table td:nth-child\(5\) \{ width: 170px; \}/,
  );
});
