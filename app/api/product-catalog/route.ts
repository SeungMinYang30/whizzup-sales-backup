import {
  accessErrorResponse,
  ensureCollaborationReady,
  requireApprovedMember,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import {
  PRODUCT_CATALOG,
  type ProductCatalogItem,
} from "../../../lib/product-catalog";
import {
  ensureProductVendorLinksReady,
  readActiveProductVendors,
  readProductCatalogRelations,
  readProductSupplySettingMap,
  readProductVendorLinkMap,
  setProductVendorLinks,
} from "../../../lib/product-vendor-links";
import { hasProcurementSignal, procurementNumbersFromText, resolveProcurementFeeRate } from "../../../lib/procurement-product";
import { normalizeProductSupplyType } from "../../../lib/product-supply-classification";
import { procurementCatalogId, procurementProductIdentity } from "../../../lib/procurement-products";

export const dynamic = "force-dynamic";

const SETTING_KEY = "product_catalog_v1";
const ORDER_SETTING_KEY_PREFIX = "product_catalog_order_v1:";
const FAVORITES_SETTING_KEY_PREFIX = "product_catalog_favorites_v1:";
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
  const procurement = source.procurement === true || hasProcurementSignal(note, specification);
  const procurementChannel = procurement
    ? cleanText(source.procurementChannel, 80) || (/S\s*2\s*B/iu.test(note) ? "S2B" : /디지털서비스몰/iu.test(note) ? "디지털서비스몰" : /혁신장터/iu.test(note) ? "혁신장터" : "G2B")
    : "";
  const procurementNumber = procurement
    ? cleanText(source.procurementNumber, 80) || procurementNumbersFromText(note, specification)[0] || ""
    : "";
  const procurementFeeRate = procurement
    ? resolveProcurementFeeRate(source.procurementFeeRate, note, specification)
    : null;
  const unitPrice = cleanNumber(source.unitPrice, 0, 100_000_000_000);
  const supplyType = normalizeProductSupplyType({
    catalogItemId: source.id,
    productName: name,
    supplyType: source.supplyType,
  });
  const requestedCommissionRate = cleanNumber(source.commissionRate, 0, 1);
  const requestedMarginRate = cleanNumber(source.marginRate, 0, 1);
  const commissionRate =
    supplyType === "partner" ? requestedCommissionRate : null;
  const marginRate =
    supplyType === "direct"
      ? requestedMarginRate ?? requestedCommissionRate
      : null;
  const supplierVendorId =
    supplyType === "partner" &&
    Number.isInteger(Number(source.supplierVendorId)) &&
    Number(source.supplierVendorId) > 0
      ? Number(source.supplierVendorId)
      : null;
  const procurementSupplierName = procurement
    ? cleanText(source.procurementSupplierName, 300)
    : "";
  const procurementUnit = procurement
    ? cleanText(source.procurementUnit, 40)
    : "";
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
    supplyType,
    marginRate,
    reference,
    needsReview:
      !specification &&
      unitPrice === null &&
      !note &&
      commissionRate === null &&
      marginRate === null &&
      !reference,
    supplierVendorId,
    supplierVendorName:
      supplyType === "partner"
        ? cleanText(source.supplierVendorName, 300)
        : "",
    procurementSupplierName,
    procurementUnit,
    procurement,
    procurementChannel,
    procurementNumber,
    procurementFeeRate,
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

function productForStorage(product: ProductCatalogItem) {
  return {
    id: product.id,
    sourceRow: product.sourceRow,
    name: product.name,
    specification: product.specification,
    unitPrice: product.unitPrice,
    note: product.note,
    commissionRate: product.commissionRate,
    reference: product.reference,
    needsReview: product.needsReview,
    procurement: product.procurement === true,
    procurementChannel: product.procurementChannel ?? "",
    procurementNumber: product.procurementNumber ?? "",
    procurementFeeRate: product.procurementFeeRate ?? null,
    procurementSupplierName: product.procurementSupplierName ?? "",
    procurementUnit: product.procurementUnit ?? "",
  };
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

async function readCatalogSettings(memberId: number) {
  const d1 = await ensureCollaborationReady();
  const orderKey = orderSettingKey(memberId);
  const favoritesKey = favoritesSettingKey(memberId);
  const rows = await d1
    .prepare(
      `SELECT key, value
       FROM app_settings
       WHERE key IN (?, ?, ?)`,
    )
    .bind(SETTING_KEY, orderKey, favoritesKey)
    .all<{ key: string; value: string }>();
  const settings = new Map(
    rows.results.map((row) => [String(row.key), String(row.value ?? "")]),
  );
  let products = PRODUCT_CATALOG;
  try {
    const stored = normalizeProducts(
      JSON.parse(settings.get(SETTING_KEY) || "[]"),
    );
    if (stored.length) products = stored;
  } catch {
    products = PRODUCT_CATALOG;
  }
  const parseProductIds = (key: string) => {
    try {
      return normalizeProductOrder(
        JSON.parse(settings.get(key) || "[]"),
        products,
      );
    } catch {
      return [];
    }
  };
  return {
    products,
    productOrder: parseProductIds(orderKey),
    favoriteProductIds: parseProductIds(favoritesKey),
  };
}

async function catalogResponse(
  memberId: number,
  products: ProductCatalogItem[],
  savedSettings?: {
    productOrder: string[];
    favoriteProductIds: string[];
  },
) {
  const [memberSettings, relations] = await Promise.all([
    savedSettings
      ? Promise.resolve(savedSettings)
      : Promise.all([
          readProductOrder(memberId, products),
          readFavoriteProductIds(memberId, products),
        ]).then(([productOrder, favoriteProductIds]) => ({
          productOrder,
          favoriteProductIds,
        })),
    readProductCatalogRelations(),
  ]);
  const { productOrder, favoriteProductIds } = memberSettings;
  const { linkMap, supplyMap, vendors } = relations;
  const linkedProducts = applyProductOrder(products, productOrder).map(
    (product) => {
      const link = linkMap.get(product.id);
      const supply = supplyMap.get(product.id);
      const supplyType = normalizeProductSupplyType({
        catalogItemId: product.id,
        productName: product.name,
        supplyType: supply?.supplyType ?? product.supplyType,
      });
      const marginRate =
        supplyType === "direct"
          ? supply?.marginRate ?? product.marginRate ?? product.commissionRate
          : null;
      return {
        ...product,
        supplyType,
        commissionRate:
          supplyType === "partner" ? product.commissionRate : null,
        marginRate,
        supplierVendorId:
          supplyType === "partner" ? link?.supplierVendorId ?? null : null,
        supplierVendorName:
          supplyType === "partner" ? link?.supplierVendorName ?? "" : "",
      };
    },
  );
  return {
    products: linkedProducts,
    productOrder,
    favoriteProductIds,
    vendors,
  };
}

function orderSettingKey(memberId: number) {
  return `${ORDER_SETTING_KEY_PREFIX}${memberId}`;
}

function favoritesSettingKey(memberId: number) {
  return `${FAVORITES_SETTING_KEY_PREFIX}${memberId}`;
}

function normalizeProductOrder(value: unknown, products: ProductCatalogItem[]) {
  if (!Array.isArray(value)) return [];
  const availableIds = new Set(products.map((product) => product.id));
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const id = cleanText(entry, 160);
    if (!id || seen.has(id) || !availableIds.has(id)) return [];
    seen.add(id);
    return [id];
  });
}

