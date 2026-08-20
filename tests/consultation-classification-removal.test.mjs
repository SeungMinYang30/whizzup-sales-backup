import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crmSource = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);
const organizerSource = await readFile(
  new URL("../app/api/ai/organize/route.ts", import.meta.url),
  "utf8",
);

test("상담 분류 입력과 검토 항목을 노출하지 않는다", () => {
  assert.doesNotMatch(crmSource, /<span>상담 분류<\/span>/);
  assert.doesNotMatch(crmSource, /add\(\s*"topic",\s*"상담 분류"/);
  assert.doesNotMatch(crmSource, /상담 분류 \/ 다음 행동/);
});

test("AI 자동 정리는 상담 분류를 만들지 않는다", () => {
  assert.match(
    organizerSource,
    /topic은 항상 빈 문자열로 두고, 실제 상담 내용은 summary에만 정리하세요/,
  );
});
