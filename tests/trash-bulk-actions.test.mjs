import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("trash supports selected restore, selected delete, and guarded empty all", () => {
  const page = readFileSync(
    new URL("../app/trash-page.tsx", import.meta.url),
    "utf8",
  );
  const route = readFileSync(
    new URL("../app/api/trash/route.ts", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const store = readFileSync(
    new URL("../lib/trash-store.ts", import.meta.url),
    "utf8",
  );
  const database = readFileSync(
    new URL("../db/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(page, /selectedIds/);
  assert.match(page, /선택 복구/);
  assert.match(page, /선택 영구 삭제/);
  assert.match(page, /휴지통 전체 비우기/);
  assert.match(page, /confirmation\?\.trim\(\) !== "휴지통 비우기"/);
  assert.match(route, /requestedIds/);
  assert.match(route, /requireMemberPermission\("trash:manage"\)/);
  assert.match(route, /const member = await requirePrimaryOwner\(\)/);
  assert.doesNotMatch(route, /requireAdminMember/);
  assert.match(route, /payload\.all === true/);
  assert.match(route, /TRASH_ID_QUERY_CHUNK_SIZE = 50/);
  assert.match(route, /chunkValues\(ids, TRASH_ID_QUERY_CHUNK_SIZE\)/);
  assert.match(route, /processedIds/);
  assert.match(route, /failedCount/);
  assert.match(page, /actionResultMessage/);
  assert.match(page, /payload\.processedIds/);
  assert.match(page, /canPermanentlyDelete/);
  assert.match(page, /항목명·삭제한 사람 검색/);
  assert.match(page, /자동 영구 삭제 없이/);
  assert.doesNotMatch(route, /purgeExpiredTrash/);
  assert.match(store, /TRASH_RESTORE_STATEMENT_CHUNK_SIZE = 40/);
  assert.match(store, /TRASH_OBJECT_DELETE_CHUNK_SIZE = 50/);
  assert.match(
    store,
    /chunkValues\(\s*statements,\s*TRASH_RESTORE_STATEMENT_CHUNK_SIZE/,
  );
  assert.match(styles, /\.trash-selection-bar/);
  assert.match(styles, /Readability pass/);
  assert.match(database, /const tableName = tableInfo\[1\] \|\| tableInfo\[2\]/);
  assert.match(database, /information_schema\.table_constraints/);
  assert.match(database, /tc\.constraint_type = 'PRIMARY KEY'/);
  assert.match(database, /\?:"\(\[A-Za-z_\]/);
});
