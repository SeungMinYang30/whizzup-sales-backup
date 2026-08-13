import { getD1 } from "../db";
import { AccessError, ensureCollaborationReady, type Member } from "./collaboration";
import { personDisplayLabel } from "./person-label";
import { hasProcurementSignal, procurementNumbersFromText, resolveProcurementFeeRate } from "./procurement-product";
import { normalizeAirpassEquipmentKit, type AirpassEquipmentKit } from "./airpass-equipment-kit";
import {
  contentSubstitutionBaseEarningRate,
  contentSubstitutionMargin,
  quotationInternalCostDefaults,
  quotationInternalCostKind,
} from "./quotation-internal-costs";
import {
  calculateConsortiumSettlement,
  type InternalCostBearer,
  type SettlementAdjustmentType,
} from "./consortium-settlement";

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
  supplierVendorId?: number | null;
  supplierVendorName?: string;
  earningRate: number;
  internalCostBaseEarningRate?: number;
  amount: number;
  expectedEarning: number;
  contractType: "direct" | "g2b" | "s2b";
  procurement: boolean;
  procurementChannel: string;
  procurementNumber: string;
  procurementFeeRate: number;
  procurementFee: number;
  consortiumRate: number;
  consortiumPayment: number;
  internalCostEnabled: boolean;
  internalCostAmount: number;
  internalCostBearer?: InternalCostBearer;
  internalCostQuantity?: number;
  internalCostUnitAmount?: number;
  internalCostAutoQuantity?: boolean;
  equipmentKit?: AirpassEquipmentKit;
};

export type AuthoredQuotationSettlementAdjustment = {
  id: string;
  type: SettlementAdjustmentType;
  label: string;
  amount: number;
  note: string;
};

export type AuthoredQuotationBudget = {
  key: string;
  budgetGroupId: number | null;
  name: string;
  institutionAmount: number;
  allocatedAmount: number;
};

