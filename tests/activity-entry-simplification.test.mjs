import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const aiRoute = await readFile(
  new URL("../app/api/ai/organize/route.ts", import.meta.url),
  "utf8",
);

test("영업 기록 입력은 네 가지 활동 유형만 노출한다", () => {
  assert.match(
    crm,
    /const typeOptions = \[\.\.\.ACTIVITY_TYPE_OPTIONS\]/,
  );
  assert.doesNotMatch(crm, /<span>컨택 유형<\/span>/);
  assert.doesNotMatch(crm, /<span>영업 진행 상태<\/span>/);
  assert.doesNotMatch(crm, /<span>관심도<\/span>/);
  assert.doesNotMatch(crm, /<span>기록 출처<\/span>/);
});

test("숨긴 값은 활동과 후속 결과에 따라 내부에서 자동 결정한다", () => {
  assert.match(crm, /function contactMethodForActivityType/);
  assert.match(crm, /function automaticSalesStatus/);
  assert.match(crm, /status: automaticSalesStatus\(normalizedCompletion\)/);
  assert.match(crm, /sourceChat: normalizedFormBase\.sourceChat \|\| "직접 입력"/);
});

test("AI 활동 유형도 같은 네 가지 값으로 정규화한다", () => {
  assert.match(
    aiRoute,
    /const activityTypeValues = \[\.\.\.ACTIVITY_TYPE_OPTIONS\]/,
  );
  assert.match(aiRoute, /temperature: "중간"/);
});
