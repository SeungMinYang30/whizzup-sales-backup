import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  ensureInventoryReady,
  inventoryProductJson,
  inventoryTransactionJson,
} from "../../../lib/inventory-store";

export const dynamic = "force-dynamic";

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanInteger(value: unknown, max = 999_999) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(max, Math.max(0, Math.round(parsed)));
}

function koreaToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function cleanDate(value: unknown) {
  const requested = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : koreaToday();
}

async function readInventory() {
  const d1 = await ensureInventoryReady();
  const month = koreaToday().slice(0, 7);
  const [products, transactions, monthly] = await Promise.all([
    d1
      .prepare(
        `SELECT product.*,
                COALESCE((
                  SELECT movement.transaction_date || ' ' || movement.created_at
                  FROM inventory_transactions movement
                  WHERE movement.product_id = product.id
                  ORDER BY movement.transaction_date DESC, movement.id DESC
                  LIMIT 1
                ), '') AS last_transaction_at
         FROM inventory_products product
         WHERE product.is_active = 1
         ORDER BY product.name COLLATE NOCASE, product.id`,
      )
      .all<Record<string, unknown>>(),
    d1
      .prepare(
        `SELECT movement.*, product.name AS product_name, product.unit
         FROM inventory_transactions movement
         JOIN inventory_products product ON product.id = movement.product_id
         ORDER BY movement.transaction_date DESC, movement.id DESC
         LIMIT 100`,
      )
      .all<Record<string, unknown>>(),
    d1
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN transaction_type = 'in' THEN quantity_delta ELSE 0 END), 0) AS inbound,
           COALESCE(SUM(CASE WHEN transaction_type = 'out' THEN -quantity_delta ELSE 0 END), 0) AS outbound
         FROM inventory_transactions
         WHERE SUBSTR(transaction_date, 1, 7) = ?`,
      )
      .bind(month)
      .first<{ inbound: number; outbound: number }>(),
  ]);
  const productRows: ReturnType<typeof inventoryProductJson>[] =
    products.results.map((row: Record<string, unknown>) =>
      inventoryProductJson(row),
    );
  return {
    products: productRows,
    transactions: transactions.results.map((row: Record<string, unknown>) =>
      inventoryTransactionJson(row),
    ),
    summary: {
      productCount: productRows.length,
      totalStock: productRows.reduce(
        (total, product) => total + product.currentStock,
        0,
      ),
      lowStockCount: productRows.filter(
        (product) => product.currentStock <= product.lowStockThreshold,
      ).length,
      monthlyInbound: Number(monthly?.inbound ?? 0),
      monthlyOutbound: Number(monthly?.outbound ?? 0),
    },
  };
}

export async function GET() {
  try {
    await requireMemberPermission("inventory:manage");
    return Response.json(await readInventory());
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("inventory:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const action = cleanText(payload.action, 30);
    const d1 = await ensureInventoryReady();

    if (action === "product") {
      const name = cleanText(payload.name, 160);
      const specification = cleanText(payload.specification, 500);
      const unit = cleanText(payload.unit, 20) || "대";
      const lowStockThreshold = cleanInteger(payload.lowStockThreshold);
      const initialStock = cleanInteger(payload.initialStock);
      if (!name) {
        return Response.json(
          { error: "품목명을 입력해 주세요." },
          { status: 400 },
        );
      }
      const created = await d1
        .prepare(
          `INSERT INTO inventory_products
           (name, specification, unit, current_stock, low_stock_threshold,
            created_by, created_by_name, updated_by, updated_by_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
        )
        .bind(
          name,
          specification,
          unit,
          initialStock,
          lowStockThreshold,
          member.id,
          member.displayName,
          member.id,
          member.displayName,
        )
        .first<{ id: number }>();
      if (!created) throw new Error("품목을 등록하지 못했습니다.");
      if (initialStock > 0) {
        await d1
          .prepare(
            `INSERT INTO inventory_transactions
             (product_id, transaction_type, quantity_delta, resulting_stock,
              reference, note, transaction_date, created_by, created_by_name)
             VALUES (?, 'adjust', ?, ?, '초기 재고', '품목 등록 시 입력한 초기 재고', ?, ?, ?)`,
          )
          .bind(
            created.id,
            initialStock,
            initialStock,
            koreaToday(),
            member.id,
            member.displayName,
          )
          .run();
      }
      return Response.json(await readInventory(), { status: 201 });
    }

    if (action === "update-product") {
      const productId = cleanInteger(payload.productId);
      const name = cleanText(payload.name, 160);
      const specification = cleanText(payload.specification, 500);
      const unit = cleanText(payload.unit, 20) || "대";
      const lowStockThreshold = cleanInteger(payload.lowStockThreshold);
      if (!productId || !name) {
        return Response.json(
          { error: "수정할 품목과 품목명을 확인해 주세요." },
          { status: 400 },
        );
      }
      const result = await d1
        .prepare(
          `UPDATE inventory_products
           SET name = ?, specification = ?, unit = ?, low_stock_threshold = ?,
               updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND is_active = 1`,
        )
        .bind(
          name,
          specification,
          unit,
          lowStockThreshold,
          member.id,
          member.displayName,
          productId,
        )
        .run();
      if (!Number(result.meta?.changes ?? 0)) {
        return Response.json(
          { error: "수정할 품목을 찾지 못했습니다." },
          { status: 404 },
        );
      }
      return Response.json(await readInventory());
    }

    if (action === "movement") {
      const productId = cleanInteger(payload.productId);
      const type = cleanText(payload.type, 20);
      if (!productId || !["in", "out", "adjust"].includes(type)) {
        return Response.json(
          { error: "입고·출고·조정 유형을 확인해 주세요." },
          { status: 400 },
        );
      }
      const product = await d1
        .prepare(
          `SELECT id, current_stock
           FROM inventory_products
           WHERE id = ? AND is_active = 1`,
        )
        .bind(productId)
        .first<{ id: number; current_stock: number }>();
      if (!product) {
        return Response.json(
          { error: "재고 품목을 찾지 못했습니다." },
          { status: 404 },
        );
      }
      const requestedQuantity = cleanInteger(payload.quantity);
      const delta =
        type === "adjust"
          ? requestedQuantity - Number(product.current_stock)
          : type === "out"
            ? -requestedQuantity
            : requestedQuantity;
      if (!delta) {
        return Response.json(
          {
            error:
              type === "adjust"
                ? "현재 재고와 다른 수량을 입력해 주세요."
                : "수량을 1대 이상 입력해 주세요.",
          },
          { status: 400 },
        );
      }
      const transactionDate = cleanDate(payload.transactionDate);
      const reference = cleanText(payload.reference, 200);
      const note = cleanText(payload.note, 1_000);
      const statements = [
        d1
          .prepare(
            `INSERT INTO inventory_transactions
             (product_id, transaction_type, quantity_delta, resulting_stock,
              reference, note, transaction_date, created_by, created_by_name)
             SELECT id, ?, ?, current_stock + ?, ?, ?, ?, ?, ?
             FROM inventory_products
             WHERE id = ? AND is_active = 1 AND current_stock + ? >= 0`,
          )
          .bind(
            type,
            delta,
            delta,
            reference,
            note,
            transactionDate,
            member.id,
            member.displayName,
            productId,
            delta,
          ),
        d1
          .prepare(
            `UPDATE inventory_products
             SET current_stock = current_stock + ?, updated_by = ?,
                 updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND is_active = 1 AND current_stock + ? >= 0`,
          )
          .bind(delta, member.id, member.displayName, productId, delta),
      ];
      const results = await d1.batch(statements);
      if (!Number(results[0]?.meta?.changes ?? 0)) {
        return Response.json(
          { error: "출고 수량이 현재 재고보다 많습니다." },
          { status: 400 },
        );
      }
      return Response.json(await readInventory());
    }

    return Response.json(
      { error: "처리할 재고 작업을 선택해 주세요." },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return Response.json(
        { error: "같은 이름의 재고 품목이 이미 있습니다." },
        { status: 409 },
      );
    }
    return accessErrorResponse(error);
  }
}
