import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crm = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);
const organizeRoute = await readFile(
  new URL("../app/api/ai/organize/route.ts", import.meta.url),
  "utf8",
);
const recordsStore = await readFile(
  new URL("../lib/records-store.ts", import.meta.url),
  "utf8",
);

test("새 영업 기록은 재연락 필요 체크를 해제한 상태로 시작한다", () => {
  assert.match(
    crm,
    /const emptyForm: FormState = \{[\s\S]*?followUpRequired: false,/,
  );
});

test("기존 기록 수정 시에는 저장된 재연락 상태를 그대로 불러온다", () => {
  assert.match(
    crm,
    /followUpRequired: record\.followUpRequired,/,
  );
});

test("AI 채팅 내용과 관계없이 새 초안의 재연락 기본값을 해제한다", () => {
  assert.match(
    organizeRoute,
    /followUpRequired:\s*false,[\s\S]*?followUpDate:\s*"",/,
  );
  assert.match(
    crm,
    /function normalizeAiDraft[\s\S]*?const followUpRequired = false;/,
  );
});

test("재연락을 직접 선택하지 않은 저장 요청은 서버에서도 해제한다", () => {
  assert.match(
    recordsStore,
    /const followUpRequired =[\s\S]*?inheritedPayload\.followUpRequired === true[\s\S]*?Boolean\(followUpDate\)/,
  );
  assert.match(recordsStore, /followUpRequired \? 1 : 0/);
});