export type AuthoredQuotation = {
  id: number;
  quoteNumber: string;
  revisionRootId: number;
  revisionParentId: number;
  revisionNumber: number;
  revisionLabel: string;
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
  additionalInternalConstructionCost: number;
  subtotalAmount: number;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  procurementFeeAmount: number;
  expectedEarning: number;
  consortiumPayment: number;
  marginAmount: number;
  marginRate: number;
  includeStamp: boolean;
  memo: string;
  items: AuthoredQuotationItem[];
  budgets: AuthoredQuotationBudget[];
  settlementAdjustments: AuthoredQuotationSettlementAdjustment[];
  drivePdfName: string;
  driveXlsxName: string;
  sourceOriginalName: string;
  driveSyncStatus: "none" | "ready" | "error";
  driveSyncError: string;
  deletedAt: string;
  canDelete: boolean;
  canPurge: boolean;
  pdfUrl: string;
  excelUrl: string;
  sourceOriginalUrl: string;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

const statements = [
  `CREATE TABLE IF NOT EXISTS authored_quotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_number TEXT NOT NULL UNIQUE,
    revision_root_id INTEGER NOT NULL DEFAULT 0,
    revision_parent_id INTEGER NOT NULL DEFAULT 0,
    revision_number INTEGER NOT NULL DEFAULT 0,
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
    additional_internal_construction_cost INTEGER NOT NULL DEFAULT 0,
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
    budgets_json TEXT NOT NULL DEFAULT '[]',
    settlement_adjustments_json TEXT NOT NULL DEFAULT '[]',
    drive_pdf_file_id TEXT NOT NULL DEFAULT '',
    drive_pdf_name TEXT NOT NULL DEFAULT '',
    drive_xlsx_file_id TEXT NOT NULL DEFAULT '',
    drive_xlsx_name TEXT NOT NULL DEFAULT '',
    source_file_id TEXT NOT NULL DEFAULT '',
    source_file_name TEXT NOT NULL DEFAULT '',
    source_file_type TEXT NOT NULL DEFAULT '',
    drive_sync_status TEXT NOT NULL DEFAULT 'none',
    drive_sync_error TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT '',
    deleted_by INTEGER NOT NULL DEFAULT 0,
    deleted_by_name TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER NOT NULL,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS authored_quotations_org_date_idx
   ON authored_quotations (organization, business_round, quote_date, id)`,
  `CREATE INDEX IF NOT EXISTS authored_quotations_revision_idx
   ON authored_quotations (revision_root_id, revision_number, id)`,
  `CREATE INDEX IF NOT EXISTS authored_quotations_deleted_idx
   ON authored_quotations (deleted_at, quote_date, id)`,
];

const authoredQuotationColumns = [
  ["revision_root_id", "INTEGER NOT NULL DEFAULT 0"],
  ["revision_parent_id", "INTEGER NOT NULL DEFAULT 0"],
  ["revision_number", "INTEGER NOT NULL DEFAULT 0"],
  ["budgets_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["settlement_adjustments_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["additional_internal_construction_cost", "INTEGER NOT NULL DEFAULT 0"],
  ["drive_pdf_file_id", "TEXT NOT NULL DEFAULT ''"],
  ["drive_pdf_name", "TEXT NOT NULL DEFAULT ''"],
  ["drive_xlsx_file_id", "TEXT NOT NULL DEFAULT ''"],
  ["drive_xlsx_name", "TEXT NOT NULL DEFAULT ''"],
  ["source_file_id", "TEXT NOT NULL DEFAULT ''"],
  ["source_file_name", "TEXT NOT NULL DEFAULT ''"],
  ["source_file_type", "TEXT NOT NULL DEFAULT ''"],
  ["drive_sync_status", "TEXT NOT NULL DEFAULT 'none'"],
  ["drive_sync_error", "TEXT NOT NULL DEFAULT ''"],
  ["deleted_at", "TEXT NOT NULL DEFAULT ''"],
  ["deleted_by", "INTEGER NOT NULL DEFAULT 0"],
  ["deleted_by_name", "TEXT NOT NULL DEFAULT ''"],
] as const;

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

export function ensureAuthoredQuotationsReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = await ensureCollaborationReady();
      await d1.prepare(statements[0]).run();
      const columns = await d1
        .prepare("PRAGMA table_info(authored_quotations)")
        .all<{ name: string }>();
      const existing = new Set(columns.results.map((column: { name: string }) => column.name));
      for (const [name, definition] of authoredQuotationColumns) {
        if (!existing.has(name)) {
          await d1.prepare(`ALTER TABLE authored_quotations ADD COLUMN ${name} ${definition}`).run();
        }
      }
      await d1.batch(statements.slice(1).map((sql) => d1.prepare(sql)));
      await d1
        .prepare("UPDATE authored_quotations SET revision_root_id = id WHERE revision_root_id = 0")
        .run();
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

function appliesProcurementFee(channel: string) {
  return !/^S\s*2\s*B$/iu.test(channel.trim());
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
    const parsedEarningRate = rate(item.earningRate);
    const requestedContractType = text(item.contractType, 20);
    const inferredProcurement = item.procurement === true || hasProcurementSignal(item.note, item.specification);
    const inferredChannel = text(item.procurementChannel, 80) || (String(item.note ?? "").match(/S\s*2\s*B/iu) ? "S2B" : String(item.note ?? "").includes("디지털서비스몰") ? "디지털서비스몰" : String(item.note ?? "").includes("혁신장터") ? "혁신장터" : "G2B");
    const contractType = requestedContractType === "direct" || requestedContractType === "g2b" || requestedContractType === "s2b"
      ? requestedContractType
      : inferredProcurement
        ? /^S\s*2\s*B$/iu.test(inferredChannel) ? "s2b" as const : "g2b" as const
        : "direct" as const;
    const procurement = contractType !== "direct";
    const procurementChannel = contractType === "s2b" ? "S2B" : procurement ? inferredChannel || "G2B" : "";
    const procurementNumber = procurement ? text(item.procurementNumber, 80) || procurementNumbersFromText(item.note, item.specification)[0] || "" : "";
    const procurementFeeRate = procurement && appliesProcurementFee(procurementChannel) ? resolveProcurementFeeRate(item.procurementFeeRate, item.note, item.specification) ?? 0.0054 : 0;
    const procurementFee = procurement && appliesProcurementFee(procurementChannel) ? Math.floor(lineAmount * procurementFeeRate / 10) * 10 : 0;
    const consortiumRate = rate(item.consortiumRate);
    const equipmentKit = normalizeAirpassEquipmentKit(item.equipmentKit);
    const internalCostDefaults = quotationInternalCostDefaults(name, text(item.specification, 1_000), quantity);
    const internalCostEnabled = typeof item.internalCostEnabled === "boolean"
      ? item.internalCostEnabled
      : false;
    const internalCostAmount = item.internalCostAmount === undefined || item.internalCostAmount === null
      ? 0
      : amount(item.internalCostAmount);
    // 부담 주체 필드가 생기기 전 저장된 견적은 기존 계산을 보존하기 위해 위즈업 부담으로 읽습니다.
    const internalCostBearer = item.internalCostBearer === "consortium" ? "consortium" as const : "whizzup" as const;
    const internalCostUnitAmount = amount(item.internalCostUnitAmount) || internalCostDefaults.unitAmount || internalCostAmount;
    const internalCostQuantity = Math.max(0, Math.round(Number(item.internalCostQuantity) || (
      internalCostEnabled && internalCostUnitAmount > 0
        ? internalCostAmount / internalCostUnitAmount
        : internalCostDefaults.quantity
    )));
    const internalCostAutoQuantity = item.internalCostAutoQuantity === true;
    const contentSubstitutionEnabled = internalCostEnabled && quotationInternalCostKind(name, text(item.specification, 1_000)) === "content-substitution";
    const internalCostBaseEarningRate = contentSubstitutionEnabled
      ? contentSubstitutionBaseEarningRate({
          earningRate: parsedEarningRate,
          internalCostBaseEarningRate: Number(item.internalCostBaseEarningRate),
        })
      : undefined;
    const earningRate = contentSubstitutionEnabled ? 1 : parsedEarningRate;
    const expectedEarning = contentSubstitutionEnabled
      ? contentSubstitutionMargin(lineAmount, internalCostAmount, internalCostBaseEarningRate ?? parsedEarningRate)
      : Math.floor(lineAmount * earningRate / 10) * 10;
    const consortiumPayment = contentSubstitutionEnabled
      ? 0
      : Math.min(expectedEarning, Math.floor(lineAmount * consortiumRate / 10) * 10);
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
      supplierVendorId: Number.isSafeInteger(Number(item.supplierVendorId)) && Number(item.supplierVendorId) > 0
        ? Number(item.supplierVendorId)
        : null,
      supplierVendorName: text(item.supplierVendorName, 300),
      earningRate,
      ...(internalCostBaseEarningRate === undefined ? {} : { internalCostBaseEarningRate }),
      amount: lineAmount,
      expectedEarning,
      contractType,
      procurement,
      procurementChannel,
      procurementNumber,
      procurementFeeRate,
      procurementFee,
      consortiumRate,
      consortiumPayment,
      internalCostEnabled,
      internalCostAmount,
      internalCostBearer,
      internalCostQuantity,
      internalCostUnitAmount,
      internalCostAutoQuantity,
      ...(equipmentKit ? { equipmentKit } : {}),
    }];
  });
}

