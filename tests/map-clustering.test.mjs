import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalProvinceName,
  clusterMapPoints,
  clusterMapPointsByProvince,
  KOREA_PROVINCES,
  pointIsInsideMapViewport,
  shouldRenderProvinceClusters,
} from "../lib/map-clustering.ts";

const points = [
  { latitude: 37.5001, longitude: 127.0001, item: "가" },
  { latitude: 37.5005, longitude: 127.0004, item: "나" },
  { latitude: 35.1796, longitude: 129.0756, item: "다" },
];

const salesMapSource = readFileSync(
  new URL("../app/sales-map.tsx", import.meta.url),
  "utf8",
);

test("전국 수준에서는 가까운 기관을 하나의 묶음으로 표시한다", () => {
  const clusters = clusterMapPoints(points, 10);
  assert.equal(clusters.length, 2);
  assert.equal(
    clusters.find((cluster) => cluster.points.length === 2)?.points.length,
    2,
  );
});

test("충분히 확대하면 기관별 마커를 유지한다", () => {
  const clusters = clusterMapPoints(points, 4);
  assert.equal(clusters.length, 3);
  assert.ok(clusters.every((cluster) => cluster.points.length === 1));
});

test("밀집도 보기는 확대 상태에서도 가까운 기관을 묶는다", () => {
  const clusters = clusterMapPoints(points, 4, true);
  assert.equal(clusters.length, 2);
});

test("현재 지도 범위 안의 기관만 판별한다", () => {
  const viewport = {
    south: 37,
    north: 38,
    west: 126,
    east: 128,
    level: 7,
  };
  assert.equal(pointIsInsideMapViewport(37.5, 127, viewport), true);
  assert.equal(pointIsInsideMapViewport(35.1, 129, viewport), false);
});

test("기관 5천 곳도 전국 화면에서는 가벼운 묶음으로 축약한다", () => {
  const manyPoints = Array.from({ length: 5_000 }, (_, index) => ({
    item: index + 1,
    latitude: 33.2 + ((index * 37) % 900) / 100,
    longitude: 126.1 + ((index * 53) % 650) / 100,
  }));

  const clusters = clusterMapPoints(manyPoints, 10);
  const clusteredItemCount = clusters.reduce(
    (total, cluster) => total + cluster.points.length,
    0,
  );

  assert.equal(clusteredItemCount, 5_000);
  assert.ok(clusters.length < 300);
});

test("시도 약칭과 과거 행정명도 17개 공식 시도로 통일한다", () => {
  assert.equal(canonicalProvinceName("경기 평택")?.province, "경기도");
  assert.equal(
    canonicalProvinceName("강원도 원주시")?.province,
    "강원특별자치도",
  );
  assert.equal(
    canonicalProvinceName("전라북도 전주시")?.province,
    "전북특별자치도",
  );
  assert.equal(KOREA_PROVINCES.length, 17);
});

test("지역값이 불완전하면 뒤의 실제 주소에서 시도를 찾는다", () => {
  assert.equal(
    canonicalProvinceName(
      "보성 전남광주통합특별시 보성군 보성읍 현충로 186",
    )?.province,
    "전라남도",
  );
  assert.equal(
    canonicalProvinceName("전라 광주 전남광주통합특별시 동구 조선대길 146")
      ?.province,
    "광주광역시",
  );
});

test("첫 전국 화면에서는 기관을 17개 시도 단위로 묶는다", () => {
  const provincePoints = KOREA_PROVINCES.map(([province], index) => ({
    item: { province },
    latitude: 33.2 + index * 0.18,
    longitude: 126.2 + index * 0.14,
  }));
  const clusters = clusterMapPointsByProvince(
    provincePoints,
    ({ item }) => item.province,
  );

  assert.equal(clusters.length, 17);
  assert.ok(clusters.every((cluster) => cluster.points.length === 1));
});

test("지역을 선택한 뒤에는 확대 수준과 관계없이 지역 묶음을 숨긴다", () => {
  assert.equal(shouldRenderProvinceClusters(true, 0), true);
  assert.equal(shouldRenderProvinceClusters(true, 1), false);
  assert.equal(shouldRenderProvinceClusters(false, 0), false);
});

test("선택 해제는 지역 검색 조건도 비워 전국 지도로 복귀한다", () => {
  assert.match(
    salesMapSource,
    /function clearMapSelection\(\) \{[\s\S]*?setSelected\(\[\]\);[\s\S]*?setFocusedOrganization\(""\);[\s\S]*?onSearchChange\(""\);[\s\S]*?\}/,
  );
  assert.match(salesMapSource, /onClick=\{clearMapSelection\}/);
});
