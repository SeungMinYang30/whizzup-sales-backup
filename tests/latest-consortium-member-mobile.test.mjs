import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("latest finalized consortium rates are suggested without overwriting entered values", async () => {
  const [api, page] = await Promise.all([
    read("../app/api/quotations/route.ts"),
    read("../app/quotation-management-page.tsx"),
  ]);

  assert.match(api, /function latestConsortiumRates/);
  assert.match(api, /quote\.status === "final" && quote\.executionType ===/);
  assert.match(api, /item\.consortiumRate <= 0/);
  assert.match(api, /recentConsortiumRates: consortiumRates/);
  assert.match(page, /recentConsortiumRates/);
  assert.match(page, /function setExecutionType/);
  assert.match(page, /item\.consortiumRate > 0/);
  assert.match(page, /quotation-recent-rate/);
});

test("rejected signups can reapply and member email changes preserve the member id", async () => {
  const [signup, members, crm] = await Promise.all([
    read("../app/api/auth/signup/route.ts"),
    read("../app/api/members/route.ts"),
    read("../app/crm-app.tsx"),
  ]);

  assert.match(signup, /DELETE FROM member_rejections WHERE lower\(email\) = \?/);
  assert.match(members, /const requestedEmail = typeof payload\.email === "string"/);
  assert.match(members, /UPDATE members SET[\s\S]*email = \?[\s\S]*display_name = \?[\s\S]*job_title = COALESCE/);
  assert.match(members, /DELETE FROM member_credentials WHERE member_id = \?/);
  assert.match(members, /DELETE FROM member_sessions WHERE member_id = \?/);
  assert.match(members, /passwordSetupRequired: emailChanged/);
  assert.doesNotMatch(members, /memberAccessPresets|MemberAccessPreset/);
  assert.match(crm, /member\.email/);
  assert.match(crm, /passwordSetupRequired/);
  assert.match(crm, /member-permission-disclosure/);
  assert.match(crm, /member\.isSales/);
  assert.doesNotMatch(crm, /MemberAccessPreset|memberAccessPresets/);
});

test("mobile field UI keeps voice recording user-controlled and touch friendly", async () => {
  const [crm, readability, globals] = await Promise.all([
    read("../app/crm-app.tsx"),
    read("../app/readability.css"),
    read("../app/globals.css"),
  ]);

  assert.match(crm, /function stopVoiceRecording\(\)/);
  assert.match(crm, /if \(voiceRecordingStatus === "recording"\)[\s\S]*stopVoiceRecording\(\)/);
  assert.match(crm, /recorder\.start\(500\)/);
  assert.match(crm, /current\.trim\(\) \? `\$\{current\.trimEnd\(\)\}\\n\$\{transcript\}` : transcript/);
  assert.doesNotMatch(crm, /silence|speechend|onspeechend/i);
  assert.match(crm, /document\.visibilityState === "hidden"/);
  assert.match(readability, /Field-first mobile pass/);
  assert.match(readability, /@media \(max-width: 760px\)/);
  assert.match(readability, /min-height: 44px/);
  assert.match(readability, /100dvh/);
  assert.match(readability, /-webkit-overflow-scrolling: touch/);
  assert.match(globals, /member-permission-disclosure/);
});
