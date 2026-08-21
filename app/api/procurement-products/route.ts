import { after } from "next/server";
import { accessErrorResponse, ensureCollaborationReady, requireApprovedMember } from "../../../lib/collaboration";
import { mapProcurementSearchItem, type ProcurementSearchItem } from "../../../lib/procurement-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_BASE_URL = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService";
const GENERAL_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const IDENTIFIER_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const CACHE_VERSION = "v17-shopping-contract-sequence";
const PROCUREMENT_SEARCH_WINDOW_DAYS = 364;
const PROCUREMENT_SEARCH_WINDOW_COUNT = 3;
const PROCUREMENT_SPEC_SEARCH_WINDOW_COUNT = 15;
const PROCUREMENT_SEARCH_GROUP_TIMEOUT_MS = 25_000;
const PROCUREMENT_MAX_PAGE_SIZE = 300;
const PROCUREMENT_SEARCH_SCOPES = ["all", "detail", "specification", "company", "identifier"] as const;
type ProcurementSearchScope = typeof PROCUREMENT_SEARCH_SCOPES[number];
type ProcurementFacet = { number: string; name: string; count: number };
type NamedFacet = { name: string; count: number };
type ProcurementFacets = {
  detailClassifications: ProcurementFacet[];
  contractMethods: NamedFacet[];
  suppliers: NamedFacet[];
  marketplaces: NamedFacet[];
};
type ProcurementSearchPayload = { items: ProcurementSearchItem[]; total: number; facets: ProcurementFacets };
type ProcurementCacheEntry = ProcurementSearchPayload & { expiresAt: number; cachedAt: number };
type SharedCacheResult = ProcurementSearchPayload & { expiresAt: number; cachedAt: number; stale: boolean };
const cache = new Map<string, ProcurementCacheEntry>();
const refreshes = new Map<string, Promise<ProcurementSearchPayload & { cachedAt: number }>>();
let sharedCacheReadyPromise: Promise<void> | null = null;

function normalizedIdentifierQuery(query: string) {
  const compact = query.replace(/[^0-9]/g, "");
  return /^\d{8}$/.test(compact) ? compact : "";
}

function procurementCacheTtl(query: string) {
  return normalizedIdentifierQuery(query) ? IDENTIFIER_CACHE_TTL_MS : GENERAL_CACHE_TTL_MS;
}