function applyProductOrder(products: ProductCatalogItem[], order: string[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const ordered = order.flatMap((id) => {
    const product = byId.get(id);
    if (!product) return [];
    byId.delete(id);
    return [product];
  });
  return [...ordered, ...products.filter((product) => byId.has(product.id))];
}

async function readProductOrder(memberId: number, products: ProductCatalogItem[]) {
  const d1 = await ensureCollaborationReady();
  const row = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(orderSettingKey(memberId))
    .first<{ value: string }>();
  if (!row?.value) return [];
  try {
    return normalizeProductOrder(JSON.parse(row.value), products);
  } catch {
    return [];
  }
}

async function readFavoriteProductIds(
  memberId: number,
  products: ProductCatalogItem[],
) {
  const d1 = await ensureCollaborationReady();
  const row = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(favoritesSettingKey(memberId))
    .first<{ value: string }>();
  if (!row?.value) return [];
  try {
    return normalizeProductOrder(JSON.parse(row.value), products);
  } catch {
    return [];
  }
}

async function writeMemberProductSetting(
  key: string,
  value: string[],
  memberId: number,
) {
  const d1 = await ensureCollaborationReady();
  if (value.length) {
    await d1
      .prepare(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(key, JSON.stringify(value), memberId)
      .run();
  } else {
    await d1.prepare("DELETE FROM app_settings WHERE key = ?").bind(key).run();
  }
}

export async function GET() {
  try {
    const member = await requireApprovedMember();
    const settings = await readCatalogSettings(member.id);
    return Response.json(
      await catalogResponse(member.id, settings.products, settings),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requirePrimaryOwner();
    const body = (await request.json()) as { product?: unknown };
    const requested = normalizeProduct(body.product, 0);
    if (!requested?.procurement || !requested.procurementNumber) {
      return Response.json({ error: "등록할 조달 물품의 식별번호가 필요합니다." }, { status: 400 });
    }
    const identity = procurementProductIdentity(requested.procurementChannel, requested.procurementNumber);
    if (!identity) {
      return Response.json({ error: "조달 채널과 식별번호를 확인해 주세요." }, { status: 400 });
    }
    requested.id = procurementCatalogId(requested.procurementChannel, requested.procurementNumber);
    requested.sourceRow = 1;
    requested.supplyType = "partner";
    requested.supplierVendorId = null;
    requested.supplierVendorName = "";
    requested.commissionRate = null;
    requested.marginRate = null;

    const d1 = await ensureCollaborationReady();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const row = await d1
        .prepare("SELECT value FROM app_settings WHERE key = ?")
        .bind(SETTING_KEY)
        .first<{ value: string }>();
      let current = PRODUCT_CATALOG;
      if (row?.value) {
        try {
          const parsed = normalizeProducts(JSON.parse(row.value));
          if (parsed.length) current = parsed;
        } catch {
          current = PRODUCT_CATALOG;
        }
      }
      const existing = current.find((product) =>
        procurementProductIdentity(product.procurementChannel, product.procurementNumber) === identity
      );
      if (existing) {
        return Response.json({ product: existing, created: false });
      }
      if (current.length >= MAX_PRODUCTS) {
        return Response.json({ error: `제품은 최대 ${MAX_PRODUCTS.toLocaleString("ko-KR")}개까지 저장할 수 있습니다.` }, { status: 409 });
      }
      requested.sourceRow = Math.max(0, ...current.map((product) => product.sourceRow || 0)) + 1;
      const nextValue = JSON.stringify([...current, requested].map(productForStorage));
      const write = row?.value
        ? await d1
            .prepare(
              `UPDATE app_settings
               SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
               WHERE key = ? AND value = ?
               RETURNING key`,
            )
            .bind(nextValue, member.id, SETTING_KEY, row.value)
            .run()
        : await d1
            .prepare(
              `INSERT INTO app_settings (key, value, updated_by, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO NOTHING
               RETURNING key`,
            )
            .bind(SETTING_KEY, nextValue, member.id)
            .run();
      if ((write.meta.changes ?? 0) > 0 || write.results.length > 0) {
        return Response.json({ product: requested, created: true }, { status: 201 });
      }
    }
    return Response.json({ error: "다른 사용자가 제품 목록을 수정 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 409 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireApprovedMember();
    const body = (await request.json()) as { products?: unknown };
    const products = normalizeProducts(body.products);
    const d1 = await ensureProductVendorLinksReady();
    const [vendors, existingLinks, existingSupply] = await Promise.all([
      readActiveProductVendors(),
      readProductVendorLinkMap(),
      readProductSupplySettingMap(),
    ]);
    const activeVendorNames = new Map(
      vendors.map((vendor) => [vendor.id, vendor.companyName]),
    );
    const productIds = new Set(products.map((product) => product.id));
    const statements: ReturnType<typeof d1.prepare>[] = [
      d1
        .prepare(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          SETTING_KEY,
          JSON.stringify(products.map(productForStorage)),
          member.id,
        ),
    ];

    for (const product of products) {
      const currentLink = existingLinks.get(product.id);
      const requestedVendorId =
        product.supplyType === "partner"
          ? product.supplierVendorId ?? null
          : null;
      const vendorName =
        requestedVendorId === null
          ? ""
          : activeVendorNames.get(requestedVendorId) ??
            (currentLink?.supplierVendorId === requestedVendorId
              ? currentLink.supplierVendorName
              : "");
      if (requestedVendorId !== null && !vendorName) {
        throw new Error(
          `'${product.name}'에 연결할 활성 협력사를 찾지 못했습니다.`,
        );
      }

      statements.push(
        d1
          .prepare(
            `INSERT INTO product_supply_settings (
               product_id, supply_type, margin_rate, updated_by
             ) VALUES (?, ?, ?, ?)
             ON CONFLICT(product_id) DO UPDATE SET
               supply_type = excluded.supply_type,
               margin_rate = excluded.margin_rate,
               updated_by = excluded.updated_by,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            product.id,
            product.supplyType,
            product.supplyType === "direct" ? product.marginRate : null,
            member.id,
          ),
      );

      if (requestedVendorId === null) {
        statements.push(
          d1
            .prepare("DELETE FROM product_vendor_links WHERE product_id = ?")
            .bind(product.id),
        );
      } else {
        statements.push(
          d1
            .prepare(
              `INSERT INTO product_vendor_links (
                 product_id, vendor_id, vendor_name_snapshot, updated_by
               ) VALUES (?, ?, ?, ?)
               ON CONFLICT(product_id) DO UPDATE SET
                 vendor_id = excluded.vendor_id,
                 vendor_name_snapshot = excluded.vendor_name_snapshot,
                 updated_by = excluded.updated_by,
                 updated_at = CURRENT_TIMESTAMP`,
            )
            .bind(product.id, requestedVendorId, vendorName, member.id),
        );
      }

      statements.push(
        d1
          .prepare(
            `UPDATE equipment_items
             SET supply_type = ?,
                 commission_rate = ?,
                 margin_rate = ?,
                 supplier_vendor_id = ?,
                 supplier_vendor_name = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE catalog_item_id = ?
               AND status IN ('제안 예정', '제안', '견적')`,
          )
          .bind(
            product.supplyType,
            product.supplyType === "partner"
              ? product.commissionRate
              : null,
            product.supplyType === "direct" ? product.marginRate : null,
            requestedVendorId,
            vendorName,
            product.id,
          ),
      );
    }

    const removedProductIds = new Set([
      ...[...existingLinks.keys()].filter((id) => !productIds.has(id)),
      ...[...existingSupply.keys()].filter((id) => !productIds.has(id)),
    ]);
    for (const productId of removedProductIds) {
      statements.push(
        d1
          .prepare("DELETE FROM product_vendor_links WHERE product_id = ?")
          .bind(productId),
        d1
          .prepare("DELETE FROM product_supply_settings WHERE product_id = ?")
          .bind(productId),
      );
    }
    await d1.batch(statements);

    return Response.json(await catalogResponse(member.id, products));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const member = await requireApprovedMember();
    const body = (await request.json()) as {
      productOrder?: unknown;
      favoriteProductIds?: unknown;
      productId?: unknown;
      productIds?: unknown;
      supplierVendorId?: unknown;
    };
    const products = await readStoredProducts();
    const updatesOrder = Array.isArray(body.productOrder);
    const updatesFavorites = Array.isArray(body.favoriteProductIds);
    const updatesVendor = Object.prototype.hasOwnProperty.call(
      body,
      "productId",
    ) || Array.isArray(body.productIds);
    if (!updatesOrder && !updatesFavorites && !updatesVendor) {
      throw new Error("저장할 제품 정보가 필요합니다.");
    }
    const productOrder = updatesOrder
      ? normalizeProductOrder(body.productOrder, products)
      : await readProductOrder(member.id, products);
    const favoriteProductIds = updatesFavorites
      ? normalizeProductOrder(body.favoriteProductIds, products)
      : await readFavoriteProductIds(member.id, products);
    if (updatesOrder) {
      await writeMemberProductSetting(
        orderSettingKey(member.id),
        productOrder,
        member.id,
      );
    }
    if (updatesFavorites) {
      await writeMemberProductSetting(
        favoritesSettingKey(member.id),
        favoriteProductIds,
        member.id,
      );
    }
    if (updatesVendor) {
      const requestedProductIds = Array.isArray(body.productIds)
        ? body.productIds.map((value) => cleanText(value, 160))
        : [cleanText(body.productId, 160)];
      const availableProductIds = new Set(products.map((product) => product.id));
      const productIds = [
        ...new Set(
          requestedProductIds.filter((productId) =>
            availableProductIds.has(productId),
          ),
        ),
      ];
      if (
        !productIds.length ||
        productIds.length !== new Set(requestedProductIds.filter(Boolean)).size
      ) {
        throw new Error("협력사를 연결할 제품을 찾지 못했습니다.");
      }
      if (productIds.length > 500) {
        throw new Error("협력사는 한 번에 최대 500개 제품까지 변경할 수 있습니다.");
      }
      const requestedVendorId =
        body.supplierVendorId === null ||
        body.supplierVendorId === undefined ||
        body.supplierVendorId === ""
          ? null
          : Number(body.supplierVendorId);
      if (
        requestedVendorId !== null &&
        (!Number.isInteger(requestedVendorId) || requestedVendorId < 1)
      ) {
        throw new Error("연결할 협력사를 확인해 주세요.");
      }
      await setProductVendorLinks(productIds, requestedVendorId, member.id);
    }
    return Response.json(await catalogResponse(member.id, products));
  } catch (error) {
    return accessErrorResponse(error);
  }
}
