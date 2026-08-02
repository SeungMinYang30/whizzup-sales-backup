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
    "../app/joint-project-member-list.tsx",
    "../lib/joint-project-display.ts",
    "../app/crm-app.tsx",
    "../app/sales-map.tsx",
    "../app/globals.css",
    "../lib/backup-store.ts",
    "../lib/institution-merge.ts",
    "../lib/institution-names.ts",
    "../db/schema.ts",
    "../drizzle/0062_joint_project_budget_period.sql",
    "../drizzle/0063_joint_project_institution_key.sql",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);

const [
  store,
  api,
  records,
  campaigns,
  modal,
  summary,
  memberList,
  display,
  crm,
  map,
  styles,
  backup,
  institutionMerge,
  institutionNames,
  schema,
  periodMigration,
  identityMigration,
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
  assert.match(store, /retrofitHamyangSudoActivityLink/);
  assert.match(store, /sponsor\.organization = '함양군청'/);
  assert.match(store, /경상남도 함양군\(수동면 생기발랄복지센터\)/);
  assert.match(store, /budget\.canonical_name = '가상현실스포츠실'/);
  assert.match(store, /jp\.project_year = 2026/);
  assert.match(store, /jp\.joint_round = 1/);
  assert.match(store, /normalizedIsoDate\(resolved\.row\.activity_date\) !== "2025-01-02"/);
  assert.match(store, /resolved\.candidates\.length !== 1/);
  assert.match(store, /SET activity_id = \?, institution_key = \?, updated_at = CURRENT_TIMESTAMP/);
  assert.match(store, /WHERE id = \? AND activity_id IS NULL/);
  assert.match(store, /retrofit_hamyang_sudo_activity_v1/);
  assert.doesNotMatch(store, /UPDATE activities[\s\S]*retrofit_hamyang_sudo_activity_v1/);
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

test("공동사업 목록은 주관기관 한 건으로 접고 설치기관 검색과 일괄 선택 범위를 보존한다", () => {
  assert.match(display, /const key = projectId \? `joint:\$\{projectId\}`/);
  assert.match(display, /row\.jointProjectRole === "sponsor"/);
  assert.match(display, /group\.members\.sort/);
  assert.match(display, /groups\.flatMap\(\(group\) => group\.members/);
  assert.match(display, /filterJointProjectGroupsByMember/);
  assert.match(display, /matchingMembers/);
  assert.match(crm, /groupJointProjectRows\(displayedRecords\)/);
  assert.match(crm, /groupJointProjectRows\(followupRows\)/);
  assert.match(map, /groupJointProjectRows\(activeCampaignTargets\)\.filter/);
  assert.match(map, /group\.members\.some\(matchesBudgetTargetFilters\)/);
  assert.match(map, /const filteredBudgetTargets = filteredBudgetTargetGroups\.flatMap/);
  assert.match(crm, /<JointProjectMemberList/);
  assert.match(map, /<JointProjectMemberList/);
  assert.match(memberList, /전체 \$\{siteMembers\.length\}곳 중 검색 일치/);
  assert.match(memberList, /다른 설치기관 \{otherSiteMembers\.length\}곳 보기/);
  assert.match(memberList, /if \(!searchActive\)[\s\S]*setOpen\(false\)/);
  assert.match(crm, /openJointProjectGroupDetail/);
  assert.doesNotMatch(crm, /setDetailOrganization\(sponsorOrganization\)/);
  assert.match(styles, /\.joint-project-member-list/);
  assert.match(styles, /\.joint-project-member-list > button\.search-match/);
  assert.match(styles, /\.joint-project-button[\s\S]*border: 1px solid #88a4f8/);
});

test("공동사업 상세는 주관기관 셸 안에서 선택 기관의 기록과 물품으로 전환한다", () => {
  assert.match(crm, /detailShellOrganization/);
  assert.match(crm, /현재 보기 \$\{detailOrganization\}/);
  assert.match(crm, /selectedActivityId=\{detailDisplayRecord\.id\}/);
  assert.match(crm, /setDetailBusinessRound\(member\.businessRound\)/);
  assert.match(summary, /onSelectMember/);
  assert.match(summary, /resolved_activity_id/);
  assert.match(summary, /aria-pressed=\{member\.id === current\?\.id\}/);
  assert.match(summary, /현재 보기 \$\{current\.organization\}/);
  assert.match(styles, /\.history-summary-grid > div[\s\S]*inset 0 -1px 0 #d8e0ec/);
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
  assert.match(periodMigration, /ADD `project_year`/);
  assert.match(periodMigration, /ADD `joint_round`/);
});

test("양쪽 화면은 저장된 활동·선정명단 ID만 사용하고 이름·연도로 다시 추정하지 않는다", () => {
  assert.match(store, /const scopeCondition = campaignId/);
  assert.match(store, /jp\.campaign_id = \?/);
  assert.match(store, /jp\.budget_group_id = \?/);
  assert.match(records, /linked\.activity_id = source_activity\.id/);
  assert.doesNotMatch(records, /linked\.organization = source_activity\.organization/);
  assert.doesNotMatch(records, /linked_project\.project_year\s*=/);
  assert.match(campaigns, /linked\.campaign_target_id = source_target\.id/);
  assert.doesNotMatch(campaigns, /linked\.organization = source_target\.organization/);
  assert.doesNotMatch(campaigns, /linked_project\.project_year\s*=/);
});

test("공동 연결은 기관 식별키·별칭·명시적 ID를 보존하고 다중 후보를 관리자에게 확인시킨다", () => {
  assert.match(institutionNames, /export function institutionIdentityKey/);
  assert.match(store, /institutionIdentityKey\(row\.organization, input\.aliasSetting\)/);
  assert.match(store, /if \(explicitActivityId\)/);
  assert.match(store, /if \(candidates\.length === 1\)/);
  assert.match(store, /if \(candidates\.length > 1\)/);
  assert.match(store, /throw new JointProjectActivityAmbiguityError/);
  assert.match(api, /activityCandidates: error\.candidatesByMember/);
  assert.match(modal, /실제 수주 기록 확인/);
  assert.match(modal, /연결할 수주 기록 선택/);
  assert.match(summary, /수주 기록 미연결/);
  assert.match(schema, /institutionKey: text\("institution_key"\)/);
  assert.match(identityMigration, /ADD `institution_key`/);
  assert.match(identityMigration, /joint_project_members_institution_idx/);
});

test("기관 합치기 후에도 공동사업 관계와 명시적 연결을 유지한다", () => {
  assert.match(institutionMerge, /UPDATE joint_project_members/);
  assert.match(institutionMerge, /activity_id = COALESCE\(activity_id/);
  assert.match(institutionMerge, /campaign_target_id = COALESCE\(campaign_target_id/);
  assert.match(institutionMerge, /institution_key = \?/);
  assert.match(institutionMerge, /UPDATE joint_projects[\s\S]*sponsor_organization = \?/);
});

test("전체 공동사업 점검은 정확히 한 건만 소급하고 모호한 후보는 변경하지 않는다", () => {
  assert.match(store, /export async function auditAndBackfillJointProjectLinks/);
  assert.match(store, /export async function applyJointProjectLinkBackfill/);
  assert.match(store, /resolved\.status === "resolved" && resolved\.candidates\.length === 1/);
  assert.match(store, /reason: resolved\.status === "ambiguous" \? "ambiguous" : "not_found"/);
  assert.match(store, /activity_link_backfill/);
  assert.match(api, /auditAndBackfillJointProjectLinks\(\)/);
  assert.match(api, /payload\.action === "backfill_links"/);
  assert.match(api, /applyJointProjectLinkBackfill\(\)/);
});

test("기관·예산 명단 조회와 백업 복원에 공동사업 관계가 포함된다", () => {
  assert.match(records, /joint_project_name/);
  assert.match(campaigns, /joint_project_name/);
  assert.match(backup, /name: "joint_projects"/);
  assert.match(backup, /name: "joint_project_members"/);
  assert.match(backup, /name: "joint_project_events"/);
  assert.match(backup, /"project_year"/);
  assert.match(backup, /"joint_round"/);
  assert.match(backup, /"institution_key"/);
  assert.match(backup, /DELETE FROM joint_project_members/);
  assert.match(backup, /"joint_project_members"/);
});
