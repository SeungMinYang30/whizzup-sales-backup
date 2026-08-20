import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findSimilarInstitutionMatches,
  rememberedInstitutionAlias,
  updateInstitutionAliasSetting,
} from "../lib/institution-names.ts";

test("보령 명천실버복지관은 명천 실버복지관 확인 후보로 표시한다", () => {
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

test("남해꿈나눔센터는 남해군꿈나눔센터 확인 후보로 표시한다", () => {
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

test("확인 전에는 자동 합치지 않고 승인한 별칭만 기억한다", async () => {
  const root = new URL("../", import.meta.url);
  const recordsStore = await readFile(
    new URL("lib/records-store.ts", root),
    "utf8",
  );
  assert.doesNotMatch(recordsStore, /const sameRegionAliases/);

  const setting = updateInstitutionAliasSetting(
    "",
    "보령 명천실버복지관",
    "명천 실버복지관",
  );
  assert.equal(
    rememberedInstitutionAlias("보령 명천실버복지관", setting),
    "명천 실버복지관",
  );
});

test("승인 병합은 관리자 알림 처리 기록까지 함께 정리한다", async () => {
  const root = new URL("../", import.meta.url);
  const institutionMerge = await readFile(
    new URL("lib/institution-merge.ts", root),
    "utf8",
  );
  assert.match(institutionMerge, /manager_alert_acknowledgements/);
});
