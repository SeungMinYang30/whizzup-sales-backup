import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("수주 목록은 50건씩 표시하고 현재 페이지와 검색 결과 전체 선택을 구분한다", () => {
  assert.match(crm, /const AWARD_LIST_PAGE_SIZE = 50/);
  assert.match(crm, /awardDisplayGroups\.slice\(offset, offset \+ AWARD_LIST_PAGE_SIZE\)/);
  assert.match(crm, /jointProjectGroupMemberIds\(awardPageGroups\)/);
  assert.match(crm, /jointProjectGroupMemberIds\(awardDisplayGroups\)/);
  assert.match(crm, /aria-label="현재 페이지 수주 전체 선택"/);
  assert.match(crm, /현재 페이지 \{awardPageGroups\.length\.toLocaleString\(\)\}개 사업이 선택되었습니다/);
  assert.match(crm, /검색 결과 \{awardDisplayGroups\.length\.toLocaleString\(\)\}개 사업 전체 선택/);
  assert.match(crm, /검색 결과 \{awardDisplayGroups\.length\.toLocaleString\(\)\}개 사업이 모두 선택되었습니다/);
  assert.match(crm, /setSelectedAwardIds\(allFilteredAwardIds\)/);
});

test("수주 목록 페이지 이동 UI가 있고 필터 변경 시 선택을 안전하게 초기화한다", () => {
  assert.match(crm, /aria-label="수주 목록 페이지"/);
  assert.match(crm, /setAwardPage\(1\)/);
  assert.match(crm, /setSelectedAwardIds\(\[\]\)/);
  assert.match(styles, /\.award-selection-banner/);
  assert.match(styles, /\.award-list-pagination/);
});

test("수주 후 목록은 기관과 사업 차수별 최신 기록을 표시하고 활동 이력은 상세에 유지한다", () => {
  assert.match(crm, /const businessKey = analyticsBusinessRoundKey\(/);
  assert.match(crm, /byBusinessRound\.has\(businessKey\)/);
  assert.match(
    crm,
    /const sourceRecords = view === "awards" \? latestAwardRecords : records/,
  );
  assert.match(
    crm,
    /institutionAliasKey\(record\.organization\) ===\s*detailOrganizationKey/,
  );
});
