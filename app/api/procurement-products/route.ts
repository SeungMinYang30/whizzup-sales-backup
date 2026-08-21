import { accessErrorResponse, requireApprovedMember } from "../../../lib/collaboration";
import { mapProcurementSearchItem, type ProcurementSearchItem } from "../../../lib/procurement-products";

export const dynamic = "force-dynamic";

const API_BASE_URL = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService";
const CACHE_TTL_MS = 10 * 60 * 1_000;
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

async function requestProcurementApi({ endpoint, params, key, contractMethod, sourceLabel }: {
  endpoint: string;
  params: Record<string, string>;
  key: string;
  contractMethod?: string;
  sourceLabel: string;
}): Promise<ProcurementApiResult> {
  const searchParams = new URLSearchParams({ ServiceKey: key, type: "json", inqryDiv: "1", ...params });
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

async function searchSources(query: string, page: number, pageSize: number, key: string) {
  const numericQuery = /^\d{5,}$/.test(query.replace(/\D/g, ""));
  const common = { numOfRows: String(pageSize), pageNo: String(page) };
  const contractField = numericQuery ? "prdctIdntNo" : "cntrctCorpNm";
  const contractQuery = numericQuery ? query.replace(/\D/g, "") : query;
  const primaryRequests = [
    ...CONTRACT_SOURCES.map((source) => requestProcurementApi({
      ...source,
      key,
      params: { ...common, [contractField]: contractQuery },
    })),
    requestProcurementApi({
      endpoint: "getShoppingMallPrdctInfoList",
      sourceLabel: "나라장터 품목 등록",
      key,
      params: { ...common, prdctIdntNoNm: query, regtCncelYn: "N" },
    }),
  ];
  const settled = await Promise.allSettled(primaryRequests);
  const successful = settled.filter((result): result is PromiseFulfilledResult<ProcurementApiResult> => result.status === "fulfilled");
  if (!successful.length) throw settled.find((result) => result.status === "rejected")?.reason || new Error("조달청 검색에 실패했습니다.");
  let results = successful.map((result) => result.value);

  // 업체명·식별번호 검색에 결과가 없을 때만 품명 분류 검색을 추가해 일일 API 호출량을 보호합니다.
  if (!numericQuery && !results.some((result) => result.items.length)) {
    const fallback = await Promise.allSettled(CONTRACT_SOURCES.map((source) => requestProcurementApi({
      ...source,
      key,
      params: { ...common, prdctClsfcNoNm: query },
    })));
    results = [...results, ...fallback
      .filter((result): result is PromiseFulfilledResult<ProcurementApiResult> => result.status === "fulfilled")
      .map((result) => result.value)];
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
    const cacheKey = `${query.toLocaleLowerCase("ko-KR")}:${page}:${pageSize}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json({ items: cached.items, total: cached.total, page, pageSize, cached: true });
    }

    const sourceResults = await searchSources(query, page, pageSize, key);
    const items = mergeSearchItems(sourceResults.flatMap((result) => result.items))
      .sort((a, b) => relevance(b, query) - relevance(a, query) || a.name.localeCompare(b.name, "ko"))
      .slice(0, pageSize);
    const total = Math.max(items.length, sourceResults.reduce((sum, result) => sum + result.total, 0));
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
