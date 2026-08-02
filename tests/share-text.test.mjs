import assert from "node:assert/strict";
import test from "node:test";

import {
  activityShareHeading,
  collapseRepeatedOrganizationRegionPrefix,
  compactRepeatedAiText,
  compactShareSummary,
  formalizeShareSummary,
  removeRepeatedContactStatement,
  replaceOrganizationReferences,
  resolveContactRole,
} from "../lib/share-text.ts";

test("단톡 공유 제목은 활동 유형에 맞게 짧게 표시한다", () => {
  assert.equal(
    activityShareHeading("묵호고등학교", "TM·통화"),
    "[묵호고등학교 TM 공유]",
  );
  assert.equal(
    activityShareHeading("묵호고등학교", "방문 미팅"),
    "[묵호고등학교 미팅 공유]",
  );
});

test("확정된 기관명을 요약 안의 오타와 띄어쓰기 표기에도 반영한다", () => {
  assert.equal(
    replaceOrganizationReferences(
      "명친실버복지관 출입구 디자인을 확인한다.",
      "명친 실버복지관",
      "명천 실버복지관",
    ),
    "명천 실버복지관 출입구 디자인을 확인한다.",
  );
});

test("공식 학교명이 이미 들어간 문장을 다시 정리해도 지역명과 학교급이 중복되지 않는다", () => {
  assert.equal(
    replaceOrganizationReferences(
      "서울 서울천동초등학교 교장선생님과 미팅이 예정되어 있습니다.",
      "서울천동초",
      "서울천동초등학교",
    ),
    "서울 서울천동초등학교 교장선생님과 미팅이 예정되어 있습니다.",
  );
  assert.equal(
    replaceOrganizationReferences(
      "서울천동초등학교 교장선생님과 미팅이 예정되어 있습니다.",
      "천동초",
      "서울천동초등학교",
    ),
    "서울천동초등학교 교장선생님과 미팅이 예정되어 있습니다.",
  );
});

test("기관명에 이미 포함된 지역명이 문장 앞에 한 번 더 붙으면 한 번만 남긴다", () => {
  assert.equal(
    collapseRepeatedOrganizationRegionPrefix(
      "서울서울천동초등학교 교장 선생님과 미팅이 예정되어 있습니다.",
      "서울천동초등학교",
      "서울",
    ),
    "서울천동초등학교 교장 선생님과 미팅이 예정되어 있습니다.",
  );
  assert.equal(
    collapseRepeatedOrganizationRegionPrefix(
      "서울 서울천동초등학교 교장 선생님과 미팅이 예정되어 있습니다.",
      "서울천동초등학교",
      "서울특별시 동대문구",
    ),
    "서울천동초등학교 교장 선생님과 미팅이 예정되어 있습니다.",
  );
  assert.equal(
    collapseRepeatedOrganizationRegionPrefix(
      "서울천동초등학교 교장 선생님과 미팅이 예정되어 있습니다.",
      "서울천동초등학교",
      "서울",
    ),
    "서울천동초등학교 교장 선생님과 미팅이 예정되어 있습니다.",
  );
});

test("단톡 공유 문구에서 해설과 없는 정보 설명만 제거한다", () => {
  assert.equal(
    compactShareSummary(
      "명천 실버복지관 출입구 디자인 컨펌을 7월 21일 오전까지 진행하기로 함. 일정 확인이 핵심이며 별도 장비나 수주 정보는 없었습니다.",
    ),
    "명천 실버복지관 출입구 디자인 컨펌을 7월 21일 오전까지 진행하기로 함.",
  );
});

test("기관이 실제로 전달한 장비 관련 부정 의견은 보존한다", () => {
  assert.equal(
    compactShareSummary("전자칠판 장비는 필요하지 않다고 전달함."),
    "전자칠판 장비는 필요하지 않다고 전달함.",
  );
});

test("기존 요약에 적힌 공사 담당자 역할을 복원한다", () => {
  assert.equal(
    resolveContactRole(
      "",
      "스크린사이즈를 논의했다. 공사 담당자는 임명숙 지사장으로 확인됐다.",
    ),
    "공사 담당자",
  );
});

test("별도 담당자 줄과 겹치는 확인 문장만 본문에서 제거한다", () => {
  assert.equal(
    removeRepeatedContactStatement(
      "스크린사이즈를 4,400*2,450으로 통일하는 방향을 논의했다. 공사 담당자는 임명숙 지사장으로 확인됐다.",
      "공사 담당자",
      "임명숙 지사장",
    ),
    "스크린사이즈를 4,400*2,450으로 통일하는 방향을 논의했다.",
  );
});

test("단톡 공유 요약을 존댓말 보고체로 바꾼다", () => {
  assert.equal(
    formalizeShareSummary(
      "스크린 규격을 통일하는 방향을 논의했다. 공사 반영 일정을 확인한다. 설치 가능 여부가 확인됐다.",
    ),
    "스크린 규격을 통일하는 방향을 논의했습니다. 공사 반영 일정을 확인합니다. 설치 가능 여부가 확인됐습니다.",
  );
});

test("AI가 기관명 일부를 오타와 함께 반복해도 한 번만 남긴다", () => {
  assert.equal(
    compactRepeatedAiText(
      "담당 선생님께 성남초등학교 병설유치원 병설유치원 병설유치워 병설유치우 공간 재구성 시기를 확인합니다.",
    ),
    "담당 선생님께 성남초등학교 병설유치원 공간 재구성 시기를 확인합니다.",
  );
});

test("AI가 동일한 짧은 구절을 반복해도 정상 문장은 유지한다", () => {
  assert.equal(
    compactRepeatedAiText(
      "업체 선정 여부 확인 업체 선정 여부 확인 후 견적서를 준비합니다.",
    ),
    "업체 선정 여부 확인 후 견적서를 준비합니다.",
  );
});
