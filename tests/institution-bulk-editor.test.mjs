import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("기관 일괄 수정 창은 모든 변경 항목을 선택 해제한 상태로 연다", async () => {
  const source = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /function toggleInstitutionBulkEditor\(\) \{[\s\S]*?setInstitutionBulkBudgetEnabled\(false\);[\s\S]*?setInstitutionBulkManagerEnabled\(false\);[\s\S]*?setInstitutionBulkContactNameEnabled\(false\);[\s\S]*?setInstitutionBulkFollowUpEnabled\(false\);[\s\S]*?setInstitutionBulkNextActionEnabled\(false\);[\s\S]*?setInstitutionBulkAwardEnabled\(false\);[\s\S]*?setInstitutionBudgetOpen\(true\);[\s\S]*?\}/,
  );
});
