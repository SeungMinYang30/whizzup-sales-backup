import { getD1, isPostgresDatabase } from "../db";
import { ensureAwardVendorsReady } from "./award-vendors";

export type ProductVendorOption = {
  id: number;
  companyName: string;
};

export type ProductVendorLink = {
  productId: string;
  supplierVendorId: number;
  supplierVendorName: string;
};

export type ProductSupplySetting = {
  productId: string;
  supplyType: "partner" | "direct";
  marginRate: number | null;
};

export type ProductCatalogRelations = {
  vendors: ProductVendorOption[];
  linkMap: Map<string, ProductVendorLink>;
  supplyMap: Map<string, ProductSupplySetting>;
};

let productVendorLinksReadyPromise: Promise<ReturnType<typeof getD1>> | null =
  null;

export function ensureProductVendorLinksReady() {
  if (!productVendorLinksReadyPromise) {
    productVendorLinksReadyPromise = (isPostgresDatabase()
      ? Promise.resolve(getD1())
      : ensureAwardVendorsReady())
      .then(async (d1) => {
        if (isPostgresDatabase()) return d1;
        await d1.batch([
          d1.prepare(
            `CREATE TABLE IF NOT EXISTS product_vendor_links (
              product_id TEXT PRIMARY KEY,
              vendor_id INTEGER NOT NULL,
              vendor_name_snapshot TEXT NOT NULL DEFAULT '',
              updated_by INTEGER NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
          ),
          d1.prepare(
            `CREATE INDEX IF NOT EXISTS product_vendor_links_vendor_idx
             ON product_vendor_links (vendor_id, product_id)`,
          ),
          d1.prepare(
            `CREATE TABLE IF NOT EXISTS product_supply_settings (
              product_id TEXT PRIMARY KEY,
              supply_type TEXT NOT NULL DEFAULT 'partner'
                CHECK (supply_type IN ('partner', 'direct')),
              margin_rate REAL,
              updated_by INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
          ),
          d1.prepare(
            `CREATE INDEX IF NOT EXISTS product_supply_settings_type_idx
             ON product_supply_settings (supply_type, product_id)`,
          ),
          d1.prepare(
            `INSERT OR IGNORE INTO product_supply_settings (
               product_id, supply_type, margin_rate, updated_by
             ) VALUES ('quote-62', 'direct', 0.5545454545454546, 0)`,
          ),
          d1.prepare(
            `DELETE FROM product_vendor_links
             WHERE product_id IN (
               SELECT product_id
               FROM product_supply_settings
               WHERE supply_type = 'direct'
             )`,
          ),
        ]);

        const equipmentColumns = await d1
          .prepare("PRAGMA table_info(equipment_items)")
          .all<{ name: string }>();
        const existing = new Set(
          equipmentColumns.results.map(
            (column: { name: string }) => column.name,
          ),
        );
        const upgrades = [
          existing.has("supplier_vendor_id")
            ? null
            : d1.prepare(
                "ALTER TABLE equipment_items ADD COLUMN supplier_vendor_id INTEGER",
              ),
          existing.has("supplier_vendor_name")
            ? null
            : d1.prepare(
                "ALTER TABLE equipment_items ADD COLUMN supplier_vendor_name TEXT NOT NULL DEFAULT ''",
              ),
          existing.has("supply_type")
            ? null
            : d1.prepare(
                "ALTER TABLE equipment_items ADD COLUMN supply_type TEXT NOT NULL DEFAULT 'partner'",
              ),
          existing.has("margin_rate")
            ? null
            : d1.prepare(
                "ALTER TABLE equipment_items ADD COLUMN margin_rate REAL",
              ),
        ].filter(
          (statement): statement is ReturnType<typeof d1.prepare> =>
            statement !== null,
        );
        if (upgrades.length) await d1.batch(upgrades);
        await d1
          .prepare(
            `UPDATE equipment_items
             SET supply_type = 'direct',
                 margin_rate = (
                   SELECT margin_rate
                   FROM product_supply_settings
                   WHERE product_id = equipment_items.catalog_item_id
                 ),
                 commission_rate = NULL,
                 supplier_vendor_id = NULL,
                 supplier_vendor_name = '',
                 updated_at = CURRENT_TIMESTAMP
             WHERE status IN ('제안 예정', '제안', '견적')
               AND COALESCE(supply_type, 'partner') = 'partner'
               AND catalog_item_id IN (
                 SELECT product_id
                 FROM product_supply_settings
                 WHERE supply_type = 'direct'
               )`,
          )
          .run();
        return d1;
      })
      .catch((error) => {
        productVendorLinksReadyPromise = null;
        throw error;
      });
  }
  return productVendorLinksReadyPromise;
}

export async function readActiveProductVendors(): Promise<ProductVendorOption[]> {
  const d1 = await ensureProductVendorLinksReady();
  const rows = await d1
    .prepare(
      `SELECT id, company_name
       FROM award_vendors
       WHERE is_active = 1
       ORDER BY company_name COLLATE NOCASE, id`,
    )
    .all<{ id: number; company_name: string }>();
  return rows.results.map(
    (row: { id: number; company_name: string }): ProductVendorOption => ({
      id: Number(row.id),
      companyName: String(row.company_name ?? ""),
    }),
  );
}

export async function readProductVendorLinkMap(): Promise<
  Map<string, ProductVendorLink>
> {
  const d1 = await ensureProductVendorLinksReady();
  const rows = await d1
    .prepare(
      `SELECT links.product_id, links.vendor_id,
              COALESCE(NULLIF(vendors.company_name, ''), links.vendor_name_snapshot) AS vendor_name
       FROM product_vendor_links links
       LEFT JOIN award_vendors vendors
         ON vendors.id = links.vendor_id AND vendors.is_active = 1
       LEFT JOIN product_supply_settings supply
         ON supply.product_id = links.product_id
       WHERE COALESCE(supply.supply_type, 'partner') = 'partner'`,
    )
    .all<{
      product_id: string;
      vendor_id: number;
      vendor_name: string;
    }>();
  return new Map<string, ProductVendorLink>(
    rows.results.map(
      (row: {
        product_id: string;
        vendor_id: number;
        vendor_name: string;
      }) => [
        String(row.product_id),
        {
          productId: String(row.product_id),
          supplierVendorId: Number(row.vendor_id),
          supplierVendorName: String(row.vendor_name ?? ""),
        } satisfies ProductVendorLink,
      ],
    ),
  );
}

export async function readProductSupplySettingMap(): Promise<
  Map<string, ProductSupplySetting>
> {
  const d1 = await ensureProductVendorLinksReady();
  const rows = await d1
    .prepare(
      `SELECT product_id, supply_type, margin_rate
       FROM product_supply_settings`,
    )
    .all<{
      product_id: string;
      supply_type: string;
      margin_rate: number | null;
    }>();
  return new Map<string, ProductSupplySetting>(
    rows.results.map(
      (row: {
        product_id: string;
        supply_type: string;
        margin_rate: number | null;
      }) => [
        String(row.product_id),
        {
          productId: String(row.product_id),
          supplyType: row.supply_type === "direct" ? "direct" : "partner",
          marginRate:
            row.margin_rate === null || row.margin_rate === undefined
              ? null
              : Number(row.margin_rate),
        } satisfies ProductSupplySetting,
      ],
    ),
  );
}

export async function readProductCatalogRelations(): Promise<ProductCatalogRelations> {
  const d1 = await ensureProductVendorLinksReady();
  const rows = await d1
    .prepare(
      `SELECT
         'vendor' AS row_kind,
         CAST(vendor.id AS TEXT) AS product_id,
         vendor.id AS vendor_id,
         vendor.company_name AS vendor_name,
         NULL AS supply_type,
         CAST(NULL AS REAL) AS margin_rate
       FROM award_vendors vendor
       WHERE vendor.is_active = 1
       UNION ALL
       SELECT
         'link' AS row_kind,
         links.product_id,
         links.vendor_id,
         COALESCE(NULLIF(vendor.company_name, ''), links.vendor_name_snapshot)
           AS vendor_name,
         NULL AS supply_type,
         CAST(NULL AS REAL) AS margin_rate
       FROM product_vendor_links links
       LEFT JOIN award_vendors vendor
         ON vendor.id = links.vendor_id AND vendor.is_active = 1
       LEFT JOIN product_supply_settings supply
         ON supply.product_id = links.product_id
       WHERE COALESCE(supply.supply_type, 'partner') = 'partner'
       UNION ALL
       SELECT
         'supply' AS row_kind,
         supply.product_id,
         NULL AS vendor_id,
         '' AS vendor_name,
         supply.supply_type,
         supply.margin_rate
       FROM product_supply_settings supply`,
    )
    .all<{
      row_kind: string;
      product_id: string;
      vendor_id: number | null;
      vendor_name: string;
      supply_type: string | null;
      margin_rate: number | null;
    }>();

  const vendors: ProductVendorOption[] = [];
  const linkMap = new Map<string, ProductVendorLink>();
  const supplyMap = new Map<string, ProductSupplySetting>();
  rows.results.forEach((row) => {
    const productId = String(row.product_id ?? "");
    if (row.row_kind === "vendor") {
      vendors.push({
        id: Number(row.vendor_id),
        companyName: String(row.vendor_name ?? ""),
      });
      return;
    }
    if (row.row_kind === "link") {
      linkMap.set(productId, {
        productId,
        supplierVendorId: Number(row.vendor_id),
        supplierVendorName: String(row.vendor_name ?? ""),
      });
      return;
    }
    if (row.row_kind === "supply") {
      supplyMap.set(productId, {
        productId,
        supplyType: row.supply_type === "direct" ? "direct" : "partner",
        marginRate:
          row.margin_rate === null || row.margin_rate === undefined
            ? null
            : Number(row.margin_rate),
      });
    }
  });
  vendors.sort((left, right) =>
    left.companyName.localeCompare(right.companyName, "ko-KR"),
  );
  return { vendors, linkMap, supplyMap };
}

export async function setProductVendorLink(
  productId: string,
  vendorId: number | null,
  memberId: number,
) {
  const [link] = await setProductVendorLinks([productId], vendorId, memberId);
  return link ?? null;
}

export async function setProductVendorLinks(
  productIds: string[],
  vendorId: number | null,
  memberId: number,
) {
  const d1 = await ensureProductVendorLinksReady();
  const uniqueProductIds = [
    ...new Set(productIds.map((productId) => productId.trim()).filter(Boolean)),
  ];
  if (!uniqueProductIds.length) return [];

  if (vendorId === null) {
    await d1.batch(
      uniqueProductIds.map((productId) =>
        d1
          .prepare("DELETE FROM product_vendor_links WHERE product_id = ?")
          .bind(productId),
      ),
    );
    return uniqueProductIds.map(() => null);
  }

  const supplySettings = await readProductSupplySettingMap();
  if (
    uniqueProductIds.some(
      (productId) => supplySettings.get(productId)?.supplyType === "direct",
    )
  ) {
    throw new Error("위즈업 직접 공급 제품에는 협력사를 연결할 수 없습니다.");
  }

  const vendor = await d1
    .prepare(
      `SELECT id, company_name
       FROM award_vendors
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
    )
    .bind(vendorId)
    .first<{ id: number; company_name: string }>();
  if (!vendor) {
    throw new Error("연결할 협력사를 찾지 못했습니다.");
  }

  const vendorName = String(vendor.company_name ?? "").trim();
  await d1.batch(
    uniqueProductIds.flatMap((productId) => [
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
        .bind(productId, vendorId, vendorName, memberId),
      d1
        .prepare(
          `UPDATE equipment_items
           SET supplier_vendor_id = ?,
               supplier_vendor_name = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE catalog_item_id = ?
             AND status IN ('제안 예정', '제안', '견적')
             AND supplier_vendor_id IS NULL
             AND trim(COALESCE(supplier_vendor_name, '')) = ''`,
        )
        .bind(vendorId, vendorName, productId),
    ]),
  );

  return uniqueProductIds.map(
    (productId) =>
      ({
        productId,
        supplierVendorId: vendorId,
        supplierVendorName: vendorName,
      }) satisfies ProductVendorLink,
  );
}
