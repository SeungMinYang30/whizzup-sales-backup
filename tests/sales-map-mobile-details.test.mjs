import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("province selection stays active after zooming out and focus details show delivery data", async () => {
  const source = await readFile(
    new URL("../app/sales-map.tsx", import.meta.url),
    "utf8",
  );
  const provinceHandlerStart = source.indexOf(
    'marker.className = "sales-map-cluster province-cluster"',
  );
  const provinceHandler = source.slice(
    provinceHandlerStart,
    source.indexOf(
      "\n      } else {\n        const count = cluster.points.length",
      provinceHandlerStart,
    ),
  );
  const viewportSyncStart = source.indexOf("const syncViewport = () => {");
  const viewportSync = source.slice(
    viewportSyncStart,
    source.indexOf(
      'maps.event.addListener(map, "idle", syncViewport)',
      viewportSyncStart,
    ),
  );

  assert.match(source, /awardCompletedDate: string/);
  assert.match(source, /businessRound: currentBusinessRound/);
  assert.match(source, /\/api\/equipment\?\$\{params\.toString\(\)\}/);
  assert.match(source, /<dt>납품 완료일<\/dt>/);
  assert.match(source, /focusedProductsAreDelivered \? "납품 제품" : "예정 품목"/);
  assert.match(source, /<dt>\{focusedProductHeading\}<\/dt>/);
  assert.match(source, /focusedDeliveryBusinessRound/);
  assert.match(source, /className="map-focus-product-list"/);
  assert.match(source, /focusedDeliverySummary\.products\.map/);
  assert.doesNotMatch(source, /deliveryProductLabel/);
  assert.doesNotMatch(source, /\.slice\(0,\s*3\)[\s\S]{0,180}quantity/);
  assert.match(source, /clusterMapPointsByProvince/);
  assert.match(
    provinceHandler,
    /const provinceBounds = new maps\.LatLngBounds\(\)/,
  );
  assert.match(provinceHandler, /provinceBounds\.extend/);
  assert.match(
    provinceHandler,
    /map\.setBounds\(provinceBounds,\s*48,\s*48,\s*48,\s*48\)/,
  );
  assert.match(provinceHandler, /provinceCluster\.points\.length === 1/);
  assert.match(provinceHandler, /map\.setLevel\(5\)/);
  assert.doesNotMatch(provinceHandler, /map\.jump/);
  assert.match(provinceHandler, /setProvinceClustersVisible\(false\)/);
  assert.match(provinceHandler, /setSelected\(provinceOrganizations\)/);
  assert.match(provinceHandler, /changeMobileView\("map"\)/);
  assert.match(
    provinceHandler,
    /skipNextVisibleBoundsFitRef\.current = true/,
  );
  assert.doesNotMatch(viewportSync, /setProvinceClustersVisible/);
  assert.doesNotMatch(viewportSync, /resolveProvinceClusterVisibility/);
  assert.doesNotMatch(source, /PROVINCE_CLUSTER_SHOW_LEVEL/);
  assert.doesNotMatch(source, /pendingProvinceSelectionRef/);
  assert.match(source, /previousActiveRef/);
  assert.match(source, /setMobileView\("map"\)/);
  assert.doesNotMatch(source, /sessionStorage\.setItem/);
  assert.doesNotMatch(
    source,
    /\[\s*deliverySummaryByBusiness,\s*focused,\s*focusedDeliveryKey,\s*\]/,
  );
  assert.doesNotMatch(source, /<dt>사업방식<\/dt>/);
  assert.doesNotMatch(source, /<dt>최근 활동<\/dt>/);
});
