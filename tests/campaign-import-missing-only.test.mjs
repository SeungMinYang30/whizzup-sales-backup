import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [map, api] = await Promise.all([
  readFile(new URL("../app/sales-map.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/map/campaigns/route.ts", import.meta.url), "utf8"),
]);

test("엑셀 재등록은 현재 예산 명단의 기존 기관을 숨기고 누락 기관만 전송한다", () => {
  assert.match(map, /const campaignImportPartition = useMemo/);
  assert.match(map, /activeCampaignOrganizationKeys\.has/);
  assert.match(map, /activeCampaignAddressKeys\.has/);
  assert.match(map, /const pendingCampaignImportRows/);
  assert.match(map, /targetRows = pendingCampaignImportRows\.map/);
  assert.match(map, /현재 명단 제외/);
  assert.match(map, /추가할 누락 기관 없음/);
  assert.match(api, /SELECT organization, address/);
  assert.match(api, /currentOrganizationKeys/);
  assert.match(api, /currentAddressKeys/);
  assert.match(api, /targets = missingTargets/);
});

test("엑셀 원본 순번과 기존 기관 검토 목록은 유지한다", () => {
  assert.match(map, /row\.sourceSequence \|\| index \+ 1/);
  assert.match(map, /제외된 기존 기관/);
  assert.match(map, /<details>/);
});
