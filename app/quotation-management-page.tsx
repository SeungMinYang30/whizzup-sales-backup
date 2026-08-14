"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
const PDF_WORKER_URL = "/pdf.worker.min.mjs";
import type {
  AuthoredQuotation,
  AuthoredQuotationBudget,
  AuthoredQuotationItem,
  AuthoredQuotationSettlementAdjustment,
} from "../lib/authored-quotations";
import type { ProductCatalogItem } from "../lib/product-catalog";
import { parseBudgetMoney } from "../lib/activity-budgets";
import { createQuotationWorkbook } from "../lib/quotation-xlsx";
import { AIRPASS_COMPANY, AIRPASS_EQUIPMENT_CONTRACT_NOTE } from "../lib/airpass-company";
import { calculateConsortiumSettlement } from "../lib/consortium-settlement";
import { createConsortiumSettlementWorkbook, type ConsortiumSettlementWorkbookInput } from "../lib/consortium-settlement-xlsx";
import { createInternalProfitReportWorkbook } from "../lib/internal-profit-report-xlsx";
import { createConsortiumSettlementPdf, createInternalProfitReportPdf } from "./consortium-settlement-pdf";
import { hasProcurementSignal, procurementNumbersFromText } from "../lib/procurement-product";
import { createAuthoredQuotationPdf, quotationFileStem } from "./authored-quotation-pdf";
import {
  contentSubstitutionBaseEarningRate,
  contentSubstitutionMargin,
  quotationInternalCostDefaults,
  quotationInternalCostKind,
} from "../lib/quotation-internal-costs";
import { directPurchaseLimitWarning, procurementContractWarnings } from "../lib/procurement-contract-warning";
import { applyCatalogSuppliers } from "../lib/quotation-supplier";
import {
  airpassEquipmentKitOutputLines,
  airpassEquipmentKitTotal,
  createAirpassEquipmentKit,
  createAirpassEquipmentKitFromPlan,
  defaultAirpassEquipmentKitPlans,
  isAirpassEquipmentKitProduct,
  type AirpassEquipmentKit,
  type AirpassEquipmentKitPlan,
} from "../lib/airpass-equipment-kit";
import QuotationImportDialog, {
  type ExternalQuotationImportResult,
  type QuotationImportMode,
} from "./quotation-import-dialog";
import { parseQuotationXlsxData } from "./quotation-xlsx";

export type QuotationInstitutionOption = {
  organization: string;
  businessRound: number;
  budgetType: string;
  region?: string;
  contactName?: string;
  executionType?: string;
  consortiumCompany?: string;
  budgets?: Array<{
    budgetType: string;
    budgetOriginalName?: string;
    budgetGroupId?: number | null;
    budgetAmount?: string;
    budgetInstitutionAmount?: string;
    budgetAmountOverride?: string;
  }>;
};

type QuotationScope = QuotationInstitutionOption;

type QuotationManagementPageProps = {
  institutions: QuotationInstitutionOption[];
  scope?: QuotationScope;
  embedded?: boolean;
  equipmentRefreshVersion?: number;
  /** @deprecated ê¸°ê´€ ìƒì„¸ ì§ì ‘ ë°˜ì˜ UIëŠ” ì œê±°ë˜ì—ˆìŠµë‹ˆë‹¤. í˜¸í™˜ìš©ìœ¼ë¡œë§Œ ìœ ì§€í•©ë‹ˆë‹¤. */
  canSyncDirectEquipment?: boolean;
  onOpenOrganization?: (organization: string, businessRound: number) => void;
  onCountChange?: (counts: { active: number; trash: number }) => void;
};

const QUOTATION_PAGE_SIZE = 25;

type EquipmentQuoteItem = {
  id: number;
  catalogItemId: string;
  productName: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  note: string;
  supplyType: "partner" | "direct";
  supplierVendorId: number | null;
  supplierVendorName: string;
  earningRate: number;
  procurement: boolean;
  procurementChannel: string;
  procurementNumber: string;
  procurementFeeRate: number;
};

type EquipmentQuoteProject = {
  id: number;
  name: string;
  budgetType: string;
  constructionAmount: number;
  actualConstructionCost: number;
  items: EquipmentQuoteItem[];
};

type DraftItem = Omit<AuthoredQuotationItem, "amount" | "expectedEarning" | "procurementFee" | "consortiumPayment">;
type Draft = {
  id?: number;
  quoteNumber?: string;
  organization: string;
  businessRound: number;
  projectTitle: string;
  projectTitleTouched?: boolean;
  quoteDate: string;
  validUntil: string;
  status: "draft" | "final";
  executionType: "ì§ì˜" | "ì»¨ì†Œ";
  consortiumCompany: string;
  consortiumRate: number;
  discountAmount: number;
  extraAmount: number;
  additionalInternalConstructionCost: number;
  includeStamp: boolean;
  memo: string;
  items: DraftItem[];
  budgets: AuthoredQuotationBudget[];
  settlementAdjustments: AuthoredQuotationSettlementAdjustment[];
};

type EquipmentKitEditor = {
  item: DraftItem;
  editingItemId?: string;
};

type RecentConsortiumRate = {
  rate: number;
  quoteNumber: string;
  quoteDate: string;
};

const won = new Intl.NumberFormat("ko-KR");
const CONSTRUCTION_PRODUCT_ID = "__construction_cost__";

function isConstructionItem(item: Pick<DraftItem, "productId">) {
  return item.productId === CONSTRUCTION_PRODUCT_ID;
}

function supportsTeachingAidDiscount(item: Pick<DraftItem, "name" | "specification" | "equipmentKit">) {
  const text = `${item.name} ${item.specification}`.replace(/\s/g, "").toLocaleLowerCase("ko-KR");
  return Boolean(item.equipmentKit) || isAirpassEquipmentKitProduct(item.name) || text.includes("êµêµ¬");
}

function isS2BChannel(value: string) {
  return /^S\s*2\s*B$/iu.test(value.trim());
}

function appliesProcurementFee(item: Pick<DraftItem, "procurement" | "procurementChannel">) {
  return item.procurement && !isS2BChannel(item.procurementChannel);
}

function contractLabel(item: DraftItem) {
  if (isConstructionItem(item)) return "ê³µì‚¬ë¹„";
  if (!item.procurement) return "ìˆ˜ì˜ê³„ì•½";
  if (isS2BChannel(item.procurementChannel)) return "í•™êµì¥í„°";
  return "ì¡°ë‹¬ ê³„ì•½";
}

function outputNote(item: DraftItem) {
  if (item.complimentary) return "ë¬´ìƒ ì œê³µ";
  if (item.equipmentKit) return AIRPASS_EQUIPMENT_CONTRACT_NOTE;
  return contractLabel(item);
}

