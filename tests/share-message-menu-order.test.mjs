import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("공유 문구 화면은 제거하고 사용자별 잠금 메뉴 순서는 유지한다", async () => {
  const [crm, styles] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(crm, /SHARE MESSAGE/);
  assert.doesNotMatch(crm, /저장된 공유 문구/);
  assert.doesNotMatch(crm, /단톡방 공유용/);
  assert.doesNotMatch(crm, /navigator\.share/);
  assert.match(crm, /상세 기록 보기/);

  assert.match(crm, /menuOrderStoragePrefix/);
  assert.match(crm, /순서 변경/);
  assert.match(crm, /저장·잠금/);
  assert.match(crm, /끌어서 순서 변경/);
  assert.match(crm, /onDragStart/);
  assert.match(crm, /onPointerDown/);
  assert.match(crm, /ArrowUp/);
  assert.match(crm, /ArrowDown/);
  assert.match(styles, /\.menu-order-toolbar/);
  assert.match(styles, /\.nav-drag-handle/);
  assert.match(crm, /기관·예산 관리/);
  assert.match(crm, /협력사 관리/);
  assert.doesNotMatch(crm, />\s*현재 목록 일괄 삭제\s*</);
  assert.match(crm, />선택 삭제</);
});