function parseSettlementAdjustments(value: unknown): AuthoredQuotationSettlementAdjustment[] {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { source = []; }
  }
  if (!Array.isArray(source)) return [];
  return source.slice(0, 50).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const adjustment = entry as Record<string, unknown>;
    const label = text(adjustment.label, 200);
    const adjustmentAmount = amount(adjustment.amount);
    if (!label || !adjustmentAmount) return [];
    return [{
      id: text(adjustment.id, 120) || `adjustment-${index + 1}`,
      type: adjustment.type === "addition" ? "addition" as const : "deduction" as const,
      label,
      amount: adjustmentAmount,
      note: text(adjustment.note, 500),
    }];
  });
}

function parseBudgets(value: unknown, totalAmount = 0): AuthoredQuotationBudget[] {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { source = []; }
  }
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const budgets = source.slice(0, 20).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const budget = entry as Record<string, unknown>;
    const name = text(budget.name ?? budget.budgetType ?? budget.budgetOriginalName, 300);
    if (!name) return [];
    const budgetGroupIdValue = Number(budget.budgetGroupId ?? budget.budget_group_id);
    const budgetGroupId = Number.isSafeInteger(budgetGroupIdValue) && budgetGroupIdValue > 0
      ? budgetGroupIdValue
      : null;
    const key = text(budget.key, 300) || (budgetGroupId ? `group:${budgetGroupId}` : `name:${name.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "")}:${index}`);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      key,
      budgetGroupId,
      name,
      institutionAmount: amount(budget.institutionAmount ?? budget.budgetAmount),
      allocatedAmount: amount(budget.allocatedAmount),
    }];
  });
  if (budgets.length === 1 && budgets[0].allocatedAmount <= 0 && totalAmount > 0) {
    budgets[0] = { ...budgets[0], allocatedAmount: totalAmount };
  }
  return budgets;
}

