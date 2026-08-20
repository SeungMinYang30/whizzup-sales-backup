import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeAiSuggestedStatus } from "../lib/ai-status.ts";

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
const recordsRoute = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL("../drizzle/0048_manual_sales_status.sql", import.meta.url),
  "utf8",
);

test("재연락 여부는 영업 진행상황을 신규 접촉으로 바꾸지 않는다", () => {
  assert.equal(normalizeAiSuggestedStatus("", true), "상담 진행");
  assert.equal(normalizeAiSuggestedStatus("제안·견적", true), "제안·견적");
  const automaticStatusStart = crm.indexOf("function automaticSalesStatus");
  const automaticStatusEnd = crm.indexOf("\n}\n", automaticStatusStart);
  const automaticStatusSource = crm.slice(
    automaticStatusStart,
    automaticStatusEnd + 3,
  );
  assert.doesNotMatch(automaticStatusSource, /followUpRequired/);
  assert.doesNotMatch(automaticStatusSource, /신규 접촉/);
  assert.match(
    recordsStore,
    /const followUpRequired =[\s\S]*?inheritedPayload\.followUpRequired === true[\s\S]*?Boolean\(followUpDate\)/,
  );
});

test("사용자가 진행상황을 직접 고르면 일정 자동화가 이후 덮어쓰지 않는다", () => {
  assert.match(crm, /statusManual:\s*true/);
  assert.match(
    crm,
    /function effectiveSalesProgress[\s\S]*if \(record\.statusManual\)[\s\S]*normalizeSalesProgress\(record\.status, record\.awardStatus\)/,
  );
  assert.match(
    recordsStore,
    /const statusManual = payload\.statusManual === true;[\s\S]*?status:[\s\S]*?statusManual \|\| awardStageManual \? requestedStatus : status,/,
  );
  assert.match(
    recordsStore,
    /statusManual:\s*record\.status_manual === 1/,
  );
  assert.match(recordsStore, /status_manual/);
  assert.match(recordsRoute, /status_manual = \?/);
  assert.match(migration, /UPDATE `activities` SET `status_manual` = 1/);
});

test("예산 명단 등록 기록은 완료 기관을 재영업으로 바꾸지 않는다", () => {
  assert.match(crm, /"예산별 기관 직접 등록"/);
  assert.match(
    crm,
    /isPartnerRegistrationSystemRecord\(record\) \|\|[\s\S]*isCampaignRegistrationSystemRecord\(record\)/,
  );
  assert.match(
    crm,
    /!isPdfCampaignRegistration\(record\) &&[\s\S]*!isCampaignRegistrationSystemRecord\(record\)/,
  );
  assert.match(
    crm,
    /\(isPdfCampaignRegistration\(record\) \|\|[\s\S]*isCampaignRegistrationSystemRecord\(record\)\)/,
  );
});

test("AI가 새 기록의 최초 진행상황을 판단하는 흐름은 유지한다", () => {
  assert.equal(normalizeAiSuggestedStatus("신규 접촉", false), "신규 접촉");
  assert.equal(normalizeAiSuggestedStatus("결과 대기", false), "결과 대기");
  assert.match(
    organizeRoute,
    /status:\s*normalizeAiSuggestedStatus\(draft\.status,\s*false\)/,
  );
  assert.doesNotMatch(
    organizeRoute,
    /draft\.status === "신규 접촉"[\s\S]*?"상담 진행"/,
  );
});
