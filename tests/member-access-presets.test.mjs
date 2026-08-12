import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("구성원 역할은 확정된 네 가지 역할과 직접 설정을 제공한다", () => {
  const crm = source("../app/crm-app.tsx");
  for (const [value, label] of [
    ["sales", "영업 담당자"],
    ["salesManager", "영업 관리자"],
    ["accounting", "회계 담당자"],
    ["operations", "운영 관리자"],
    ["custom", "직접 설정"],
  ]) {
    assert.match(crm, new RegExp(`<option value="${value}">${label}</option>`));
  }
  assert.match(crm, /salesManager:[\s\S]*permissions: \["records:manage"\]/);
  assert.match(
    crm,
    /accounting:[\s\S]*permissions: \["accounting:manage", "analytics:view"\]/,
  );
  assert.match(
    crm,
    /operations:[\s\S]*permissions: memberPermissionOptions[\s\S]*filter\(\(permission\) => permission !== "activity-history:manage"\)/,
  );
  assert.match(crm, /id: "activity-history:manage"/);
});

test("역할과 기능 권한을 저장해도 영업 담당자 등록은 변경하지 않는다", () => {
  const crm = source("../app/crm-app.tsx");
  const membersRoute = source("../app/api/members/route.ts");
  const presetDefinitions = crm.slice(
    crm.indexOf("const memberAccessPresetDefinitions"),
    crm.indexOf("const memberAccessPresetLabels"),
  );
  const updateMember = crm.slice(
    crm.indexOf("async function updateMember("),
    crm.indexOf("async function updateMemberSalesStatus("),
  );
  const updateAccess = membersRoute.slice(
    membersRoute.indexOf("export async function PUT"),
    membersRoute.indexOf("export async function PATCH"),
  );
  const updateSales = membersRoute.slice(
    membersRoute.indexOf("export async function PATCH"),
    membersRoute.indexOf("export async function DELETE"),
  );

  assert.doesNotMatch(presetDefinitions, /isSales/);
  assert.doesNotMatch(updateMember, /isSales/);
  assert.doesNotMatch(updateAccess, /is_sales\s*=|payload\.isSales/);
  assert.match(updateSales, /typeof payload\.isSales === "boolean"/);
  assert.match(updateSales, /UPDATE members SET is_sales = \?/);
});

test("직접 설정 권한은 왼쪽 운영 도구 순서와 동일하다", () => {
  const collaboration = source("../lib/collaboration.ts");
  const crm = source("../app/crm-app.tsx");
  const orderedPermissions = [
    "records:manage",
    "members:manage",
    "activity-history:manage",
    "accounting:manage",
    "analytics:view",
    "inventory:manage",
    "trash:manage",
    "integration:manage",
    "backup:manage",
  ];
  const orderedLabels = [
    "팀 업무 현황 · 관리자 영업 점검",
    "구성원 관리",
    "일괄 변경 이력·되돌리기",
    "수금·채권 관리",
    "수주·제품 통계",
    "물류·재고 관리",
    "휴지통 복구",
    "API 등록·관리",
    "데이터 백업·복구",
  ];

  let previousPermission = -1;
  for (const permission of orderedPermissions) {
    const next = collaboration.indexOf(`"${permission}"`);
    assert.ok(next > previousPermission, `${permission} 권한 순서`);
    previousPermission = next;
  }

  let previousLabel = -1;
  for (const label of orderedLabels) {
    const next = crm.indexOf(`label: "${label}"`);
    assert.ok(next > previousLabel, `${label} 표시 순서`);
    previousLabel = next;
  }
});

test("팀 현황과 관리자 점검은 하나의 권한으로 함께 노출된다", () => {
  const crm = source("../app/crm-app.tsx");
  const managementMenu = crm.slice(
    crm.indexOf("const managementNavItems"),
    crm.indexOf("const visibleManagementNavItems"),
  );
  assert.equal(
    (managementMenu.match(/canManageRecords &&/g) || []).length,
    2,
  );
  assert.match(
    managementMenu,
    /canManageRecords && \{[\s\S]*id: "records"[\s\S]*canManageRecords && \{[\s\S]*id: "organizations"/,
  );
  assert.doesNotMatch(managementMenu, /id: "trash"/);
  assert.match(
    managementMenu,
    /\(canManageBackup \|\| canManageTrash\) && \{[\s\S]*id: "backup"/,
  );
});

test("음성과 사진 분석은 대표관리자가 구성원별로 허용한다", () => {
  const collaboration = source("../lib/collaboration.ts");
  const membersRoute = source("../app/api/members/route.ts");
  const transcribeRoute = source("../app/api/ai/transcribe/route.ts");
  const imageRoute = source("../app/api/ai/images/route.ts");
  const crm = source("../app/crm-app.tsx");

  assert.match(collaboration, /"ai:voice"/);
  assert.match(collaboration, /"ai:images"/);
  assert.match(membersRoute, /const aiInputPermissions/);
  assert.match(transcribeRoute, /requireMemberPermission\("ai:voice"\)/);
  assert.match(imageRoute, /requireMemberPermission\("ai:images"\)/);
  assert.match(crm, /label: "음성으로 입력"/);
  assert.match(crm, /label: "사진 추가·분석"/);
  assert.match(crm, /\{canUseVoiceInput && \(/);
  assert.match(crm, /\{canUseImageInput && \(/);
});

test("서버는 이메일로 구성원을 미리 승인 등록할 수 있다", () => {
  const membersRoute = source("../app/api/members/route.ts");

  assert.match(membersRoute, /export async function POST/);
  assert.match(membersRoute, /requireMemberPermission\("members:manage"\)/);
  assert.match(membersRoute, /trim\(\)\.toLowerCase\(\)/);
  assert.match(membersRoute, /status = 'approved'/);
  assert.match(membersRoute, /LOWER\(email\) = \?/);
});
