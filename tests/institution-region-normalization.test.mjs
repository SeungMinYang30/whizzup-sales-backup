import assert from "node:assert/strict";
import test from "node:test";

import { institutionNameWithoutRegionPrefix } from "../lib/institution-names.ts";

test("AI 기관명 앞에 반복된 지역을 분리한다", () => {
  assert.equal(
    institutionNameWithoutRegionPrefix("강원 영월 세경대학교", "강원 영월"),
    "세경대학교",
  );
});

test("기관 고유명에 포함된 지역명은 제거하지 않는다", () => {
  assert.equal(
    institutionNameWithoutRegionPrefix("서울대학교", "서울"),
    "서울대학교",
  );
  assert.equal(
    institutionNameWithoutRegionPrefix("강원 영월 대학교", "강원 영월"),
    "강원 영월 대학교",
  );
});
