import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("승인된 구성원은 목록에서 진행 담당자를 바로 변경할 수 있다", async () => {
  const crm = await readFile(new URL("app/crm-app.tsx", root), "utf8");
  const route = await readFile(
    new URL("app/api/records/assignee/route.ts", root),
    "utf8",
  );
  const assignment = await readFile(
    new URL("lib/activity-assignment-history.ts", root),
    "utf8",
  );

  assert.match(route, /requireApprovedMember\(\)/);
  assert.doesNotMatch(assignment, /hasMemberPermission/);
  assert.match(crm, /function renderInlineAssigneePicker/);
  assert.ok((crm.match(/renderInlineAssigneePicker\(record\)/g) ?? []).length >= 3);
});

test("품목 선택 금액은 좁은 노트북 화면에서도 잘리지 않는다", async () => {
  const styles = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(
    styles,
    /\.equipment-catalog-option \{ box-sizing: border-box;[^}]+minmax\(90px, max-content\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]+?\.equipment-catalog-settlement \{ grid-column: 2 \/ -1; grid-row: 2;/,
  );
  assert.match(
    styles,
    /\.equipment-catalog-option > b, \.equipment-catalog-price-input \{ grid-column: 3; grid-row: 1;/,
  );
});

test("긴 표는 화면 하단 고정 가로 스크롤을 제공한다", async () => {
  const crm = await readFile(new URL("app/crm-app.tsx", root), "utf8");
  const styles = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(crm, /function StickyTableWrap/);
  assert.match(crm, /className=\{`table-scroll-dock/);
  assert.match(styles, /\.table-scroll-dock \{ position: fixed; bottom: 0;/);
  assert.match(crm, /shellBounds\.bottom > viewportBottom/);
  assert.match(
    crm,
    /window\.addEventListener\("scroll", updateSize, \{ passive: true \}\)/,
  );
  assert.doesNotMatch(
    crm,
    /window\.addEventListener\("scroll", updateSize, true\)/,
  );
});

test("제품 검색과 즐겨찾기 필터는 스크롤 위치를 유지한다", async () => {
  const crm = await readFile(new URL("app/crm-app.tsx", root), "utf8");
  const products = await readFile(
    new URL("app/product-catalog-page.tsx", root),
    "utf8",
  );

  assert.match(crm, /★ 즐겨찾기만/);
  assert.match(crm, /catalogFavoriteProductIdSet/);
  assert.match(products, /제품명·업체명·모델명·규격·제품 코드 검색/);
  assert.match(products, /window\.scrollTo\(viewport\.x, viewport\.y\)/);
});

test("위즈업 수수료율 라벨과 퍼센트 입력은 겹치지 않는다", async () => {
  const styles = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(
    styles,
    /> label:not\(\.equipment-catalog-wizup-rate\) > span/,
  );
  assert.doesNotMatch(
    styles,
    /\.equipment-catalog-settlement > label > span \{/,
  );
  assert.match(styles, /\.equipment-catalog-wizup-rate \{ display: flex;/);
  assert.match(styles, /flex-direction: column/);
  assert.match(styles, /\.equipment-catalog-wizup-rate-input \{ position: relative;/);
});
