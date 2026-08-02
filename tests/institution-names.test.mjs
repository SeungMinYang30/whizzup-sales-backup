import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalInstitutionName,
  findSimilarInstitutionNames,
  findSimilarInstitutionMatches,
  isSameRegionInstitution,
  officialSchoolSearchTerms,
  rememberedInstitutionAlias,
  rememberedInstitutionAliasCandidates,
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

test("초등학교·초중학교 축약은 자동 병합하지 않고 확인 후보로 올린다", () => {
  assert.deepEqual(
    findSimilarInstitutionNames("한빛초", ["한빛초중학교"]),
    ["한빛초중학교"],
  );
  assert.deepEqual(
    findSimilarInstitutionNames("모담초", ["김포 모담초중학교"]),
    ["김포 모담초중학교"],
  );
  assert.deepEqual(
    findSimilarInstitutionNames("모담초중", ["김포 모담초중학교"]),
    ["김포 모담초중학교"],
  );
  assert.deepEqual(
    findSimilarInstitutionNames("모담초중학교", ["김포 모담초중학교"]),
    ["김포 모담초중학교"],
  );
  assert.equal(
    canonicalInstitutionName("김포 모담초중학교"),
    "김포 모담초중학교",
  );
  assert.deepEqual(
    findSimilarInstitutionMatches(
      {
        organization: "모담초",
        region: "경기 김포",
      },
      [
        {
          organization: "김포 모담초중학교",
          region: "경기 김포",
        },
      ],
    ),
    [
      {
        organization: "김포 모담초중학교",
        reasons: [
          "지역명 또는 학교 명칭이 생략된 축약명",
          "지역과 기관 핵심명이 같음",
        ],
        score: 15,
      },
    ],
  );
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

test("같은 보령 지역에서 지역명 표기만 다른 복지관을 같은 기관으로 본다", () => {
  const requested = {
    organization: "보령시 실버복지관",
    region: "충남 보령",
  };
  const existing = {
    organization: "보령 실버복지관",
    region: "보령시",
  };

  assert.equal(isSameRegionInstitution(requested, existing), true);
  assert.deepEqual(
    findSimilarInstitutionMatches(requested, [existing]),
    [
      {
        organization: "보령 실버복지관",
        reasons: ["지역과 기관 핵심명이 같음"],
        score: 8,
      },
    ],
  );
});

test("지역만 같고 기관 핵심명이 다르면 합치지 않는다", () => {
  assert.equal(
    isSameRegionInstitution(
      { organization: "보령 실버복지관", region: "충남 보령" },
      { organization: "보령 노인복지관", region: "보령시" },
    ),
    false,
  );
});

test("공사 담당자와 영업 담당자 및 상담 내용이 같아도 다른 기관명은 후보로 올리지 않는다", () => {
  const requested = {
    organization: "보령 명천초등학교 병설유치원",
    region: "보령",
    contactName: "임명숙 지사장",
    progressManager: "양승민 이사",
    topic: "스크린 사이즈 통일",
    summary: "스크린 사이즈를 4,400*2,450으로 통일하는 방향을 검토했습니다.",
  };
  const existing = {
    organization: "보령 실버복지관",
    region: "보령",
    contactName: "임명숙 지사장",
    progressManager: "양승민 이사",
    topic: "스크린 사이즈 통일",
    summary: "스크린 사이즈를 4,400*2,450으로 통일하는 방향을 검토했습니다.",
  };

  assert.deepEqual(findSimilarInstitutionMatches(requested, [existing]), []);
});

test("앞에 지역명이 붙은 명천 실버복지관을 확인 후보로 올린다", () => {
  assert.deepEqual(
    findSimilarInstitutionMatches(
      {
        organization: "보령 명천실버복지관",
        region: "충남 보령",
      },
      [
        {
          organization: "명천 실버복지관",
          region: "보령시",
        },
      ],
    ),
    [
      {
        organization: "명천 실버복지관",
        reasons: ["지역과 기관 핵심명이 같음"],
        score: 8,
      },
    ],
  );
});

test("시군 표기가 다른 남해 꿈나눔센터를 확인 후보로 올린다", () => {
  assert.deepEqual(
    findSimilarInstitutionMatches(
      {
        organization: "남해꿈나눔센터",
        region: "경남 남해",
      },
      [
        {
          organization: "남해군꿈나눔센터",
          region: "남해군",
        },
      ],
    ),
    [
      {
        organization: "남해군꿈나눔센터",
        reasons: ["지역과 기관 핵심명이 같음"],
        score: 8,
      },
    ],
  );
});

test("같은 지역·기관 유형·진행 담당자가 같아도 기관명이 다르면 합치지 않는다", () => {
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

  assert.deepEqual(findSimilarInstitutionMatches(requested, [existing]), []);
});

test("엑셀 명단의 어린이집은 지역·유형·상담 내용이 같아도 서로 다른 기관으로 유지한다", () => {
  assert.deepEqual(
    findSimilarInstitutionMatches(
      {
        organization: "선영어린이집",
        region: "강원 인제군",
        topic: "가상현실 스포츠실 선정기관",
        summary: "선영어린이집 선정기관 등록",
      },
      [
        {
          organization: "보듬이 나눔이 참사랑어린이집",
          region: "강원 인제군",
          topic: "가상현실 스포츠실 선정기관",
          summary: "보듬이 나눔이 참사랑어린이집 선정기관 등록",
        },
      ],
    ),
    [],
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

test("같은 별칭이 지역별 다른 기관으로 확인되면 자동 확정하지 않는다", () => {
  const first = updateInstitutionAliasSetting(
    "",
    "꿈나눔센터",
    "남해군꿈나눔센터",
    "경남 남해",
  );
  const second = updateInstitutionAliasSetting(
    first,
    "꿈나눔센터",
    "서울꿈나눔센터",
    "서울 마포",
  );

  assert.equal(rememberedInstitutionAlias("꿈나눔센터", second), "");
  assert.deepEqual(
    rememberedInstitutionAliasCandidates("꿈나눔센터", second),
    [
      { canonical: "남해군꿈나눔센터", region: "경남 남해" },
      { canonical: "서울꿈나눔센터", region: "서울 마포" },
    ],
  );
});

test("기관을 다시 합치면 이전 별칭도 최종 기관명으로 이어진다", () => {
  const first = updateInstitutionAliasSetting(
    "",
    "보령 실버복지관",
    "명천 실버복지관",
    "충남 보령",
  );
  const second = updateInstitutionAliasSetting(
    first,
    "명천 실버복지관",
    "보령명천실버복지관",
    "충남 보령",
  );

  assert.equal(
    rememberedInstitutionAlias("보령 실버복지관", second),
    "보령명천실버복지관",
  );
});

test("핵심 이름이 두 글자인 학교는 한 글자만 달라도 유사 기관으로 묻지 않는다", () => {
  assert.deepEqual(
    findSimilarInstitutionNames("대일초등학교", [
      "제일초등학교",
      "대현초등학교",
    ]),
    [],
  );
  assert.deepEqual(
    findSimilarInstitutionMatches(
      {
        organization: "부평초등학교",
        region: "인천 부평",
        progressManager: "양승민 이사",
        summary: "설치 완료",
      },
      [
        {
          organization: "부구초등학교",
          region: "인천 부평",
          progressManager: "양승민 이사",
          summary: "설치 완료",
        },
        {
          organization: "가평초등학교",
          region: "경기 가평",
          progressManager: "양승민 이사",
          summary: "설치 완료",
        },
      ],
    ),
    [],
  );
});
