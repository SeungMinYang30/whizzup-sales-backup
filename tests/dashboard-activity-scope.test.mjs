import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const crm = fs.readFileSync(path.join(root, "app", "crm-app.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "app", "globals.css"), "utf8");

test("dashboard activity scope keeps both mobile labels present", () => {
  assert.match(crm, /className="dashboard-activity-scope" aria-label="활동 이력 범위"/);
  assert.match(crm, />\s*내 활동\s*<\/button>/);
  assert.match(crm, />\s*전체 활동\s*<\/button>/);
});

test("dashboard activity scope uses two equal mobile columns", () => {
  assert.match(
    styles,
    /\.dashboard-records \.dashboard-activity-scope\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*width:\s*min\(176px,\s*100%\);[^}]*\}/s,
  );
});

test("dashboard activity scope labels stay centered on one line", () => {
  assert.match(
    styles,
    /\.dashboard-records \.dashboard-activity-scope button\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*text-align:\s*center;[^}]*white-space:\s*nowrap;[^}]*word-break:\s*keep-all;[^}]*\}/s,
  );
});
