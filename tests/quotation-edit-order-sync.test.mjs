import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../app/quotation-management-page.tsx", import.meta.url);
const storePath = new URL("../lib/authored-quotations.ts", import.meta.url);

test("견적 품목은 버튼과 드래그로 순서를 바꾸고 배열 순서를 출력에 사용한다", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /function reorderItem\(sourceId: string, targetId: string\)/);
  assert.match(page, /className="quotation-item-drag-handle"/);
  assert.match(page, /위로 이동/);
  assert.match(page, /아래로 이동/);
  assert.match(page, /lines: draft\.items\.map\(\(item\) => \(\{/);
  assert.match(page, /lines: quote\.items\.map\(\(item\) => \(\{/);
});

test("최종 견적은 같은 번호로 직접 수정하고 기존 출력 파일을 새로 교체한다", async () => {
  const [page, store] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(storePath, "utf8"),
  ]);
  assert.match(page, />견적 수정<\/button>/);
  assert.match(page, /견적 수정 저장/);
  assert.match(page, /기존 PDF·Excel도 새 내용으로 교체됩니다/);
  assert.doesNotMatch(store, /최종 견적서는 덮어쓸 수 없습니다/);
  assert.match(store, /drive_sync_status='none', drive_sync_error=''/);
});

test("견적 저장은 기관 상세 품목을 직접 변경하지 않는다", async () => {
  const page = await readFile(pagePath, "utf8");
  const saveStart = page.indexOf('async function save(status: "draft" | "final")');
  const exportStart = page.indexOf("async function exportExcel()", saveStart);
  const saveBody = page.slice(saveStart, exportStart);
  assert.doesNotMatch(saveBody, /\/api\/equipment/);
  assert.doesNotMatch(saveBody, /syncQuotationItems|syncConstructionCost/);
  assert.match(saveBody, /storeQuotationFiles/);
});
