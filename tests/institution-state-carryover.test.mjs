import assert from "node:assert/strict";
import test from "node:test";

import {
  inheritInstitutionState,
  mergeInstitutionStateSnapshots,
  resolveInstitutionContactSet,
} from "../lib/institution-state-carryover.ts";

const previousState = {
  category: "기관",
  region: "충남 보령",
  budgetType: "본예산",
  budgetAmount: "5,000만",
  status: "결과 확인",
  temperature: "높음",
  awardStatus: "위즈업 수주",
  awardCompany: "위즈업",
  executionType: "컨소",
  consortiumCompany: "협력사",
  awardStage: "일정 조율",
  awardCompletedDate: "2026-07-22",
  progressManager: "양승민",
  followUpRequired: false,
  followUpDate: "2026-07-23",
  nextAction: "설치 일정 확인",
  progressSchedule: "설치\t2026-07-30",
  contactRole: "행정 담당자",
  contactName: "신동빈 선생님",
  contactPhone: "010-1234-5678",
  contactEmail: "teacher@example.com",
};

test("같은 기관의 새 기록은 비어 있는 기관 정보와 진행 상태를 승계한다", () => {
  const result = inheritInstitutionState(
    {
      activityDate: "2026-07-21",
      activityType: "TM·통화",
      summary: "오늘 새로 통화한 내용",
      region: "",
      budgetType: "",
      budgetAmount: "",
      status: "",
      awardStatus: "미정",
      awardCompany: "",
      awardStage: "미정",
      progressManager: "",
      contactName: "",
      contactEmail: "",
    },
    previousState,
  );

  assert.equal(result.activityDate, "2026-07-21");
  assert.equal(result.summary, "오늘 새로 통화한 내용");
  assert.equal(result.region, "충남 보령");
  assert.equal(result.budgetType, "본예산");
  assert.equal(result.budgetAmount, "5,000만");
  assert.equal(result.status, "결과 확인");
  assert.equal(result.awardStatus, "위즈업 수주");
  assert.equal(result.awardCompany, "위즈업");
  assert.equal(result.awardStage, "일정 조율");
  assert.equal(result.awardCompletedDate, "2026-07-22");
  assert.equal(result.progressManager, "양승민");
  assert.equal(result.contactName, "신동빈 선생님");
  assert.equal(result.contactEmail, "teacher@example.com");
});

test("새 기록에 직접 입력한 값은 이전 정보보다 우선한다", () => {
  const result = inheritInstitutionState(
    {
      status: "완료",
      budgetAmount: "6,000만",
      awardStatus: "타업체 수주",
      awardCompany: "새 업체",
      awardStage: "계약",
      contactName: "새 담당자",
    },
    previousState,
  );

  assert.equal(result.status, "완료");
  assert.equal(result.budgetAmount, "6,000만");
  assert.equal(result.awardStatus, "타업체 수주");
  assert.equal(result.awardCompany, "새 업체");
  assert.equal(result.executionType, "해당 없음");
  assert.equal(result.consortiumCompany, "");
  assert.equal(result.awardStage, "해당 없음");
  assert.equal(result.contactName, "새 담당자");
});

test("입력 화면의 초기 선택값은 최근 기관 값으로 바꾼다", () => {
  const result = inheritInstitutionState(
    {
      category: "학교",
      status: "진행 중",
      temperature: "중간",
      executionType: "직영",
      followUpRequired: false,
    },
    previousState,
    { inheritFormDefaults: true },
  );

  assert.equal(result.category, "기관");
  assert.equal(result.status, "결과 확인");
  assert.equal(result.temperature, "높음");
  assert.equal(result.executionType, "컨소");
  assert.equal(result.consortiumCompany, "협력사");
  assert.equal(result.followUpRequired, false);
});

test("최신 기록의 빈칸은 더 오래된 기록의 실제 값으로 보완한다", () => {
  const snapshot = mergeInstitutionStateSnapshots([
    {
      status: "진행 중",
      contactName: "",
      awardStatus: "미정",
      followUpRequired: 0,
    },
    {
      contactName: "이전 담당자",
      awardStatus: "위즈업 수주",
      awardStage: "협상",
    },
  ]);

  assert.equal(snapshot?.status, "진행 중");
  assert.equal(snapshot?.contactName, "이전 담당자");
  assert.equal(snapshot?.awardStatus, "위즈업 수주");
  assert.equal(snapshot?.awardStage, "협상");
  assert.equal(snapshot?.followUpRequired, false);
});

