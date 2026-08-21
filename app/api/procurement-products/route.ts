import { accessErrorResponse, requireApprovedMember } from "../../../lib/collaboration";
import { mapProcurementSearchItem, type ProcurementSearchItem } from "../../../lib/procurement-products";

export const dynamic = "force-dynamic";

const API_URL = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getShoppingMallPrdctInfoList";
const CACHE_TTL_MS = 10 * 60 * 1_000;
const cache = new Map<string, { expiresAt: number; items: ProcurementSearchItem[]; total: number }>();

function dateValue(date: Date, endOfDay = false) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${endOfDay ? "2359" : "0000"}`;
}

function serviceKey() {
  const raw = String(process.env.PROCUREMENT_DATA_SERVICE_KEY || process.env.PUBLIC_DATA_SERVICE_KEY || "").trim();
  if (!raw) return "";
  try {
    return raw.includes("%") ? decodeURIComponent(raw) : raw;
  } catch {
    return raw;
  }
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const url = new URL(request.url);
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 120);
    const page = Math.max(1, Math.min(100, Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(20, Number(url.searchParams.get("pageSize")) || 20));
    if (query.length < 2) {
      return Response.json({ error: "조달 물품명 또는 식별번호를 두 글자 이상 입력해 주세요." }, { status: 400 });
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

    const end = new Date();
    const start = new Date(end);
    start.setUTCFullYear(end.getUTCFullYear() - 1);
    start.setUTCDate(start.getUTCDate() + 1);
    const params = new URLSearchParams({
      ServiceKey: key,
      type: "json",
      numOfRows: String(pageSize),
      pageNo: String(page),
      inqryDiv: "1",
      inqryBgnDate: dateValue(start),
      inqryEndDate: dateValue(end, true),
      prdctIdntNoNm: query,
      regtCncelYn: "N",
    });
    const response = await fetch(`${API_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body) throw new Error("조달청 응답을 확인할 수 없습니다.");
    const root = (body.response && typeof body.response === "object" ? body.response : body) as Record<string, unknown>;
    const header = (root.header && typeof root.header === "object" ? root.header : {}) as Record<string, unknown>;
    const resultCode = String(header.resultCode ?? body.resultCode ?? "00");
    if (resultCode !== "00" && resultCode !== "000") {
      throw new Error(String(header.resultMsg || body.resultMsg || "조달청 검색 요청이 거절되었습니다."));
    }
    const responseBody = (root.body && typeof root.body === "object" ? root.body : root) as Record<string, unknown>;
    const rawItemsContainer = responseBody.items;
    const rawItems = Array.isArray(rawItemsContainer)
      ? rawItemsContainer
      : rawItemsContainer && typeof rawItemsContainer === "object" && Array.isArray((rawItemsContainer as Record<string, unknown>).item)
        ? (rawItemsContainer as Record<string, unknown>).item as unknown[]
        : responseBody.item && Array.isArray(responseBody.item)
          ? responseBody.item as unknown[]
          : [];
    const items = rawItems.map(mapProcurementSearchItem).filter((item): item is ProcurementSearchItem => Boolean(item));
    const total = Math.max(items.length, Number(responseBody.totalCount) || 0);
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
