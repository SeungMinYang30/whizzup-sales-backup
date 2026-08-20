import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("catalog commission defaults remain editable and accept an explicit zero", () => {
  const crm = readFileSync(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(crm, /wizupRate\s*<\s*0\s*\|\|\s*wizupRate\s*>\s*100/);
  assert.doesNotMatch(crm, /wizupRate <= 0/);
  assert.doesNotMatch(crm, /itemCommissionLocked/);
  assert.doesNotMatch(crm, /readOnly=\{[^}]*wizupCommissionRateInput/);
  assert.match(
    crm,
    /updateCatalogSettlement\(product, \{[\s\S]*?wizupCommissionRateInput:/,
  );
  assert.match(crm, /0%를 포함해 수정할 수 있습니다/);
  assert.match(crm, /위즈업 직접 공급 마진율/);
  assert.match(crm, /supplyType:\s*product\.supplyType/);
  assert.match(crm, /marginRate:[\s\S]*product\.supplyType === "direct"/);
  assert.match(styles, /\.equipment-catalog-wizup-rate input/);
});

test("제품 선택 수량은 1개로 시작하고 직영·컨소 화면에서 안전하게 배치한다", () => {
  const crm = readFileSync(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(crm, /catalogQuantityDrafts[\s\S]*Record<string, string>/);
  assert.match(crm, /\[product\.id\]: "1"/);
  assert.match(crm, /proposedQty: resolvedCatalogQuantity\(product\.id\)/);
  assert.match(crm, /aria-label=\{`\$\{product\.name\} 수량`\}/);
  assert.match(styles, /\.equipment-catalog-quantity-input/);
  assert.match(styles, /\.equipment-catalog-consortium-fields/);
  assert.match(
    styles,
    /\.equipment-catalog-consortium-fields \{ grid-column: 1 \/ -1;/,
  );
});

test("카탈로그 제품을 바꾸면 이전 제품의 수수료·마진 스냅샷을 재사용하지 않는다", () => {
  const route = readFileSync(
    new URL("../app/api/equipment/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    route,
    /const preservesExistingCatalog =\s*clean\(existingItem\.catalog_item_id\) === catalogItemId;/,
  );
  assert.match(
    route,
    /cleanSupplySettlement\(\s*payload,\s*productSupplyMap\.get\(catalogItemId\),\s*preservesExistingCatalog \? existingItem : undefined,\s*\)/,
  );
});
