import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/resource-library-page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("자료 수정 화면은 저장 구역과 변경사항 저장 버튼을 명확히 표시한다", () => {
  assert.match(page, /className="resource-edit-actions"/);
  assert.match(page, /변경한 내용은 저장 버튼을 눌러야 반영됩니다\./);
  assert.match(page, />변경사항 저장<\/button>/);
  assert.match(styles, /\.resource-edit-actions \{ position: sticky; bottom: 0;/);
  assert.match(styles, /border-top: 2px solid #c9d4ed;/);
});
test("모바일 자료 수정 화면은 취소와 저장 버튼을 한 줄로 제공한다", () => {
  assert.match(page, /className="resource-edit-action-buttons"/);
  assert.match(styles, /\.resource-edit-action-buttons \{ display: grid; grid-template-columns:/);
});