function constructionDraftItem(amount = 0, projectTitle = "") : DraftItem {
  return {
    id: crypto.randomUUID(),
    productId: CONSTRUCTION_PRODUCT_ID,
    name: "ì„¤ì¹˜Â·ê³µì‚¬ë¹„",
    specification: projectTitle ? `${projectTitle} ì„¤ì¹˜ê³µì‚¬` : "ê³µê°„ì¬êµ¬ì¡°í™” ì„¤ì¹˜ê³µì‚¬",
    quantity: 1,
    unit: "ì‹",
    unitPrice: Math.max(0, Math.round(amount)),
    note: "ê³µì‚¬ë¹„",
    supplyType: "direct",
    earningRate: 0,
    contractType: "direct",
    procurement: false,
    procurementChannel: "",
    procurementNumber: "",
    procurementFeeRate: 0,
    consortiumRate: 0,
    internalCostEnabled: false,
    internalCostAmount: 0,
    internalCostBearer: "consortium",
  };
}

function normalizedInstitutionName(value: string) {
  return value.replace(/\s/g, "").toLocaleLowerCase("ko-KR");
}

function internalCostFields(name: string, specification = "", quantity = 1) {
  const defaults = quotationInternalCostDefaults(name, specification, quantity);
  return {
    internalCostEnabled: defaults.enabled,
    internalCostAmount: defaults.amount,
    internalCostBearer: "consortium" as const,
    internalCostQuantity: defaults.quantity,
    internalCostUnitAmount: defaults.unitAmount,
    internalCostAutoQuantity: defaults.autoQuantity,
  };
}

function isContentSubstitutionItem(item: Pick<DraftItem, "name" | "specification" | "internalCostEnabled">) {
  return item.internalCostEnabled && quotationInternalCostKind(item.name, item.specification) === "content-substitution";
}

function draftItemExpectedEarning(item: DraftItem) {
  const lineAmount = Math.max(0, item.quantity) * Math.max(0, item.unitPrice);
  return isContentSubstitutionItem(item)
    ? contentSubstitutionMargin(lineAmount, item.internalCostAmount, contentSubstitutionBaseEarningRate(item))
    : Math.floor(lineAmount * Math.max(0, item.earningRate) / 10) * 10;
}

function normalizedEquipmentKitName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-zê°€-í£]/g, "");
}

function draftItemLookupKeys(item: Pick<DraftItem, "productId" | "procurementNumber" | "name" | "specification">) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-zê°€-í£]/g, "");
  return [
    item.productId && item.productId !== CONSTRUCTION_PRODUCT_ID ? `product:${item.productId}` : "",
    item.procurementNumber ? `procurement:${normalize(item.procurementNumber)}` : "",
    item.name ? `item:${normalize(item.name)}|${normalize(item.specification)}` : "",
  ].filter(Boolean);
}

function procurementChannelFromText(...values: string[]) {
  const text = values.join(" ");
  if (/S\s*2\s*B/iu.test(text)) return "S2B";
  if (/ë””ì§€í„¸ì„œë¹„ìŠ¤ëª°/iu.test(text)) return "ë””ì§€í„¸ì„œë¹„ìŠ¤ëª°";
  if (/í˜ì‹ ì¥í„°/iu.test(text)) return "í˜ì‹ ì¥í„°";
  return "G2B";
}
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
function amountInKoreanLabel(value: number) {
  const small = ["", "ì‹­", "ë°±", "ì²œ"];
  const large = ["", "ë§Œ", "ì–µ", "ì¡°"];
  const digit = ["", "ì¼", "ì´", "ì‚¼", "ì‚¬", "ì˜¤", "ìœ¡", "ì¹ ", "íŒ”", "êµ¬"];
  let remaining = Math.max(0, Math.round(value));
  if (!remaining) return "ê¸ˆ ì˜ì›ì •";
  let result = "";
  let group = 0;
  while (remaining) {
    const part = remaining % 10_000;
    if (part) {
      let block = "";
      for (let position = 3; position >= 0; position -= 1) {
        const current = Math.floor(part / (10 ** position)) % 10;
        if (!current) continue;
        if (!(current === 1 && position > 0)) block += digit[current];
        block += small[position];
      }
      result = `${block}${large[group]}${result}`;
    }
    remaining = Math.floor(remaining / 10_000);
    group += 1;
  }
  return `ê¸ˆ ${result}ì›ì •`;
}

function procurementDisplay(item: DraftItem) {
  if (!item.procurement) return "-";
  return [item.procurementChannel || "G2B", item.procurementNumber].filter(Boolean).join(" Â· ") || "-";
}
const emptyDraft = (): Draft => ({
  organization: "",
  businessRound: 1,
  projectTitle: "",
  projectTitleTouched: false,
  quoteDate: today(),
  validUntil: "",
  status: "draft",
  executionType: "ì§ì˜",
  consortiumCompany: "",
  consortiumRate: 0,
  discountAmount: 0,
  extraAmount: 0,
  additionalInternalConstructionCost: 0,
  includeStamp: true,
  memo: "",
  items: [],
  budgets: [],
  settlementAdjustments: [],
});

