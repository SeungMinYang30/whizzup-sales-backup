import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrganizationSearchQuery,
  buildOrganizationSearchQueries,
  compactMapSearchName,
  normalizeInstitutionSearchName,
} from "../lib/map-location-query.ts";

test("병설 표현을 제거하고 초등학교를 초로 정리한다", () => {
  assert.equal(normalizeInstitutionSearchName("성남초 병설"), "성남초");
  assert.equal(
    normalizeInstitutionSearchName("성남초 병설유치원"),
    "성남초",
  );
  assert.equal(
    normalizeInstitutionSearchName("성남초등학교 병설 유치원"),
    "성남초",
  );
  assert.equal(
    normalizeInstitutionSearchName("단재초등학교병설유치원"),
    "단재초",
  );
});

test("상세 지역만 한 번 붙여 지도 검색어를 만든다", () => {
  assert.equal(
    buildOrganizationSearchQuery({
      region: "경기 김포",
      organization: "김포 모담초등학교",
    }),
    "김포 모담초",
  );
  assert.equal(
    buildOrganizationSearchQuery({
      region: "경기 김포",
      organization: "모담초등학교",
    }),
    "김포 모담초",
  );
  assert.equal(
    buildOrganizationSearchQuery({
      region: "경남 김해",
      organization: "김해 동부노인종합복지관",
    }),
    "김해 동부노인종합복지관",
  );
  assert.equal(
    buildOrganizationSearchQuery({
      region: "지역 미등록",
      organization: "성남초 병설유치원",
    }),
    "성남초",
  );
});

test("상세 지역명에 시를 붙인 자동 검색 후보도 함께 만든다", () => {
  assert.deepEqual(
    buildOrganizationSearchQueries({
      region: "경남 거제",
      organization: "거제 장애인 복지관",
    }),
    ["거제 장애인 복지관", "거제시 장애인 복지관"],
  );
  assert.deepEqual(
    buildOrganizationSearchQueries({
      region: "경기 김포",
      organization: "모담초등학교",
    }),
    ["김포 모담초", "김포시 모담초", "모담초", "모담초등학교"],
  );
});

test("결과 비교에서는 지역명과 시군구 접미사를 같은 이름으로 본다", () => {
  assert.equal(
    compactMapSearchName("김포 모담초등학교", "경기 김포"),
    "모담초",
  );
  assert.equal(
    compactMapSearchName("김해시동부노인종합복지관", "경남 김해"),
    "동부노인종합복지관",
  );
  assert.equal(
    compactMapSearchName("김해 동부노인종합복지관", "경남 김해"),
    "동부노인종합복지관",
  );
});

test("일반 기관명과 주소처럼 보이는 문자열은 불필요하게 바꾸지 않는다", () => {
  assert.equal(
    normalizeInstitutionSearchName("동부노인종합복지관"),
    "동부노인종합복지관",
  );
  assert.equal(
    normalizeInstitutionSearchName("경기도 성남시 수정구 수정로 12"),
    "경기도 성남시 수정구 수정로 12",
  );
});
