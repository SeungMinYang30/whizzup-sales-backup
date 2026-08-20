import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildOwnerPerformance,
  canonicalOwnerPerformanceManagerName,
} from "../lib/owner-performance.ts";

test("양승민 담당자 표기를 양승민 이사로 통합한다", () => {
  assert.equal(canonicalOwnerPerformanceManagerName("양승민"), "양승민 이사");
  assert.equal(canonicalOwnerPerformanceManagerName("양승민 이사"), "양승민 이사");
  assert.equal(canonicalOwnerPerformanceManagerName("양승민 이사님"), "양승민 이사");

  const result = buildOwnerPerformance([
    { activityId: 1, businessKey: "a", businessRound: 1, activityDate: "2026-08-01", organization: "A", region: "", progressManager: "양승민", confirmed: true, confirmedAmount: 10, netRevenue: 2 },
    { activityId: 2, businessKey: "b", businessRound: 1, activityDate: "2026-08-02", organization: "B", region: "", progressManager: "양승민 이사", confirmed: true, confirmedAmount: 20, netRevenue: 3 },
  ], [], "2026-01-01", "2026-12-31");

  assert.equal(result.managers.length, 1);
  assert.equal(result.managers[0].name, "양승민 이사");
  assert.equal(result.managers[0].orderCount, 2);
});

test("대표 직책은 대표님으로 통합한다", () => {
  assert.equal(canonicalOwnerPerformanceManagerName("박원석"), "박원석 대표님");
  assert.equal(canonicalOwnerPerformanceManagerName("박원석 대표"), "박원석 대표님");
  assert.equal(canonicalOwnerPerformanceManagerName("박원석 대표님"), "박원석 대표님");
});

test("대표 경영 실적은 완료된 위즈업 수주를 담당자별로 한 번씩 집계한다", () => {
  const result = buildOwnerPerformance(
    [
      {
        activityId: 1,
        businessKey: "기관A\u001f1",
        businessRound: 1,
        activityDate: "2026-07-20",
        organization: "기관A",
        region: "서울",
        progressManager: "김과장",
        confirmed: true,
        confirmedAmount: 50_000_000,
        netRevenue: 8_000_000,
      },
      {
        activityId: 2,
        businessKey: "기관B\u001f1",
        businessRound: 1,
        activityDate: "2026-07-21",
        organization: "기관B",
        region: "부산",
        progressManager: "김과장",
        confirmed: false,
        confirmedAmount: 30_000_000,
        netRevenue: 4_000_000,
      },
    ],
    [
      {
        businessKey: "기관A\u001f1",
        productName: "3D 모션",
        quantity: 2,
        amount: 20_000_000,
        progressManager: "김과장",
      },
      {
        businessKey: "기관A\u001f1",
        productName: "터치테이블",
        quantity: 1,
        amount: 5_000_000,
        progressManager: "김과장",
      },
    ],
    "2026-01-01",
    "2026-12-31",
  );

  assert.deepEqual(result.totals, {
    managerCount: 1,
    orderCount: 1,
    salesAmount: 50_000_000,
    margin: 8_000_000,
    quantity: 3,
  });
  assert.equal(result.managers[0].averageMargin, 8_000_000);
  assert.equal(result.managers[0].marginRate, 0.16);
  assert.equal(result.managers[0].institutions[0].products.length, 2);
});

test("담당자가 비어 있으면 별도 미정 항목으로 남긴다", () => {
  const result = buildOwnerPerformance(
    [{
      activityId: 3,
      businessKey: "기관C\u001f1",
      businessRound: 1,
      activityDate: "2026-08-01",
      organization: "기관C",
      region: "대전",
      progressManager: "",
      confirmed: true,
      confirmedAmount: 10_000_000,
      netRevenue: 1_000_000,
    }],
    [],
    "2026-08-01",
    "2026-08-31",
  );
  assert.equal(result.managers[0].name, "담당자 미정");
  assert.equal(result.totals.managerCount, 0);
});

test("경영 요약은 대표 본인 전용 API와 프로필 메뉴로만 연결된다", async () => {
  const [route, crm, page] = await Promise.all([
    readFile(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/owner-performance-page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /ownerPerformanceResponse[\s\S]*requirePrimaryOwner\(\)/);
  assert.match(crm, /isPrimaryOwner && \([\s\S]*경영 요약/);
  assert.match(crm, /formatManagerName=\{displayProgressManager\}/);
  assert.match(crm, /return member \? memberLabel\(member\) : canonicalOwnerPerformanceManagerName\(raw\)/);
  assert.match(crm, /nextView === "owner-performance" && !isPrimaryOwner/);
  assert.doesNotMatch(
    crm.slice(crm.indexOf("const managementNavItems"), crm.indexOf("const visibleManagementNavItems")),
    /owner-performance/,
  );
  assert.match(page, /납품 완료된 위즈업 수주만 집계/);
  assert.match(page, /담당자별 순위/);
  assert.doesNotMatch(page, /건당 마진/);
  assert.match(page, /owner-ranking-col-manager/);
});