function budgetOptionsForInstitution(option?: QuotationInstitutionOption): AuthoredQuotationBudget[] {
  if (!option) return [];
  const source = option.budgets?.length
    ? option.budgets
    : option.budgetType
      ? [{ budgetType: option.budgetType }]
      : [];
  const seen = new Set<string>();
  return source.flatMap((budget) => {
    const name = String(budget.budgetType || budget.budgetOriginalName || "").trim();
    if (!name) return [];
    const groupId = Number(budget.budgetGroupId);
    const budgetGroupId = Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
    const key = budgetGroupId
      ? `group:${budgetGroupId}`
      : `name:${name.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "")}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      key,
      budgetGroupId,
      name,
      institutionAmount: parseBudgetMoney(budget.budgetAmountOverride || budget.budgetInstitutionAmount || budget.budgetAmount || ""),
      allocatedAmount: 0,
    }];
  });
}

function mergeInstitutionRounds(options: QuotationInstitutionOption[]) {
  const rounds = new Map<number, QuotationInstitutionOption>();
  options.forEach((option) => {
    const current = rounds.get(option.businessRound);
    if (!current) {
      rounds.set(option.businessRound, { ...option, budgets: [...(option.budgets ?? [])] });
      return;
    }
    const combined = [...(current.budgets?.length ? current.budgets : current.budgetType ? [{ budgetType: current.budgetType }] : []),
      ...(option.budgets?.length ? option.budgets : option.budgetType ? [{ budgetType: option.budgetType }] : [])];
    rounds.set(option.businessRound, {
      ...current,
      budgetType: "",
      budgets: combined,
      executionType: current.executionType === "ì»¨ì†Œ" || option.executionType === "ì»¨ì†Œ" ? "ì»¨ì†Œ" : current.executionType,
      consortiumCompany: current.consortiumCompany?.trim() || option.consortiumCompany?.trim() || "",
    });
  });
  return Array.from(rounds.values()).sort((left, right) => left.businessRound - right.businessRound);
}

function institutionCollaborationDefaults(option?: QuotationInstitutionOption) {
  const consortiumCompany = String(option?.consortiumCompany ?? "").trim();
  if (option?.executionType === "ì»¨ì†Œ" && consortiumCompany) {
    return { executionType: "ì»¨ì†Œ" as const, consortiumCompany };
  }
  return { executionType: "ì§ì˜" as const, consortiumCompany: "" };
}

function draftForScope(scope?: QuotationScope): Draft {
  const budgetOptions = budgetOptionsForInstitution(scope);
  const collaboration = institutionCollaborationDefaults(scope);
  return {
    ...emptyDraft(),
    organization: scope?.organization ?? "",
    businessRound: scope?.businessRound ?? 1,
    projectTitle: scope?.budgetType ?? "",
    budgets: budgetOptions.length === 1 ? budgetOptions : [],
    ...collaboration,
  };
}

function draftFromQuotation(quote: AuthoredQuotation): Draft {
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    organization: quote.organization,
    businessRound: quote.businessRound,
    projectTitle: quote.projectTitle,
    projectTitleTouched: true,
    quoteDate: quote.quoteDate,
    validUntil: quote.validUntil,
    status: quote.status,
    executionType: quote.executionType,
    consortiumCompany: quote.consortiumCompany,
    consortiumRate: quote.consortiumRate,
    discountAmount: quote.discountAmount,
    extraAmount: quote.extraAmount,
    additionalInternalConstructionCost: quote.additionalInternalConstructionCost,
    includeStamp: quote.includeStamp,
    memo: quote.memo,
    budgets: quote.budgets,
    settlementAdjustments: quote.settlementAdjustments,
    items: quote.items.map(({ amount: _amount, expectedEarning: _earning, ...item }) => ({
      ...item,
      id: item.id,
    })),
  };
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "_") || "ë¯¸ì§€ì •";
}

function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, name);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anç]úêÚ$z{-®éÜj×¢&öGV7D–C¢""ÀĞ¢æÖS¢Æ–æRææÖRÀĞ¢7V6–f–6F–öã¢""ÀĞ¢&ö7W&VÖVçDçVÖ&W#¢""ÀĞ¢Ò’’¢G&gBæ—FV×2æf–ÇFW"‚†—FVÒ’Óâ—46öç7G'V7F–öä—FVÒ†—FVÒ’’æÖ‚†—FVÒ’Óâ‡°Ğ¢–C¢—FVÒæ–BÀĞ¢&öGV7D–C¢—FVÒç&öGV7D–BÀĞ¢æÖS¢—FVÒææÖRÀĞ¢7V6–f–6F–öã¢—FVÒç7V6–f–6F–öâÀĞ¢&ö7W&VÖVçDçVÖ&W#¢—FVÒç&ö7W&VÖVçDçVÖ&W"ÀĞ¢Ò’’—ĞĞ¢öä6Æ÷6S×²‚’Óâ6WD–×÷'DÖöFR†çVÆÂ—ĞĞ¢öäÇ“×¶Ç”W‡FW&æÅV÷FF–öçĞĞ¢óâÂFö7VÖVçBæ&öG’—ĞĞ Ğ¢¶WV—ÖVçD¶—DVF—F÷#òæ—FVÒæWV—ÖVçD¶—BbbÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—BÖVF—F÷"×6†VÆÂæò×&–çB"&öÆSÒ'&W6VçFF–öâ#àĞ¢Ç6V7F–öâ6Æ74æÖSÒ&WV—ÖVçBÖ¶—BÖVF—F÷""&öÆSÒ&F–Æör"&–ÖÖöFÃÒ'G'VR"&–ÖÆ&VÆÆVF'“Ò&WV—ÖVçBÖ¶—B×F—FÆR#àĞ¢Æ†VFW#àĞ¢ÆF—cãÆƒ2–CÒ&WV—ÖVçBÖ¶—B×F—FÆR#î«Y«ZÂÈKØ«‚«ZÎÈKÂöƒ3ãÇî«‹»;ÉXÉØB»h¹úÎÉŠ‚¹*BÈ‰¹øœ+~¸ºÉÈL+~¸º«º[ÂÊÊ	^ÙY«:ÙXNÉ©NÙYÂÙ(ºªÉØBËiN«ÙZ¸¸¸ºBãÂ÷ãÂöF—càĞ¢Æ'WGFöâG—SÒ&'WGFöâ"&–ÖÆ&VÃÒ.«Y«ZÂÈKØ«‚«ZÎÈK¸º¾«‹"öä6Æ–6³×²‚’Óâ6WDWV—ÖVçD¶—DVF—F÷"†çVÆÂ—Óì9sÂö'WGFöãàĞ¢Âö†VFW#àĞ¢ÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×Æâ#àĞ¢Ç7G&öæsî«‹»;‚«ZÎÈKÉXƒÂ÷7G&öæsàĞ¢ÆF—càĞ¢¶WV—ÖVçD¶—EÆç2æf–ÇFW"‚‡Æâ’ÓâÆâæ7F—fR’æÖ‚‡Æâ’Óâ°Ğ¢6öç7B6VÆV7FVBÒWV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—CòçFV×ÆFT–@Ğ¢òWV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—BçFV×ÆFT–BÓÓÒÆâæ–@Ğ¢¢&ööÆVâ‡Æâç7—7FVÕÆâbbWV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—CòçÆâÓÓÒÆâç7—7FVÕÆâ“°Ğ¢&WGW&âÆ'WGFöâ¶W“×·Æâæ–GÒG—SÒ&'WGFöâ"6Æ74æÖS×·6VÆV7FVBò&7F—fR"¢"'Òöä6Æ–6³×²‚’Óâ°Ğ¢–b‡6VÆV7FVB’&WGW&ã°Ğ¢–b‡v–æF÷ræ6öæf—&Ò‚.«‹»;‚Ù(ºªÉÙ‚È‰Ê	^«	.ÉØBÈJØ9ŞÙYÂ«ZÎÈKÉXÉËÎºÂ¸ºNÈ¹Â»h¹úÎÉŠÎ«˜ÎÉ©CòÊxÊ	ËiN«ÙYÂÙ(ºªÉØÉÊÊx¹
¸¸¸ºBâ"’’6VÆV7DWV—ÖVçD¶—EÆâ‡Æâ“°Ğ¢×Óç·ÆâææÖWÓÂö'WGFöãã°Ğ¢Ò—ĞĞ¢ÂöF—càĞ¢Ç7ãî«‹»;«	"Éé¸ù’Éè^º
R+rºª¹:È‰¹øœ+~¸ºÉÈL+~¸º«È‰Ê	R«¸ªSÂ÷7ãàĞ¢ÂöF—càĞ¢¶6äÖævTWV—ÖVçD¶—EÆç2bbÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×ÆâÖ7F–öç2#àĞ¢Ç7ãî«HºjÎÉé«ÙˆNÉêÂÙ(ºªœ+~È‰¹øœ+~¸º«º[Â«;^Éª’«‹»;ÉXÉËÎºÂÊÉê^ÙZÈ‰‚ÉèÈ«^¸¸¸ºBâ«‹ÊB«*ÎÊÉØ»	N¸ÎÊxÉX®È«^¸¸¸ºBãÂ÷7ãàĞ¢ÆF—càĞ¢Æ'WGFöâG—SÒ&'WGFöâ"F—6&ÆVC×¶WV—ÖVçD¶—EÆç56f–æwÒöä6Æ–6³×·6fT7W'&VçDWV—ÖVçD¶—D5ÆçÓâ²ÙˆNÉêÂ«ZÎÈKÈ8‚«‹»;ÉX‚ÊÉêSÂö'WGFöãàĞ¢¶WV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—BçFV×ÆFT–BbbÆ'WGFöâG—SÒ&'WGFöâ"F—6&ÆVC×¶WV—ÖVçD¶—EÆç56f–æwÒöä6Æ–6³×¶÷fW'w&—FT7W'&VçDWV—ÖVçD¶—EÆçÓîÙˆNÉêÂ«‹»;ÉX‚¸ÚîÉkNÉ;«‹Âö'WGFöãçĞĞ¢¶WV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—BçFV×ÆFT–BbbWV—ÖVçD¶—EÆç2æÆVæwF‚âbbÆ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖSÒ&FævW""F—6&ÆVC×¶WV—ÖVçD¶—EÆç56f–æwÒöä6Æ–6³×¶FVÆWFT7W'&VçDWV—ÖVçD¶—EÆçÓî«‹»;ÉX‚È*ŞÊ	ÃÂö'WGFöãçĞĞ¢ÂöF—càĞ¢ÂöF—cçĞĞ¢ÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—BÖwV–FR#îÈ‰¹øÉÛBÉÛ‚Ù(ºªÉØÉè^º
^ËŞÉy¸©BÉÊÊx¹	«:Â«*ÎÊÙZ«8NÉ˜W†6VÌ+uDb»8NË*ÉyÈIÎ¸©BÉé¸ù’Ê	ÎÉ›¹
¸¸¸ºBãÂöF—càĞ¢ÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×FööÆ&"#àĞ¢Ç7G&öæsîÈK»hÙ(ºª’¶WV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—BæÆ–æW2æÆVæwF‡Ş«	ÃÂ÷7G&öæsàĞ¢ÆF—cãÆÆ&VÃãÆ–çWBG—SÒ&6†V6¶&÷‚"6†V6¶VC×¶WV—ÖVçD¶—D†–FU¦W&÷Òöä6†ævS×²†WfVçB’Óâ6WDWV—ÖVçD¶—D†–FU¦W&ò†WfVçBçF&vWBæ6†V6¶VB—ÒóâÈ‰¹ø’ÈŠ«‹«‹ÂöÆ&VÃãÆ'WGFöâG—SÒ&'WGFöâ"öä6Æ–6³×²‚’Óâ6WD–×÷'DÖöFR‚'FV6†–ærÖ–G2"—Óî«Y«ZÂ«*ÎÊÈIÂ»h¹úÎÉŠN«‹Âö'WGFöããÆ'WGFöâG—SÒ&'WGFöâ"öä6Æ–6³×¶FDWV—ÖVçD¶—DÆ–æWÓâ²Ù(ºª’ËiN«Âö'WGFöããÂöF—càĞ¢ÂöF—càĞ¢ÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×F&ÆR×w&#àĞ¢ÇF&ÆSàĞ¢ÇF†VCãÇG#ãÇFƒäæóÂ÷FƒãÇFƒîÙ(º¨SÂ÷FƒãÇFƒîÈ‰¹ø“Â÷FƒãÇFƒî¸ºÉÈCÂ÷FƒãÇFƒî¸º«Â÷FƒãÇFƒî«ˆÉZÂ÷FƒãÇFƒîËiÎº
SÂ÷FƒãÇFƒî«HºjÃÂ÷FƒãÂ÷G#ãÂ÷F†VCàĞ¢ÇF&öG“ç¶WV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—BæÆ–æW2æÖ‚†Æ–æRÂ–æFW‚’Óâ°Ğ¢–b†WV—ÖVçD¶—D†–FU¦W&òbbÆ–æRçVçF—G’ÓÓÒ’&WGW&âçVÆÃ°Ğ¢&WGW&âÇG"¶W“×¶Æ–æRæ–GÒ6Æ74æÖS×¶Æ–æRçVçF—G’ÓÓÒò'¦W&ò"¢Æ–æRæ7W7FöÒò&7W7FöÒ"¢"'ÓàĞ¢ÇFCç¶–æFW‚²ÓÂ÷FCàĞ¢ÇFCãÆ–çWBfÇVS×¶Æ–æRææÖWÒöä6†ævS×²†WfVçB’ÓâWFFTWV—ÖVçD¶—DÆ–æR†Æ–æRæ–BÂ²æÖS¢WfVçBçF&vWBçfÇVRÒ—ÒÆ6V†öÆFW#Ò.Ù(ºªº¨RÉè^º
R"&–ÖÆ&VÃ×¶G¶–æFW‚²Ş»(‚Ù(ºªº¨VÒóãÂ÷FCàĞ¢ÇFCãÆ–çWBG—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#"fÇVS×¶Æ–æRçVçF—G—Òöä6†ævS×²†WfVçB’ÓâWFFTWV—ÖVçD¶—DÆ–æR†Æ–æRæ–BÂ²VçF—G“¢ÖF‚æÖ‚ƒÂÖF‚ç&÷VæB„çVÖ&W"†WfVçBçF&vWBçfÇVR’ÇÂ’’Ò—Ò&–ÖÆ&VÃ×¶G¶Æ–æRææÖRÇÂG¶–æFW‚²Ş»(‚Ù(ºª–ÒÈ‰¹ø–ÒóãÂ÷FCàĞ¢ÇFCãÇ6VÆV7BfÇVS×¶Æ–æRçVæ—GÒöä6†ævS×²†WfVçB’ÓâWFFTWV—ÖVçD¶—DÆ–æR†Æ–æRæ–BÂ²Væ—C¢WfVçBçF&vWBçfÇVRÒ—Ò&–ÖÆ&VÃ×¶G¶Æ–æRææÖRÇÂG¶–æFW‚²Ş»(‚Ù(ºª–Ò¸ºÉÈFÓãÆ÷F–öãäTÂö÷F–öããÆ÷F–öãå4UCÂö÷F–öããÆ÷F–öãî«	ÃÂö÷F–öããÆ÷F–öãîÈ¹ÓÂö÷F–öããÆ÷F–öãî¸ÈÂö÷F–öããÂ÷6VÆV7CãÂ÷FCàĞ¢ÇFCãÄf÷&ÖGFVDÖöæW”–çWBfÇVS×¶Æ–æRçVæ—E&–6WÒöä6†ævS×²‡Væ—E&–6R’ÓâWFFTWV—ÖVçD¶—DÆ–æR†Æ–æRæ–BÂ²Væ—E&–6RÒ—ÒÆ&VÃ×¶G¶Æ–æRææÖRÇÂG¶–æFW‚²Ş»(‚Ù(ºª–Ò¸º«ÒóãÂ÷FCàĞ¢ÇFCç·vöâæf÷&ÖB†Æ–æRçVçF—G’¢Æ–æRçVæ—E&–6R—ŞÉ¹Â÷FCàĞ¢ÇFCç¶Æ–æRçVçF—G’âò.ØúÎÙZ‚"¢.Ê	ÎÉ›‚'ÓÂ÷FCàĞ¢ÇFCãÆ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖSÒ'&VÖ÷fR"öä6Æ–6³×²‚’Óâ°Ğ¢6öç7BWV—ÖVçD¶—C¢—'74WV—ÖVçD¶—BÒ²ââæWV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—BÂÆ–æW3¢WV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—BæÆ–æW2æf–ÇFW"‚†—FVÒ’Óâ—FVÒæ–BÓÒÆ–æRæ–B’Ó°Ğ¢6WDWV—ÖVçD¶—DVF—F÷"‡²ââæWV—ÖVçD¶—DVF—F÷"Â—FVÓ¢²ââæWV—ÖVçD¶—DVF—F÷"æ—FVÒÂVæ—E&–6S¢—'74WV—ÖVçD¶—EF÷FÂ†WV—ÖVçD¶—B’ÂWV—ÖVçD¶—BÒÒ“°Ğ¢×ÓîÈ*ŞÊ	ÃÂö'WGFöããÂ÷FCàĞ¢Â÷G#ã°Ğ¢Ò—ÓÂ÷F&öG“àĞ¢Â÷F&ÆSàĞ¢ÂöF—càĞ¢ÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×F÷FÂ#ãÇ7ãî«*ÎÊ+~»8NË*ÉyØúÎÙZ¹	¸©B«Y«ZÂÙZ«8CÂ÷7ããÇ7G&öæsç·vöâæf÷&ÖB†—'74WV—ÖVçD¶—EF÷FÂ†WV—ÖVçD¶—DVF—F÷"æ—FVÒæWV—ÖVçD¶—B’—ŞÉ¹Â÷7G&öæsãÂöF—càĞ¢Æfö÷FW#ãÆ'WGFöâG—SÒ&'WGFöâ"öä6Æ–6³×²‚’Óâ6WDWV—ÖVçD¶—DVF—F÷"†çVÆÂ—ÓîËzÈhÃÂö'WGFöããÆ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖSÒ'&–Ö'’"öä6Æ–6³×¶Ç”WV—ÖVçD¶—GÓîÉÛB«ZÎÈKÉËÎºÂ«*ÎÊÉyÊÉª“Âö'WGFöããÂöfö÷FW#àĞ¢Â÷6V7F–öãàĞ¢ÂöF—cçĞĞ Ğ¢·&–çE÷'FÅ&VG’bb–çFW&æÅ&W÷'D÷Vâò7&VFU÷'FÂƒÇ6V7F–öâ6Æ74æÖSÒ'V÷FF–öâ×&–çB×7F6²V÷FF–öâ×&–çB×÷'FÂ&–çBÖöæÇ’"&–ÖÆ&VÃÒ.«H«;^ÈIÂÊ	ÎËiÎÉª’«*ÎÊÈIÂÉÛÈxN»;‚#àĞ¢·&–çD—FVÕvW2æÖ‚‡vRÂvT–æFW‚’Óâ°Ğ¢6öç7BvT—FV×2ÒvRç&÷w3°Ğ¢6öç7B—4f—'7EvRÒvT–æFW‚ÓÓÒ°Ğ¢6öç7B—4Æ7EvRÒvT–æFW‚ÓÓÒ&–çD—FVÕvW2æÆVæwF‚Ò°Ğ¢&WGW&âÆ'F–6ÆR6Æ74æÖSÒ'V÷FF–öâ×&–çB×6†VWB"¶W“×¶&–çB×vRÒG·vT–æFW‡ÖÓàĞ¢¶—4f—'7EvRòÃàĞ¢Æ†VFW"6Æ74æÖSÒ'V÷FF–öâ×&–çBÖ†VFW"#àĞ¢Æ–Ör7&3Ò"÷v†—§§WÖÆövòçær"ÇCÒ%t„•¥¥U"óàĞ¢Æƒî«*ÂÊÈIÃÂöƒàĞ¢ÆFÃãÆGCî«*ÎÊ»(Ù‹ƒÂöGCãÆFCç¶G&gBçV÷FTçVÖ&W"ÇÂ.ÊÉêRÈ¹Â»	Î«ˆ’'ÓÂöFCãÆGCîÉéÈKÉÛÃÂöGCãÆFCç¶G&gBçV÷FTFFWÓÂöFCãÂöFÃàĞ¢Âö†VFW#àĞ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâ×&–çB×'F–W2#àĞ¢Ç6V7F–öããÆƒ#î»	¾¸©B»hCÂöƒ#ãÆFÃãÆGCîÈ‰ÈºÂöGCãÆFCç¶G&gBæ÷&væ—¦F–öâÇÂ.ºûÊxÊ	R'ÓÂöFCãÆGCî¸»N¸»ÉéÂöGCãÆFCî¸»N¸»Éé«xÙYƒÂöFCãÆGCî«*ÎÊº¨SÂöGCãÆFCç¶G&gBç&ö¦V7EF—FÆRÇÂ.Ê	ÎÙ(‚«;^«ˆ’'ÓÂöFCãÆGCîÉÊÙª«‹«CÂöGCãÆFCç¶G&gBçfÆ–EVçF–ÂòG¶G&gBçfÆ–EVçF–ÇŞ«˜ÎÊx¢.«*ÎÊÉÛÎºÎ»hØK3ÉÛÂ'ÓÂöFCãÆGCî¸*Ù(Ê«CÂöGCãÆFCî»	ÎÊ;ÂÙ¸BÉÛÎÊ	RÙ‰ÉÙƒÂöFCãÂöFÃãÂ÷6V7F–öãàĞ¢Ç6V7F–öããÆƒ#î«;^«ˆÉéÂöƒ#ãÆFÃãÆGCîÈ8Ù‹ƒÂöGCãÆFCîÊ;ÎÈ¹ŞÙ¨ÎÈ*ÂÉÈNÊhÉxSÂöFCãÆGCîÈ*ÎÉx^Éé»(Ù‹ƒÂöGCãÆFCã#ƒbÓƒbÓ3CSCÂöFCãÆGCî¸ÈÙÎÉéÂöGCãÆFCî»	^É¹ÈIÓÂöFCãÆGCîÊ;ÎÈhÃÂöGCãÆFCî«+Ş«‹¸øBÙY¸*È¹ÂÙY¸*¸ÈºÂ“CrÂN¸ù’#Ù‹‚Ù(ŞÈ+¸ù’“ÂöFCãÆGCîÉx^Ø9Ì+~Ê(^ºª“ÂöGCãÆFCî¸øNºzB»òÈhÎºzNÉxR+rÊ	^»;NØk^ÈºÉxRòË»NÙ:ØK»òÊ;Î»8Éê^Ë™‚«;^«ˆ“ÂöFCãÂöFÃãÂ÷6V7F–öãàĞ¢ÂöF—càĞ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâ×&–çB×F÷FÂ#ãÇ7ãî«*ÎÊ«ˆÉZ…dBØúÎÙZ‚+rÊ¸ºÎÈ‰È‰º8Â»	Éˆ“Â÷7ããÆ#ç¶Ö÷VçD–ä¶÷&VäÆ&VÂ†çVÖ&W'2çF÷FÂ—ÓÂö#ãÇ7G&öæsç·vöâæf÷&ÖB†çVÖ&W'2çF÷FÂ—ŞÉ¹Â÷7G&öæsãÂöF—càĞ¢Âóâ¢Æ†VFW"6Æ74æÖSÒ'V÷FF–öâ×&–çBÖ6öçF–çVF–öâ#ãÆ–Ör7&3Ò"÷v†—§§WÖÆövòçær"ÇCÒ%t„•¥¥U"óãÆF—cãÆƒî«*ÎÊÈIÂÙ(ºª’«8NÈhÓÂöƒãÇç¶G&gBæ÷&væ—¦F–öçÒ+r¶G&gBæ'W6–æW75&÷VæGŞË
ƒÂ÷ãÂöF—cãÇ7ãç·vT–æFW‚²Òò·&–çD—FVÕvW2æÆVæwF‡ÓÂ÷7ããÂö†VFW#çĞĞ¢ÇF&ÆR6Æ74æÖSÒ'V÷FF–öâ×&–çBÖ—FV×2#àĞ¢Æ6öÆw&÷WãÆ6öÂ6Æ74æÖSÒ&æò"óãÆ6öÂ6Æ74æÖSÒ&æÖR"óãÆ6öÂ6Æ74æÖSÒ'7V2"óãÆ6öÂ6Æ74æÖSÒ'&ö7W&VÖVçB"óãÆ6öÂ6Æ74æÖSÒ'VçF—G’"óãÆ6öÂ6Æ74æÖSÒ'Væ—B"óãÆ6öÂ6Æ74æÖSÒ'&–6R"óãÆ6öÂ6Æ74æÖSÒ&Ö÷VçB"óãÆ6öÂ6Æ74æÖSÒ&æ÷FR"óãÂö6öÆw&÷WàĞ¢ÇF†VCãÇG#ãÇFƒäæóÂ÷FƒãÇFƒîÙ(º¨SÂ÷FƒãÇFƒî«yÎ«*“Â÷FƒãÇFƒîÈ¹Ş»8N»(Ù‹ƒÂ÷FƒãÇFƒîÈ‰¹ø“Â÷FƒãÇFƒî¸ºÉÈCÂ÷FƒãÇFƒî¸º«Â÷FƒãÇFƒî«ˆÉZÂ÷FƒãÇFƒî»˜N«:Â÷FƒãÂ÷G#ãÂ÷F†VCàĞ¢ÇF&öG“ç·vT—FV×2æÖ‚†—FVÒÂ&÷t–æFW‚’Óâ°Ğ¢6öç7B—FVÔ–æFW‚ÒvRç7F'D–æFW‚²&÷t–æFWƒ°Ğ¢&WGW&âÇG"¶W“×¶—FVÓòæ–BÇÂV×G’ÒG¶—FVÔ–æFW‡ÖÓãÇFCç¶—FVÒò—FVÔ–æFW‚²¢"'ÓÂ÷FCãÇFCç¶—FVÓòææÖRÇÂ"'ÓÂ÷FCãÇFCç¶—FVÓòç7V6–f–6F–öâÇÂ"'ÓÂ÷FCãÇFCç¶—FVÒò&ö7W&VÖVçDF—7Æ’†—FVÒ’¢"'ÓÂ÷FCãÇFCç¶—FVÓòçVçF—G’ÇÂ"'ÓÂ÷FCãÇFCç¶—FVÓòçVæ—BÇÂ"'ÓÂ÷FCãÇFCç¶—FVÒò—FVÒæ6ö×Æ–ÖVçF'’ò.ºËNÈ8"¢G·vöâæf÷&ÖB†—FVÒçVæ—E&–6R—ŞÉ¹¢"'ÓÂ÷FCãÇFCç¶—FVÒò—FVÒæ6ö×Æ–ÖVçF'’ò.ºËNÈ8"¢G·vöâæf÷&ÖB†—FVÒçVçF—G’¢—FVÒçVæ—E&–6R—ŞÉ¹¢"'ÓÂ÷FCãÇFCç¶—FVÒò÷WGWDæ÷FR†—FVÒ’¢"'ÓÂ÷FCãÂ÷G#ã°Ğ¢Ò—ÓÂ÷F&öG“àĞ¢Â÷F&ÆSàĞ¢¶—4Æ7EvRòÆF—b6Æ74æÖSÒ'V÷FF–öâ×&–çBÖ6Æ÷6–ær#àĞ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâ×&–çBÖ&÷GFöÒ#àĞ¢Ç6V7F–öããÆƒ#î«*ÎÊÊ«B»òØ«ÉÛNÈ*ÎÙZÓÂöƒ#ãÆFÃãÆGCî«*ÎÊÉÊÙª«‹«CÂöGCãÆFCç¶G&gBçfÆ–EVçF–ÂòG¶G&gBçfÆ–EVçF–ÇŞ«˜ÎÊx¢.«*ÎÊÉÛÎºÎ»hØK3ÉÛÂ'ÓÂöFCãÆGCî¸*Ù(‚»òÈJNË™ƒÂöGCãÆFCî»	ÎÊ;Î«‹«H«;ÂÉÛÎÊ	RÙ‰ÉÙ‚Ù¸BÊxNÙh“ÂöFCãÆGCî¸È«ˆ‚Êx«ˆ“ÂöGCãÆFCî»	ÎÊ;Î«‹«HÉÙ‚Êx«ˆ’Ê«NÉy¹KºhCÂöFCãÆGCîÙYÉé»;NÊiÓÂöGCãÆFCî¸*Ù(‚É˜Nº8ÎÉÛÎºÎ»hØK¸XCÂöFCãÆGCî»˜N«:ÂöGCãÆFCîÙÎÈ¹Â¸º«¸©BdL+~ÉÛÎ»	‚È‰È‰º8ÂØúÎÙZ‚ÂÊ¸ºÎÈ‰È‰º8Î¸©BÙZ«8NÉy»8N¸øB»	ÉˆÂöFCãÆGCî¸»N¸»“ÂöGCãÆFCîÉÈNÊhÉxRÉˆÉx^ØÈÂöFCãÆGCîÉX¸+CÂöGCãÆFCç¶G&gBæÖVÖòÇÂ.»;‚«*ÎÊÈIÎ¸©B«H«;^ÈIÂÊ	ÎËiÎÉªÉè^¸¸¸ºBâ'ÓÂöFCãÂöFÃãÂ÷6V7F–öãàĞ¢Ç6V7F–öããÆƒ#î«ˆÉZÉ©NÉ[ÓÂöƒ#ãÆFÃãÆGCîÙ(ºª’ÙZ«8B…dBØúÎÙZ‚“ÂöGCãÆFCç·vöâæf÷&ÖB†çVÖ&W'2ç7V'F÷FÂ—ŞÉ¹ÂöFCãÆGCîÊ¸ºÎÈ‰È‰º8ÃÂöGCãÆFCç·vöâæf÷&ÖB†çVÖ&W'2ç&ö7W&VÖVçDfVR—ŞÉ¹ÂöFCãÆGCîÙZÉÛƒÂöGCãÆFCç¶G&gBæF—66÷VçDÖ÷VçBòG·vöâæf÷&ÖB†G&gBæF—66÷VçDÖ÷VçB—ŞÉ¹¢"Ò'ÓÂöFCãÆGCîËiN«»˜NÉª“ÂöGCãÆFCç¶G&gBæW‡G&Ö÷VçBòG·vöâæf÷&ÖB†G&gBæW‡G&Ö÷VçB—ŞÉ¹¢"Ò'ÓÂöFCãÆGCî«;^«ˆ«ÉZÂöGCãÆFCç·vöâæf÷&ÖB†çVÖ&W'2ç7WÇ’—ŞÉ¹ÂöFCãÆGCî»h««Ë™ÈKƒÂöGCãÆFCç·vöâæf÷&ÖB†çVÖ&W'2çF‚—ŞÉ¹ÂöFCãÆGCîËYÎÊ(RÙZ«8CÂöGCãÆFCç·vöâæf÷&ÖB†çVÖ&W'2çF÷FÂ—ŞÉ¹ÂöFCãÂöFÃãÂ÷6V7F–öãàĞ¢ÂöF—càĞ¢Æfö÷FW"6Æ74æÖSÒ'V÷FF–öâ×&–çB×6–væGW&R#ãÆF—cîÉÈNÉ˜«	ÉÛB«*ÎÊÙZ¸¸¸ºBãÆ'"óãÆ#ç¶G&gBçV÷FTFFRç&WÆ6R‚òÒƒõÆB²’ÒƒõÆB²’BòÂ.¸XBCÉ¹BC.ÉÛÂ"—ÓÂö#ãÂöF—cãÆF—cãÇ7G&öæsîÊ;ÎÈ¹ŞÙ¨ÎÈ*ÂÉÈNÊhÉxSÆ'"óî¸ÈÙÎÉÛNÈ*Âfæ'7²fæ'7¾»	RÉ¹ÈIÓÂ÷7G&öæsç¶G&gBæ–æ6ÇVFU7F×bbÆ–Ör7&3Ò"÷v†—§§W×6VÂçær"ÇCÒ.ÉÈNÊhÉxRÊxÉÛ‚"óçÓÂöF—cãÂöfö÷FW#àĞ¢ÂöF—câ¢Æfö÷FW"6Æ74æÖSÒ'V÷FF–öâ×&–çB×vRÖÖ÷&R#î¸ºNÉØÂØéÉÛNÊxÉyÙ(ºªÉÛB«8NÈhŞ¹
¸¸¸ºBãÂöfö÷FW#çĞĞ¢Âö'F–6ÆSã°Ğ¢Ò—ĞĞ¢¶WV—ÖVçD¶—E&–çEvW2æÖ‚†¶—EvRÂ¶—EvT–æFW‚’ÓâÆ'F–6ÆR6Æ74æÖSÒ'V÷FF–öâ×&–çB×6†VWBWV—ÖVçBÖ¶—B×&–çB×6†VWB"¶W“×¶¶—B×&–çBÒG¶¶—EvRæ—FVÒæ–GÒÒG¶¶—EvRçvWÖÓàĞ¢Æ†VFW"6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×&–çBÖ†VFW"#àĞ¢ÆF—b6Æ74æÖSÒ&—'72×&–çBÖ'&æB#âÊ;ÂÉyÉkNØÊÈªCÂöF—càĞ¢ÆF—cãÆƒî«Y«ZÂÈK‚»h«*ÂÊÂöƒãÇç¶G&gBæ÷&væ—¦F–öâÇÂ.ºûÊxÊ	R'ÓÂ÷ãÂöF—càĞ¢ÆFÃãÆGCî«*ÎÊ»(Ù‹ƒÂöGCãÆFCç¶G&gBçV÷FTçVÖ&W"ÇÂ.ÊÉêRÈ¹Â»	Î«ˆ’'ÓÂöFCãÆGCîÉéÈKÉÛÃÂöGCãÆFCç¶G&gBçV÷FTFFWÓÂöFCãÂöFÃàĞ¢Âö†VFW#àĞ¢¶¶—EvRçvRÓÓÒbbÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×&–çB×'F–W2#àĞ¢Ç6V7F–öããÆƒ#î»	¾¸©B»hCÂöƒ#ãÆFÃãÆGCîÈ‰ÈºÂöGCãÆFCç¶G&gBæ÷&væ—¦F–öçÓÂöFCãÆGCî«*ÎÊº¨SÂöGCãÆFCç¶G&gBç&ö¦V7EF—FÆRÇÂ.Ê	ÎÙ(‚«;^«ˆ’'ÓÂöFCãÆGCî«8NÉ[Ş«ZÎ»hCÂöGCãÆFCîÈ‰ÉÙ«8NÉ[ÓÂöFCãÆGCî¸*Ù(Ê«CÂöGCãÆFCî»	ÎÊ;ÂÙ¸BÉÛÎÊ	RÙ‰ÉÙƒÂöFCãÂöFÃãÂ÷6V7F–öãàĞ¢Ç6V7F–öããÆƒ#î«;^«ˆÉéÂöƒ#ãÆFÃãÆGCîÈ8Ù‹ƒÂöGCãÆFCç´•%55ô4ôÕå’ææÖWÓÂöFCãÆGCîÈ*ÎÉx^Éé»(Ù‹ƒÂöGCãÆFCç´•%55ô4ôÕå’æ'W6–æW74çVÖ&W'ÓÂöFCãÆGCî¸ÈÙÎÉéÂöGCãÆFCç´•%55ô4ôÕå’ç&W&W6VçFF—fWÓÂöFCãÆGCîÊ;ÎÈhÃÂöGCãÆFCç´•%55ô4ôÕå’æFG&W77ÓÂöFCãÂöFÃãÂ÷6V7F–öãàĞ¢ÂöF—cçĞĞ¢ÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×&–çBÖ&æB#îÉyÉkNØÊÈªB«Y«ZÂÈK»h¸+NÉzÓÂöF—càĞ¢ÇF&ÆR6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×&–çB×F&ÆR#àĞ¢Æ6öÆw&÷WãÆ6öÂ6Æ74æÖSÒ&æò"óãÆ6öÂ6Æ74æÖSÒ&æÖR"óãÆ6öÂ6Æ74æÖSÒ'VçF—G’"óãÆ6öÂ6Æ74æÖSÒ'Væ—B"óãÆ6öÂ6Æ74æÖSÒ'&–6R"óãÆ6öÂ6Æ74æÖSÒ&Ö÷VçB"óãÆ6öÂ6Æ74æÖSÒ&æ÷FR"óãÂö6öÆw&÷WàĞ¢ÇF†VCãÇG#ãÇFƒäæóÂ÷FƒãÇFƒîÙ(º¨SÂ÷FƒãÇFƒîÈ‰¹ø“Â÷FƒãÇFƒî¸ºÉÈCÂ÷FƒãÇFƒî¸º«Â÷FƒãÇFƒî«ˆÉZÂ÷FƒãÇFƒî»˜N«:Â÷FƒãÂ÷G#ãÂ÷F†VCàĞ¢ÇF&öG“ç¶¶—EvRæÆ–æW2æÖ‚†Æ–æRÂÆ–æT–æFW‚’ÓâÇG"¶W“×¶Æ–æRæ–GÓãÇFCç¶¶—EvRç7F'D–æFW‚²Æ–æT–æFW‚²ÓÂ÷FCãÇFCç¶Æ–æRææÖWÓÂ÷FCãÇFCç¶Æ–æRçVçF—G—ÓÂ÷FCãÇFCç¶Æ–æRçVæ—GÓÂ÷FCãÇFCç¶¶—EvRæ—FVÒæ6ö×Æ–ÖVçF'’ò.ºËNÈ8"¢G·vöâæf÷&ÖB†Æ–æRçVæ—E&–6R—ŞÉ¹ÓÂ÷FCãÇFCç¶¶—EvRæ—FVÒæ6ö×Æ–ÖVçF'’ò.ºËNÈ8"¢G·vöâæf÷&ÖB†Æ–æRçVçF—G’¢Æ–æRçVæ—E&–6R—ŞÉ¹ÓÂ÷FCãÇFCç¶¶—EvRæ—FVÒæ6ö×Æ–ÖVçF'’ò.ºËNÈ8Ê	Î«;R"¢"'ÓÂ÷FCãÂ÷G#â—ÓÂ÷F&öG“àĞ¢Â÷F&ÆSàĞ¢¶¶—EvRçvRÓÓÒ¶—EvRçvW2bbÆF—b6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×&–çB×F÷FÂ#ãÇ7ãç¶¶—EvRæ—FVÒæ6ö×Æ–ÖVçF'’ò.Ê	Î«;RÊ«B"¢.ÙZ«8N«ˆÉZ…dBØúÎÙZ‚’'ÓÂ÷7ããÇ7G&öæsç¶¶—EvRæ—FVÒæ6ö×Æ–ÖVçF'’ò.ºËNÈ8Ê	Î«;R"¢G·vöâæf÷&ÖB†—'74WV—ÖVçD¶—EF÷FÂ†¶—EvRæ—FVÒæWV—ÖVçD¶—B’—ŞÉ¹ÓÂ÷7G&öæsãÂöF—cçĞĞ¢Æfö÷FW"6Æ74æÖSÒ&WV—ÖVçBÖ¶—B×&–çBÖfö÷FW"#ãÇ7ãç´•%55ô4ôÕå’ææÖWÒ+r»;‚ÈK»h«*ÎÊÉØ»;‚«*ÎÊÈIÎÉ˜ÙZ«¹‚Ê	ÎËiÎ¹
¸¸¸ºBãÂ÷7ãç¶¶—EvRçvRÓÓÒ¶—EvRçvW2bbÆ–Ör7&3Ò"ö—'72×6VÂçær"ÇCÒ.ÉyÉkNØÊÈªBÊxÉÛ‚"óçÓÆ#î»8NË*‚¶¶—EvT–æFW‚²ÓÂö#ãÂöfö÷FW#àĞ¢Âö'F–6ÆSâ—ĞĞ¢Â÷6V7F–öãâÂFö7VÖVçBæ&öG’’¢çVÆÇĞĞ¢ÂöF—càĞ¢ÂöF—cçĞĞ¢Â÷6V7F–öãã°Ğ§ĞĞ