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

test("기관별 관리는 수주 전 기관 전체를 기본 목록으로 유지한다", () => {
  assert.match(
    crm,
    /const preAwardInstitutionRows = useMemo\(\(\) => \{[\s\S]*latestInstitutionRows\.flatMap\(\(record\) => \{[\s\S]*latestAwardEvidence[\s\S]*isActivePreAwardProgress\(salesProgress\)/,
  );
  assert.match(
    crm,
    /return \["위즈업 수주", "협력사 수주"\]\.includes\(record\.awardStatus\)/,
  );
  assert.match(crm, /<option>타업체 수주<\/option>/);
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
