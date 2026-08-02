import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const taxonomy = await readFile(
  new URL("../lib/sales-taxonomy.ts", import.meta.url),
  "utf8",
);
const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");

test("영업 진행상황과 수주 진행단계는 화면 전체에서 같은 분류를 사용한다", () => {
  assert.match(
    taxonomy,
    /"신규 접촉"[\s\S]*"상담 진행"[\s\S]*"제안·견적"[\s\S]*"결과 대기"[\s\S]*"재영업 상담"[\s\S]*"사후관리"[\s\S]*"수주 전환"[\s\S]*"영업 종료"/,
  );
  assert.match(
    taxonomy,
    /"미정"[\s\S]*"협상"[\s\S]*"계약"[\s\S]*"일정 조율"[\s\S]*"설치·공사 진행"[\s\S]*"검수·교육 진행"[\s\S]*"납품 완료"/,
  );
  assert.match(crm, /completedAwardStages = new Set\(\[COMPLETED_AWARD_STAGE, "완공"\]\)/);
});

test("대시보드 점검 카드에는 필요한 두 수치만 남긴다", () => {
  assert.doesNotMatch(crm, /오늘 입력 <b>/);
  assert.doesNotMatch(crm, /오늘 확인 완료 <b>/);
  assert.match(crm, /보완 필요 <b>/);
  assert.match(crm, /영업보호 필요 <b>/);
});

test("수주 후 목록은 진행단계와 납품 완료 처리를 한 칸에서 제공한다", () => {
  assert.match(crm, /className="award-stage-cell"/);
  assert.match(crm, /납품 완료/);
  assert.match(crm, /className="award-progress-content"/);
  assert.match(crm, /재영업 진행 중/);
});
