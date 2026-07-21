import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalInstitutionName,
  findSimilarInstitutionNames,
  findSimilarInstitutionMatches,
  officialSchoolSearchTerms,
  rememberedInstitutionAlias,
  updateInstitutionAliasSetting,
} from "../lib/institution-names.ts";

test("학교급과 성별이 포함된 흔한 줄임말을 정식 형태로 정리한다", () => {
  assert.equal(canonicalInstitutionName("진명여고"), "진명여자고등학교");
  assert.equal(canonicalInstitutionName("근명여중"), "근명여자중학교");
  assert.equal(canonicalInstitutionName("한빛 초·중학교"), "한빛초중학교");
  assert.equal(canonicalInstitutionName("모담초교"), "모담초등학교");
});

test("전문계 고등학교 줄임말은 공식 학교 검색 후보로만 확장한다", () => {
  assert.deepEqual(officialSchoolSearchTerms("서울공고"), [
    "서울공고",
    "서울공업고등학교",
  ]);
  assert.deepEqual(officialSchoolSearchTerms("대원외고"), [
    "대원외고",
    "대원외국어고등학교",
  ]);
});

test("초등학교와 초중학교는 이름이 같아도 자동 통합 후보로 보지 않는다", () => {
  assert.deepEqual(findSimilarInstitutionNames("한빛초", ["한빛초중학교"]), []);
});

test("초 유치원 축약을 초등학교 병설유치원으로 정리한다", () => {
  assert.equal(
    canonicalInstitutionName("성남초 유치원"),
    "성남초등학교 병설유치원",
  );
  assert.equal(
    canonicalInstitutionName("성남초 병설유치원"),
    "성남초등학교 병설유치원",
  );
});

test("같은 초등학교와 병설유치원은 합치기 확인 후보로 올린다", () => {
  assert.deepEqual(
    findSimilarInstitutionNames("성남초 병설", ["성남초"]),
    ["성남초등학교"],
  );
  assert.deepEqual(
    findSimilarInstitutionMatches(
      { organization: "성남초 병설" },
      [{ organization: "성남초" }],
    ),
    [
      {
        organization: "성남초등학교",
        reasons: ["초등학교와 병설유치원 관계"],
        score: 5,
      },
    ],
  );
});

test("같은 지역·기관 유형에 진행 담당자까지 같으면 합치기 확인 후보로 올린다", () => {
  const requested = {
    organization: "보령 실버복지관",
    region: "충남 보령",
    progressManager: "양승민 이사",
  };
  const existing = {
    organization: "명천 실버복지관",
    region: "보령",
    progressManager: "양승민 이사",
  };

  assert.deepEqual(
    findSimilarInstitutionMatches(requested, [existing]),
    [
      {
        organization: "명천 실버복지관",
        reasons: [
          "기관 유형이 같음",
          "지역이 같음",
          "진행 담당자가 같음",
        ],
        score: 8,
      },
    ],
  );
});

test("같은 지역의 같은 유형 기관이어도 추가 근거가 없으면 후보로 올리지 않는다", () => {
  assert.deepEqual(
    findSimilarInstitutionMatches(
      {
        organization: "보령 실버복지관",
        region: "충남 보령",
      },
      [
        {
          organization: "명천 실버복지관",
          region: "보령",
        },
      ],
    ),
    [],
  );
});

test("사용자가 승인한 기관 별칭만 다음 입력부터 기억한다", () => {
  const setting = updateInstitutionAliasSetting(
    "",
    "보령 실버복지관",
    "명천 실버복지관",
  );

  assert.equal(
    rememberedInstitutionAlias("보령 실버복지관", setting),
    "명천 실버복지관",
  );
  assert.equal(rememberedInstitutionAlias("보령 노인복지관", setting), "");
});

test("승인한 별칭은 저장되고 다음 기록 입력에서 먼저 적용된다", async () => {
  const root = new URL("../", import.meta.url);
  const [recordsStore, institutionMerge] = await Promise.all([
    readFile(new URL("lib/records-store.ts", root), "utf8"),
    readFile(new URL("lib/institution-merge.ts", root), "utf8"),
  ]);

  assert.match(recordsStore, /rememberedInstitutionAlias/);
  assert.match(recordsStore, /INSTITUTION_ALIASES_SETTING_KEY/);
  assert.match(institutionMerge, /updateInstitutionAliasSetting/);
  assert.match(institutionMerge, /ON CONFLICT\(key\) DO UPDATE SET/);
});

test("기관 관계 선택과 전국 학교정보 연결이 백업 사이트에도 포함된다", async () => {
  const root = new URL("../", import.meta.url);
  const [recordsStore, confirmation, crm, schoolDirectory] = await Promise.all([
    readFile(new URL("lib/records-store.ts", root), "utf8"),
    readFile(new URL("app/institution-confirmation.ts", root), "utf8"),
    readFile(new URL("app/crm-app.tsx", root), "utf8"),
    readFile(new URL("lib/school-directory.ts", root), "utf8"),
  ]);
  assert.match(recordsStore, /resolveOfficialSchoolName/);
  assert.match(recordsStore, /excludedInstitutionCandidates/);
  assert.match(confirmation, /관련 기관으로 구분/);
  assert.match(confirmation, /새로운 별도 기관으로 등록/);
  assert.match(crm, /전국 학교정보 연결/);
  assert.match(schoolDirectory, /INTERVAL '30 days'/);
});

test("띄어쓰기만 다른 동일 기관은 채팅에서 다시 묻지 않고 기존 기관명으로 연결한다", async () => {
  const root = new URL("../", import.meta.url);
  const [aiRoute, crm] = await Promise.all([
    readFile(new URL("app/api/ai/organize/route.ts", root), "utf8"),
    readFile(new URL("app/crm-app.tsx", root), "utf8"),
  ]);

  assert.match(
    aiRoute,
    /draft\.organization = preferFullInstitutionName\(\.\.\.exactAliases\)/,
  );
  assert.doesNotMatch(aiRoute, /두 이름을 같은 기관으로 합칠까요/);
  assert.match(crm, /event\.shiftKey \|\| mobileTextEntry/);
  assert.match(crm, /모바일은\s+Enter로 줄바꿈/);
});