export function authoredQuotationFromRow(row: Record<string, unknown>): AuthoredQuotation {
  let items: AuthoredQuotationItem[] = [];
  let budgets: AuthoredQuotationBudget[] = [];
  let settlementAdjustments: AuthoredQuotationSettlementAdjustment[] = [];
  try { items = parseItems(JSON.parse(String(row.items_json ?? "[]"))); } catch { items = []; }
  try { budgets = parseBudgets(JSON.parse(String(row.budgets_json ?? "[]")), amount(row.total_amount)); } catch { budgets = []; }
  try { settlementAdjustments = parseSettlementAdjustments(row.settlement_adjustments_json); } catch { settlementAdjustments = []; }
  const id = Number(row.id);
  const revisionNumber = Math.max(0, Number(row.revision_number) || 0);
  const drivePdfFileId = String(row.drive_pdf_file_id ?? "");
  const driveXlsxFileId = String(row.drive_xlsx_file_id ?? "");
  const sourceFileId = String(row.source_file_id ?? "");
  const driveSyncStatus = row.drive_sync_status === "ready"
    ? "ready" as const
    : row.drive_sync_status === "error"
      ? "error" as const
      : "none" as const;
  return {
    id, quoteNumber: String(row.quote_number ?? ""),
    revisionRootId: Math.max(1, Number(row.revision_root_id) || id),
    revisionParentId: Math.max(0, Number(row.revision_parent_id) || 0),
    revisionNumber,
    revisionLabel: revisionNumber > 0 ? `수정${revisionNumber}` : "원본",
    organization: String(row.organization ?? ""),
    businessRound: Math.max(1, Number(row.business_round) || 1),
    projectTitle: String(row.project_title ?? ""), quoteDate: String(row.quote_date ?? ""),
    validUntil: String(row.valid_until ?? ""), status: row.status === "final" ? "final" : "draft",
    executionType: row.execution_type === "컨소" ? "컨소" : "직영",
    consortiumCompany: String(row.consortium_company ?? ""), consortiumRate: rate(row.consortium_rate),
    discountAmount: amount(row.discount_amount), extraAmount: amount(row.extra_amount),
    additionalInternalConstructionCost: amount(row.additional_internal_construction_cost),
    subtotalAmount: amount(row.subtotal_amount), supplyAmount: amount(row.supply_amount),
    taxAmount: amount(row.tax_amount), totalAmount: amount(row.total_amount),
    procurementFeeAmount: items.reduce((sum, item) => sum + item.procurementFee, 0),
    expectedEarning: amount(row.expected_earning), consortiumPayment: amount(row.consortium_payment),
    marginAmount: amount(row.margin_amount), marginRate: rate(row.margin_rate),
    includeStamp: Number(row.include_stamp) === 1, memo: String(row.memo ?? ""), items, budgets, settlementAdjustments,
    drivePdfName: String(row.drive_pdf_name ?? ""),
    driveXlsxName: String(row.drive_xlsx_name ?? ""),
    sourceOriginalName: String(row.source_file_name ?? ""),
    driveSyncStatus,
    driveSyncError: String(row.drive_sync_error ?? ""),
    deletedAt: String(row.deleted_at ?? ""),
    canDelete: Number(row.can_delete) === 1,
    canPurge: Number(row.can_purge) === 1,
    pdfUrl: drivePdfFileId ? `/api/quotations/files?id=${id}&kind=pdf` : "",
    excelUrl: driveXlsxFileId ? `/api/quotations/files?id=${id}&kind=xlsx` : "",
    sourceOriginalUrl: sourceFileId ? `/api/quotations/files?id=${id}&kind=source` : "",
    createdByName: personDisplayLabel({
      displayName: row.creator_display_name ?? row.created_by_name,
      jobTitle: row.creator_job_title,
    }),
    updatedByName: personDisplayLabel({
      displayName: row.editor_display_name ?? row.updated_by_name,
      jobTitle: row.editor_job_title,
    }),
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
  const additionalInternalConstructionCost = amount(value.additionalInternalConstructionCost);
  const adjustedItemAmount = Math.max(0, subtotalAmount - discountAmount + extraAmount);
  const supplyAmount = Math.round(adjustedItemAmount / 1.1);
  const taxAmount = adjustedItemAmount - supplyAmount;
  const procurementFeeAmount = items.reduce((sum, item) => sum + item.procurementFee, 0);
  const totalAmount = adjustedItemAmount + procurementFeeAmount;
  const budgets = parseBudgets(value.budgets, totalAmount);
  const settlementAdjustments = parseSettlementAdjustments(value.settlementAdjustments);
  if ((value.status === "final" || value.validateFinal === true) && budgets.length > 0) {
    const allocatedTotal = budgets.reduce((sum, budget) => sum + budget.allocatedAmount, 0);
    if (allocatedTotal !== totalAmount) {
      throw new Error(`예산 배분 합계 ${allocatedTotal.toLocaleString("ko-KR")}원이 견적 최종 합계 ${totalAmount.toLocaleString("ko-KR")}원과 일치해야 합니다.`);
    }
  }
  const expectedEarning = items.reduce((sum, item) => sum + item.expectedEarning, 0);
  const executionType = value.executionType === "컨소" ? "컨소" as const : "직영" as const;
  const consortiumRate = 0;
  const settlement = calculateConsortiumSettlement(items, executionType, settlementAdjustments);
  const consortiumPayment = settlement.finalPayment;
  const marginAmount = expectedEarning - consortiumPayment - settlement.whizzupCost - additionalInternalConstructionCost;
  return {
    organization, businessRound: Math.max(1, Number(value.businessRound) || 1),
    projectTitle: text(value.projectTitle, 500), quoteDate,
    validUntil: date(value.validUntil), status: value.status === "final" ? "final" as const : "draft" as const,
    executionType, consortiumCompany: executionType === "컨소" ? text(value.consortiumCompany, 300) : "",
    consortiumRate, discountAmount, extraAmount, additionalInternalConstructionCost, subtotalAmount, supplyAmount,
    taxAmount, totalAmount, procurementFeeAmount, expectedEarning, consortiumPayment, marginAmount,
    marginRate: subtotalAmount > 0 ? marginAmount / subtotalAmount : 0,
    includeStamp: value.includeStamp === true, memo: text(value.memo, 4_000), items, budgets, settlementAdjustments,
  };
}

export type AuthoredQuotationListOptions = {
  query?: string;
  organization?: string;
  businessRound?: number;
  deleted?: "active" | "only";
  member?: Pick<Member, "id" | "role">;
};

const quotationWithPeopleSelect = `
  SELECT q.*,
    creator.display_name AS creator_display_name,
    creator.job_title AS creator_job_title,
    editor.display_name AS editor_display_name,
    editor.job_title AS editor_job_title
  FROM authored_quotations q
  LEFT JOIN members creator ON creator.id = q.created_by
  LEFT JOIN members editor ON editor.id = q.updated_by
`;

async function quotationRowById(
  d1: Awaited<ReturnType<typeof ensureAuthoredQuotationsReady>>,
  id: number,
  includeDeleted = false,
) {
  return d1
    .prepare(`${quotationWithPeopleSelect} WHERE q.id=?${includeDeleted ? "" : " AND q.deleted_at = ''"}`)
    .bind(id)
    .first<Record<string, unknown>>();
}

export async function listAuthoredQuotations(
  options: AuthoredQuotationListOptions = {},
) {
  const d1 = await ensureAuthoredQuotationsReady();
  const cleanQuery = text(options.query, 200);
  const organization = text(options.organization, 300);
  const businessRound = Number(options.businessRound);
  const conditions: string[] = [options.deleted === "only" ? "q.deleted_at <> ''" : "q.deleted_at = ''"];
  const bindings: unknown[] = [];
  if (organization) {
    conditions.push("q.organization = ?");
    bindings.push(organization);
  }
  if (organization && Number.isSafeInteger(businessRound) && businessRound > 0) {
    conditions.push("q.business_round = ?");
    bindings.push(businessRound);
  }
  if (cleanQuery) {
    conditions.push("(instr(lower(q.organization), lower(?)) > 0 OR instr(lower(q.quote_number), lower(?)) > 0 OR instr(lower(q.project_title), lower(?)) > 0 OR instr(lower(q.budgets_json), lower(?)) > 0)");
    bindings.push(cleanQuery, cleanQuery, cleanQuery, cleanQuery);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const result = await d1
    .prepare(`${quotationWithPeopleSelect}${where} ORDER BY q.quote_date DESC, q.id DESC LIMIT 500`)
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return result.results.map((row: Record<string, unknown>) => authoredQuotationFromRow({
    ...row,
    can_delete: options.member && (options.member.role === "admin" || Number(row.created_by) === options.member.id) ? 1 : 0,
    can_purge: options.member?.role === "admin" ? 1 : 0,
  }));
}

function quotationNumber(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `WZ-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export async function saveAuthoredQuotation(value: Record<string, unknown>, member: Pick<Member, "id" | "displayName" | "jobTitle">) {
  const data = normalized(value);
  const d1 = await ensureAuthoredQuotationsReady();
  const id = Number(value.id);
  const memberName = personDisplayLabel(member);
  const params = [data.organization, data.businessRound, data.projectTitle, data.quoteDate, data.validUntil,
    data.status, data.executionType, data.consortiumCompany, String(data.consortiumRate), data.discountAmount,
    data.extraAmount, data.additionalInternalConstructionCost, data.subtotalAmount, data.supplyAmount, data.taxAmount, data.totalAmount,
    data.expectedEarning, data.consortiumPayment, data.marginAmount, String(data.marginRate), data.includeStamp ? 1 : 0,
    data.memo, JSON.stringify(data.items), JSON.stringify(data.budgets), JSON.stringify(data.settlementAdjustments), member.id, memberName] as const;
  if (Number.isSafeInteger(id) && id > 0) {
    const existing = await d1
      .prepare("SELECT status FROM authored_quotations WHERE id=? AND deleted_at = ''")
      .bind(id)
      .first<{ status: string }>();
    if (!existing) throw new Error("수정할 견적서를 찾지 못했습니다.");
    await d1.prepare(`UPDATE authored_quotations SET organization=?, business_round=?, project_title=?, quote_date=?, valid_until=?, status=?, execution_type=?, consortium_company=?, consortium_rate=?, discount_amount=?, extra_amount=?, additional_internal_construction_cost=?, subtotal_amount=?, supply_amount=?, tax_amount=?, total_amount=?, expected_earning=?, consortium_payment=?, margin_amount=?, margin_rate=?, include_stamp=?, memo=?, items_json=?, budgets_json=?, settlement_adjustments_json=?, drive_sync_status='none', drive_sync_error='', updated_by=?, updated_by_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...params, id).run();
    const row = await quotationRowById(d1, id);
    if (!row) throw new Error("저장한 견적서를 찾지 못했습니다.");
    return authoredQuotationFromRow(row);
  }
  const revisionSourceId = Number(value.revisionSourceId);
  let revisionRootId = 0;
  let revisionParentId = 0;
  let revisionNumber = 0;
  let quoteNumber = quotationNumber();
  if (Number.isSafeInteger(revisionSourceId) && revisionSourceId > 0) {
    const source = await d1
      .prepare("SELECT id, quote_number, revision_root_id, revision_number, status FROM authored_quotations WHERE id=? AND deleted_at = ''")
      .bind(revisionSourceId)
      .first<Record<string, unknown>>();
    if (!source || source.status !== "final") {
      throw new Error("수정할 최종 견적서를 찾지 못했습니다.");
    }
    revisionParentId = Number(source.id);
    revisionRootId = Math.max(1, Number(source.revision_root_id) || revisionParentId);
    const latest = await d1
      .prepare("SELECT COALESCE(MAX(revision_number), 0) AS revision_number FROM authored_quotations WHERE revision_root_id=? AND deleted_at = ''")
      .bind(revisionRootId)
      .first<{ revision_number: number }>();
    revisionNumber = Math.max(0, Number(latest?.revision_number) || 0) + 1;
    const root = await d1
      .prepare("SELECT quote_number FROM authored_quotations WHERE id=?")
      .bind(revisionRootId)
      .first<{ quote_number: string }>();
    const rootNumber = String(root?.quote_number || source.quote_number || quotationNumber()).replace(/-수정\d+$/u, "");
    quoteNumber = `${rootNumber}-수정${revisionNumber}`;
  }
  const result = await d1.prepare(`INSERT INTO authored_quotations (quote_number, revision_root_id, revision_parent_id, revision_number, organization, business_round, project_title, quote_date, valid_until, status, execution_type, consortium_company, consortium_rate, discount_amount, extra_amount, additional_internal_construction_cost, subtotal_amount, supply_amount, tax_amount, total_amount, expected_earning, consortium_payment, margin_amount, margin_rate, include_stamp, memo, items_json, budgets_json, settlement_adjustments_json, created_by, created_by_name, updated_by, updated_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(quoteNumber, revisionRootId, revisionParentId, revisionNumber, ...params.slice(0, 25), member.id, memberName, member.id, memberName).run();
  const insertedId = Number(result.results[0]?.id);
  if (!Number.isSafeInteger(insertedId) || insertedId < 1) {
    throw new Error("저장된 견적서 번호를 확인하지 못했습니다.");
  }
  if (!revisionRootId) {
    revisionRootId = insertedId;
    await d1.prepare("UPDATE authored_quotations SET revision_root_id=? WHERE id=?").bind(insertedId, insertedId).run();
  }
  const row = await quotationRowById(d1, insertedId);
  if (!row) throw new Error("저장한 견적서를 찾지 못했습니다.");
  return authoredQuotationFromRow(row);
}

export async function getAuthoredQuotationById(id: number) {
  const d1 = await ensureAuthoredQuotationsReady();
  const row = await quotationRowById(d1, id);
  return row ? authoredQuotationFromRow(row) : null;
}

function assertQuotationManager(
  row: Record<string, unknown>,
  member: Pick<Member, "id" | "role">,
) {
  if (member.role !== "admin" && Number(row.created_by) !== member.id) {
    throw new AccessError("견적 작성자 또는 운영자만 삭제할 수 있습니다.", 403);
  }
}

export async function trashAuthoredQuotation(
  id: number,
  member: Pick<Member, "id" | "role" | "displayName">,
) {
  const d1 = await ensureAuthoredQuotationsReady();
  const row = await d1
    .prepare("SELECT * FROM authored_quotations WHERE id=? AND deleted_at = ''")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) throw new AccessError("삭제할 견적서를 찾지 못했습니다.", 404);
  assertQuotationManager(row, member);
  if (Number(row.revision_number) === 0) {
    const revisions = await d1
      .prepare("SELECT COUNT(*) AS count FROM authored_quotations WHERE revision_root_id=? AND id<>? AND deleted_at = ''")
      .bind(id, id)
      .first<{ count: number }>();
    if (Number(revisions?.count) > 0) {
      throw new AccessError("수정본이 있는 원본은 먼저 수정본을 정리한 뒤 삭제해 주세요.", 409);
    }
  }
  await d1
    .prepare(`UPDATE authored_quotations
      SET deleted_at=CURRENT_TIMESTAMP, deleted_by=?, deleted_by_name=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at = ''`)
    .bind(member.id, member.displayName, id)
    .run();
  return authoredQuotationFromRow({ ...row, deleted_at: new Date().toISOString() });
}

export async function restoreAuthoredQuotation(
  id: number,
  member: Pick<Member, "id" | "role">,
) {
  const d1 = await ensureAuthoredQuotationsReady();
  const row = await d1
    .prepare("SELECT * FROM authored_quotations WHERE id=? AND deleted_at <> ''")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) throw new AccessError("복원할 견적서를 찾지 못했습니다.", 404);
  assertQuotationManager(row, member);
  await d1
    .prepare(`UPDATE authored_quotations
      SET deleted_at='', deleted_by=0, deleted_by_name='', updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
    .bind(id)
    .run();
  return authoredQuotationFromRow({ ...row, deleted_at: "" });
}

export async function quotationForPermanentDeletion(id: number) {
  const d1 = await ensureAuthoredQuotationsReady();
  const row = await d1
    .prepare("SELECT * FROM authored_quotations WHERE id=? AND deleted_at <> ''")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) throw new AccessError("영구 삭제할 견적서를 찾지 못했습니다.", 404);
  if (Number(row.revision_number) === 0) {
    const revisions = await d1
      .prepare("SELECT COUNT(*) AS count FROM authored_quotations WHERE revision_root_id=? AND id<>?")
      .bind(id, id)
      .first<{ count: number }>();
    if (Number(revisions?.count) > 0) {
      throw new AccessError("원본과 연결된 수정본을 먼저 영구 삭제해 주세요.", 409);
    }
  }
  return { d1, row };
}