test("기존 정보가 없는 기관은 새 기록 값을 그대로 사용한다", () => {
  const payload = { status: "진행 중", awardStatus: "미정" };
  assert.equal(inheritInstitutionState(payload, null), payload);
});

test("이전 기록이 재연락 대상이어도 새 기록에는 승계하지 않는다", () => {
  const result = inheritInstitutionState(
    {
      status: "진행 중",
      followUpRequired: false,
      followUpDate: "",
    },
    {
      followUpRequired: true,
      followUpDate: "2026-08-01",
    },
  );

  assert.equal(result.followUpRequired, false);
  assert.equal(result.followUpDate, "");
});

test("연락처는 같은 차수의 가장 가까운 이전 기록 한 건에서만 가져온다", () => {
  const current = {
    id: 30,
    activityDate: "2026-07-30",
    businessRound: 2,
    contactRole: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  };
  const latestPrevious = {
    id: 29,
    activityDate: "2026-07-20",
    businessRound: 2,
    contactRole: "행정 담당자",
    contactName: "최근 담당자",
    contactPhone: "",
    contactEmail: "",
  };
  const olderComplete = {
    id: 28,
    activityDate: "2026-07-10",
    businessRound: 2,
    contactRole: "교사",
    contactName: "과거 담당자",
    contactPhone: "010-1111-2222",
    contactEmail: "old@example.com",
  };

  const result = resolveInstitutionContactSet(current, [
    olderComplete,
    current,
    latestPrevious,
  ]);

  assert.equal(result.contactRole, "행정 담당자");
  assert.equal(result.contactName, "최근 담당자");
  assert.equal(result.contactPhone, "");
  assert.equal(result.contactEmail, "");
  assert.equal(result.source?.id, 29);
  assert.deepEqual(result.inheritedFields, ["contactRole", "contactName"]);
});

test("다른 사업 차수 연락처는 자동으로 섞지 않는다", () => {
  const current = {
    id: 40,
    activityDate: "2026-07-30",
    businessRound: 2,
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  };
  const differentRound = {
    id: 39,
    activityDate: "2026-07-29",
    businessRound: 1,
    contactName: "1차 담당자",
    contactPhone: "010-3333-4444",
    contactEmail: "round1@example.com",
  };

  const result = resolveInstitutionContactSet(current, [
    current,
    differentRound,
  ]);

  assert.equal(result.contactName, "");
  assert.equal(result.contactPhone, "");
  assert.equal(result.contactEmail, "");
  assert.equal(result.source, null);
  assert.deepEqual(result.inheritedFields, []);
});

test("현재 연락처 값은 유지하고 빈 필드만 동일한 이전 기록에서 보완한다", () => {
  const current = {
    id: 50,
    activityDate: "2026-07-30",
    businessRound: 1,
    contactRole: "",
    contactName: "현재 입력 담당자",
    contactPhone: "",
    contactEmail: "current@example.com",
  };
  const previous = {
    id: 49,
    activityDate: "2026-07-20",
    businessRound: 1,
    contactRole: "행정 담당자",
    contactName: "이전 담당자",
    contactPhone: "010-5555-6666",
    contactEmail: "previous@example.com",
  };

  const result = resolveInstitutionContactSet(current, [previous, current]);

  assert.equal(result.contactRole, "행정 담당자");
  assert.equal(result.contactName, "현재 입력 담당자");
  assert.equal(result.contactPhone, "010-5555-6666");
  assert.equal(result.contactEmail, "current@example.com");
  assert.equal(result.source?.id, 49);
  assert.deepEqual(result.inheritedFields, ["contactRole", "contactPhone"]);
});

test("기관 상태 병합도 연락처 필드를 여러 과거 기록에서 조합하지 않는다", () => {
  const snapshot = mergeInstitutionStateSnapshots([
    {
      contactName: "최근 담당자",
      contactPhone: "",
      status: "상담 진행",
    },
    {
      contactName: "과거 담당자",
      contactPhone: "010-7777-8888",
      status: "신규 접촉",
    },
  ]);

  assert.equal(snapshot?.contactName, "최근 담당자");
  assert.equal(snapshot?.contactPhone, undefined);
  assert.equal(snapshot?.status, "상담 진행");
});
