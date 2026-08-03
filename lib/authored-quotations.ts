import { getD1 } from "../db";
import { ensureCollaborationReady, type Member } from "./collaboration";

export type AuthoredQuotationItem = {
  id: string;
  productId: string;
  name: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  note: string;
  supplyType: "partner" | "direct";
  earningRate: number;
  amount: number;
  expectedEarning: number;
};

export type AuthoredQuotation = {
  id: number;
  quoteNumber: string;
  organization: string;
  businessRound: number;
  projectTitle: string;
  quoteDate: string;
  validUntil: string;
  status: "draft" | "final";
  executionType: "직영" | "컨소";
  consortiumCompany: string;
  consortiumRate: number;
  discountAmount: number;
  extraAmount: number;
  subtotalAmount: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  expectedEarning: number;
  consortiumPayment: number;
  marginAmount: number;
  marginRate: number;
  includeStamp: boolean;
  memo: string;
  items: AuthoredQuotationItem[];
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

const statements = [
  `CREATE TABLE IF NOT EXISTS authored_quotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_number TEXT NOT NULL UNIQUE,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    project_title TEXT NOT NULL DEFAULT '',
    quote_date TEXT NOT NULL,
    valid_until TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    execution_type TEXT NOT NULL DEFAULT '직영',
    consortium_company TEXT NOT NULL DEFAULT '',
    consortium_rate TEXT NOT NULL DEFAULT '0',
    discount_amount INTEGER NOT NULL DEFAULT 0,
    extra_amount INTEGER NOT NULL DEFAULT 0,
    subtotal_amount INTEGER NOT NULL DEFAULT 0,
    supply_amount INTEGER NOT NULL DEFAULT 0,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    expected_earning INTEGER NOT NULL DEFAULT 0,
    consortium_payment INTEGER NOT NULL DEFAULT 0,
    margin_amount INTEGER NOT NULL DEFAULT 0,
    margin_rate TEXT NOT NULL DEFAULT '0',
    include_stamp INTEGER NOT NULL DEFAULT 0,
    memo TEXT NOT NULL DEFAULT '',
    items_json TEXT NOT NULL DEFAULT '[]',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER NOT NULL,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS authored_quotations_org_date_idx
   ON authored_quotations (organization, business_round, quote_date, id)`,
];

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

export function ensureAuthoredQuotationsReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = await ensureCollaborationReady();
      await d1.batch(statements.map((sql) => d1.prepare(sql)));
      return d1;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

function text(value: unknown, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function amount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function rate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
}

function date(value: unknown) {
  const result = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : "";
}

function parseItems(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return source.slice(0, 200).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const name = text(item.name, 300);
    if (!name) return [];
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = amount(item.unitPrice);
    const lineAmount = Math.round(quantity * unitPrice);
    const earningRate = rate(item.earningRate);
    return [{
      id: text(item.id, 160) || `line-${index + 1}`,
      productId: text(item.productId, 160),
      name,
      specification: text(item.specification, 1_000),
      quantity,
      unit: text(item.unit, 40) || "대",
      unitPrice,
      note: text(item.note, 1_000),
      supplyType: item.supplyType === "direct" ? "direct" as const : "partner" as const,
      earningRate,
      amount: lineAmount,
      expectedEarning: Math.floor(lineAmount * earningRate / 10) * 10,
    }];
  });
}

function fromRow(row: Record<string, unknown>): AuthoredQuotation {
  let items: AuthoredQuotationItem[] = [];
  try { items = parseItems(JSON.parse(String(row.items_json ?? "[]"))); } catch { items = []; }
  return {
    id: Number(row.id), quoteNumber: String(row.quote_number ?? ""),
    organization: String(row.organization ?? ""),
    businessRound: Math.max(1, Number(row.business_round) || 1),
    projectTitle: String(row.project_title ?? ""), quoteDate: String(row.quote_date ?? ""),
    validUntil: String(row.valid_until ?? ""), status: row.status === "final" ? "final" : "draft",
    executionType: row.execution_type === "컨소" ? "컨소" : "직영",
    consortiumCompany: String(row.consortium_company ?? ""), consortiumRate: rate(row.consortium_rate),
    discountAmount: amount(row.discount_amount), extraAmount: amount(row.extra_amount),
    subtotalAmount: amount(row.subtotal_amount), supplyAmount: amount(row.supply_amount),
    taxAmount: amount(row.tax_amount), totalAmount: amount(row.total_amount),
    expectedEarning: amount(row.expected_earning), consortiumPayment: amount(row.consortium_payment),
    marginAmount: amount(row.margin_amount), marginRate: rate(row.margin_rate),
    includeStamp: Number(row.include_stamp) === 1, memo: String(row.memo ?? ""), items,
    createdByName: String(row.created_by_name ?? ""), updatedByName: String(row.updated_by_name ?? ""),
    createdAt: String(row.created_at ?? ""), updatedAt: String(row.updated_at ?? ""),
  };
}

