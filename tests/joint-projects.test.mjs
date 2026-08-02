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
    "../app/joint-project-summary.tsx",
    "../lib/joint-project-display.ts",
    "../app/crm-app.tsx",
    "../app/sales-map.tsx",
    "../app/globals.css",
    "../lib/backup-store.ts",
    "../db/schema.ts",
    "../drizzle/0062_joint_project_budget_period.sql",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

const [
  store,
  api,
  records,
  campaigns,
  modal,
  summary,
  display,
  crm,
  map,
  styles,
  backup,
  schema,
  migration,
] = sources;

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

test("함양 공동사업은 가상현실스포츠실 2026년 1차와 세 설치기관으로 안전하게 소급한다", () => {
  assert.match(store, /ensureHamyangJointProjectConsistency/);
  assert.match(store, /"경상남도 함양군\(수동면 생기발랄복지센터\)"/);
  assert.match(store, /"함양 항노화 건강 문화활력센터"/);
  assert.match(store, /"함양군청-행복안의봄날센터"/);
  assert.match(store, /project_year = 2026, joint_round = 1[\s\S]*budget\.canonical_name/);
  assert.match(store, /role = 'sponsor', budget_amount = NULL/);
  assert.match(store, /SET role = 'site', budget_amount = \?/);
  assert.match(store, /WHERE NOT EXISTS \([\s\S]*joint_project_members/);
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
  assert.match(crm, /<JointProjectSummary/);
  assert.match(summary, /budgets_json/);
  assert.match(summary, /member\.role === "site"/);
  assert.match(summary, /합계는 설치기관만 계산합니다/);
});

test("공동사업 목록은 주관기관 한 건으로 접고 설치기관과 일괄 선택 범위를 보존한다", () => {
  assert.match(display, /const key = projectId \? `joint:\$\{projectId\}`/);
  assert.match(display, /row\.jointProjectRole === "sponsor"/);
  assert.match(display, /group\.members\.sort/);
  assert.match(display, /groups\.flatMap\(\(group\) => group\.members/);
  assert.match(crm, /groupJointProjectRows\(displayedRecords\)/);
  assert.match(crm, /groupJointProjectRows\(followupRows\)/);
  assert.match(map, /groupJointProjectRows\(filteredBudgetTargets\)/);
  assert.match(crm, /설치기관 펼쳐보기/);
  assert.match(map, /설치기관 펼쳐보기/);
  assert.match(crm, /setDetailOrganization\(sponsorOrganization\)/);
  assert.match(styles, /\.joint-project-member-list/);
  assert.match(styles, /\.joint-project-button[\s\S]*border: 1px solid #88a4f8/);
});

test("공동사업 예산은 활성 표준 예산명과 연도·차수로 구분하고 설치기관별 금액을 저장한다", () => {
  assert.match(modal, /fetch\("\/api\/budget-catalog"/);
  assert.match(modal, />예산명</);
  assert.match(modal, />공동사업 연도</);
  assert.match(modal, />공동사업 차수</);
  assert.match(modal, /selectedBudget\.defaultAmount/);
  assert.match(modal, /budgetAmount:/);
  assert.match(store, /FROM budget_name_groups/);
  assert.match(store, /AND active = 1/);
  assert.match(store, /project_year = \?/);
  assert.match(store, /joint_round = \?/);
  assert.match(store, /jp\.campaign_id = \? AND jp\.budget_group_id = \?/);
  assert.match(schema, /projectYear: integer\("project_year"\)/);
  assert.match(schema, /jointRound: integer\("joint_round"\)/);
  assert.match(migration, /ADD `project_year`/);
  assert.match(migration, /ADD `joint_round`/);
});

test("같은 주관기관도 캠페인·표준 예산별 공동사업으로 나누고 정확한 활동을 우선 연결한다", () => {
  assert.match(store, /const scopeCondition = campaignId/);
  assert.match(store, /jp\.campaign_id = \?/);
  assert.match(store, /jp\.budget_group_id = \?/);
  assert.match(records, /WITH joint_member_candidates AS/);
  assert.match(records, /linked\.activity_id = source_activity\.id/);
  assert.match(records, /linked_project\.budget_group_id = source_activity\.budget_group_id/);
  assert.match(records, /linked_project\.project_year/);
  assert.match(records, /joint_link\.row_number = 1/);
  assert.doesNotMatch(records, /linked\.activity_id = a\.id/);
  assert.match(campaigns, /WITH joint_target_candidates AS/);
  assert.match(campaigns, /source_campaign\.budget_group_id/);
  assert.match(campaigns, /linked_project\.project_year/);
  assert.doesNotMatch(campaigns, /linked\.campaign_target_id = t\.id/);
});

test("기관·예산 명단 조회와 백업 복원에 공동사업 관계가 포함된다", () => {
  assert.match(records, /joint_project_name/);
  assert.match(campaigns, /joint_project_name/);
  assert.match(backup, /name: "joint_projects"/);
  assert.match(backup, /name: "joint_project_members"/);
  assert.match(backup, /name: "joint_project_events"/);
  assert.match(backup, /"project_year"/);
  assert.match(backup, /"joint_round"/);
  assert.match(backup, /DELETE FROM joint_project_members/);
  assert.match(backup, /"joint_project_members"/);
});
