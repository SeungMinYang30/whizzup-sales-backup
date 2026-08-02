import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const collaborationSource = await readFile(
  new URL("../lib/collaboration.ts", import.meta.url),
  "utf8",
);
const assignmentSource = await readFile(
  new URL("../lib/activity-assignment-history.ts", import.meta.url),
  "utf8",
);
const recordsRouteSource = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);
const crmSource = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);
const recordsStoreSource = await readFile(
  new URL("../lib/records-store.ts", import.meta.url),
  "utf8",
);

test("general record collaboration stays open and sales members can change progress managers", () => {
  assert.match(
    collaborationSource,
    /return member\.status === "approved"/,
  );
  assert.match(
    assignmentSource,
    /!actor\.isSales && !\(await isPrimaryOwner\(actor\)\)/,
  );
  assert.match(
    recordsRouteSource,
    /progressManagerChanged[\s\S]*!member\.isSales[\s\S]*await isPrimaryOwner\(member\)/,
  );
  assert.match(crmSource, /if \(!canEditProgressManager\)/);
});

test("assignment changes keep audit data and move open correction work", () => {
  assert.match(assignmentSource, /updated_by_name = \?/);
  assert.match(assignmentSource, /reassignOpenCorrectionRequests/);
  assert.match(assignmentSource, /activity_assignment_history/);
  assert.match(recordsRouteSource, /previousManagerById/);
  assert.match(recordsRouteSource, /changed_by_name/);
});

test("record edits preserve the original author and expose the latest editor", () => {
  assert.match(recordsRouteSource, /updated_by_member_id = \?/);
  assert.match(recordsRouteSource, /updated_by_name = \?/);
  assert.match(crmSource, /originalRecord\?\.createdByName/);
  assert.match(crmSource, /최근 수정 \$\{record\.updatedByName\}/);
});

test("AI input assigns the author unless the business round is manually fixed", () => {
  assert.match(crmSource, /fixedManager/);
  assert.match(recordsStoreSource, /sourceChat === "사이트 AI 입력"/);
  assert.match(
    recordsStoreSource,
    /progressManagerLocked[\s\S]*member\.displayName/,
  );
  assert.match(
    recordsStoreSource,
    /progressManagerForAward\(\s*award\.awardStatus,\s*progressManager,/,
  );
});