function normalized(value: Record<string, unknown>) {
  const organization = text(value.organization, 300);
  const quoteDate = date(value.quoteDate);
  const items = parseItems(value.items);
  if (!organization) throw new Error("견적 기관명을 입력해 주세요.");
  if (!quoteDate) throw new Error("견적일을 확인해 주세요.");
  if (!items.length) throw new Error("견적 품목을 한 개 이상 추가해 주세요.");
  const subtotalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const discountAmount = Math.min(subtotalAmount, amount(value.discountAmount));
  const extraAmount = amount(value.extraAmount);
  const supplyAmount = Math.max(0, subtotalAmount - discountAmount + extraAmount);
  const taxAmount = Math.floor(supplyAmount * 0.1);
  const totalAmount = supplyAmount + taxAmount;
  const expectedEarning = items.reduce((sum, item) => sum + item.expectedEarning, 0);
  const executionType = value.executionType === "컨소" ? "컨소" as const : "직영" as const;
  const consortiumRate = executionType === "컨소" ? rate(value.consortiumRate) : 0;
  const consortiumPayment = executionType === "컨소"
    ? Math.min(expectedEarning, Math.floor(subtotalAmount * consortiumRate / 10) * 10)
    : 0;
  const marginAmount = Math.max(0, expectedEarning - consortiumPayment);
  return {
    organization, businessRound: Math.max(1, Number(value.businessRound) || 1),
    projectTitle: text(value.projectTitle, 500), quoteDate,
    validUntil: date(value.validUntil), status: value.status === "final" ? "final" as const : "draft" as const,
    executionType, consortiumCompany: executionType === "컨소" ? text(value.consortiumCompany, 300) : "",
    consortiumRate, discountAmount, extraAmount, subtotalAmount, supplyAmount,
    taxAmount, totalAmount, expectedEarning, consortiumPayment, marginAmount,
    marginRate: subtotalAmount > 0 ? marginAmount / subtotalAmount : 0,
    includeStamp: value.includeStamp === true, memo: text(value.memo, 4_000), items,
  };
}

export async function listAuthoredQuotations(query = "") {
  const d1 = await ensureAuthoredQuotationsReady();
  const cleanQuery = text(query, 200);
  const result = cleanQuery
    ? await d1.prepare(`SELECT * FROM authored_quotations WHERE organization LIKE ? OR quote_number LIKE ? OR project_title LIKE ? ORDER BY quote_date DESC, id DESC LIMIT 500`).bind(`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`).all<Record<string, unknown>>()
    : await d1.prepare(`SELECT * FROM authored_quotations ORDER BY quote_date DESC, id DESC LIMIT 500`).all<Record<string, unknown>>();
  return result.results.map(fromRow);
}

function quotationNumber(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `WZ-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export async function saveAuthoredQuotation(value: Record<string, unknown>, member: Pick<Member, "id" | "displayName">) {
  const data = normalized(value);
  const d1 = await ensureAuthoredQuotationsReady();
  const id = Number(value.id);
  const params = [data.organization, data.businessRound, data.projectTitle, data.quoteDate, data.validUntil,
    data.status, data.executionType, data.consortiumCompany, String(data.consortiumRate), data.discountAmount,
    data.extraAmount, data.subtotalAmount, data.supplyAmount, data.taxAmount, data.totalAmount,
    data.expectedEarning, data.consortiumPayment, data.marginAmount, String(data.marginRate), data.includeStamp ? 1 : 0,
    data.memo, JSON.stringify(data.items), member.id, member.displayName] as const;
  if (Number.isSafeInteger(id) && id > 0) {
    await d1.prepare(`UPDATE authored_quotations SET organization=?, business_round=?, project_title=?, quote_date=?, valid_until=?, status=?, execution_type=?, consortium_company=?, consortium_rate=?, discount_amount=?, extra_amount=?, subtotal_amount=?, supply_amount=?, tax_amount=?, total_amount=?, expected_earning=?, consortium_payment=?, margin_amount=?, margin_rate=?, include_stamp=?, memo=?, items_json=?, updated_by=?, updated_by_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...params, id).run();
    const row = await d1.prepare("SELECT * FROM authored_quotations WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!row) throw new Error("저장한 견적서를 찾지 못했습니다.");
    return fromRow(row);
  }
  const quoteNumber = quotationNumber();
  const result = await d1.prepare(`INSERT INTO authored_quotations (quote_number, organization, business_round, project_title, quote_date, valid_until, status, execution_type, consortium_company, consortium_rate, discount_amount, extra_amount, subtotal_amount, supply_amount, tax_amount, total_amount, expected_earning, consortium_payment, margin_amount, margin_rate, include_stamp, memo, items_json, created_by, created_by_name, updated_by, updated_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(quoteNumber, ...params.slice(0, 22), member.id, member.displayName, member.id, member.displayName).run();
  const row = await d1.prepare("SELECT * FROM authored_quotations WHERE id=?").bind(Number(result.meta.last_row_id)).first<Record<string, unknown>>();
  if (!row) throw new Error("저장한 견적서를 찾지 못했습니다.");
  return fromRow(row);
}

