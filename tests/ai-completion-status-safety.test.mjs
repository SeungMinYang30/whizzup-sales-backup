import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("사이트 AI는 공통 영업 진행상황 분류를 사용한다", () => {
  const route = source("../app/api/ai/organize/route.ts");
  const client = source("../app/crm-app.tsx");
  const status = source("../lib/ai-status.ts");

  assert.match(route, /const statusValues = \[\.\.\.AI_SUGGESTED_STATUS_VALUES\]/);
  assert.match(route, /normalizeAiSuggestedStatus\([\s\S]*draft\.status/);
  assert.match(client, /status: normalizeAiSuggestedStatus\(draft\?\.status/);
  assert.match(status, /AI_SUGGESTED_STATUS_VALUES = SALES_PROGRESS_OPTIONS/);
});

test("공유 GPT 입력도 같은 영업 진행상황을 전송한다", () => {
  const openapi = source("../app/gpt-action-openapi.yaml/route.ts");
  const action = source("../app/api/gpt-actions/activities/route.ts");

  assert.match(
    openapi,
    /enum: \[신규 접촉, 상담 진행, 제안·견적, 결과 대기, 재영업 상담, 사후관리, 수주 전환, 영업 종료\]/,
  );
  assert.match(
    openapi,
    /상담 내용과 수주 결과를 기준으로 영업 진행상황을 분류합니다/,
  );
  assert.match(action, /normalizeAiSuggestedStatus\(payload\.status/);
});

test("직접 입력 화면도 공통 영업 진행상황 선택지를 사용한다", () => {
  const client = source("../app/crm-app.tsx");
  assert.match(client, /const statusOptions = \[\.\.\.SALES_PROGRESS_OPTIONS\]/);
});
