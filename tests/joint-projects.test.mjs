import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sources = await Promise.all(
  [
    "../lib/joint-projects.ts",
    "../app/api/joint-projects/route.ts",
    "../app/api/records/route.ts",
    "../app/api/map/campaigns/route.ts",
    "../app/joint-project-modal.tsx",
    "../app/crm-app.tsx",
    "../app/sales-map.tsx",
    "../lib/backup-store.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

const [store, api, records, campaigns, modal, crm, map, backup] = sources;

test("공동사업은 기관 병합과 분리된 관계로 저장한다", () => {
  assert.match(store, /CREATE TABLE IF NOT EXISTS joint_projects/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS joint_project_members/);
  assert.match(store, /role TEXT NOT NULL DEFAULT 'site'/);
  assert.match(store, /item\.role === "site" \? item\.budgetAmount : null/);
  assert.doesNotMatch(store, /mergeInstitution|renameInstitution|DELETE FROM activities/);
  assert.match(api, /requireMemberPermission\("records:manage"\)/);
  assert.match(api, /deactivateJointProject/);
});

test("괴산 소급 연결은 군청을 주관으로 두고 두 복지관 금액만 합산한다", () => {
  assert.match(
    store,
    /"괴산군청",\s*"괴산군노인복지관",\s*"괴산군장애인복지관"/,
  );
  assert.match(store, /index === 0 \? "sponsor" : "site"/);
  assert.match(store, /index === 0\s*\? null\s*:/);
  assert.match(store, /preservesCampaignTargetCount: true/);
  assert.doesNotMatch(store, /UPDATE sales_campaign_targets/);
  assert.doesNotMatch(store, /DELETE FROM sales_campaign_targets/);
});

test("예산별 기관과 수주 전후 화면이 같은 공동사업 API를 사용한다", () => {
  assert.match(crm, /<JointProjectModal/);
  assert.match(crm, /공동사업 연결/);
  assert.match(map, /<JointProjectModal/);
  assert.match(map, /availableSponsors=\{jointProjectSponsorOptions\}/);
  assert.match(modal, /fetch\("\/api\/joint-projects"/);
  assert.match(modal, /주관기관/);
  assert.match(modal, /설치·수혜기관/);
  assert.match(modal, /선정기관 수는 변경하지 않습니다/);
});

test("같은 주관기관도 캠페인·표준 예산별 공동사업으로 나누고 정확한 활동을 우선 연결한다", () => {
  assert.match(store, /const scopeCondition = campaignId/);
  assert.match(store, /jp\.campaign_id = \?/);
  assert.match(store, /jp\.budget_group_id = \?/);
  assert.match(records, /linked\.activity_id = a\.id/);
  assert.match(
    records,
    /CASE WHEN linked\.activity_id = a\.id THEN 0 ELSE 1 END/,
  );
});

test("기관·예산 명단 조회와 백업 복원에 공동사업 관계가 포함된다", () => {
  assert.match(records, /joint_project_name/);
  assert.match(campaigns, /joint_project_name/);
  assert.match(backup, /name: "joint_projects"/);
  assert.match(backup, /name: "joint_project_members"/);
  assert.match(backup, /name: "joint_project_events"/);
  assert.match(backup, /DELETE FROM joint_project_members/);
  assert.match(backup, /"joint_project_members"/);
});