async function procurementCacheDatabase() {
  if (!sharedCacheReadyPromise) {
    sharedCacheReadyPromise = (async () => {
      const d1 = await ensureCollaborationReady();
      await d1.prepare(
        `CREATE TABLE IF NOT EXISTS procurement_search_cache (
          cache_key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          expires_at BIGINT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ).run();
      await d1.prepare(
        "DELETE FROM procurement_search_cache WHERE expires_at < ?",
      ).bind(Date.now() - CACHE_RETENTION_MS).run().catch(() => undefined);
    })().catch((error) => {
      sharedCacheReadyPromise = null;
      throw error;
    });
  }
  await sharedCacheReadyPromise;
  return ensureCollaborationReady();
}

async function readSharedCache(cacheKey: string, ttlMs: number): Promise<SharedCacheResult | null> {
  try {
    const d1 = await procurementCacheDatabase();
    const row = await d1.prepare(
      "SELECT payload, expires_at FROM procurement_search_cache WHERE cache_key = ? LIMIT 1",
    ).bind(cacheKey).first<{ payload: string; expires_at: number }>();
    if (!row) return null;
    const expiresAt = Number(row.expires_at);
    const cachedAt = expiresAt - ttlMs;
    if (!Number.isFinite(expiresAt) || cachedAt <= Date.now() - CACHE_RETENTION_MS) return null;
    const parsed = JSON.parse(String(row.payload || "{}")) as Partial<ProcurementSearchPayload>;
    if (!Array.isArray(parsed.items) || !parsed.facets || !Number.isFinite(Number(parsed.total))) return null;
    return {
      items: parsed.items,
      total: Number(parsed.total),
      facets: parsed.facets,
      expiresAt,
      cachedAt,
      stale: expiresAt <= Date.now(),
    } as SharedCacheResult;
  } catch {
    return null;
  }
}

async function writeSharedCache(cacheKey: string, payload: ProcurementSearchPayload, ttlMs: number, cachedAt: number) {
  try {
    const d1 = await procurementCacheDatabase();
    await d1.prepare(
      `INSERT INTO procurement_search_cache (cache_key, payload, expires_at, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload = excluded.payload,
         expires_at = excluded.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(cacheKey, JSON.stringify(payload), cachedAt + ttlMs).run();
  } catch {
    // Shared caching is an optimization; the live procurement result remains usable.
  }
}

const CONTRACT_SOURCES = [
  { endpoint: "getMASCntrctPrdctInfoList", contractMethod: "다수공급자계약", sourceLabel: "다수공급자계약" },
  { endpoint: "getUcntrctPrdctInfoList", contractMethod: "일반단가계약", sourceLabel: "일반단가계약" },
  { endpoint: "getThptyUcntrctPrdctInfoList", contractMethod: "제3자단가계약", sourceLabel: "제3자단가계약" },
] as const;

type ProcurementApiResult = {
  items: ProcurementSearchItem[];
  total: number;
};

function serviceKey() {
  const raw = String(process.env.PROCUREMENT_DATA_SERVICE_KEY || process.env.PUBLIC_DATA_SERVICE_KEY || "").trim();
  if (!raw) return "";
  try {
    return raw.includes("%") ? decodeURIComponent(raw) : raw;
  } catch {
    return raw;
  }
}

function normalizeItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const item = (value as Record<string, unknown>).item;
    if (Array.isArray(item)) return item;
    if (item && typeof item === "object") return [item];
  }
  return [];
}

function compactDate(value = new Date()) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function procurementSearchDateParams(endpoint: string, end = new Date()): Record<string, string> {
  // 공식 API는 한 번에 최대 1년만 조회할 수 있다. 범위를 초과하면
  // nkoneps.com.response.ResponseError(resultCode=07)를 돌려주므로 364일로 제한한다.
  const startDate = compactDate(addUtcDays(end, -PROCUREMENT_SEARCH_WINDOW_DAYS));
  const endDate = compactDate(end);
  if (endpoint === "getShoppingMallPrdctInfoList") {
    return { inqryBgnDate: startDate, inqryEndDate: endDate };
  }
  return { rgstDtBgnDt: `${startDate}0000`, rgstDtEndDt: `${endDate}2359` };
}

function procurementSearchDateWindows(endpoint: string, count = PROCUREMENT_SEARCH_WINDOW_COUNT) {
  const windows: Record<string, string>[] = [];
  let end = new Date();
  for (let index = 0; index < count; index += 1) {
    windows.push(procurementSearchDateParams(endpoint, end));
    end = addUtcDays(end, -(PROCUREMENT_SEARCH_WINDOW_DAYS + 1));
  }
  return windows;
}

async function requestProcurementApi({ endpoint, params, key, contractMethod, sourceLabel, signal }: {
  endpoint: string;
  params: Record<string, string>;
  key: string;
  contractMethod?: string;
  sourceLabel: string;
  signal?: AbortSignal;
}): Promise<ProcurementApiResult> {
  // The official API otherwise falls back to only the latest day of registrations.
  // Always provide a stable registration/search range so company and product-name
  // searches can find existing active catalogue entries, not only today's rows.
  const searchParams = new URLSearchParams({
    serviceKey: key,
    type: "json",
    inqryDiv: "1",
    ...procurementSearchDateParams(endpoint),
    ...params,
  });
  const response = await fetch(`${API_BASE_URL}/${endpoint}?${searchParams.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: signal || AbortSignal.timeout(PROCUREMENT_SEARCH_GROUP_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) throw new Error(`${sourceLabel} 응답을 확인할 수 없습니다.`);
  const errorRoot = body["nkoneps.com.response.ResponseError"];
  const errorHeader = (errorRoot && typeof errorRoot === "object" && "header" in errorRoot
    && (errorRoot as Record<string, unknown>).header && typeof (errorRoot as Record<string, unknown>).header === "object"
    ? (errorRoot as Record<string, unknown>).header
    : null) as Record<string, unknown> | null;
  if (errorHeader) {
    throw new Error(String(errorHeader.resultMsg || `${sourceLabel} 검색 요청이 거절되었습니다.`));
  }
  const root = (body.response && typeof body.response === "object" ? body.response : body) as Record<string, unknown>;
  const header = (root.header && typeof root.header === "object" ? root.header : {}) as Record<string, unknown>;
  const resultCode = String(header.resultCode ?? body.resultCode ?? "00");
  if (resultCode !== "00" && resultCode !== "000") {
    throw new Error(String(header.resultMsg || body.resultMsg || `${sourceLabel} 검색 요청이 거절되었습니다.`));
  }
  const responseBody = (root.body && typeof root.body === "object" ? root.body : root) as Record<string, unknown>;
  const primaryItems = normalizeItems(responseBody.items);
  const rawItems = primaryItems.length ? primaryItems : normalizeItems(responseBody.item);
  const items = rawItems
    .map((item) => mapProcurementSearchItem(item, { contractMethod, sourceLabel }))
    .filter((item): item is ProcurementSearchItem => Boolean(item));
  return { items, total: Math.max(items.length, Number(responseBody.totalCount) || 0) };
}

function mergeSearchItems(items: ProcurementSearchItem[]) {
  const merged = new Map<string, ProcurementSearchItem>();
  const shoppingIdentities = new Set(items
    .filter((item) => item.sourceLabel.startsWith("나라장터 "))
    .map((item) => item.identity));
  for (const item of items) {
    const shoppingRecord = item.sourceLabel.startsWith("나라장터 ");
    if (!shoppingRecord && shoppingIdentities.has(item.identity)) continue;
    // 공식 명세가 보장하는 쇼핑몰 행의 유일 키는 계약번호 + 계약순번이다.
    // 같은 식별번호라도 계약순번이 다른 행을 합치면 공식 검색 건수와 달라진다.
    const contractRecord = shoppingRecord
      ? [item.contractNumber, item.contractSequence].filter(Boolean).join(":") || item.registrationDate
      : "";
    const identity = contractRecord ? `${item.identity}:contract:${contractRecord}` : item.identity;
    const normalizedItem = identity === item.identity ? item : { ...item, identity };
    const saved = merged.get(identity);
    if (!saved) {
      merged.set(identity, normalizedItem);
      continue;
    }
    merged.set(identity, {
      ...saved,
      ...Object.fromEntries(Object.entries(normalizedItem).map(([field, value]) => [
        field,
        value === "" || value === null ? saved[field as keyof ProcurementSearchItem] : value,
      ])),
      identity: saved.identity,
    } as ProcurementSearchItem);
  }
  return [...merged.values()];
}

function relevance(item: ProcurementSearchItem, query: string) {
  const key = query.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
  const contains = (value: string) => value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "").includes(key);
  return (item.procurementNumber.replace(/[^0-9A-Z]/giu, "") === query.replace(/[^0-9A-Z]/giu, "") ? 100 : 0)
    + (contains(item.supplierName) ? 70 : 0)
    + (contains(item.name) ? 60 : 0)
    + (contains(item.specification) ? 40 : 0)
    + (contains(item.manufacturerName) ? 30 : 0)
    + (item.saleStatus === "계약 유효" ? 5 : 0);
}

function resultFacets(items: ProcurementSearchItem[]): ProcurementFacets {
  const details = new Map<string, ProcurementFacet>();
  const methods = new Map<string, number>();
  const suppliers = new Map<string, number>();
  const marketplaces = new Map<string, number>();
  for (const item of items) {
    const number = item.detailClassificationNumber || "unclassified";
    const name = item.detailClassificationName || item.classificationName || "세부품명 미분류";
    const saved = details.get(number);
    details.set(number, { number, name, count: (saved?.count || 0) + 1 });
    const method = item.contractMethod || item.sourceLabel || "계약 구분 미확인";
    methods.set(method, (methods.get(method) || 0) + 1);
    const supplier = item.supplierName || "계약업체 미확인";
    suppliers.set(supplier, (suppliers.get(supplier) || 0) + 1);
    const marketplace = item.marketplaceLabel || "종합쇼핑몰";
    marketplaces.set(marketplace, (marketplaces.get(marketplace) || 0) + 1);
  }
  const namedFacets = (values: Map<string, number>) => [...values.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
  return {
    detailClassifications: [...details.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko")),
    contractMethods: namedFacets(methods),
    suppliers: namedFacets(suppliers),
    marketplaces: namedFacets(marketplaces),
  };
}

function procurementSearchScope(value: string): ProcurementSearchScope {
  return PROCUREMENT_SEARCH_SCOPES.includes(value as ProcurementSearchScope)
    ? value as ProcurementSearchScope
    : "all";
}

async function collectAllUseful(requests: Promise<ProcurementApiResult>[], controller: AbortController) {
  let firstError: unknown;
  const timeout = setTimeout(() => controller.abort(), PROCUREMENT_SEARCH_GROUP_TIMEOUT_MS);
  try {
    const settled = await Promise.allSettled(requests);
    const results: ProcurementApiResult[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") results.push(result.value);
      else firstError ??= result.reason;
    }
    return { results, firstError };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function searchSources(query: string, scope: ProcurementSearchScope, page: number, pageSize: number, key: string) {
  const numericQuery = /^\d{5,}$/.test(query.replace(/\D/g, ""));
  const common = { numOfRows: String(pageSize), pageNo: String(page) };
  const normalizedNumber = query.replace(/\D/g, "");

  if (scope === "identifier" || (scope === "all" && numericQuery)) {
    const controller = new AbortController();
    const searched = await collectAllUseful(CONTRACT_SOURCES.flatMap((source) => procurementSearchDateWindows(source.endpoint).map((dateParams) => requestProcurementApi({
        ...source,
        key,
        params: { ...common, ...dateParams, prdctIdntNo: normalizedNumber },
        signal: controller.signal,
      }))), controller);
    if (!searched.results.length) throw searched.firstError || new Error("조달청 검색에 실패했습니다.");
    return searched.results;
  }

  // 공식 API는 통합 키워드 검색을 제공하지 않는다. 선택한 범위에 해당하는
  // 계약·품목등록 조회를 모두 끝까지 수집한 뒤 물품식별번호로 합친다.
  const controller = new AbortController();
  const requests: Promise<ProcurementApiResult>[] = [];
  if (scope === "all" || scope === "company") {
    requests.push(...CONTRACT_SOURCES.flatMap((source) => procurementSearchDateWindows(source.endpoint).map((dateParams) => requestProcurementApi({
        ...source,
        key,
        params: { ...common, ...dateParams, cntrctCorpNm: query },
        signal: controller.signal,
      }))));
  }
  if (scope === "all" || scope === "detail") {
    requests.push(...procurementSearchDateWindows("getShoppingMallPrdctInfoList").map((dateParams) => requestProcurementApi({
      endpoint: "getShoppingMallPrdctInfoList",
      sourceLabel: "나라장터 세부품명",
      key,
      params: { ...common, ...dateParams, dtilPrdctClsfcNoNm: query, regtCncelYn: "N" },
      signal: controller.signal,
    })));
    requests.push(...CONTRACT_SOURCES.flatMap((source) => procurementSearchDateWindows(source.endpoint).map((dateParams) => requestProcurementApi({
        ...source,
        key,
        params: { ...common, ...dateParams, prdctClsfcNoNm: query },
        signal: controller.signal,
      }))));
  }
  if (scope === "all") {
    requests.push(...procurementSearchDateWindows("getShoppingMallPrdctInfoList").map((dateParams) => requestProcurementApi({
      endpoint: "getShoppingMallPrdctInfoList",
      sourceLabel: "나라장터 품명",
      key,
      params: { ...common, ...dateParams, prdctClsfcNoNm: query, regtCncelYn: "N" },
      signal: controller.signal,
    })));
  }
  if (scope === "all" || scope === "specification") {
    requests.push(...procurementSearchDateWindows("getShoppingMallPrdctInfoList", PROCUREMENT_SPEC_SEARCH_WINDOW_COUNT).map((dateParams) => requestProcurementApi({
      endpoint: "getShoppingMallPrdctInfoList",
      sourceLabel: "나라장터 규격",
      key,
      params: { ...common, ...dateParams, prdctIdntNoNm: query, regtCncelYn: "N" },
      signal: controller.signal,
    })));
  }
  const searched = await collectAllUseful(requests, controller);
  if (!searched.results.length) throw searched.firstError || new Error("조달청 검색에 실패했습니다.");
  return searched.results;
}

async function refreshProcurementSearch(options: {
  cacheKey: string;
  key: string;
  page: number;
  pageSize: number;
  query: string;
  scope: ProcurementSearchScope;
  sort: string;
  ttlMs: number;
}) {
  const existing = refreshes.get(options.cacheKey);
  if (existing) return existing;
  const refresh = (async () => {
    const sourceResults = await searchSources(options.query, options.scope, options.page, options.pageSize, options.key);
    const mergedItems = mergeSearchItems(sourceResults.flatMap((result) => result.items));
    const items = mergedItems
      .sort((a, b) => {
        if (options.sort === "priceAsc") return (a.unitPrice ?? Number.MAX_SAFE_INTEGER) - (b.unitPrice ?? Number.MAX_SAFE_INTEGER) || relevance(b, options.query) - relevance(a, options.query);
        if (options.sort === "priceDesc") return (b.unitPrice ?? -1) - (a.unitPrice ?? -1) || relevance(b, options.query) - relevance(a, options.query);
        if (options.sort === "recent") return String(b.registrationDate).localeCompare(String(a.registrationDate)) || relevance(b, options.query) - relevance(a, options.query);
        return relevance(b, options.query) - relevance(a, options.query) || a.name.localeCompare(b.name, "ko");
      })
      .slice(0, options.pageSize);
    const facets = resultFacets(items);
    // 같은 항목을 여러 공식 검색 필드에서 찾으므로 각 응답의 합계를 더해 중복 과장하지 않는다.
    const sourceMayHaveMore = sourceResults.some((result) => result.total > result.items.length);
    const total = sourceMayHaveMore
      ? Math.max(items.length, ...sourceResults.map((result) => result.total))
      : items.length;
    const payload = { items, total, facets };
    const cachedAt = Date.now();
    cache.set(options.cacheKey, { expiresAt: cachedAt + options.ttlMs, cachedAt, ...payload });
    if (cache.size > 100) cache.delete(cache.keys().next().value as string);
    await writeSharedCache(options.cacheKey, payload, options.ttlMs, cachedAt);
    return { ...payload, cachedAt };
  })().finally(() => refreshes.delete(options.cacheKey));
  refreshes.set(options.cacheKey, refresh);
  return refresh;
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const url = new URL(request.url);
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 120);
    const page = Math.max(1, Math.min(100, Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(PROCUREMENT_MAX_PAGE_SIZE, Number(url.searchParams.get("pageSize")) || PROCUREMENT_MAX_PAGE_SIZE));
    const sort = String(url.searchParams.get("sort") || "relevance");
    const scope = procurementSearchScope(String(url.searchParams.get("scope") || "all"));
    const forceRefresh = url.searchParams.get("refresh") === "1";
    if (query.length < 2) {
      return Response.json({ error: "업체명, 조달 물품명 또는 식별번호를 두 글자 이상 입력해 주세요." }, { status: 400 });
    }
    const key = serviceKey();
    if (!key) {
      return Response.json({ error: "조달 검색 인증키가 아직 설정되지 않았습니다. 관리자에게 확인해 주세요.", code: "PROCUREMENT_KEY_MISSING" }, { status: 503 });
    }
    if (scope === "identifier" && !/^\d{8}$/.test(query.replace(/\D/g, ""))) {
      return Response.json({ error: "물품식별번호 8자리를 입력해 주세요." }, { status: 400 });
    }
    const cacheKey = `${CACHE_VERSION}:${scope}:${query.toLocaleLowerCase("ko-KR")}:${page}:${pageSize}:${sort}`;
    const ttlMs = procurementCacheTtl(query);
    const ttlHours = Math.round(ttlMs / (60 * 60 * 1_000));
    const cached = cache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return Response.json({ items: cached.items, total: cached.total, facets: cached.facets, page, pageSize, cached: true, stale: false, cachedAt: cached.cachedAt, cacheSource: "memory", ttlHours });
    }
    const sharedCached = forceRefresh ? null : await readSharedCache(cacheKey, ttlMs);
    if (sharedCached && !sharedCached.stale) {
      cache.set(cacheKey, {
        items: sharedCached.items,
        total: sharedCached.total,
        facets: sharedCached.facets,
        expiresAt: sharedCached.expiresAt,
        cachedAt: sharedCached.cachedAt,
      });
      return Response.json({ items: sharedCached.items, total: sharedCached.total, facets: sharedCached.facets, page, pageSize, cached: true, stale: false, cachedAt: sharedCached.cachedAt, cacheSource: "shared", ttlHours });
    }
    const refreshOptions = { cacheKey, key, page, pageSize, query, scope, sort, ttlMs };
    if (sharedCached?.stale) {
      after(async () => {
        try {
          await refreshProcurementSearch(refreshOptions);
        } catch (error) {
          console.error("[procurement-products-cache-refresh]", error);
        }
      });
      return Response.json({ items: sharedCached.items, total: sharedCached.total, facets: sharedCached.facets, page, pageSize, cached: true, stale: true, refreshing: true, cachedAt: sharedCached.cachedAt, cacheSource: "shared", ttlHours });
    }
    const refreshed = await refreshProcurementSearch(refreshOptions);
    return Response.json({ ...refreshed, page, pageSize, cached: false, stale: false, cacheSource: forceRefresh ? "refreshed" : "live", ttlHours });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse.status === 401 || accessResponse.status === 403) return accessResponse;
    console.error("[procurement-products]", error);
    return Response.json({ error: "조달 물품을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요." }, { status: 502 });
  }
}
