import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
const origin = "http://localhost:3107";
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
);
childEnv.Path = [
  fileURLToPath(
    new URL(
      "../../.runtime/node-v24.18.0-win-x64",
      import.meta.url,
    ),
  ),
  "C:\\Windows\\System32",
  "C:\\Windows",
].join(";");
childEnv.OPENAI_API_KEY = "";

const server = spawn(
  process.execPath,
  [cliPath, "dev", "--host", "127.0.0.1", "--port", "3107"],
  {
    cwd: projectRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

const ownerHeaders = {
  "x-dev-user-email": "owner@local.test",
  "x-dev-user-name": encodeURIComponent("로컬 관리자"),
};
const memberHeaders = {
  "x-dev-user-email": "integration.member@local.test",
  "x-dev-user-name": encodeURIComponent("통합 테스트 구성원"),
};

async function waitUntilReady() {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`개발 서버가 일찍 종료됐습니다.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${origin}/privacy`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`개발 서버 시작 시간이 초과됐습니다.\n${serverOutput}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${origin}${path}`, options);
  let payload = {};
  const text = await response.text();
  if (text) payload = JSON.parse(text);
  return { response, payload };
}

async function jsonRequest(path, method, headers, body) {
  return request(path, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

try {
  await waitUntilReady();

  const ownerSession = await request("/api/session", {
    headers: ownerHeaders,
  });
  assert.equal(
    ownerSession.response.status,
    200,
    `${JSON.stringify(ownerSession.payload)}\n${serverOutput}`,
  );
  assert.equal(ownerSession.payload.member.role, "admin");
  assert.equal(ownerSession.payload.member.status, "approved");

  const memberSession = await request("/api/session", {
    headers: memberHeaders,
  });
  assert.equal(memberSession.response.status, 200);

  const team = await request("/api/members", { headers: ownerHeaders });
  assert.equal(team.response.status, 200);
  const testMember = team.payload.members.find(
    (member) => member.email === "integration.member@local.test",
  );
  assert.ok(testMember);

  const resetPending = await jsonRequest(
    "/api/members",
    "PUT",
    ownerHeaders,
    { id: testMember.id, status: "pending", role: "member" },
  );
  assert.equal(resetPending.response.status, 200);

  const pendingRecords = await request("/api/records", {
    headers: memberHeaders,
  });
  assert.equal(pendingRecords.response.status, 403);

  const approval = await jsonRequest(
    "/api/members",
    "PUT",
    ownerHeaders,
    { id: testMember.id, status: "approved", role: "member" },
  );
  assert.equal(approval.response.status, 200);

  const renamedMember = await jsonRequest(
    "/api/members",
    "PATCH",
    ownerHeaders,
    { id: testMember.id, displayName: "통합 구성원" },
  );
  assert.equal(renamedMember.response.status, 200);
  assert.equal(renamedMember.payload.member.display_name, "통합 구성원");

  const resetMemberSales = await jsonRequest(
    "/api/members",
    "PATCH",
    ownerHeaders,
    { id: testMember.id, isSales: false },
  );
  assert.equal(resetMemberSales.response.status, 200);

  const nonSalesAssignees = await request(
    "/api/members?scope=assignees",
    { headers: memberHeaders },
  );
  assert.equal(nonSalesAssignees.response.status, 200);
  assert.equal(
    nonSalesAssignees.payload.members.some(
      (member) => member.id === testMember.id,
    ),
    false,
  );

  const ownerSalesRegistration = await jsonRequest(
    "/api/members",
    "PATCH",
    ownerHeaders,
    { id: ownerSession.payload.member.id, isSales: true },
  );
  assert.equal(ownerSalesRegistration.response.status, 200);
  assert.equal(ownerSalesRegistration.payload.member.is_sales, 1);

  const memberSalesRegistration = await jsonRequest(
    "/api/members",
    "PATCH",
    ownerHeaders,
    { id: testMember.id, isSales: true },
  );
  assert.equal(memberSalesRegistration.response.status, 200);
  assert.equal(memberSalesRegistration.payload.member.is_sales, 1);

  const renamedSession = await request("/api/session", {
    headers: memberHeaders,
  });
  assert.equal(renamedSession.response.status, 200);
  assert.equal(renamedSession.payload.member.displayName, "통합 구성원");
  assert.equal(renamedSession.payload.member.isSales, true);

  const rejectedHeaders = {
    "x-dev-user-email": "rejected.integration@local.test",
    "x-dev-user-name": encodeURIComponent("삭제할 승인 대기 계정"),
  };
  const rejectedSession = await request("/api/session", {
    headers: rejectedHeaders,
  });
  assert.equal(rejectedSession.response.status, 200);
  assert.equal(rejectedSession.payload.member.status, "pending");
  const rejectedDeletion = await jsonRequest(
    "/api/members",
    "DELETE",
    ownerHeaders,
    { id: rejectedSession.payload.member.id },
  );
  assert.equal(rejectedDeletion.response.status, 200);
  const teamAfterRejection = await request("/api/members", {
    headers: ownerHeaders,
  });
  assert.equal(
    teamAfterRejection.payload.members.some(
      (member) => member.email === "rejected.integration@local.test",
    ),
    false,
  );

  const promotedAssistant = await jsonRequest(
    "/api/members",
    "PUT",
    ownerHeaders,
    {
      id: testMember.id,
      status: "approved",
      role: "assistant",
      permissions: ["members:manage", "records:manage"],
    },
  );
  assert.equal(promotedAssistant.response.status, 200);
  assert.equal(promotedAssistant.payload.member.role, "assistant");
  assert.equal(
    promotedAssistant.payload.member.permissions,
    '["records:manage","members:manage"]',
  );

  const assistantSession = await request("/api/session", {
    headers: memberHeaders,
  });
  assert.equal(assistantSession.response.status, 200);
  assert.equal(assistantSession.payload.member.role, "assistant");
  assert.deepEqual(assistantSession.payload.member.permissions, [
    "records:manage",
    "members:manage",
  ]);

  const assistantTeam = await request("/api/members", {
    headers: memberHeaders,
  });
  assert.equal(assistantTeam.response.status, 200);

  const protectedOwner = await jsonRequest(
    "/api/members",
    "PUT",
    memberHeaders,
    {
      id: ownerSession.payload.member.id,
      status: "suspended",
      role: "member",
      permissions: [],
    },
  );
  assert.equal(protectedOwner.response.status, 400);

  const assistantSettings = await request("/api/settings", {
    headers: memberHeaders,
  });
  assert.equal(assistantSettings.response.status, 403);

  const savedManagerAlert = await jsonRequest(
    "/api/manager-alerts",
    "POST",
    memberHeaders,
    {
      items: [
        {
          organization: "관리자 알림 통합 테스트 기관",
          issueSignature: "record-1|overdue",
          snoozedUntil: "2099-07-22",
        },
      ],
    },
  );
  assert.equal(savedManagerAlert.response.status, 200);
  assert.equal(savedManagerAlert.payload.acknowledgements.length, 1);
  assert.equal(
    savedManagerAlert.payload.acknowledgements[0].snoozedUntil,
    "2099-07-22",
  );

  const hiddenManagerAlert = await jsonRequest(
    "/api/manager-alerts",
    "PATCH",
    memberHeaders,
    { organizations: ["관리자 알림 통합 테스트 기관"] },
  );
  assert.equal(hiddenManagerAlert.response.status, 200);
  assert.equal(hiddenManagerAlert.payload.hiddenCount, 1);
  assert.ok(hiddenManagerAlert.payload.acknowledgements[0].hiddenAt);

  const reopenedManagerAlert = await jsonRequest(
    "/api/manager-alerts",
    "POST",
    memberHeaders,
    {
      items: [
        {
          organization: "관리자 알림 통합 테스트 기관",
          issueSignature: "record-1|overdue",
          snoozedUntil: "2099-07-22",
        },
      ],
    },
  );
  assert.equal(reopenedManagerAlert.response.status, 200);
  assert.equal(reopenedManagerAlert.payload.acknowledgements[0].hiddenAt, "");

  const restoredManagerAlert = await jsonRequest(
    "/api/manager-alerts",
    "DELETE",
    memberHeaders,
    { organizations: ["관리자 알림 통합 테스트 기관"] },
  );
  assert.equal(restoredManagerAlert.response.status, 200);
  assert.equal(restoredManagerAlert.payload.acknowledgements.length, 0);

  const demotedMember = await jsonRequest(
    "/api/members",
    "PUT",
    ownerHeaders,
    {
      id: testMember.id,
      status: "approved",
      role: "member",
      permissions: [],
    },
  );
  assert.equal(demotedMember.response.status, 200);
  assert.equal(demotedMember.payload.member.role, "member");

  const activityReviewAssignees = await request(
    "/api/members?scope=assignees",
    { headers: memberHeaders },
  );
  assert.equal(activityReviewAssignees.response.status, 200);
  const ownerAssignee = activityReviewAssignees.payload.members.find(
    (member) => member.id === ownerSession.payload.member.id,
  );
  const memberAssignee = activityReviewAssignees.payload.members.find(
    (member) => member.id === testMember.id,
  );
  assert.equal(ownerAssignee.display_name, "로컬 관리자");
  assert.equal(memberAssignee.display_name, "통합 구성원");

  const memberManagerAlerts = await request("/api/manager-alerts", {
    headers: memberHeaders,
  });
  assert.equal(memberManagerAlerts.response.status, 403);

  const approvedRecords = await request("/api/records", {
    headers: memberHeaders,
  });
  assert.equal(
    approvedRecords.response.status,
    200,
    JSON.stringify(approvedRecords.payload),
  );
  assert.ok(Array.isArray(approvedRecords.payload.records));

  const equipmentOrganization = "품목 통합 테스트 기관";
  await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    { organizations: [equipmentOrganization] },
  );
  const equipmentRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      organization: equipmentOrganization,
      activityType: "학교 미팅",
      region: "경기",
      topic: "스마트교실 구축 제안",
      budgetType: "교육청",
      budgetAmount: "50,000,000",
      awardStatus: "위즈업 수주",
      awardStage: "계약",
    },
  );
  assert.equal(equipmentRecord.response.status, 201);
  assert.equal(equipmentRecord.payload.record.execution_type, "직영");

  const autoEquipmentProjects = await request(
    `/api/equipment?organization=${encodeURIComponent(equipmentOrganization)}`,
    { headers: memberHeaders },
  );
  assert.equal(
    autoEquipmentProjects.response.status,
    200,
    JSON.stringify(autoEquipmentProjects.payload),
  );
  assert.equal(autoEquipmentProjects.payload.projects.length, 1);
  assert.equal(autoEquipmentProjects.payload.projects[0].name, "교육청");
  assert.equal(autoEquipmentProjects.payload.projects[0].budget_type, "교육청");
  assert.equal(autoEquipmentProjects.payload.projects[0].status, "수주");
  const equipmentProjectId = Number(autoEquipmentProjects.payload.projects[0].id);
  assert.ok(equipmentProjectId > 0);

  const equipmentItem = await jsonRequest(
    "/api/equipment",
    "POST",
    memberHeaders,
    {
      kind: "item",
      projectId: equipmentProjectId,
      productName: "전자칠판 86인치",
      specification: "WHZ-86",
      proposedQty: 3,
      awardedQty: 2,
      installedQty: 1,
      unit: "대",
      status: "설치 중",
    },
  );
  assert.equal(equipmentItem.response.status, 201);
  const equipmentItemId = Number(equipmentItem.payload.item.id);
  assert.equal(equipmentItem.payload.item.protection_status, "신청 필요");

  const integrationVendor = await jsonRequest(
    "/api/award-vendors",
    "POST",
    ownerHeaders,
    { companyName: "통합 테스트 협력사" },
  );
  assert.equal(integrationVendor.response.status, 201);
  const integrationVendorId = Number(integrationVendor.payload.vendor.id);
  assert.ok(integrationVendorId > 0);

  const existingCatalog = await request("/api/product-catalog", {
    headers: memberHeaders,
  });
  assert.equal(existingCatalog.response.status, 200);
  const integrationCatalogProduct = {
    id: "integration-catalog-product",
    sourceRow: 9_999,
    name: "통합 테스트 제품",
    specification: "TEST-100",
    unitPrice: 123000,
    note: "통합 테스트 업체 · 조달 1234",
    commissionRate: 0.25,
    reference: "",
    needsReview: false,
  };
  const savedCatalog = await jsonRequest(
    "/api/product-catalog",
    "PUT",
    memberHeaders,
    {
      products: [
        ...(Array.isArray(existingCatalog.payload.products)
          ? existingCatalog.payload.products
          : []),
        integrationCatalogProduct,
      ],
    },
  );
  assert.equal(savedCatalog.response.status, 200);
  const linkedCatalog = await jsonRequest(
    "/api/product-catalog",
    "PATCH",
    memberHeaders,
    {
      productId: integrationCatalogProduct.id,
      supplierVendorId: integrationVendorId,
    },
  );
  assert.equal(linkedCatalog.response.status, 200);
  assert.equal(
    linkedCatalog.payload.products.find(
      (product) => product.id === integrationCatalogProduct.id,
    ).supplierVendorName,
    "통합 테스트 협력사",
  );

  const catalogEquipmentItems = await jsonRequest(
    "/api/equipment",
    "POST",
    memberHeaders,
    {
      kind: "catalog-items",
      projectId: equipmentProjectId,
      items: [
        {
          catalogItemId: "integration-catalog-product",
          productName: "통합 테스트 제품",
          specification: "TEST-100",
          catalogUnitPrice: 123000,
          catalogNote: "통합 테스트 업체 · 조달 1234",
        },
      ],
    },
  );
  assert.equal(catalogEquipmentItems.response.status, 201);
  assert.equal(catalogEquipmentItems.payload.added, 1);

  const projectsWithCatalogItem = await request(
    `/api/equipment?organization=${encodeURIComponent(equipmentOrganization)}`,
    { headers: memberHeaders },
  );
  const catalogEquipmentItem = projectsWithCatalogItem.payload.projects[0].items.find(
    (item) => item.catalog_item_id === "integration-catalog-product",
  );
  assert.ok(catalogEquipmentItem);
  assert.equal(catalogEquipmentItem.status, "제안 예정");
  assert.equal(catalogEquipmentItem.protection_status, "신청 필요");
  assert.equal(catalogEquipmentItem.supplier_vendor_id, integrationVendorId);
  assert.equal(
    catalogEquipmentItem.supplier_vendor_name,
    "통합 테스트 협력사",
  );

  const catalogProtectionComplete = await jsonRequest(
    "/api/equipment",
    "PUT",
    memberHeaders,
    {
      kind: "protection",
      id: Number(catalogEquipmentItem.id),
      protectionStatus: "신청 완료",
    },
  );
  assert.equal(catalogProtectionComplete.response.status, 200);
  assert.equal(
    catalogProtectionComplete.payload.item.protection_status,
    "신청 완료",
  );
  assert.ok(catalogProtectionComplete.payload.item.protection_completed_at);

  const duplicateCatalogEquipmentItems = await jsonRequest(
    "/api/equipment",
    "POST",
    memberHeaders,
    {
      kind: "catalog-items",
      projectId: equipmentProjectId,
      items: [
        {
          catalogItemId: "integration-catalog-product",
          productName: "통합 테스트 제품",
          specification: "TEST-100",
        },
      ],
    },
  );
  assert.equal(duplicateCatalogEquipmentItems.response.status, 201);
  assert.equal(duplicateCatalogEquipmentItems.payload.added, 0);
  assert.equal(duplicateCatalogEquipmentItems.payload.skipped, 1);

  const catalogEquipmentDelete = await jsonRequest(
    "/api/equipment",
    "DELETE",
    memberHeaders,
    { kind: "item", id: Number(catalogEquipmentItem.id) },
  );
  assert.equal(catalogEquipmentDelete.response.status, 200);

  const equipmentItemUpdate = await jsonRequest(
    "/api/equipment",
    "PUT",
    memberHeaders,
    {
      kind: "item",
      id: equipmentItemId,
      productName: "전자칠판 86인치",
      specification: "WHZ-86",
      proposedQty: 3,
      awardedQty: 2,
      installedQty: 2,
      unit: "대",
      status: "설치 완료",
      notes: "2대 설치 완료",
    },
  );
  assert.equal(equipmentItemUpdate.response.status, 200);

  const aiEquipmentImport = await jsonRequest(
    "/api/equipment",
    "POST",
    memberHeaders,
    {
      kind: "ai-import",
      organization: equipmentOrganization,
      projectName: "교육청",
      projectStatus: "설치 중",
      budgetType: "교육청",
      items: [
        {
          productName: "전자칠판 86인치",
          specification: "WHZ-86",
          proposedQty: 3,
          awardedQty: 2,
          installedQty: 2,
          unit: "대",
          status: "설치 완료",
          notes: "",
        },
        {
          productName: "이동형 스탠드",
          specification: "",
          proposedQty: 3,
          awardedQty: 2,
          installedQty: 0,
          unit: "대",
          status: "발주",
          notes: "",
        },
      ],
    },
  );
  assert.equal(aiEquipmentImport.response.status, 200);

  const progressingSchedule = await jsonRequest(
    "/api/records",
    "PUT",
    ownerHeaders,
    {
      id: Number(equipmentRecord.payload.record.id),
      organization: equipmentOrganization,
      activityType: "학교 미팅",
      region: "경기",
      topic: "스마트교실 구축 일정",
      budgetType: "교육청",
      budgetAmount: "50,000,000",
      status: "대기",
      awardStatus: "미정",
      awardStage: "미정",
      progressSchedule: [
        { label: "전자칠판 설치", date: "2000-01-01" },
        { label: "이동형 스탠드 설치", date: "2099-12-31" },
      ],
    },
  );
  assert.equal(progressingSchedule.response.status, 200);
  assert.equal(progressingSchedule.payload.record.status, "진행 중");
  assert.equal(
    progressingSchedule.payload.record.award_status,
    "미정",
  );
  assert.equal(
    progressingSchedule.payload.record.award_stage,
    "일정 조율",
  );

  const progressingEquipment = await request(
    `/api/equipment?organization=${encodeURIComponent(equipmentOrganization)}`,
    { headers: memberHeaders },
  );
  const progressingItems = progressingEquipment.payload.projects[0].items;
  assert.equal(
    progressingItems.find(
      (item) => item.product_name === "전자칠판 86인치",
    ).status,
    "설치 완료",
  );
  assert.equal(
    progressingItems.find(
      (item) => item.product_name === "이동형 스탠드",
    ).status,
    "설치 중",
  );

  const constructionOnlySchedule = await jsonRequest(
    "/api/records",
    "PUT",
    ownerHeaders,
    {
      id: Number(equipmentRecord.payload.record.id),
      organization: equipmentOrganization,
      activityType: "학교 미팅",
      region: "경기",
      topic: "스마트교실 구축 일정",
      budgetType: "교육청",
      budgetAmount: "50,000,000",
      status: "진행 중",
      awardStatus: "위즈업 수주",
      awardStage: "일정 조율",
      progressSchedule: [
        { label: "전자칠판 설치", date: "2000-01-01" },
        { label: "이동형 스탠드 설치", date: "2000-01-02" },
        { label: "완공", date: "2000-01-03" },
      ],
    },
  );
  assert.equal(constructionOnlySchedule.response.status, 200);
  assert.notEqual(constructionOnlySchedule.payload.record.status, "완료");
  assert.equal(
    constructionOnlySchedule.payload.record.award_stage,
    "검수·교육 진행",
  );

  const constructionAndInspectionSchedule = await jsonRequest(
    "/api/records",
    "PUT",
    ownerHeaders,
    {
      id: Number(equipmentRecord.payload.record.id),
      organization: equipmentOrganization,
      activityType: "학교 미팅",
      region: "경기",
      topic: "스마트교실 구축 일정",
      budgetType: "교육청",
      budgetAmount: "50,000,000",
      status: "진행 중",
      awardStatus: "위즈업 수주",
      awardStage: "일정 조율",
      progressSchedule: [
        { label: "전자칠판 설치", date: "2000-01-01" },
        { label: "완공", date: "2000-01-02" },
        { label: "검수", date: "2000-01-03" },
      ],
    },
  );
  assert.equal(constructionAndInspectionSchedule.response.status, 200);
  assert.notEqual(constructionAndInspectionSchedule.payload.record.status, "완료");
  assert.equal(
    constructionAndInspectionSchedule.payload.record.award_stage,
    "검수·교육 진행",
  );

  const completedSchedule = await jsonRequest(
    "/api/records",
    "PUT",
    ownerHeaders,
    {
      id: Number(equipmentRecord.payload.record.id),
      organization: equipmentOrganization,
      activityType: "학교 미팅",
      region: "경기",
      topic: "스마트교실 구축 일정",
      budgetType: "교육청",
      budgetAmount: "50,000,000",
      status: "진행 중",
      awardStatus: "위즈업 수주",
      awardStage: "일정 조율",
      progressSchedule: [
        { label: "전자칠판 설치", date: "2000-01-01" },
        { label: "완공", date: "2000-01-02" },
        { label: "검수", date: "2000-01-03" },
        { label: "교육", date: "2000-01-04" },
      ],
    },
  );
  assert.equal(completedSchedule.response.status, 200);
  assert.equal(completedSchedule.payload.record.status, "수주 전환");
  assert.equal(completedSchedule.payload.record.award_stage, "납품 완료");

  const aiProjectOnlyUpdate = await jsonRequest(
    "/api/equipment",
    "POST",
    memberHeaders,
    {
      kind: "ai-import",
      organization: equipmentOrganization,
      projectName: "교육청",
      projectStatus: "설치 완료",
      budgetType: "교육청",
      summary: "설치와 검수를 완료했습니다.",
      items: [],
    },
  );
  assert.equal(aiProjectOnlyUpdate.response.status, 200);

  const equipmentProjects = await request(
    `/api/equipment?organization=${encodeURIComponent(equipmentOrganization)}`,
    { headers: memberHeaders },
  );
  assert.equal(equipmentProjects.response.status, 200);
  assert.equal(equipmentProjects.payload.projects.length, 1);
  assert.equal(equipmentProjects.payload.projects[0].status, "설치 완료");
  assert.equal(equipmentProjects.payload.projects[0].items.length, 2);
  const storedDisplay = equipmentProjects.payload.projects[0].items.find(
    (item) => item.product_name === "전자칠판 86인치",
  );
  assert.equal(storedDisplay.proposed_qty, 3);
  assert.equal(storedDisplay.awarded_qty, 2);
  assert.equal(storedDisplay.installed_qty, 2);
  assert.equal(storedDisplay.status, "설치 완료");
  assert.equal(
    equipmentProjects.payload.projects[0].items.find(
      (item) => item.product_name === "이동형 스탠드",
    ).status,
    "설치 완료",
  );

  const equipmentSummaries = await request("/api/equipment?summary=1", {
    headers: memberHeaders,
  });
  assert.equal(equipmentSummaries.response.status, 200);
  const storedEquipmentSummary = equipmentSummaries.payload.summaries.find(
    (summary) => summary.organization === equipmentOrganization,
  );
  assert.equal(storedEquipmentSummary.item_count, 2);
  assert.equal(storedEquipmentSummary.proposed_kinds, 2);
  assert.equal(storedEquipmentSummary.awarded_kinds, 2);
  assert.equal(storedEquipmentSummary.installed_kinds, 1);

  const removeEquipmentOrganization = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    { organizations: [equipmentOrganization] },
  );
  assert.equal(removeEquipmentOrganization.response.status, 200);
  const equipmentAfterOrganizationDelete = await request(
    `/api/equipment?organization=${encodeURIComponent(equipmentOrganization)}`,
    { headers: memberHeaders },
  );
  assert.equal(equipmentAfterOrganizationDelete.response.status, 200);
  assert.equal(equipmentAfterOrganizationDelete.payload.projects.length, 0);

  const mapConfig = await request("/api/map/config", {
    headers: memberHeaders,
  });
  assert.equal(mapConfig.response.status, 200);

  const rejectedMapConfig = await jsonRequest(
    "/api/map/config",
    "PUT",
    memberHeaders,
    { javascriptKey: "local-test-javascript-key-123456" },
  );
  assert.equal(rejectedMapConfig.response.status, 403);

  const savedMapConfig = await jsonRequest(
    "/api/map/config",
    "PUT",
    ownerHeaders,
    { javascriptKey: "local-test-javascript-key-123456" },
  );
  assert.equal(savedMapConfig.response.status, 200);

  const rejectedUnknownMapLocation = await jsonRequest(
    "/api/map/locations",
    "PUT",
    memberHeaders,
    {
      organization: "지도 통합 테스트 학교",
      latitude: 37.4,
      longitude: 127.1,
    },
  );
  assert.equal(rejectedUnknownMapLocation.response.status, 404);

  const linkedMapRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      organization: "지도 통합 테스트 학교",
      activityType: "학교 미팅",
      region: "서울",
    },
  );
  assert.equal(linkedMapRecord.response.status, 201);

  const savedMapLocation = await jsonRequest(
    "/api/map/locations",
    "PUT",
    memberHeaders,
    {
      organization: "지도 통합 테스트 학교",
      region: "",
      address: "경기도 성남시 테스트로 1",
      roadAddress: "경기도 성남시 테스트로 1",
      latitude: 37.4,
      longitude: 127.1,
      placeName: "지도 통합 테스트 학교",
      placeId: "local-map-place",
    },
  );
  assert.equal(savedMapLocation.response.status, 200);
  assert.equal(
    savedMapLocation.payload.location.organization,
    "지도 통합 테스트 학교",
  );
  assert.equal(savedMapLocation.payload.location.region, "경기 성남");

  const recordsAfterMapLocation = await request("/api/records", {
    headers: memberHeaders,
  });
  assert.equal(recordsAfterMapLocation.response.status, 200);
  assert.equal(
    recordsAfterMapLocation.payload.records.find(
      (record) => record.organization === "지도 통합 테스트 학교",
    ).region,
    "경기 성남",
  );

  const changedMapLocation = await jsonRequest(
    "/api/map/locations",
    "PUT",
    memberHeaders,
    {
      organization: "지도 통합 테스트 학교",
      region: "경기 성남",
      address: "부산광역시 해운대구 테스트로 2",
      roadAddress: "부산광역시 해운대구 테스트로 2",
      latitude: 35.16,
      longitude: 129.16,
      placeName: "지도 통합 테스트 학교",
      placeId: "local-map-place-updated",
    },
  );
  assert.equal(changedMapLocation.response.status, 200);
  assert.equal(changedMapLocation.payload.location.region, "부산 해운대");

  const recordsAfterMapChange = await request("/api/records", {
    headers: memberHeaders,
  });
  assert.equal(recordsAfterMapChange.response.status, 200);
  assert.equal(
    recordsAfterMapChange.payload.records.find(
      (record) => record.organization === "지도 통합 테스트 학교",
    ).region,
    "부산 해운대",
  );

  const memberMapLocations = await request("/api/map/locations", {
    headers: memberHeaders,
  });
  assert.equal(memberMapLocations.response.status, 200);
  assert.ok(
    memberMapLocations.payload.locations.some(
      (location) => location.organization === "지도 통합 테스트 학교",
    ),
  );

  const removedMapInstitution = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    { organizations: ["지도 통합 테스트 학교"] },
  );
  assert.equal(removedMapInstitution.response.status, 200);

  const locationsAfterInstitutionDelete = await request("/api/map/locations", {
    headers: memberHeaders,
  });
  assert.equal(locationsAfterInstitutionDelete.response.status, 200);
  assert.ok(
    !locationsAfterInstitutionDelete.payload.locations.some(
      (location) => location.organization === "지도 통합 테스트 학교",
    ),
  );

  const campaignSuffix = String(Date.now());
  const campaignName = `통합 테스트 영업 ${campaignSuffix}`;
  const campaignOrganizations = [
    `통합 영업 학교 A ${campaignSuffix}`,
    `통합 영업 기관 B ${campaignSuffix}`,
  ];
  const memberCampaignName = `${campaignName} 일반 구성원`;
  const memberCampaignOrganization = `${campaignOrganizations[0]} 일반 구성원`;
  const memberCampaignImport = await jsonRequest(
    "/api/map/campaigns",
    "POST",
    memberHeaders,
    {
      name: memberCampaignName,
      importSource: "excel",
      selectionDate: "2026-07-30",
      budgetType: "자체예산",
      targets: [
        {
          organization: memberCampaignOrganization,
          address: "경기도 성남시 테스트로 10",
        },
      ],
    },
  );
  assert.equal(
    memberCampaignImport.response.status,
    201,
    JSON.stringify(memberCampaignImport.payload),
  );
  const memberCampaignId = Number(memberCampaignImport.payload.campaign.id);
  assert.ok(memberCampaignId > 0);
  const deletedMemberCampaign = await jsonRequest(
    "/api/map/campaigns",
    "DELETE",
    memberHeaders,
    { campaignId: memberCampaignId },
  );
  assert.equal(deletedMemberCampaign.response.status, 200);

  const importedCampaign = await jsonRequest(
    "/api/map/campaigns",
    "POST",
    ownerHeaders,
    {
      name: campaignName,
      notes: "엑셀 일괄 등록 통합 테스트",
      importSource: "excel",
      selectionDate: "2026-07-30",
      budgetType: "자체예산",
      targets: [
        {
          organization: campaignOrganizations[0],
          address: "경기도 성남시 테스트로 10",
          phone: "031-111-2222",
          contactName: "김담당",
        },
        {
          organization: campaignOrganizations[1],
          address: "서울특별시 테스트로 20",
          phone: "02-333-4444",
        },
      ],
    },
  );
  assert.equal(
    importedCampaign.response.status,
    201,
    JSON.stringify(importedCampaign.payload),
  );
  assert.equal(importedCampaign.payload.targetCount, 2);
  const campaignId = Number(importedCampaign.payload.campaign.id);
  assert.ok(campaignId > 0);

  const memberCampaigns = await request("/api/map/campaigns", {
    headers: memberHeaders,
  });
  assert.equal(memberCampaigns.response.status, 200);
  const importedCampaignRow = memberCampaigns.payload.campaigns.find(
    (campaign) => Number(campaign.id) === campaignId,
  );
  assert.equal(Number(importedCampaignRow.target_count), 2);
  const campaignTarget = memberCampaigns.payload.targets.find(
    (target) =>
      Number(target.campaign_id) === campaignId &&
      target.organization === campaignOrganizations[0],
  );
  assert.ok(campaignTarget);

  const assignedCampaignTarget = await jsonRequest(
    "/api/map/campaigns",
    "PUT",
    memberHeaders,
    {
      targetId: campaignTarget.id,
      assignedMemberId: testMember.id,
    },
  );
  assert.equal(assignedCampaignTarget.response.status, 200);

  const recordsAfterCampaignImport = await request("/api/records", {
    headers: memberHeaders,
  });
  assert.equal(recordsAfterCampaignImport.response.status, 200);
  campaignOrganizations.forEach((organization) => {
    const record = recordsAfterCampaignImport.payload.records.find(
      (item) => item.organization === organization,
    );
    assert.ok(record);
    assert.equal(record.activity_type, "영업 대상");
    assert.equal(record.source_chat, "예산별 기관 엑셀 가져오기");
    assert.equal(
      record.region,
      organization === campaignOrganizations[0] ? "경기 성남" : "서울",
    );
  });

  const removedCampaignInstitution = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    { organizations: [campaignOrganizations[1]] },
  );
  assert.equal(removedCampaignInstitution.response.status, 200);
  const campaignAfterInstitutionDelete = await request("/api/map/campaigns", {
    headers: memberHeaders,
  });
  assert.ok(
    !campaignAfterInstitutionDelete.payload.targets.some(
      (target) =>
        Number(target.campaign_id) === campaignId &&
        target.organization === campaignOrganizations[1],
    ),
  );

  const deletedCampaign = await jsonRequest(
    "/api/map/campaigns",
    "DELETE",
    memberHeaders,
    { campaignId },
  );
  assert.equal(deletedCampaign.response.status, 200);

  const recordsAfterCampaignDelete = await request("/api/records", {
    headers: memberHeaders,
  });
  assert.ok(
    recordsAfterCampaignDelete.payload.records.some(
      (record) => record.organization === campaignOrganizations[0],
    ),
  );
  const campaignRecordCleanup = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    {
      organizations: [
        ...campaignOrganizations,
        memberCampaignOrganization,
      ],
    },
  );
  assert.equal(campaignRecordCleanup.response.status, 200);

  const unconfiguredAI = await jsonRequest(
    "/api/ai/organize",
    "POST",
    memberHeaders,
    { message: "성남초 통화, 목공 6/17 진행 중" },
  );
  assert.equal(unconfiguredAI.response.status, 503);
  assert.equal(unconfiguredAI.payload.code, "AI_NOT_CONFIGURED");

  const clientResult = await request("/api/oauth/client", {
    method: "POST",
    headers: ownerHeaders,
  });
  assert.equal(clientResult.response.status, 200);
  const { clientId, clientSecret } = clientResult.payload.client;
  assert.ok(clientId);
  assert.ok(clientSecret);

  const redirectUri = "https://chatgpt.com/aip/test/oauth/callback";
  const rejectedScope = await jsonRequest(
    "/api/oauth/authorize",
    "POST",
    memberHeaders,
    {
      clientId,
      redirectUri,
      responseType: "code",
      scope: "activities:write members:admin",
    },
  );
  assert.equal(rejectedScope.response.status, 400);

  const authorization = await jsonRequest(
    "/api/oauth/authorize",
    "POST",
    memberHeaders,
    {
      clientId,
      redirectUri,
      responseType: "code",
      state: "local-integration",
      scope: "activities:write",
    },
  );
  assert.equal(authorization.response.status, 200);
  const authorizationResult = new URL(authorization.payload.redirectTo);
  assert.equal(authorizationResult.searchParams.get("state"), "local-integration");
  const code = authorizationResult.searchParams.get("code");
  assert.ok(code);

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const token = await request("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  assert.equal(token.response.status, 200);
  assert.ok(token.payload.access_token);
  assert.ok(token.payload.refresh_token);

  const actionHeaders = {
    Authorization: `Bearer ${token.payload.access_token}`,
  };
  const connection = await request("/api/gpt-actions/activities", {
    headers: actionHeaders,
  });
  assert.equal(connection.response.status, 200);
  assert.equal(connection.payload.user.email, "integration.member@local.test");

  const refreshBody = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: token.payload.refresh_token,
  });
  const refreshed = await request("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: refreshBody,
  });
  assert.equal(refreshed.response.status, 200);
  assert.ok(refreshed.payload.access_token);

  const revokedConnection = await request("/api/gpt-actions/activities", {
    headers: actionHeaders,
  });
  assert.equal(revokedConnection.response.status, 401);

  const reusedRefresh = await request("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: refreshBody,
  });
  assert.equal(reusedRefresh.response.status, 400);

  const refreshedActionHeaders = {
    Authorization: `Bearer ${refreshed.payload.access_token}`,
  };
  const rejectedOtherAward = await jsonRequest(
    "/api/gpt-actions/activities",
    "POST",
    refreshedActionHeaders,
    {
      activityType: "수주",
      organization: "수주 검증 기관",
      awardStatus: "타업체 수주",
    },
  );
  assert.equal(rejectedOtherAward.response.status, 400);

  const created = await jsonRequest(
    "/api/gpt-actions/activities",
    "POST",
    refreshedActionHeaders,
    {
      activityDate: "2026-07-17",
      dateConfidence: "확정",
      activityType: "TM·통화",
      category: "기관",
      contactMethod: "유선",
      region: "경기 성남",
      organization: "로컬 통합 테스트 기관",
      budgetType: "자체예산",
      budgetAmount: "2,480만원",
      topic: "공유 GPT 연결 검증",
      summary: "OAuth 사용자 이름으로 공동 관리표에 저장되는지 확인",
      status: "진행 중",
      temperature: "중간",
      awardStatus: "타업체 수주",
      awardCompany: "테스트 경쟁사",
      followUpRequired: false,
      nextAction: "테스트 기록 삭제",
      progressSchedule: [
        { label: "목공", date: "2026-07-20" },
        { label: "시스템", date: "2026-07-22" },
      ],
    },
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.record.createdBy, "통합 구성원");
  assert.equal(created.payload.record.awardStatus, "타업체 수주");
  assert.equal(created.payload.record.awardCompany, "테스트 경쟁사");
  assert.equal(created.payload.record.contactMethod, "유선");
  assert.equal(created.payload.record.region, "경기 성남");
  assert.equal(created.payload.record.budgetType, "자체예산");
  assert.equal(created.payload.record.budgetAmount, "2,480만원");
  assert.match(created.payload.record.progressSchedule, /목공\t2026-07-20/);
  assert.match(created.payload.record.progressSchedule, /시스템\t2026-07-22/);

  const ownerRecords = await request("/api/records", {
    headers: ownerHeaders,
  });
  assert.equal(ownerRecords.response.status, 200);
  const stored = ownerRecords.payload.records.find(
    (record) => record.id === created.payload.record.id,
  );
  assert.equal(stored.created_by_name, "통합 구성원");
  assert.equal(stored.award_status, "타업체 수주");
  assert.equal(stored.award_company, "테스트 경쟁사");
  assert.equal(stored.contact_method, "유선");
  assert.equal(stored.region, "경기 성남");
  assert.equal(stored.budget_type, "자체예산");
  assert.equal(stored.budget_amount, "2,480만원");
  assert.match(stored.progress_schedule, /목공\t2026-07-20/);

  const reviewSignature = JSON.stringify({
    activityId: created.payload.record.id,
    issues: ["기관 담당자", "담당자 연락처"],
  });
  const savedRecordReview = await jsonRequest(
    "/api/record-reviews",
    "POST",
    memberHeaders,
    {
      items: [
        {
          activityId: created.payload.record.id,
          issueSignature: reviewSignature,
          snoozedUntil: "2026-07-20",
        },
      ],
    },
  );
  assert.equal(savedRecordReview.response.status, 200);
  assert.ok(
    savedRecordReview.payload.acknowledgements.some(
      (item) =>
        item.activityId === created.payload.record.id &&
        item.issueSignature === reviewSignature &&
        item.snoozedUntil === "2026-07-20",
    ),
  );

  const ownerRecordReviews = await request("/api/record-reviews", {
    headers: ownerHeaders,
  });
  assert.equal(ownerRecordReviews.response.status, 200);
  assert.equal(
    ownerRecordReviews.payload.acknowledgements.some(
      (item) => item.activityId === created.payload.record.id,
    ),
    false,
  );

  const restoredRecordReview = await jsonRequest(
    "/api/record-reviews",
    "DELETE",
    memberHeaders,
    { activityIds: [created.payload.record.id] },
  );
  assert.equal(restoredRecordReview.response.status, 200);
  assert.equal(
    restoredRecordReview.payload.acknowledgements.some(
      (item) => item.activityId === created.payload.record.id,
    ),
    false,
  );

  const confirmedRecordReview = await jsonRequest(
    "/api/record-reviews",
    "POST",
    memberHeaders,
    {
      items: [
        {
          activityId: created.payload.record.id,
          issueSignature: reviewSignature,
          snoozedUntil: null,
        },
      ],
    },
  );
  assert.equal(confirmedRecordReview.response.status, 200);

  const normalizationStamp = Date.now();
  const annexOrganization = `기관정규화${normalizationStamp}초등학교 병설유치원`;
  const girlsHighOrganization = `기관정규화${normalizationStamp}여자고등학교`;
  const elementaryOrganization = `기관정규화${normalizationStamp}초등학교`;
  const annexRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: `기관정규화${normalizationStamp}초 병설`,
    },
  );
  assert.equal(annexRecord.response.status, 201);
  assert.equal(annexRecord.payload.record.organization, annexOrganization);
  const girlsHighRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: `기관정규화${normalizationStamp}여고`,
    },
  );
  assert.equal(girlsHighRecord.response.status, 201);
  assert.equal(
    girlsHighRecord.payload.record.organization,
    girlsHighOrganization,
  );
  const elementaryRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: `기관정규화${normalizationStamp}초`,
    },
  );
  assert.equal(elementaryRecord.response.status, 201);
  assert.equal(
    elementaryRecord.payload.record.organization,
    elementaryOrganization,
  );

  const existingSimilarOrganization =
    `기관오타확인${normalizationStamp}가초등학교`;
  const requestedSimilarOrganization =
    `기관오타확인${normalizationStamp}나초등학교`;
  const existingSimilarRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: existingSimilarOrganization,
    },
  );
  assert.equal(existingSimilarRecord.response.status, 201);
  const ambiguousInstitution = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: requestedSimilarOrganization,
    },
  );
  assert.equal(ambiguousInstitution.response.status, 409);
  assert.equal(
    ambiguousInstitution.payload.needsInstitutionConfirmation,
    true,
  );
  assert.ok(
    ambiguousInstitution.payload.suggestedOrganizations.includes(
      existingSimilarOrganization,
    ),
  );
  const confirmedInstitution = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: requestedSimilarOrganization,
      confirmedOrganization: existingSimilarOrganization,
    },
  );
  assert.equal(confirmedInstitution.response.status, 201);
  assert.equal(
    confirmedInstitution.payload.record.organization,
    existingSimilarOrganization,
  );

  const contextualCanonicalOrganization =
    `김포 모담확인${normalizationStamp}초등학교`;
  const contextualAliasOrganization =
    `모담확인${normalizationStamp}초등학교`;
  const contextualCanonicalRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: contextualCanonicalOrganization,
      region: "경기 김포",
      contactName: "신동빈",
      progressManager: "양승민",
      topic: "스마트 체육공간",
      summary: "유휴교실 80㎡에 25명이 함께 사용하는 스마트 체육공간 검토",
    },
  );
  assert.equal(contextualCanonicalRecord.response.status, 201);
  const contextualSeparateRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: contextualAliasOrganization,
      region: "김포",
      contactName: "신동빈",
      progressManager: "양승민",
      topic: "스마트 체육공간",
      summary: "유휴교실 80㎡에 25명이 함께 사용하는 스마트 체육공간 검토",
      institutionSeparate: true,
    },
  );
  assert.equal(contextualSeparateRecord.response.status, 201);
  const contextualConfirmation = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: contextualAliasOrganization,
      region: "김포",
      contactName: "신동빈",
      progressManager: "양승민",
      topic: "스마트 체육공간",
      summary: "유휴교실 80㎡에 25명이 함께 사용하는 스마트 체육공간 검토",
    },
  );
  assert.equal(contextualConfirmation.response.status, 409);
  const contextualMatch =
    contextualConfirmation.payload.suggestedInstitutionMatches.find(
      (match) => match.organization === contextualCanonicalOrganization,
    );
  assert.ok(contextualMatch);
  assert.ok(contextualMatch.reasons.includes("지역이 같음"));
  assert.ok(contextualMatch.reasons.includes("기관 담당자가 같음"));
  assert.ok(contextualMatch.reasons.includes("진행 담당자가 같음"));
  assert.ok(contextualMatch.reasons.includes("상담 내용이 비슷함"));
  const contextualConfirmedRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityType: "TM",
      organization: contextualAliasOrganization,
      region: "김포",
      contactName: "신동빈",
      progressManager: "양승민",
      topic: "스마트 체육공간",
      summary: "유휴교실 80㎡에 25명이 함께 사용하는 스마트 체육공간 검토",
      confirmedOrganization: contextualCanonicalOrganization,
    },
  );
  assert.equal(contextualConfirmedRecord.response.status, 201);
  assert.equal(
    contextualConfirmedRecord.payload.record.organization,
    contextualCanonicalOrganization,
  );
  const contextualMergedRecords = await request("/api/records", {
    headers: ownerHeaders,
  });
  assert.equal(contextualMergedRecords.response.status, 200);
  assert.equal(
    contextualMergedRecords.payload.records.filter(
      (record) => record.organization === contextualAliasOrganization,
    ).length,
    0,
  );
  assert.equal(
    contextualMergedRecords.payload.records.filter(
      (record) => record.organization === contextualCanonicalOrganization,
    ).length,
    3,
  );
  const removedContextualInstitutions = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    {
      organizations: [
        contextualCanonicalOrganization,
        contextualAliasOrganization,
      ],
    },
  );
  assert.equal(removedContextualInstitutions.response.status, 200);
  assert.equal(removedContextualInstitutions.payload.deletedCount, 3);

  const protectedWelfareOrganization =
    `보령 병합보호${normalizationStamp}실버복지관`;
  const protectedKindergartenOrganization =
    `보령 병합보호${normalizationStamp}초등학교 병설유치원`;
  const sharedInstitutionContext = {
    activityType: "TM",
    region: "보령",
    contactName: "임명숙 지사장",
    progressManager: "양승민 이사",
    topic: "스크린 사이즈 통일",
    summary: "스크린 사이즈를 4,400*2,450으로 통일하는 방향을 검토했습니다.",
  };
  const protectedWelfareRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      ...sharedInstitutionContext,
      organization: protectedWelfareOrganization,
    },
  );
  assert.equal(protectedWelfareRecord.response.status, 201);
  const protectedKindergartenRecord = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      ...sharedInstitutionContext,
      organization: protectedKindergartenOrganization,
    },
  );
  assert.equal(protectedKindergartenRecord.response.status, 201);
  assert.equal(
    protectedKindergartenRecord.payload.record.organization,
    protectedKindergartenOrganization,
  );
  const rejectedUnsafeConfirmation = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      ...sharedInstitutionContext,
      organization: protectedKindergartenOrganization,
      confirmedOrganization: protectedWelfareOrganization,
    },
  );
  assert.equal(rejectedUnsafeConfirmation.response.status, 201);
  assert.equal(
    rejectedUnsafeConfirmation.payload.record.organization,
    protectedKindergartenOrganization,
  );
  const removedProtectedInstitutions = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    {
      organizations: [
        protectedWelfareOrganization,
        protectedKindergartenOrganization,
      ],
    },
  );
  assert.equal(removedProtectedInstitutions.response.status, 200);
  assert.equal(removedProtectedInstitutions.payload.deletedCount, 3);

  const removed = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    {
      organizations: [
        "로컬 통합 테스트 기관",
        annexOrganization,
        girlsHighOrganization,
        elementaryOrganization,
        existingSimilarOrganization,
      ],
    },
  );
  assert.equal(removed.response.status, 200);
  assert.equal(removed.payload.deletedCount, 6);

  const manyOrganizations = Array.from(
    { length: 56 },
    (_, index) => `전체 삭제 검증 기관 ${index + 1}`,
  );
  const removedMany = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    { organizations: manyOrganizations },
  );
  assert.equal(removedMany.response.status, 200);
  assert.equal(removedMany.payload.deletedOrganizations, 56);
  assert.equal(removedMany.payload.deletedCount, 0);

  const reviewBackupRecord = await jsonRequest(
    "/api/records",
    "POST",
    memberHeaders,
    {
      activityDate: "2026-07-19",
      activityType: "TM·통화",
      organization: "내 기록 점검 백업 검증 기관",
      summary: "점검 처리 상태가 백업과 복원에 포함되는지 확인",
      followUpRequired: true,
      progressManager: "통합 구성원",
    },
  );
  assert.equal(reviewBackupRecord.response.status, 201);
  const transferredReviewRecord = await jsonRequest(
    "/api/records/assignee",
    "PUT",
    memberHeaders,
    {
      activityId: reviewBackupRecord.payload.record.id,
      targetMemberId: ownerAssignee.id,
    },
  );
  assert.equal(transferredReviewRecord.response.status, 200);
  assert.equal(
    transferredReviewRecord.payload.record.progress_manager,
    "로컬 관리자",
  );
  assert.equal(
    transferredReviewRecord.payload.assignment.changedByName,
    "통합 구성원",
  );
  const rejectedTransferBack = await jsonRequest(
    "/api/records/assignee",
    "PUT",
    memberHeaders,
    {
      activityId: reviewBackupRecord.payload.record.id,
      targetMemberId: memberAssignee.id,
    },
  );
  assert.equal(rejectedTransferBack.response.status, 403);
  const transferredBackToMember = await jsonRequest(
    "/api/records/assignee",
    "PUT",
    ownerHeaders,
    {
      activityId: reviewBackupRecord.payload.record.id,
      targetMemberId: memberAssignee.id,
    },
  );
  assert.equal(transferredBackToMember.response.status, 200);
  assert.equal(
    transferredBackToMember.payload.record.progress_manager,
    "통합 구성원",
  );
  const reviewBackupSignature = JSON.stringify({
    activityId: reviewBackupRecord.payload.record.id,
    issues: ["재연락 예정일", "다음 행동"],
  });
  const savedBackupReview = await jsonRequest(
    "/api/record-reviews",
    "POST",
    memberHeaders,
    {
      items: [
        {
          activityId: reviewBackupRecord.payload.record.id,
          issueSignature: reviewBackupSignature,
          snoozedUntil: null,
        },
      ],
    },
  );
  assert.equal(savedBackupReview.response.status, 200);

  const assistantBackup = await request("/api/backup?kind=full", {
    headers: memberHeaders,
  });
  assert.equal(assistantBackup.response.status, 403);

  const fullBackup = await request("/api/backup?kind=full", {
    headers: ownerHeaders,
  });
  assert.equal(fullBackup.response.status, 200);
  assert.equal(fullBackup.payload.format, "whizzup-full-backup");
  assert.equal(fullBackup.payload.formatVersion, 1);
  assert.ok(Array.isArray(fullBackup.payload.data.activities));
  assert.ok(Array.isArray(fullBackup.payload.data.organization_locations));
  assert.ok(Array.isArray(fullBackup.payload.data.sales_campaign_targets));
  assert.ok(Array.isArray(fullBackup.payload.data.equipment_items));
  assert.ok(
    Array.isArray(
      fullBackup.payload.data.activity_review_acknowledgements,
    ),
  );
  assert.ok(
    Array.isArray(fullBackup.payload.data.activity_assignment_history),
  );
  assert.ok(
    fullBackup.payload.data.activity_assignment_history.some(
      (item) =>
        item.activity_id === reviewBackupRecord.payload.record.id &&
        item.to_manager === "로컬 관리자" &&
        item.changed_by_name === "통합 구성원",
    ),
  );
  assert.ok(
    fullBackup.payload.data.activity_review_acknowledgements.some(
      (item) =>
        item.activity_id === reviewBackupRecord.payload.record.id &&
        item.issue_signature === reviewBackupSignature,
    ),
  );
  assert.equal(fullBackup.payload.data.oauth_tokens, undefined);
  assert.equal(fullBackup.payload.data.oauth_codes, undefined);

  const emergencyDownload = await fetch(
    `${origin}/api/backup?kind=emergency`,
    { headers: ownerHeaders },
  );
  assert.equal(emergencyDownload.status, 200);
  assert.match(
    emergencyDownload.headers.get("content-disposition") ?? "",
    /WHIZZUP_emergency_recovery_/,
  );
  const emergencyFiles = unzipSync(
    new Uint8Array(await emergencyDownload.arrayBuffer()),
  );
  assert.ok(emergencyFiles["WHIZZUP_source.zip"]);
  assert.ok(emergencyFiles["READ_THIS_FIRST.txt"]);
  assert.ok(emergencyFiles["MANIFEST.json"]);
  const emergencyDataName = Object.keys(emergencyFiles).find(
    (name) => name.startsWith("WHIZZUP_full_backup_") && name.endsWith(".json"),
  );
  assert.ok(emergencyDataName);
  const emergencyBackup = JSON.parse(
    strFromU8(emergencyFiles[emergencyDataName]),
  );
  assert.equal(emergencyBackup.format, "whizzup-full-backup");
  const sourceFiles = unzipSync(emergencyFiles["WHIZZUP_source.zip"]);
  assert.ok(sourceFiles["app/api/backup/route.ts"]);
  assert.ok(sourceFiles["package.json"]);
  assert.equal(sourceFiles[".env"], undefined);

  const offlineDownload = await fetch(
    `${origin}/api/backup?kind=offline`,
    { headers: ownerHeaders },
  );
  assert.equal(offlineDownload.status, 200);
  assert.match(
    offlineDownload.headers.get("content-disposition") ?? "",
    /WHIZZUP_offline_edition_/,
  );
  const offlineFiles = unzipSync(
    new Uint8Array(await offlineDownload.arrayBuffer()),
  );
  assert.ok(offlineFiles["WHIZZUP_offline.html"]);
  assert.ok(offlineFiles["오프라인_사용안내.txt"]);
  const offlineHtml = strFromU8(offlineFiles["WHIZZUP_offline.html"]);
  assert.match(offlineHtml, /인터넷 없이 실행 중/);
  assert.match(offlineHtml, /변경본 백업 내보내기/);
  assert.match(offlineHtml, /whizzup-full-backup/);
  assert.match(offlineHtml, /진행 담당자 변경 이력/);
  assert.doesNotMatch(offlineHtml, /<script\s+src=/i);
  const offlineScripts = [...offlineHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(offlineScripts.length, 2);
  new Function(offlineScripts[1][1]);

  const inspectedBackup = await jsonRequest(
    "/api/backup",
    "POST",
    ownerHeaders,
    {
      action: "inspect-backup",
      backup: fullBackup.payload,
    },
  );
  assert.equal(inspectedBackup.response.status, 200);
  assert.equal(inspectedBackup.payload.inspection.valid, true);
  assert.equal(
    inspectedBackup.payload.inspection.counts.activities,
    fullBackup.payload.data.activities.length,
  );
  const corruptedBackup = structuredClone(fullBackup.payload);
  corruptedBackup.data.members[0].display_name =
    `${corruptedBackup.data.members[0].display_name} 손상`;
  const rejectedCorruptedBackup = await jsonRequest(
    "/api/backup",
    "POST",
    ownerHeaders,
    {
      action: "inspect-backup",
      backup: corruptedBackup,
    },
  );
  assert.equal(rejectedCorruptedBackup.response.status, 400);
  assert.match(rejectedCorruptedBackup.payload.error, /무결성/);

  const temporaryAfterBackup = await jsonRequest(
    "/api/records",
    "POST",
    ownerHeaders,
    {
      activityDate: "2026-07-18",
      activityType: "TM·통화",
      organization: "전체 백업 복원 임시기관",
      summary: "복원 후 사라져야 하는 기록",
      followUpRequired: false,
    },
  );
  assert.equal(temporaryAfterBackup.response.status, 201);

  const restoredBackup = await jsonRequest(
    "/api/backup",
    "POST",
    ownerHeaders,
    {
      action: "restore-backup",
      backup: fullBackup.payload,
      confirmation: "복원",
      safetyBackupDownloaded: true,
    },
  );
  assert.equal(restoredBackup.response.status, 200);
  assert.equal(restoredBackup.payload.ok, true);

  const recordsAfterRestore = await request("/api/records", {
    headers: ownerHeaders,
  });
  assert.equal(recordsAfterRestore.response.status, 200);
  assert.equal(
    recordsAfterRestore.payload.records.some(
      (record) => record.organization === "전체 백업 복원 임시기관",
    ),
    false,
  );
  const recordReviewsAfterRestore = await request("/api/record-reviews", {
    headers: memberHeaders,
  });
  assert.ok(
    recordReviewsAfterRestore.payload.acknowledgements.some(
      (item) =>
        item.activityId === reviewBackupRecord.payload.record.id &&
        item.issueSignature === reviewBackupSignature,
    ),
  );
  const backupAfterRestore = await request("/api/backup?kind=full", {
    headers: ownerHeaders,
  });
  assert.equal(backupAfterRestore.response.status, 200);
  assert.ok(
    backupAfterRestore.payload.data.activity_assignment_history.some(
      (item) =>
        item.activity_id === reviewBackupRecord.payload.record.id &&
        item.to_manager === "로컬 관리자" &&
        item.changed_by_name === "통합 구성원",
    ),
  );

  const csvDownload = await fetch(
    `${origin}/api/backup?kind=activities-csv`,
    { headers: ownerHeaders },
  );
  assert.equal(csvDownload.status, 200);
  const downloadedCsv = await csvDownload.text();
  assert.match(downloadedCsv, /기록 ID/);
  assert.match(downloadedCsv, /입력자 이메일/);

  const importCsv =
    '\uFEFF"날짜","활동 유형","기관명","요약","재연락 필요","입력자"\r\n' +
    '"2026-07-18","TM·통화","CSV 통합 테스트 기관","쉼표, 포함\n둘째 줄","아니오","로컬 관리자"';
  const inspectedCsv = await jsonRequest(
    "/api/backup",
    "POST",
    ownerHeaders,
    { action: "inspect-csv", csv: importCsv },
  );
  assert.equal(inspectedCsv.response.status, 200);
  assert.equal(inspectedCsv.payload.inspection.importableRows, 1);
  assert.equal(inspectedCsv.payload.inspection.errorRows, 0);

  const importedCsv = await jsonRequest(
    "/api/backup",
    "POST",
    ownerHeaders,
    { action: "import-csv", csv: importCsv },
  );
  assert.equal(importedCsv.response.status, 200);
  assert.equal(importedCsv.payload.result.importedRows, 1);
  const recordsAfterCsvImport = await request("/api/records", {
    headers: ownerHeaders,
  });
  const csvRecord = recordsAfterCsvImport.payload.records.find(
    (record) => record.organization === "CSV 통합 테스트 기관",
  );
  assert.equal(csvRecord.summary, "쉼표, 포함\n둘째 줄");

  const duplicateCsv = await jsonRequest(
    "/api/backup",
    "POST",
    ownerHeaders,
    { action: "inspect-csv", csv: importCsv },
  );
  assert.equal(duplicateCsv.response.status, 200);
  assert.equal(duplicateCsv.payload.inspection.importableRows, 0);
  assert.equal(duplicateCsv.payload.inspection.duplicateRows, 1);

  const csvCleanup = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    { organizations: ["CSV 통합 테스트 기관"] },
  );
  assert.equal(csvCleanup.response.status, 200);
  const reviewCleanup = await jsonRequest(
    "/api/records",
    "DELETE",
    ownerHeaders,
    { organizations: ["내 기록 점검 백업 검증 기관"] },
  );
  assert.equal(reviewCleanup.response.status, 200);

  console.log(
    "PASS: 로그인, 승인, OAuth, 기관명 자동정리·확인, 수주, 전체 DB·비상복구·오프라인 백업, 활동 CSV 가져오기",
  );
} finally {
  server.kill();
}
