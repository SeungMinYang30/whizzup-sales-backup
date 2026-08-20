import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recordsStore = await readFile(
  new URL("../lib/records-store.ts", import.meta.url),
  "utf8",
);
const assignmentStore = await readFile(
  new URL("../lib/activity-assignment-history.ts", import.meta.url),
  "utf8",
);
const recordsRoute = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);
const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const globals = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("AI history assigns its signed-in author unless the business round is fixed", () => {
  assert.match(
    recordsStore,
    /sourceChat === "사이트 AI 입력"[\s\S]*progressManagerLocked[\s\S]*member\.displayName/,
  );
  assert.match(
    recordsStore,
    /progress_manager_locked = 1[\s\S]*ORDER BY updated_at DESC, id DESC/,
  );
});

test("manual progress-manager changes are open to sales members and stay automatic", () => {
  assert.match(
    assignmentStore,
    /!actor\.isSales && !\(await isPrimaryOwner\(actor\)\)/,
  );
  assert.match(
    assignmentStore,
    /SET progress_manager = \?[\s\S]*progress_manager_locked = 0/,
  );
  assert.match(
    recordsRoute,
    /progressManagerChanged[\s\S]*!member\.isSales[\s\S]*await isPrimaryOwner\(member\)/,
  );
  assert.match(recordsRoute, /영업 담당자만 진행 담당자를 직접 변경/);
  assert.match(recordsRoute, /: progressManagerChanged\s*\? 0/);
  assert.match(
    recordsRoute,
    /progress_manager_locked = CASE[\s\S]*WHEN \? = 0 THEN progress_manager_locked[\s\S]*ELSE 0 END/,
  );
});

test("primary owner can return a business round to automatic assignment", () => {
  assert.match(
    assignmentStore,
    /setActivityAssignmentAutomatic[\s\S]*SET progress_manager_locked = 0/,
  );
  assert.match(crm, /mode: locked \? "fixed" : "automatic"/);
});

test("primary owner can toggle the current progress manager in the detail card", () => {
  assert.match(
    assignmentStore,
    /setActivityAssignmentFixed[\s\S]*SET progress_manager_locked = 1/,
  );
  assert.match(crm, /mode: locked \? "fixed" : "automatic"/);
  assert.match(
    crm,
    /role="switch"[\s\S]*aria-checked=\{[\s\S]*detailDisplayRecord\.progressManagerLocked[\s\S]*setProgressManagerLock\([\s\S]*!detailDisplayRecord\.progressManagerLocked/,
  );
  assert.match(
    crm,
    /detailDisplayRecord\.progressManagerLocked[\s\S]*\? "is-fixed"[\s\S]*: "automatic"/,
  );
  assert.doesNotMatch(
    crm,
    /assignment-mode-switch \$\{[\s\S]{0,120}\? "fixed"/,
  );
  assert.match(globals, /\.assignment-mode-switch\.is-fixed/);
});

test("fixed assignment control is owner-only and excluded from institution lists", () => {
  const pickerBlock = crm.slice(
    crm.indexOf("function renderInlineAssigneePicker"),
    crm.indexOf("async function saveActivityReviewState"),
  );
  assert.match(
    pickerBlock,
    /function renderInlineAssigneePicker\(record: Activity\)[\s\S]*if \(!canEditProgressManager\)/,
  );
  assert.doesNotMatch(
    pickerBlock,
    /assignment-mode-switch|setProgressManagerLock/,
  );
  assert.equal(
    (crm.match(/renderInlineAssigneePicker\(record, true\)/g) || []).length,
    0,
  );
  assert.match(crm, /<td>\s*\{renderInlineAssigneePicker\(record\)\}/);
  assert.match(
    crm,
    /manager-col-manager">\s*\{renderInlineAssigneePicker\(record\)\}/,
  );
  assert.match(
    crm,
    /session\?\.canViewPresence[\s\S]*assignment-mode-switch[\s\S]*detailDisplayRecord\.progressManagerLocked/,
  );
});

test("detail progress-manager save renders the server response without stale camel-case fields", () => {
  const saveBlock = crm.slice(
    crm.indexOf("async function saveDetailInlineEdit"),
    crm.indexOf("function updateDetailInlineDraft"),
  );
  assert.match(
    saveBlock,
    /const savedRecord = normalizeUpdatedActivity\(payloadRecord, record\)/,
  );
  assert.doesNotMatch(
    saveBlock,
    /const savedRecord = normalize\(\{\s*\.\.\.record,\s*\.\.\.payloadRecord,/,
  );
  assert.match(saveBlock, /이미 같은 진행 담당자로 저장되어 있습니다/);
  assert.match(
    assignmentStore,
    /target\.display_name\.trim\(\) === current\.progress_manager\.trim\(\)[\s\S]*return \{ record \}/,
  );
});

test("sales UI renders assignee controls while non-sales members see text", () => {
  assert.match(
    crm,
    /if \(!canEditProgressManager\)[\s\S]*inline-assignee-static/,
  );
  assert.match(
    crm,
    /canEditProgressManager \? \([\s\S]*<select[\s\S]*readonly-form-value/,
  );
});

test("institution detail saves against the same registered assignee catalog shown in the card", () => {
  assert.match(
    crm,
    /field === "progressManager" && activityReviewAssignees\.length === 0/,
  );
  assert.match(
    crm,
    /const targetMember = activityReviewAssignees\.find/,
  );
});

test("pre-award institution rows reuse grouped history instead of rescanning every record", () => {
  assert.match(crm, /const recordsByInstitutionKey = useMemo/);
  assert.match(crm, /const institutionPageViewRows = useMemo/);
  assert.match(crm, /recordsByInstitutionKey\.get/);
  assert.doesNotMatch(
    crm,
    /institutionPageViewRows\.map[\s\S]*records\.filter[\s\S]*renderInlineAssigneePicker/,
  );
});
