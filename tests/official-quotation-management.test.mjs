import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../app/quotation-management-page.tsx", import.meta.url),
  "utf8",
);
const api = await readFile(
  new URL("../app/api/quotations/route.ts", import.meta.url),
  "utf8",
);
const schedule = await readFile(
  new URL("../app/construction-schedule-page.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("approved members can save formal quotations without mutating award records", () => {
  assert.match(api, /requireApprovedMember/);
  assert.doesNotMatch(api, /award_status|awardStatus|activities/);
  assert.match(page, /\/api\/quotations/);
});

test("formal quotation supports catalog items, direct-consortium margin, seal and customer print", () => {
  assert.match(page, /\/api\/product-catalog/);
  assert.match(page, /executionType/);
  assert.match(page, /consortiumRate/);
  assert.match(page, /whizzup-seal\.png/);
  assert.match(page, /window\.print/);
  assert.match(styles, /@media print/);
  assert.match(styles, /quotation-profit-panel/);
});

test("construction board uses only shared post-award schedules", () => {
  assert.match(schedule, /item\.visibility === "shared-post-award"/);
  assert.match(schedule, /\/api\/schedules\?scope=calendar/);
});
