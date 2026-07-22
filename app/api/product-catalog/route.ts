import {
  accessErrorResponse,
  ensureCollaborationReady,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  PRODUCT_CATALOG,
  type ProductCatalogItem,
} from "../../../lib/product-catalog";

export const dynamic = "force-dynamic";

const SETTING_KEY = "product_catalog_v1";
const MAX_PRODUCTS = 2_000;

function cleanText(value: unknown, maxLength = 2_000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanNumber(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function normalizeProduct(
  value: unknown,
  index: number,
): ProductCatalogItem | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const name = cleanText(source.name, 300);
  if (!name) return null;

  const specification = cleanText(source.specification, 1_000);
  const note = cleanText(source.note, 1_000);
  const reference = cleanText(source.reference, 2_000);
  const unitPrice = cleanNumber(source.unitPrice, 0, 100_000_000_000);
  const commissionRate = cleanNumber(source.commissionRate, 0, 1);
  const sourceRow = Math.max(
    1,
    Math.round(Number(source.sourceRow) || index + 1),
  );
  const id =
    cleanText(source.id, 160) ||
    `product-${sourceRow}-${crypto.randomUUID()}`;

  return {
    id,
    sourceRow,
    name,
    specification,
    unitPrice,
    note,
    commissionRate,
    reference,
    needsReview:
      !specification &&
      unitPrice === null &&
      !note &&
      commissionRate === null &&
      !reference,
  };
}

function normalizeProducts(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("제품 목록 형식이 올바르지 않습니다.");
  }
  if (value.length > MAX_PRODUCTS) {
    throw new Error(`제품은 최대 ${MAX_PRODUCTS.toLocaleString("ko-KR")}개까지 저장할 수 있습니다.`);
  }

  const products = value
    .map(normalizeProduct)
    .filter((item): item is ProductCatalogItem => Boolean(item));
  if (value.length && !products.length) {
    throw new Error("저장할 수 있는 제품 정보가 없습니다.");
  }
  return products;
}

async function readStoredProducts() {
  const d1 = await ensureCollaborationReady();
  const row = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(SETTING_KEY)
    .first<{ value: string }>();
  if (!row?.value) return PRODUCT_CATALOG;

  try {
    const products = normalizeProducts(JSON.parse(row.value));
    return products.length ? products : PRODUCT_CATALOG;
  } catch {
    return PRODUCT_CATALOG;
  }
}

export async function GET() {
  try {
    await requireApprovedMember();
    const products = await readStoredProducts();
    return Response.json(
      { products },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireApprovedMember();
    const body = (await request.json()) as { products?: unknown };
    const products = normalizeProducts(body.products);
    const d1 = await ensureCollaborationReady();
    await d1
      .prepare(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(SETTING_KEY, JSON.stringify(products), member.id)
      .run();

    return Response.json({ products });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
