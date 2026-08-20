import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the Korean collaborative sales management application", async () => {
  const [
    page,
    crm,
    styles,
    layout,
    baseMigration,
    collaborationMigration,
    awardMigration,
    scheduleMigration,
    contactMigration,
    awardManagementMigration,
    progressManagerMigration,
    mapMigration,
    actionRoute,
    aiRoute,
    sessionRoute,
    settingsRoute,
    mapPage,
    mapConfigRoute,
    mapLocationsRoute,
    recordsRoute,
    mapStore,
    regionFromAddress,
    openAIConfig,
    recordsStore,
    campaignMigration,
    campaignPortfolioMigration,
    campaignRoute,
    campaignPdfRoute,
    campaignStore,
    campaignXlsx,
    equipmentMigration,
    equipmentRoute,
    equipmentStore,
    backupPage,
    backupRoute,
    backupStore,
    activityCsv,
    activityXlsx,
    institutionNames,
    institutionMerge,
    institutionConfirmation,
    managerAlertMigration,
    managerAlertRoute,
    managerAlertStore,
    activityReviewMigration,
    activityReviewRoute,
    activityReviewStore,
    activityAssignmentMigration,
    activityAssignmentRoute,
    activityAssignmentStore,
    membersRoute,
    salesNames,
    salesManagerNormalization,
    salesNameMigration,
    aiRecommendationsRoute,
    aiRecommendationsStore,
    readability,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_wild_malcolm_colcord.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_same_sue_storm.sql", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0002_nappy_kinsey_walden.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0003_plain_swarm.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0004_fixed_union_jack.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0005_eager_kulan_gath.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0006_premium_talkback.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0007_luxuriant_slayback.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/gpt-actions/activities/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/ai/organize/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sales-map.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/map/config/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/map/locations/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/map-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/region-from-address.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/openai-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/records-store.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0008_sales-campaigns.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../drizzle/0054_budget_campaign_portfolio.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/api/map/campaigns/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/map/campaigns/pdf/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/campaign-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/campaign-xlsx.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0009_equipment-projects.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/equipment/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/equipment-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/data-backup-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/backup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/backup-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/activity-csv.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/activity-xlsx.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/institution-names.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/institution-merge.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/institution-confirmation.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0012_colorful_gabe_jones.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/manager-alerts/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/manager-alerts.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0013_fine_typhoid_mary.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/record-reviews/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/activity-reviews.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0014_nebulous_argent.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/records/assignee/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/activity-assignment-history.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/members/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sales-names.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/sales-manager-normalization.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0018_normalize_existing_sales_names.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/ai/recommendations/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/ai-recommendations.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/readability.css", import.meta.url), "utf8"),
  ]);
  const productVendorLinks = await readFile(
    new URL("../lib/product-vendor-links.ts", import.meta.url),
    "utf8",
  );
  const productCatalogPage = await readFile(
    new URL("../app/product-catalog-page.tsx", import.meta.url),
    "utf8",
  );
  const accountingPage = await readFile(
    new URL("../app/accounting-page.tsx", import.meta.url),
    "utf8",
  );
  const followupHeader =
    crm.match(
      /<table className="followup-table">[\s\S]*?<thead>([\s\S]*?)<\/thead>/,
    )?.[1] ?? "";

  assert.match(layout, /lang="ko"/);
  assert.match(layout, /위즈업 영업관리/);
  assert.match(page, /getApplicationIdentity/);
  assert.match(page, /LoginPage/);
  assert.match(page, /InitialPasswordSetup/);
  assert.match(crm, /새 기록/);
  assert.match(crm, /엑셀 대량 등록/);
  assert.match(crm, /엑셀 양식 다운로드/);
  assert.match(crm, /업로드 미리보기/);
  assert.match(crm, /saveActivityImportBatch/);
  assert.match(crm, /중복 의심 기록은 기본적으로 제외/);
  assert.match(activityXlsx, /WHIZZUP_새기록_대량등록_양식\.xlsx/);
  assert.match(activityXlsx, /<sheet name="기록 입력"/);
  assert.match(activityXlsx, /<sheet name="작성 안내"/);
  assert.match(activityXlsx, /<sheet name="선택값 안내"/);
  assert.match(activityXlsx, /한 번에 최대 5,000건/);
  assert.match(styles, /\.activity-import-preview/);
  assert.match(styles, /\.record-entry-tabs button \{[^}]*font-size: 13px/);
  assert.match(styles, /\.activity-import-actions strong \{[^}]*font-size: 14px/);
  assert.match(crm, /기관별 관리/);
  assert.doesNotMatch(crm, /<em>\{followupRows\.length\}<\/em>/);
  assert.doesNotMatch(crm, /awardCount/);
  assert.match(crm, /<th>순번<\/th>/);
  assert.match(
    crm,
    /className="sequence-cell">[\s\S]{0,120}DATA_LIST_PAGE_SIZE \+ index \+ 1/,
  );
  assert.doesNotMatch(
    crm,
    /<small>\{record\.dateConfidence\} · \{record\.createdByName\}<\/small>/,
  );
  assert.doesNotMatch(
    crm,
    /<small>\{record\.createdByName\}<\/small>/,
  );
  assert.doesNotMatch(crm, /<span>날짜 신뢰도<\/span>/);
  assert.match(crm, /records-table/);
  assert.match(styles, /\.sequence-cell/);
  assert.doesNotMatch(crm, /현재 목록 CSV/);
  assert.match(crm, /exportInstitutionWorkbook/);
  assert.match(crm, /exportAwardWorkbook/);
  assert.doesNotMatch(crm, /exportDashboardWorkbook/);
  assert.match(activityXlsx, /export function downloadRowsXlsx/);
  assert.match(
    activityXlsx,
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
  );
  assert.match(crm, /label: "데이터 백업·복구"/);
  assert.match(crm, /view === "backup"/);
  assert.match(backupPage, /전체 DB 백업 받기/);
  assert.match(backupPage, /활동 CSV 불러오기/);
  assert.match(backupPage, /복원 직전 백업 받기/);
  assert.match(backupPage, /restoreConfirmation !== "복원"/);
  assert.match(backupRoute, /requireMemberPermission\("backup:manage"\)/);
  assert.match(backupRoute, /inspect-backup/);
  assert.match(backupRoute, /restore-backup/);
  assert.match(backupRoute, /inspect-csv/);
  assert.match(backupRoute, /import-csv/);
  assert.match(backupStore, /BACKUP_FORMAT_VERSION = 1/);
  assert.match(backupStore, /organization_locations/);
  assert.match(backupStore, /sales_campaign_targets/);
  assert.match(backupStore, /equipment_items/);
  assert.match(backupStore, /product_vendor_links/);
  assert.match(backupStore, /product_supply_settings/);
  assert.match(backupStore, /"supply_type"/);
  assert.match(backupStore, /"margin_rate"/);
  assert.match(backupStore, /award_vendors/);
  assert.match(backupStore, /manager_alert_acknowledgements/);
  assert.match(backupStore, /checksumBackup/);
  assert.match(backupStore, /현재 운영자 계정/);
  assert.doesNotMatch(
    backupStore,
    /name:\s*"oauth_tokens"|name:\s*"oauth_codes"|client_secret_hash/,
  );
  assert.doesNotMatch(backupStore, /env\.OPENAI_API_KEY/);
  assert.match(activityCsv, /CSV_MAX_ROWS = 5_000/);
  assert.match(activityCsv, /입력자 이메일/);
  assert.match(activityCsv, /existingSignatures/);
  assert.match(activityCsv, /CSV 따옴표가 닫히지 않았습니다/);
  assert.match(styles, /\.backup-layout/);
  assert.match(styles, /\.restore-count-grid/);
  assert.match(crm, /admin-nav-group/);
  assert.match(crm, /보조관리자/);
  assert.doesNotMatch(crm, /\{ id: "records", label: "전체 이력", mark: "L" \}/);
  assert.match(
    crm,
    /id: "records" as View,[\s\S]{0,100}label: "팀 업무 현황"/,
  );
  assert.match(crm, /nextView === "records"/);
  assert.match(crm, /이 메뉴를 사용할 권한이 없습니다/);
  assert.match(crm, /엑셀 내보내기/);
  assert.match(crm, /selectedInstitutionIds/);
  assert.match(crm, /selectedAwardIds/);
  assert.match(crm, /구성원 승인/);
  assert.match(crm, /운영 도구 접근/);
  assert.doesNotMatch(crm, /추가 작업 권한/);
  assert.match(crm, /API 등록·관리/);
  assert.match(crm, /데이터 백업·복구/);
  assert.match(crm, /팀 업무 현황 · 관리자 영업 점검/);
  assert.match(crm, /운영자 권한 변경은 운영자만 가능합니다/);
  assert.match(crm, /이름·직책 저장/);
  assert.match(crm, /역할·기능 권한 저장/);
  assert.match(crm, /members:manage/);
  assert.match(styles, /\.member-access-editor/);
  assert.doesNotMatch(crm, /label: "공유 GPT 연결"/);
  assert.match(crm, /관리자 영업 점검/);
  assert.doesNotMatch(
    crm,
    /\{ id: "organizations", label: "기관별 보기", mark: "O" \}/,
  );
  assert.match(crm, /id: "organizations" as View/);
  assert.match(crm, /오늘 점검 필요/);
  assert.match(crm, /재연락 지연/);
  assert.match(crm, /14일 이상 정체/);
  assert.match(crm, /직원별 업무 점검/);
  assert.match(crm, /후속 관리율/);
  assert.match(crm, /개인을\s*단순 평가하기보다/);
  assert.match(styles, /\.manager-inspection-table/);
  assert.match(styles, /\.team-work-table/);
  assert.doesNotMatch(crm, /선택 삭제/);
  assert.match(crm, /선택 알림 확인 완료/);
  assert.match(crm, /3일 후 다시/);
  assert.match(crm, /7일 후 다시/);
  assert.match(crm, /처리한 알림/);
  assert.match(crm, /알림 복구/);
  assert.match(crm, /기관과 기록은 그대로 유지됩니다/);
  assert.match(managerAlertMigration, /manager_alert_acknowledgements/);
  assert.match(managerAlertRoute, /requireMemberPermission\("records:manage"\)/);
  assert.match(managerAlertRoute, /export async function DELETE/);
  assert.match(managerAlertStore, /ON CONFLICT\(member_id, organization\)/);
  assert.match(crm, /진행 중 수주/);
  assert.match(crm, /타업체 수주/);
  assert.match(crm, /수주업체명/);
  assert.match(crm, /타업체 수주 건에는 적용되지 않습니다/);
  assert.match(crm, /타업체 수주 결과로 자동 종료됩니다/);
  assert.match(crm, /수주 진행 단계/);
  assert.match(crm, /other-award-row/);
  assert.match(crm, /award-result-pill/);
  assert.match(styles, /\.other-award-row td/);
  assert.match(crm, /타업체 수주/);
  assert.match(crm, /executionType: isOtherCompanyAward/);
  assert.match(recordsStore, /executionType: "해당 없음"/);
  assert.match(recordsStore, /awardStage: "해당 없음"/);
  assert.match(recordsRoute, /execution_type: "해당 없음"/);
  assert.match(recordsRoute, /award_stage: "해당 없음"/);
  assert.match(activityXlsx, /values\.executionType = "해당 없음"/);
  assert.match(aiRoute, /isOtherCompanyAward/);
  assert.match(crm, /미팅·통화 내용을 편하게 남겨보세요/);
  assert.match(crm, /사이트에서 AI 정리/);
  assert.match(crm, /내용 확인·저장/);
  assert.match(crm, /개 기관으로 나눴습니다/);
  assert.match(crm, /개 기관 한 번에 저장/);
  assert.match(crm, /mergeAiDrafts/);
  assert.match(crm, /<h3>품목 관리<\/h3>/);
  assert.doesNotMatch(crm, /제안 수량/);
  assert.doesNotMatch(crm, /수주 수량/);
  assert.doesNotMatch(crm, /설치 수량/);
  assert.match(crm, /<span>수량<\/span>/);
  assert.match(crm, /equipment-entry-panel-inline/);
  assert.match(crm, /OrganizationEquipmentManager/);
  assert.match(
    crm,
    /기관에 제안·수주·설치할 품목과 공사비를 관리합니다/,
  );
  assert.match(
    crm,
    /필요한 품목을 제품 목록에서 선택하거나 직접 입력해 주세요/,
  );
  assert.doesNotMatch(crm, /equipment-project-amount/);
  assert.doesNotMatch(crm, /syncedBudgetType/);
  assert.doesNotMatch(crm, /openProjectEdit/);
  assert.doesNotMatch(crm, /removeProject/);
  assert.doesNotMatch(crm, /＋ 사업 추가/);
  assert.doesNotMatch(crm, /사업 수정/);
  assert.match(crm, /name: budgetType\.trim\(\) \|\| displayName/);
  assert.match(
    crm,
    /equipmentProjectName:\s*""/,
  );
  assert.doesNotMatch(
    crm,
    /setProjectDraft\(\{[\s\S]{0,120}budgetType: event\.target\.value/,
  );
  assert.doesNotMatch(crm, /saveAiEquipmentPreview/);
  assert.match(crm, /equipmentProjectStatus/);
  assert.doesNotMatch(crm, /품목 관리에 연결/);
  assert.doesNotMatch(crm, /제안·수주 품목/);
  assert.doesNotMatch(crm, /requestEquipmentSummaries/);
  assert.match(aiRoute, /equipmentProjectName/);
  assert.match(aiRoute, /equipmentProjectStatus/);
  assert.match(aiRoute, /equipmentItems/);
  assert.match(aiRoute, /equipmentProjectName:\s*""/);
  assert.match(aiRoute, /장비·물품의 품목, 수량, 규격, 설치 수량이나 품목 관리용 사업 정보를 추출하거나 만들지 마세요/);
  assert.doesNotMatch(aiRoute, /inferredEquipmentItemsFromSchedule/);
  assert.match(recordsRoute, /isAiInputActivity/);
  assert.match(recordsRoute, /skipAiEquipmentSync/);
  assert.doesNotMatch(equipmentRoute, /defaultProjectName/);
  assert.match(recordsRoute, /syncEquipmentProjectFromRecord/);
  assert.match(recordsRoute, /DEFAULT_RECORD_PAGE_SIZE = 500/);
  assert.match(recordsRoute, /MAX_RECORD_PAGE_SIZE = 500/);
  assert.match(recordsRoute, /LIMIT \? OFFSET \?/);
  assert.match(recordsRoute, /nextOffset/);
  assert.match(recordsRoute, /scope"\) === "dashboard"/);
  assert.match(recordsRoute, /ranked_organizations/);
  assert.match(recordsRoute, /recent_activities/);
  assert.match(crm, /pageSize = scope === "dashboard" \? 2_500 : 500/);
  assert.match(crm, /maximumPages = 1_000/);
  assert.match(crm, /recordsById/);
  assert.match(crm, /pagination\?\.hasMore/);
  assert.match(crm, /const nextRecords = await requestRecords\("dashboard"\)/);
  assert.doesNotMatch(crm, /preloadManagerRecords/);
  assert.match(crm, /requestRecords\("full"\)/);
  assert.match(
    recordsRoute,
    /SET budget_type = \?, status = \?, activity_id = COALESCE\(\?, activity_id\),/,
  );
  assert.match(
    aiRoute,
    /isPartnerCompanyAward \|\| isOtherCompanyAward/,
  );
  assert.match(aiRoute, /\? "해당 없음"\s*: member\.isSales/);
  assert.match(membersRoute, /status = 'approved' AND is_sales = 1/);
  assert.match(membersRoute, /export async function DELETE/);
  assert.match(crm, /영업 담당자 등록/);
  assert.match(crm, /거절·삭제/);
  assert.match(crm, /resolveRegisteredSalesName/);
  assert.match(salesNames, /salesNameAliasKey/);
  assert.match(salesNames, /aliasMatches\.length === 1/);
  assert.match(salesManagerNormalization, /SELECT DISTINCT progress_manager/);
  assert.match(salesManagerNormalization, /SET progress_manager = \?/);
  assert.match(salesManagerNormalization, /normalizeHistoricalProgressManagers/);
  assert.match(recordsStore, /progressManagerForAward/);
  assert.match(activityCsv, /canonicalProgressManagerName/);
  assert.match(salesNameMigration, /김동훈 과장/);
  assert.match(salesNameMigration, /이준상 본부장/);
  assert.match(aiRoute, /resolveActivityDateFromMessage/);
  assert.doesNotMatch(aiRoute, /activityDate: postedDate/);
  assert.doesNotMatch(
    aiRoute,
    /hasProgressSchedule && draft\.awardStatus === "미정"/,
  );
  assert.match(aiRoute, /institutionAliasKey/);
  assert.match(
    aiRoute,
    /draft\.organization = preferFullInstitutionName\(\.\.\.exactAliases\)/,
  );
  assert.doesNotMatch(aiRoute, /두 이름을 같은 기관으로 합칠까요/);
  assert.match(crm, /event\.shiftKey \|\| mobileTextEntry/);
  assert.match(crm, /모바일은\s+Enter로 줄바꿈/);
  assert.match(institutionNames, /초등학교 병설유치원/);
  assert.match(institutionNames, /여자고등학교/);
  assert.match(institutionNames, /남자고등학교/);
  assert.match(institutionNames, /findSimilarInstitutionNames/);
  assert.match(institutionNames, /findSimilarInstitutionMatches/);
  assert.match(institutionNames, /isSameRegionInstitution/);
  assert.match(institutionNames, /지역과 기관 핵심명이 같음/);
  assert.match(institutionNames, /기관 담당자가 같음/);
  assert.match(institutionNames, /진행 담당자가 같음/);
  assert.match(institutionNames, /상담 내용이 비슷함/);
  assert.match(institutionNames, /기관 유형이 같음/);
  assert.match(institutionNames, /SAFE_FACILITY_SUFFIXES/);
  assert.match(institutionNames, /INSTITUTION_ALIASES_SETTING_KEY/);
  assert.match(recordsStore, /rememberedInstitutionAlias/);
  assert.doesNotMatch(
    recordsStore,
    /if \(payload\.institutionSeparate !== true\) \{\s*const excludedCandidateKeys/,
  );
  assert.match(recordsStore, /institutionRejectedOrganizations/);
  assert.doesNotMatch(recordsStore, /const sameRegionAliases/);
  assert.match(institutionMerge, /updateInstitutionAliasSetting/);
  assert.match(institutionMerge, /manager_alert_acknowledgements/);
  assert.match(institutionNames, /score < 5 \|\| !hasNameEvidence/);
  assert.match(
    institutionConfirmation,
    /기존 기관과 연결할까요/,
  );
  assert.match(institutionConfirmation, /관련 기관으로 구분/);
  assert.match(institutionConfirmation, /새로운 별도 기관으로 등록/);
  assert.match(institutionConfirmation, /institutionSeparate/);
  assert.match(styles, /institution-confirmation-dialog/);
  assert.match(institutionNames, /officialSchoolSearchTerms/);
  assert.match(recordsStore, /resolveOfficialSchoolName/);
  assert.match(crm, /전국 학교정보 연결/);
  assert.match(crm, /fetchWithInstitutionConfirmation/);
  assert.match(
    crm,
    /view !== "dashboard" && view !== "map" && view !== "budget-institutions" && view !== "trash" && view !== "accounting" && view !== "analytics" && \(\s*<div className="global-search">/,
  );
  assert.match(mapPage, /기관명·담당자·주소·주제 검색/);
  assert.match(mapPage, /record\.contactName/);
  assert.match(mapPage, /record\.contactPhone/);
  assert.match(mapPage, /campaignTarget\?\.assignedMemberName/);
  assert.match(equipmentRoute, /kind === "ai-import"/);
  assert.match(
    equipmentRoute,
    /const projectName = \(budgetType \|\| requestedProjectName\)/,
  );
  assert.match(
    equipmentRoute,
    /SET name = CASE WHEN \? = '' THEN name ELSE \? END/,
  );
  assert.match(equipmentRoute, /inferProjectStatusFromRecord/);
  assert.match(equipmentRoute, /progressiveProjectStatus/);
  assert.doesNotMatch(equipmentRoute, /!organization \|\| !items\.length/);
  assert.match(equipmentRoute, /searchParams\.get\("summary"\) === "1"/);
  assert.match(equipmentRoute, /searchParams\.get\("protection"\) === "1"/);
  assert.match(equipmentRoute, /kind === "catalog-items"/);
  assert.match(equipmentRoute, /kind === "protection"/);
  assert.match(equipmentRoute, /protection_completed_at/);
  assert.match(equipmentRoute, /requireApprovedMember/);
  assert.match(equipmentRoute, /UPDATE activities[\s\S]*SET organization =/);
  assert.match(equipmentRoute, /renamedOrganization/);
  assert.match(equipmentStore, /CREATE TABLE IF NOT EXISTS equipment_projects/);
  assert.match(equipmentStore, /CREATE TABLE IF NOT EXISTS equipment_items/);
  assert.match(equipmentStore, /protection_status TEXT NOT NULL DEFAULT '신청 필요'/);
  assert.match(equipmentStore, /execution_type TEXT NOT NULL DEFAULT '직영'/);
  assert.match(equipmentStore, /consortium_payment_amount INTEGER/);
  assert.match(equipmentStore, /consortium_commission_rate REAL/);
  assert.match(equipmentStore, /supplier_vendor_name TEXT NOT NULL DEFAULT ''/);
  assert.match(equipmentStore, /procurement_fee_rate REAL/);
  assert.match(equipmentStore, /construction_amount INTEGER/);
  assert.match(equipmentRoute, /kind === "project-costs"/);
  assert.match(equipmentRoute, /cleanConsortiumSettlement/);
  assert.match(equipmentRoute, /commission_input_type/);
  assert.match(crm, /제품 목록에서 선택/);
  assert.doesNotMatch(crm, /slice\(0, normalizedCatalogSearch \? 60 : 20\)/);
  assert.match(crm, /협력사 수수료율/);
  assert.match(crm, /위즈업 직접 공급 마진율/);
  assert.match(crm, /컨소 지급방식/);
  assert.match(crm, /컨소 지급률/);
  assert.match(crm, /협력사 예상 수수료/);
  assert.match(crm, /직접 공급 예상 마진/);
  assert.match(crm, /총 컨소 지급/);
  assert.match(crm, /<span>총 마진<\/span>/);
  assert.match(crm, /마진율 \{projectMarginRate\.toFixed\(1\)\}%/);
  assert.match(crm, /조달 수수료/);
  assert.match(crm, /실공사비/);
  assert.match(crm, /영업보호 신청 필요/);
  assert.match(crm, /requestProtectionReviewItems/);
  assert.match(styles, /\.equipment-catalog-picker/);
  assert.match(styles, /\.equipment-protection\.pending/);
  assert.match(equipmentMigration, /CREATE TABLE `equipment_projects`/);
  assert.match(equipmentMigration, /CREATE TABLE `equipment_items`/);
  assert.match(productVendorLinks, /CREATE TABLE IF NOT EXISTS product_vendor_links/);
  assert.match(productVendorLinks, /supplier_vendor_name/);
  assert.match(productCatalogPage, /공급 구분/);
  assert.match(productCatalogPage, /위즈업 직접 공급/);
  assert.match(accountingPage, /남은 금액 전액 입금/);
  assert.match(institutionMerge, /DELETE FROM equipment_projects/);
  assert.match(recordsRoute, /canonicalInstitutionName/);
  assert.match(recordsRoute, /mergeInstitutionRecords/);
  assert.doesNotMatch(recordsRoute, /mergeExistingInstitutionAliases/);
  assert.match(recordsStore, /resolveInstitutionName/);
  assert.match(recordsStore, /InstitutionConfirmationRequiredError/);
  assert.match(recordsRoute, /institutionConfirmationResponse/);
  assert.match(crm, /isBundledOrganization/);
  assert.match(crm, /WHIZZUP SALES HUB/);
  assert.match(crm, /access-brand-logo/);
  assert.doesNotMatch(crm, /WIZ-UP SALES HUB/);
  assert.doesNotMatch(crm, /공유 GPT로 음성 입력/);
  assert.doesNotMatch(crm, /마이크로 말하기/);
  assert.doesNotMatch(crm, /webkitSpeechRecognition/);
  assert.match(crm, /navigator\.mediaDevices\.getUserMedia/);
  assert.doesNotMatch(crm, /speechShouldContinueRef/);
  assert.doesNotMatch(crm, /mergeSpeechParts/);
  assert.doesNotMatch(crm, /이미지 첨부/);
  assert.doesNotMatch(crm, /imageDataUrl/);
  assert.match(styles, /whizzup-logo\.png/);
  assert.match(layout, /\/whizzup-mark\.png/);
  await access(new URL("../public/whizzup-mark.png", import.meta.url));
  assert.match(styles, /\.access-brand-logo/);
  assert.match(styles, /\.oauth-brand-logo/);
  assert.match(styles, /\.brand \{[^}]*align-items: center/);
  assert.match(styles, /\.brand-product \{[^}]*text-align: center/);
  assert.match(crm, /\/api\/ai\/organize/);
  assert.doesNotMatch(crm, /event\.ctrlKey/);
  assert.match(crm, /event\.nativeEvent\.isComposing/);
  assert.match(crm, /수주 후 진행 일정/);
  assert.match(crm, /진행 일정에 따라 자동 설정되며 직접 변경할 수 있습니다/);
  assert.match(
    crm,
    /일정 날짜가 지나면 기관 상태와 연결된 품목 상태가 자동으로 바뀝니다/,
  );
  assert.match(crm, /automaticProgressManagement/);
  assert.match(recordsStore, /resolveProgressScheduleManagement/);
  assert.match(recordsStore, /entry\.date < todayValue/);
  assert.match(equipmentStore, /syncEquipmentItemsFromProgressSchedule/);
  assert.match(equipmentStore, /scheduleMatchesEquipment/);
  assert.doesNotMatch(crm, /<span>최근 30일 활동<\/span>/);
  assert.match(crm, /<span>2일 내 재연락<\/span>/);
  assert.match(crm, /dueSoonFollowups: actionable\.filter/);
  assert.match(crm, /followupAlertEnd\.setDate\(today\.getDate\(\) \+ 2\)/);
  assert.match(crm, /followupDueSoonOnly/);
  assert.match(crm, /다가오는 진행 일정/);
  assert.match(crm, /진행 중 수주/);
  assert.match(crm, /activeAwardOrganizationCount/);
  assert.match(
    crm,
    /const completedAwardStages = new Set\(\[COMPLETED_AWARD_STAGE, "완공"\]\)/,
  );
  assert.doesNotMatch(
    crm,
    /record\.status\.includes\("완료"\)\s*\|\|\s*isBundledOrganization\(record\.organization\)/,
  );
  assert.match(crm, /납품 완료 전 기관/);
  assert.match(mapPage, /isCompletedAwardStage\(record\.awardStage\)/);
  assert.match(crm, /upcomingProgressScheduleCount/);
  assert.match(crm, /function openMetricList/);
  assert.match(crm, /function navigateTo/);
  assert.match(crm, /"replaceState" : "pushState"/);
  assert.match(crm, /window\.history\.replaceState/);
  assert.match(crm, /window\.addEventListener\("popstate"/);
  assert.match(crm, /whizzupView/);
  assert.match(crm, /`\$\{baseUrl\}#\$\{nextView\}`/);
  assert.doesNotMatch(crm, /openMetricList\("recent"\)/);
  assert.match(crm, /onClick=\{\(\) => openMetricList\("followup"\)\}/);
  assert.match(crm, /onClick=\{\(\) => openMetricList\("schedules"\)\}/);
  assert.match(crm, /onClick=\{\(\) => openMetricList\("active-awards"\)\}/);
  assert.match(crm, /className="metric-link">목록 보기/);
  assert.match(crm, /view === "schedules"/);
  assert.match(crm, /type ScheduleRange = 14 \| 30 \| "all"/);
  assert.match(crm, /useState<ScheduleRange>\(30\)/);
  assert.match(crm, /const dashboardUpcoming = schedulesWithinRange\(14\)/);
  assert.match(crm, /선택한 기간에 예정된 진행 일정이 없습니다/);
  assert.match(crm, /teamPeriodDays !== "all"/);
  assert.match(crm, /setTeamPeriodDays\("all"\)/);
  assert.match(crm, /useState<TeamPeriod>\(30\)/);
  assert.match(crm, /teamPeriodDays !== 30/);
  assert.match(crm, /setTeamPeriodDays\(30\)/);
  assert.doesNotMatch(crm, />\s*7일\s*<\/button>/);
  assert.doesNotMatch(crm, />\s*전체 직원\s*<\/button>/);
  assert.match(crm, /const selectingMember =\s*selectedTeamMember !== metric\.name/);
  assert.match(crm, /selectingMember \? metric\.name : "전체"/);
  assert.match(crm, /<th>수주 전환<\/th>/);
  assert.match(crm, /conversionWonCount/);
  assert.match(crm, /현재 관리 대상 없음/);
  assert.match(crm, /팀 전체 확인 필요 업무/);
  assert.match(
    crm,
    /type TeamDetailMode = "activity" \| "attention" \| "conversion"/,
  );
  assert.match(crm, /const teamAttentionItems = useMemo/);
  assert.match(crm, /const teamConversionRecords = useMemo/);
  assert.match(crm, /const teamDetailRecords =/);
  assert.match(crm, /setTeamDetailMode\("conversion"\)/);
  assert.match(crm, /수주 전환 기관/);
  assert.match(crm, /수주 기관 \$\{metric\.conversionWonCount\}곳 보기/);
  assert.match(crm, /return teamPeriodLatestRecords/);
  assert.doesNotMatch(crm, /기간 선택과 관계없이 현재 해결되지 않은/);
  assert.match(crm, /현재 확인 필요 업무가 없습니다/);
  assert.match(crm, /setTeamDetailMode\("attention"\)/);
  assert.match(crm, /teamAttentionByRecordId/);
  assert.match(crm, /mark: "C"/);
  assert.match(crm, /registeredSalesManager !== selectedTeamMember/);
  assert.doesNotMatch(
    crm,
    /record\.createdByName !== selectedTeamMember/,
  );
  assert.doesNotMatch(crm, /record\.createdByName \|\| "등록자 미상"/);
  assert.match(crm, /record\.awardStatus !== "위즈업 수주"/);
  assert.match(styles, /\.schedule-row-button/);
  assert.match(styles, /\.team-work-kpi-card:hover/);
  assert.match(styles, /\.team-attention-row/);
  assert.match(styles, /\.team-conversion-button/);
  assert.match(styles, /\.team-conversion-row/);
  assert.match(styles, /\.team-detail-reset/);
  assert.match(
    styles,
    /\.metric-grid \{[^}]*grid-template-columns: repeat\(3,/,
  );
  assert.match(styles, /\.activity-detail-link/);
  assert.match(styles, /\.metric-card:hover/);
  assert.doesNotMatch(crm, /<span>전체 활동<\/span>/);
  assert.doesNotMatch(crm, /<span>관심도 높음<\/span>/);
  assert.match(crm, /schedule-dashboard-grid/);
  assert.doesNotMatch(crm, /ACTIVITY MIX/);
  assert.match(crm, /progressSchedule/);
  assert.match(crm, /management\?\.awardStage \?\? current\.awardStage/);
  assert.match(crm, /datePattern/);
  assert.doesNotMatch(crm, /activeWonOrganizations/);
  assert.match(crm, /기관별 관리\(수주 전\) 현황/);
  assert.match(crm, /최종 컨택일/);
  assert.doesNotMatch(crm, /<th>컨택<\/th>/);
  assert.match(followupHeader, /<th>기관 담당자<\/th>/);
  assert.doesNotMatch(followupHeader, /<th>제안·수주 품목<\/th>/);
  assert.doesNotMatch(followupHeader, /<th>상태<\/th>/);
  assert.match(crm, /aria-label="기관별 관리 정렬"/);
  assert.match(crm, /useState\("activity-desc"\)/);
  assert.match(crm, /재연락 예정일 임박순/);
  assert.match(crm, /최종 컨택 최신순/);
  assert.match(crm, /최종 컨택 오래된순/);
  assert.match(crm, /setFollowupSort\("activity-desc"\)/);
  assert.match(crm, /const dashboardRecentRecords = useMemo/);
  assert.match(
    crm,
    /resolveRegisteredSalesName\(\s*sessionDisplayName,\s*registeredSalesNames/,
  );
  assert.match(
    crm,
    /resolveRegisteredSalesName\(\s*record\.progressManager,\s*registeredSalesNames/,
  );
  assert.match(crm, /\.slice\(0, 20\)/);
  assert.match(
    crm,
    /view !== "dashboard" &&\s*!\(view === "records" && teamDetailMode !== "activity"\)/,
  );
  assert.match(
    crm,
    /view === "dashboard" \? dashboardRecentRecords : pagedTeamDetailRecords/,
  );
  assert.match(crm, /<th>내용<\/th>/);
  assert.match(
    crm,
    /<th>내용<\/th><th>진행 담당자<\/th><th>상태<\/th>/,
  );
  assert.match(
    crm,
    /className="activity-detail-link"[\s\S]{0,240}setDetailOrganization\(record\.organization\)/,
  );
  assert.match(
    crm,
    /view === "dashboard" && \([\s\S]{0,180}record\.progressManager \|\| "미등록"/,
  );
  assert.match(styles, /\.dashboard-records table \{ min-width: 1120px; \}/);
  assert.match(styles, /\.dashboard-table-wrap \{ max-height:/);
  assert.doesNotMatch(crm, /팀 활동 로그에서 전체 \{records\.length\}건 보기/);
  assert.doesNotMatch(crm, /최근 \{dashboardRecentRecords\.length\}건 엑셀/);
  assert.match(crm, /시연 모드 시작/);
  assert.match(crm, /시연 모드 종료/);
  assert.match(crm, /시연 모드를 종료했습니다/);
  assert.match(crm, /sessionStorage\.setItem\(presentationModeStorageKey/);
  assert.match(crm, /const presentationHiddenViews = new Set<View>\(\[/);
  assert.match(crm, /visibleManagementNavItems/);
  assert.match(crm, /팀 업무 현황과 관리자 영업점검을 숨겼습니다/);
  assert.match(crm, /팀 업무 현황과 관리자 영업점검만 숨깁니다/);
  assert.doesNotMatch(crm, /!presentationMode &&\s*\(managementNavItems/);
  assert.doesNotMatch(crm, /운영 도구와 사용자 정보를 숨겼습니다/);
  assert.match(crm, /event\.key !== "Escape"/);
  assert.doesNotMatch(crm, /\? "시연 화면"/);
  assert.match(styles, /\.profile-popover/);
  assert.doesNotMatch(crm, /컨택·공유/);
  assert.doesNotMatch(crm, /<span>컨택 유형<\/span>/);
  assert.doesNotMatch(crm, /<span>영업 진행 상태<\/span>/);
  assert.doesNotMatch(crm, /<span>관심도<\/span>/);
  assert.doesNotMatch(crm, /<span>기록 출처<\/span>/);
  assert.match(
    crm,
    /const typeOptions = \[\.\.\.ACTIVITY_TYPE_OPTIONS\]/,
  );
  assert.match(crm, /기관 담당자/);
  assert.match(crm, /기관 메일/);
  assert.match(crm, /진행 담당자/);
  assert.match(
    crm,
    /<th>수주일<\/th>\s*<th>지역<\/th>\s*<th>기관<\/th>\s*<th>예산<\/th>\s*<th>계약금액<\/th>/,
  );
  assert.doesNotMatch(crm, /<th>최근 진행 내용<\/th>/);
  assert.match(crm, /hasResolvedStandardBudget\(record\)/);
  assert.match(crm, /표준 예산 연결 필요/);
  assert.match(crm, /진행 공유/);
  assert.doesNotMatch(crm, /단톡방 공유용/);
  assert.doesNotMatch(crm, /SHARE MESSAGE/);
  assert.doesNotMatch(crm, /저장된 공유 문구/);
  assert.doesNotMatch(crm, /buildActivityBatchShareText/);
  assert.doesNotMatch(crm, /OrganizationAiRecommendations/);
  assert.match(crm, /상세 기록 보기/);
  assert.match(crm, /className="activity-detail-dialog"/);
  assert.match(crm, /AI 자동 판단/);
  assert.match(crm, /setRecords\(\(current\) => upsertActivity/);
  assert.doesNotMatch(crm, /navigator\.share/);
  assert.match(crm, /formatInputTime\(record\.createdAt\)/);
  assert.doesNotMatch(crm, /AI 추천 대응 보기/);
  assert.match(
    aiRecommendationsRoute,
    /export const DELETE = removedRecommendationResponse/,
  );
  assert.match(aiRecommendationsRoute, /status: 410/);
  assert.match(aiRecommendationsRoute, /recommendations: \[\]/);
  assert.match(
    aiRecommendationsStore,
    /DELETE FROM ai_recommendations WHERE id = \?/,
  );
  assert.doesNotMatch(
    aiRecommendationsStore,
    /deleteAiRecommendation[\s\S]{0,900}DELETE FROM activities/,
  );
  assert.match(crm, /MY RECORD CHECK/);
  assert.match(crm, /내 기록 점검/);
  assert.match(crm, /기록·품목 금액 보완과 영업보호 신청 업무를 한곳에서 확인합니다/);
  assert.match(crm, /record\.progressManager\.trim\(\) === displayName/);
  assert.doesNotMatch(crm, /record\.createdByName\.trim\(\) === displayName/);
  assert.match(crm, /현재 정보로 확인 완료/);
  assert.match(crm, /내일 다시 보기/);
  assert.match(crm, /전체 기록 보기/);
  assert.match(crm, /진행 담당자 변경/);
  assert.match(crm, /진행 담당자를 \$\{assignee\.displayName\}님으로 변경했습니다/);
  assert.match(crm, /\/api\/records\/assignee/);
  assert.match(crm, /\/api\/members\?scope=assignees/);
  assert.match(crm, /activityReviewFields/);
  assert.match(crm, /session\?\.member\.displayName/);
  assert.match(styles, /\.my-record-review-card/);
  assert.match(styles, /\.record-review-drawer/);
  assert.match(activityReviewMigration, /activity_review_acknowledgements/);
  assert.match(activityReviewRoute, /requireApprovedMember/);
  assert.match(activityReviewRoute, /listActivityReviewAcknowledgements/);
  assert.match(activityReviewStore, /ON CONFLICT\(member_id, activity_id\)/);
  assert.match(activityAssignmentMigration, /activity_assignment_history/);
  assert.match(activityAssignmentRoute, /requireApprovedMember/);
  assert.match(activityAssignmentRoute, /transferActivityAssignment/);
  assert.match(
    activityAssignmentStore,
    /canCollaborativelyManageSalesRecords/,
  );
  assert.match(activityAssignmentStore, /changed_by_member_id/);
  assert.match(membersRoute, /scope === "assignees"/);
  assert.match(membersRoute, /WHERE status = 'approved'/);
  assert.match(backupStore, /activity_assignment_history/);
  assert.match(
    aiRoute,
    /활동유형은 TM·통화, 미팅·방문, 문자·메일, 기타 중 하나만 사용하세요/,
  );
  assert.match(aiRoute, /const explicitCall/);
  assert.match(aiRoute, /const activityType = explicitCall/);
  assert.match(aiRoute, /이번 활동이 통화라면 activityType은 반드시 TM·통화/);
  assert.match(crm, /기관별 관리\(수주 후\) 현황/);
  assert.match(
    crm,
    /view !== "awards" && \([\s\S]{0,220}aria-label="활동 유형 필터"/,
  );
  assert.match(
    crm,
    /view !== "awards" && typeFilter !== "전체 유형"/,
  );
  assert.match(crm, /영업·수주 지도/);
  assert.match(crm, /<SalesMapPage/);
  assert.match(
    crm,
    /const SalesMapPage = lazy\(\(\) => import\("\.\/sales-map"\)\)/,
  );
  assert.doesNotMatch(crm, /mapVisited|setMapVisited/);
  assert.match(
    crm,
    /\{\(view === "map" \|\| view === "budget-institutions"\) && \(/,
  );
  assert.match(crm, /<SalesMapPage\s+active/);
  assert.match(
    crm,
    /displayMode=\{\s*view === "budget-institutions" \? "budget" : "map"\s*\}/,
  );
  assert.match(mapPage, /if \(mapRef\.current && sdkRef\.current\)/);
  assert.doesNotMatch(
    mapPage,
    /\[javascriptKey, configLoading, locationsLoading, mapLoadAttempt\]/,
  );
  assert.match(crm, /const latestAwardRecords = useMemo/);
  assert.match(
    crm,
    /const sourceRecords = view === "awards" \? latestAwardRecords : records/,
  );
  assert.match(mapPage, /영업 중/);
  assert.doesNotMatch(mapPage, /영업 후보|완료 실적 보기|showcaseMode/);
  assert.match(mapPage, /지도 보기/);
  assert.match(mapPage, /목록·동선/);
  assert.match(mapPage, /mobile-view-/);
  assert.match(styles, /\.sales-map-layout\.mobile-view-map \.sales-map-sidebar/);
  assert.match(styles, /70svh/);
  assert.doesNotMatch(mapPage, /scrollIntoView/);
  assert.match(mapPage, /const center = map\.getCenter\(\)/);
  assert.match(mapPage, /isMobileMapLayout \|\|/);
  assert.match(mapPage, /지도 이동과 관계없이 선택한 기관을 유지합니다/);
  assert.doesNotMatch(styles, /\.map-nearby-panel \{ order: -3;/);
  assert.doesNotMatch(styles, /\.sales-map-layout \{[^}]*order: -1;/);
  assert.match(styles, /\.sidebar \{[^}]*height: 100dvh/);
  assert.match(styles, /\.sidebar \{[^}]*overflow-y: auto/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /\.sidebar > \.profile-menu \{ flex: 0 0 auto; \}/);
  assert.match(crm, /메뉴 순서/);
  assert.match(crm, /순서 변경/);
  assert.match(crm, /저장·잠금/);
  assert.match(crm, /menuOrderStoragePrefix/);
  assert.match(crm, /localStorage\.setItem/);
  assert.match(crm, /끌어서 순서 변경/);
  assert.match(crm, /저장·잠금/);
  assert.match(styles, /\.menu-order-toolbar/);
  assert.match(styles, /\.nav-drag-handle/);
  assert.match(mapPage, /방문 순서 추천/);
  assert.match(mapPage, /출발지 선택/);
  assert.match(mapPage, /다른 출발지/);
  assert.match(mapPage, /위즈업 본사/);
  assert.match(mapPage, /recommendRouteFromCurrentLocation/);
  assert.match(mapPage, /route-current-location/);
  assert.match(mapPage, /위치 확인 중/);
  assert.match(styles, /\.nearby-origin-marker \{[^}]*min-width: 56px/);
  assert.match(styles, /\.nearby-origin-marker \{[^}]*height: 30px/);
  assert.match(
    mapPage,
    /경기도 하남시 하남대로 947 하남테크노밸리 U1 CENTER/,
  );
  assert.match(mapPage, /async function findRouteOrigin/);
  assert.match(mapPage, /async function recommendRoute\(startQuery/);
  assert.doesNotMatch(mapPage, /function currentPosition/);
  assert.doesNotMatch(mapPage, /선택 기관만 보기|onlySelected|setOnlySelected/);
  assert.match(
    mapPage,
    /eligibleOrganizations\.filter\(\s*\(item\) =>\s*activeSelected\.includes/,
  );
  assert.match(mapPage, /카테고리 혼합 가능/);
  assert.match(mapPage, /\.\.\.new Set\(\[/);
  assert.match(mapPage, /기관 목록 열기/);
  assert.match(mapPage, /Geocoder/);
  assert.match(mapPage, /병설\(\?:유치원\)\?/);
  assert.match(mapPage, /초등학교\/g, "초"/);
  assert.match(mapPage, /localityWithSuffix/);
  assert.doesNotMatch(mapPage, /www\.google\.com\/search\?q=/);
  assert.match(mapPage, /주소는 위치 미등록 상태로/);
  assert.match(mapPage, /addressSearch/);
  assert.match(mapPage, /학교·기관명 또는 도로명·지번 주소/);
  assert.match(mapPage, /카카오 길찾기/);
  assert.match(mapPage, /네이버 지도/);
  assert.match(mapPage, /className="map-focus-phone-link"/);
  assert.match(mapPage, /href=\{`tel:\$\{focusedDialPhone\}`\}/);
  assert.match(mapPage, /aria-label=\{`\$\{focused\.organization\} 전화 걸기`\}/);
  assert.match(mapPage, /위치 찾기/);
  assert.match(mapPage, /미등록 \$\{unmappedCount\}곳 보기/);
  assert.match(mapPage, /showingUnmappedList/);
  assert.match(mapPage, /setLocationFilter\("위치 미등록"\)/);
  assert.match(mapPage, /전체 기관 보기/);
  assert.match(
    mapPage,
    /<div className="map-toolbar-actions">[\s\S]{0,1800}미등록 \$\{unmappedCount\}곳 보기/,
  );
  assert.doesNotMatch(
    mapPage,
    /\{isAdmin && \(\s*<button[\s\S]{0,400}className=\{`auto-locate/,
  );
  assert.match(
    mapPage,
    /\{canEditLocations && \(\s*<button[\s\S]{0,240}className="map-location-button"[\s\S]{0,240}위치 변경/,
  );
  assert.match(crm, /canEditLocations=\{sessionStatus === "approved"\}/);
  assert.match(
    mapPage,
    /!canEditLocations \|\|[\s\S]{0,180}autoLocateRunningRef\.current/,
  );
  assert.match(mapPage, /findAutomaticOrganizationPlace/);
  assert.match(mapPage, /autoLocateAttemptedRef/);
  assert.match(
    mapPage,
    /개 기관의 위치와 지역을 자동으로 등록했습니다/,
  );
  assert.match(mapPage, /영업 카테고리/);
  assert.match(mapPage, /엑셀 양식 다운로드/);
  assert.match(mapPage, /엑셀 가져오기/);
  assert.match(mapPage, /PDF로 등록/);
  assert.match(mapPage, /PDF 분석 결과 확인/);
  assert.match(mapPage, /기관 직접 등록/);
  assert.match(mapPage, /\+ 기관 한 곳 추가/);
  assert.match(mapPage, /아직 저장되지 않았습니다/);
  assert.match(mapPage, /existingOrganizations/);
  assert.match(mapPage, /confirmedOrganization/);
  assert.match(mapPage, /지원·공급 내용/);
  assert.match(mapPage, /기관별 예산/);
  assert.match(mapPage, /예산·공고별 기관 명단/);
  assert.match(mapPage, /단계와 관계없이 선택 가능/);
  assert.match(mapPage, /이번 명단 예산명으로 변경/);
  assert.match(mapPage, /기존 진행 단계·완료일·제품·회계 기록은 유지됩니다/);
  assert.match(mapPage, /businessMatchMode/);
  assert.match(mapPage, /BudgetNameSelector/);
  assert.match(mapPage, /기관별 관리/);
  assert.match(mapPage, /영업 담당자/);
  assert.match(mapPage, /지도 위치는 뒤에서 자동으로 찾고 있습니다/);
  assert.match(mapPage, /pendingRows\.slice\(index, index \+ 5\)/);
  assert.match(mapPage, /searchKakaoKeyword\(maps, query\)/);
  assert.match(mapPage, /캠페인만 삭제/);
  assert.match(mapPage, /캠페인과 등록 기관 함께 삭제/);
  assert.match(mapPage, /campaignImport\.source === "pdf"[\s\S]{0,100}\? campaignImport\.rows/);
  assert.match(mapPage, /\/api\/map\/campaigns/);
  assert.match(campaignXlsx, /WHIZZUP_영업지도_등록양식\.xlsx/);
  assert.match(campaignXlsx, /기관명/);
  assert.match(campaignXlsx, /주소/);
  assert.match(campaignXlsx, /전화번호/);
  assert.match(campaignXlsx, /zipSync/);
  assert.match(
    campaignRoute,
    /export async function POST[\s\S]*requireApprovedMember\(\)/,
  );
  assert.match(
    campaignRoute,
    /export async function DELETE[\s\S]*requireApprovedMember\(\)/,
  );
  assert.doesNotMatch(
    mapPage,
    /\{isAdmin && \(\s*<button[\s\S]{0,300}엑셀 가져오기/,
  );
  assert.match(campaignRoute, /insertActivity/);
  assert.match(campaignRoute, /예산별 기관 엑셀 가져오기/);
  assert.match(campaignRoute, /예산별 기관 직접 등록/);
  assert.match(campaignRoute, /skipOfficialSchoolLookup: true/);
  assert.match(campaignRoute, /skipInstitutionStateLookup: reviewedNewPdfInstitution/);
  assert.match(campaignRoute, /target\.businessMatchMode === "link-current"/);
  assert.match(campaignRoute, /target\.linkedActivityId/);
  assert.match(campaignRoute, /target\.updateLinkedBudget/);
  assert.match(campaignRoute, /award_status NOT IN \('협력사 수주', '타업체 수주'\)/);
  assert.match(campaignRoute, /budget_original_name = CASE/);
  assert.match(campaignRoute, /created_activity = 1/);
  assert.match(campaignRoute, /deleteRegisteredInstitutions/);
  assert.match(campaignRoute, /removeCreatedActivities/);
  assert.match(institutionConfirmation, /cancelled: true/);
  assert.match(institutionConfirmation, /기관 연결 확인을 취소했습니다/);
  assert.match(recordsStore, /payload\.skipOfficialSchoolLookup === true/);
  assert.match(recordsStore, /payload\.skipInstitutionStateLookup === true/);
  assert.match(crm, /첫 TM·미팅 기록 입력/);
  assert.match(crm, /function openNewForOrganization/);
  assert.match(crm, /기관 최신 정보 요약/);
  assert.match(crm, /detailDisplayRecord/);
  assert.match(campaignPdfRoute, /requireApprovedMember/);
  assert.match(campaignPdfRoute, /type: "input_file"/);
  assert.match(campaignPdfRoute, /detail: "high"/);
  assert.match(campaignPdfRoute, /json_schema/);
  assert.match(campaignPdfRoute, /findSimilarInstitutionNames/);
  assert.match(campaignPdfRoute, /MAX_PDF_BYTES/);
  assert.match(campaignStore, /CREATE TABLE IF NOT EXISTS sales_campaigns/);
  assert.match(campaignMigration, /CREATE TABLE `sales_campaigns`/);
  assert.match(campaignMigration, /CREATE TABLE `sales_campaign_targets`/);
  assert.match(campaignPortfolioMigration, /budget_group_id/);
  assert.match(campaignPortfolioMigration, /business_round/);
  assert.match(campaignPortfolioMigration, /created_activity/);
  assert.match(crm, /budget-institutions/);
  assert.doesNotMatch(mapPage, /저장 위치 삭제|removeLocation/);
  assert.match(mapPage, /\/api\/map\/config/);
  assert.match(mapPage, /\/api\/map\/locations/);
  assert.match(mapPage, /void fetch\("\/api\/map\/config"/);
  assert.match(mapPage, /void fetch\("\/api\/map\/locations"/);
  assert.match(mapPage, /void fetch\("\/api\/map\/campaigns"/);
  assert.match(
    mapPage,
    /\[\s*active,\s*configLoading,\s*displayMode,\s*javascriptKey,\s*mapLoadAttempt,\s*\]/,
  );
  assert.match(mapPage, /지도 다시 불러오기/);
  assert.match(mapPage, /12_000/);
  assert.match(mapConfigRoute, /kakao_javascript_key/);
  assert.match(
    mapConfigRoute,
    /requireMemberPermission\("integration:manage"\)/,
  );
  assert.match(mapLocationsRoute, /requireApprovedMember/);
  assert.doesNotMatch(mapLocationsRoute, /requireMemberPermission/);
  assert.doesNotMatch(mapLocationsRoute, /export async function DELETE/);
  assert.match(
    mapLocationsRoute,
    /기관별 관리에 없는 기관은 저장할 수 없습니다/,
  );
  assert.match(mapLocationsRoute, /regionFromAddress/);
  assert.match(
    mapLocationsRoute,
    /UPDATE activities[\s\S]*SET region = \?, updated_at = CURRENT_TIMESTAMP[\s\S]*WHERE organization = \?/,
  );
  assert.match(mapStore, /has_region_mismatch/);
  assert.match(mapPage, /await onRecordsChanged\(\)/);
  assert.doesNotMatch(recordsRoute, /syncRegionsFromMappedLocations/);
  assert.match(recordsRoute, /resolveMappedRegion/);
  assert.match(recordsStore, /resolveMappedRegion/);
  assert.match(recordsStore, /let recordsReadyPromise/);
  assert.match(mapStore, /let mapReadyPromise/);
  assert.match(
    recordsRoute,
    /await Promise\.all\(\[[\s\S]{0,500}syncEquipmentItemsFromProgressSchedule[\s\S]{0,500}promotePlannedEquipmentFromActivity/,
  );
  assert.match(campaignRoute, /regionFromAddress/);
  assert.match(regionFromAddress, /경기도: "경기"/);
  assert.match(regionFromAddress, /강원특별자치도: "강원"/);
  assert.match(regionFromAddress, /return `\$\{province\} \$\{district\}`/);
  assert.match(recordsRoute, /DELETE FROM organization_locations/);
  assert.match(recordsRoute, /activities\.organization = organization_locations\.organization/);
  assert.match(recordsRoute, /DELETE FROM sales_campaign_targets/);
  assert.match(recordsRoute, /activities\.organization = sales_campaign_targets\.organization/);
  assert.match(mapStore, /organization_locations/);
  assert.match(mapMigration, /CREATE TABLE `organization_locations`/);
  assert.doesNotMatch(mapPage, /REST_API_KEY|KAKAO_REST/);
  assert.match(crm, /계약금액/);
  assert.match(crm, /수주 등록/);
  assert.match(crm, /aria-label="수주 관리 정렬"/);
  assert.match(crm, /금액 높은순/);
  assert.match(crm, /기관명순/);
  assert.match(crm, /function parseMoneyAmount/);
  assert.match(crm, /budgetAmount: formatMoneyInput/);
  assert.match(crm, /inputMode="decimal"/);
  assert.match(styles, /\.filter-row \.sort-select/);
  assert.match(crm, /function openNewAward/);
  assert.match(crm, /<option value="전체 수주">전체<\/option>/);
  assert.match(crm, /content-wide/);
  assert.match(styles, /\.content\.content-wide/);
  assert.match(styles, /\.award-register-button/);
  assert.match(crm, /사업방식/);
  assert.match(crm, /컨소 업체명/);
  assert.match(recordsStore, /requestedExecutionType === "컨소" \? "컨소" : "직영"/);
  assert.match(
    recordsStore,
    /UPDATE activities SET execution_type = '직영'/,
  );
  assert.match(crm, /현재 상태/);
  assert.match(crm, /협상/);
  assert.match(crm, /설치·공사 진행/);
  assert.match(crm, /검수·교육 진행/);
  assert.match(crm, /납품 완료/);
  assert.match(crm, /이전 히스토리/);
  assert.match(crm, /award-record-row/);
  assert.match(crm, /상세와 이전 히스토리 보기/);
  assert.match(crm, /최신 기록 수정/);
  assert.match(crm, /award-stage-cell/);
  assert.match(crm, /납품 완료/);
  assert.match(styles, /\.awards-table th:nth-child\(10\)/);
  assert.match(crm, /history-event-actions/);
  assert.match(crm, /이 기록 삭제/);
  assert.match(styles, /\.modal-delete-button/);
  assert.match(styles, /\.followup-table th \{ height: 48px; font-size: 12px; \}/);
  assert.match(styles, /\.followup-table td \{ height: 82px; font-size: 13px; \}/);
  assert.match(styles, /\.history-header h2 \{[^}]*font-size: 28px/);
  assert.match(styles, /\.equipment-item-name strong \{[^}]*font-size: 13px/);
  assert.match(styles, /\.execution-pill,[\s\S]*\.award-stage \{ font-size: 11px; \}/);
  assert.match(crm, /<th>예산<\/th>/);
  assert.match(crm, /<BudgetNameSelector/);
  assert.match(activityXlsx, /\["budgetType", "예산"/);
  assert.match(activityXlsx, /"예산명", "예산 종류", "budget_type"/);
  assert.match(activityCsv, /"예산",\s*"예산금액"/);
  assert.match(activityCsv, /"예산", "예산명", "예산 종류", "budget_type"/);
  assert.match(crm, /isUnregisteredBudgetName\(value\)/);
  assert.match(crm, /toggleInstitutionBulkEditor/);
  assert.match(crm, /method: editingId \? "PUT" : "POST"/);
  assert.match(baseMigration, /CREATE TABLE `activities`/);
  assert.match(collaborationMigration, /CREATE TABLE `members`/);
  assert.match(collaborationMigration, /CREATE TABLE `oauth_tokens`/);
  assert.match(awardMigration, /ADD `award_status`/);
  assert.match(awardMigration, /ADD `award_company`/);
  assert.match(scheduleMigration, /progress_schedule/);
  assert.match(contactMigration, /contact_method/);
  assert.match(contactMigration, /budget_amount/);
  assert.match(awardManagementMigration, /execution_type/);
  assert.match(awardManagementMigration, /consortium_company/);
  assert.match(awardManagementMigration, /award_stage/);
  assert.match(progressManagerMigration, /progress_manager/);
  assert.match(actionRoute, /getOAuthMember/);
  assert.match(actionRoute, /insertActivity/);
  assert.match(aiRoute, /requireApprovedMember/);
  assert.match(aiRoute, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(aiRoute, /json_schema/);
  assert.match(aiRoute, /drafts/);
  assert.doesNotMatch(aiRoute, /input_image/);
  assert.doesNotMatch(aiRoute, /imageDataUrl/);
  assert.match(aiRoute, /외 N건/);
  assert.match(aiRoute, /normalizeDrafts/);
  assert.match(styles, /max-height: 377px/);
  assert.match(aiRoute, /store: false/);
  assert.match(openAIConfig, /getEffectiveOpenAIConfig/);
  assert.match(crm, /gpt-5\.4-mini/);
  assert.doesNotMatch(aiRoute, /sk-[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(openAIConfig, /sk-[A-Za-z0-9_-]{20,}/);
  assert.match(sessionRoute, /requireMember/);
  assert.match(sessionRoute, /aiConfigured/);
  assert.match(
    settingsRoute,
    /requireMemberPermission\("integration:manage"\)/,
  );
  assert.doesNotMatch(settingsRoute, /requireApprovedMember/);
  assert.doesNotMatch(recordsStore, /seedActivities|SELECT COUNT\(\*\) AS count FROM activities/);
  assert.doesNotMatch(crm, /SkeletonPreview|react-loading-skeleton/i);
});
