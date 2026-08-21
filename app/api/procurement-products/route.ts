import { accessErrorResponse, requireApprovedMember } from "../../../lib/collaboration";
import { mapProcurementSearchItem, type ProcurementSearchItem } from "../../../lib/procurement-products";

export const dynamic = "force-dynamic";

const API_BASE_URL = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService";
const CACHE_TTL_MS = 10 * 60 * 1_000;
const CACHE_VERSION = "v2-date-range";
const PROCUREMENT_SEARCH_START_DATE = "20000101";
const cache = new Map<string, { expiresAt: number; items: ProcurementSearchItem[]; total: number }>();

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

function procurementSearchDateParams(endpoint: string): Record<string, string> {
  const endDate = compactDate(new Date(Date.now() + 24 * 60 * 60 * 1_000));
  if (endpoint === "getShoppingMallPrdctInfoList") {
    return { inqryBgnDate: PROCUREMENT_SEARCH_START_DATE, inqryEndDate: endDate };
  }
  return { rgstDtBgnDt: PROCUREMENT_SEARCH_START_DATE, rgstDtEndDt: endDate };
}

async function requestProcurementApi({ endpoint, params, key, contractMethod, sourceLabel }: {
  endpoint: string;
  params: Record<string, string>;
  key: string;
  contractMethod?: string;
  sourceLabel: string;
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
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) throw new Error(`${sourceLabel} 응답을 확인할 수 없습니다.`);
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
  for (const item of items) {
    const saved = merged.get(item.identity);
    if (!saved) {
      merged.set(item.identity, item);
      continue;
    }
    merged.set(item.identity, {
      ...saved,
      ...Object.fromEntries(Object.entries(item).map(([field, value]) => [
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

function fulfilledResults(settled: PromiseSettledResult<ProcurementApiResult>[]) {
  return settled
    .filter((result): result is PromiseFulfilledResult<ProcurementApiResult> => result.status === "fulfilled")
    .map((result) => result.value);
}

function companyNameCandidates(query: string) {
  const compact = query.replace(/\s+/g, " ").trim();
  if (!compact || /^(?:\(주\)|㈜|주식회사\s*)/.test(compact)) return [];
  return [`(주)${compact}`, `주식회사 ${compact}`];
}

async function searchSources(query: string, page: number, pageSize: number, key: string) {
  const numericQuery = /^\d{5,}$/.test(query.replace(/\D/g, ""));
  const common = { numOfRows: String(pageSize), pageNo: String(page) };
  const normalizedNumber = query.replace(/\D/g, "");

  if (numericQuery) {
    const settled = await Promise.allSettled([
      ...CONTRACT_SOURCES.map((source) => requestProcurementApi({
        ...source,
        key,
        params: { ...common, prdctIdntNo: normalizedNumber },
      })),
      requestProcurementApi({
        endpoint: "getShoppingMallPrdctInfoList",
        sourceLabel: "나라장터 품목 등록",
        key,
        params: { ...common, prdctIdntNoNm: normalizedNumber, regtCncelYn: "N" },
      }),
    ]);
    const results = fulfilledResults(settled);
    if (!results.length) throw settled.find((result) => result.status === "rejected")?.reason || new Error("조달청 검색에 실패했습니다.");
    return results;
  }

  // 공식 API는 통합 키워드 검색을 제공하지 않으므로 업체명·품명·세부품명·규격명을 각각 조회한다.
  const [companySettled, productSettled] = await Promise.all([
    Promise.allSettled(CONTRACT_SOURCES.map((source) => requestProcurementApi({
      ...source,
      key,
      params: { ...common, cntrctCorpNm: query },
    }))),
    Promise.allSettled(["prdctClsfcNoNm", "dtilPrdctClsfcNoNm", "prdctIdntNoNm"].map((field) => requestProcurementApi({
      endpoint: "getShoppingMallPrdctInfoList",
      sourceLabel: "나라장터 품목 등록",
      key,
      params: { ...common, [field]: query, regtCncelYn: "N" },
    }))),
  ]);
  const companyResults = fulfilledResults(companySettled);
  const productResults = fulfilledResults(productSettled);
  let results = [...companyResults, ...productResults];

  // 조달 등록 상호가 법인 표기를 포함한 경우를 위해 원문 업체명 검색이 비었을 때만 제한적으로 보완한다.
  if (!companyResults.some((result) => result.items.length)) {
    const candidates = companyNameCandidates(query);
    if (candidates.length) {
      const companyFallback = await Promise.allSettled(candidates.flatMap((candidate) => CONTRACT_SOURCES.map((source) => requestProcurementApi({
        ...source,
        key,
        params: { ...common, cntrctCorpNm: candidate },
      }))));
      results = [...results, ...fulfilledResults(companyFallback)];
    }
  }

  // 품목 등록 검색이 비었을 때만 계약 품명 검색을 보완하여 평상시 API 호출량을 줄인다.
  if (!productResults.some((result) => result.items.length)) {
    const productFallback = await Promise.allSettled(CONTRACT_SOURCES.map((source) => requestProcurementApi({
      ...source,
      key,
      params: { ...common, prdctClsfcNoNm: query },
    })));
    results = [...results, ...fulfilledResults(productFallback)];
  }

  if (!results.length) {
    const rejected = [...companySettled, ...productSettled].find((result) => result.status === "rejected");
    throw rejected?.reason || new Error("조달청 검색에 실패했습니다.");
  }
  return results;
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const url = new URL(request.url);
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 120);
    const page = Math.max(1, Math.min(100, Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(20, Number(url.searchParams.get("pageSize")) || 20));
    if (query.length < 2) {
      return Response.json({ error: "업체명, 조달 물품명 또는 식별번호를 두 글자 이상 입력해 주세요." }, { status: 400 });
    }
    const key = serviceKey();
    if (!key) {
      return Response.json({ error: "조달 검색 인증키가 아직 설정되지 않았습니다. 관리자에게 확인해 주세요.", code: "PROCUREMENT_KEY_MISSING" }, { status: 503 });
    }
    const cacheKey = `${CACHE_VERSION}:${query.toLocaleLowerCase("ko-KR")}:${page}:${pageSize}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json({ items: cached.items, total: cached.total, page, pageSize, cached: true });
    }

    const sourceResults = await searchSources(query, page, pageSize, key);
    const items = mergeSearchItems(sourceResults.flatMap((result) => result.items))
      .sort((a, b) => relevance(b, query) - relevance(a, query) || a.name.localeCompare(b.name, "ko"))
      .slice(0, pageSize);
    // 같은 항목을 여러 공식 검색 필드에서 찾으므로 각 응답의 합계를 더해 중복 과장하지 않는다.
    const total = Math.max(items.length, ...sourceResults.map((result) => result.total));
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, items, total });
    if (cache.size > 100) cache.delete(cache.keys().next().value as string);
    return Response.json({ items, total, page, pageSize, cached: false });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse.status === 401 || accessResponse.status === 403) return accessResponse;
    console.error("[procurement-products]", error);
    return Response.json({ error: "조달 물품을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요." }, { status: 502 });
  }
}
