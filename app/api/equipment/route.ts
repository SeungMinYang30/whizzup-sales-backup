import {
  accessErrorResponse,
  requireApprovedMember,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import { ensureCampaignsReady } from "../../../lib/campaign-store";
import {
  ensureEquipmentReady,
  reconcileEquipmentProjectsForBusiness,
  syncEquipmentItemsFromProgressSchedule,
} from "../../../lib/equipment-store";
import { ensureMapReady } from "../../../lib/map-store";
import { clean, ensureRecordsReady } from "../../../lib/records-store";
import {
  readProductSupplySettingMap,
  readProductVendorLinkMap,
  type ProductSupplySetting,
  type ProductVendorLink,
} from "../../../lib/product-vendor-links";
import {
  ensureBudgetNamesReady,
  linkBudgetRequestRecord,
  linkBudgetNameEntity,
  normalizeBudgetNameKey,
  resolveBudgetRecordMetadata,
} from "../../../lib/budget-names";
import {
  isCompletedAwardStage,
  normalizeAwardStage,
} from "../../../lib/sales-taxonomy";
import {
  analyticsBusinessRoundKey,
} from "../../../lib/analytics-business-rounds";
import {
  calculateEquipmentFinance,
  equipmentSettlementQuantity,
  resolveEquipmentSnapshotRate,
} from "../../../lib/equipment-finance";
import {
  calculateRegisteredQuote,
  isRegisteredQuoteItemAmount,
} from "../../../lib/registered-quote";
import {
  PRODUCT_CATALOG,
  type ProductCatalogItem,
} from "../../../lib/product-catalog";
import { resolveProcurementFeeRate } from "../../../lib/procurement-product";
import {
  isPartnerOnlyProduct,
  normalizeProductSupplyType,
} from "../../../lib/product-supply-classification";

export const dynamic = "force-dynamic";

const projectStatuses = [
  "ì œì•ˆ",
  "ê²¬ì ",
  "ìˆ˜ì£¼",
  "ë°œì£¼",
  "ì„¤ì¹˜ ì¤‘",
  "ì„¤ì¹˜ ì™„ë£Œ",
  "ë³´ë¥˜",
  "ì·¨ì†Œ",
];
const itemStatuses = [
  "ì œì•ˆ ì˜ˆì •",
  "ì œì•ˆ",
  "ê²¬ì ",
  "ìˆ˜ì£¼",
  "ë°œì£¼",
  "ì„¤ì¹˜ ì¤‘",
  "ì„¤ì¹˜ ì™„ë£Œ",
  "ë¯¸ìˆ˜ì£¼",
  "ì·¨ì†Œ",
];
const protectionStatuses = ["ì‹ ì²­ í•„ìš”", "ì‹ ì²­ ì™„ë£Œ"];
const priceStatuses = [
  "ê¸ˆì•¡ ë¯¸ìž…ë ¥",
  "ìž…ë ¥ ì™„ë£Œ",
  "ë¬´ìƒ ì œê³µ",
  "ê³„ì•½ê¸ˆì•¡ì— í¬í•¨",
  "ì„œë¹„ìŠ¤ í’ˆëª©",
];

async function readCanonicalProductMap(
  d1: Awaited<ReturnType<typeof ensureEquipmentReady>>,
) {
  let products: ProductCatalogItem[] = PRODUCT_CATALOG;
  try {
    const row = await d1
      .prepare("SELECT value FROM app_settings WHERE key = 'product_catalog_v1'")
      .first<{ value: string }>();
    const stored = row?.value ? JSON.parse(row.value) : null;
    if (Array.isArray(stored) && stored.length) {
      products = stored
        .filter(
          (item): item is ProductCatalogItem =>
            Boolean(
              item &&
                typeof item === "object" &&
                clean((item as Record<string, unknown>).id) &&
                clean((item as Record<string, unknown>).name),
            ),
        )
        .map((item) => ({
          ...item,
          id: clean(item.id),
          name: clean(item.name),
        }));
    }
  } catch {
    products = PRODUCT_CATALOG;
  }
  return new Map(products.map((product) => [product.id, product]));
}

function cleanStatus(value: unknown, values: string[], fallback: string) {
  const requested = clean(value);
  return values.includes(requested) ? requested : fallback;
}

function cleanQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(999_999, Math.max(0, Math.round(quantity)));
}

function cleanSignedAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.min(100_000_000_000, Math.max(-100_000_000_000, Math.round(amount)));
}

function cleanProcurementFeeRate(
  value: unknown,
  source?: Record<string, unknown>,
  catalogProduct?: ProductCatalogItem,
) {
  return resolveProcurementFeeRate(
    value,
    source?.productName,
    source?.specification,
    source?.catalogNote,
    source?.notes,
    catalogProduct?.name,
    catalogProduct?.specification,
    catalogProduct?.note,
    catalogProduct?.reference,
  );
}

function cleanPriceStatus(value: unknown, unitPrice: number | null) {
  const requested = cleanStatus(value, priceStatuses, "");
  if (requested) return requested;
  return Number(unitPrice ?? 0) > 0 ? "ìž…ë ¥ ì™„ë£Œ" : "ê¸ˆì•¡ ë¯¸ìž…ë ¥";
}

function cleanConsortiumSettlement(payload: Record<string, unknown>) {
  const executionType = clean(payload.executionType) === "ì»¨ì†Œ" ? "ì»¨ì†Œ" : "ì§ì˜";
  const commissionInputType =
    clean(payload.commissionInputType) === "amount" ? "amount" : "rate";
  const optionalNumber = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const requestedRate = optionalNumber(payload.commissionRate);
  const requestedConsortiumRate = optionalNumber(
    payload.consortiumCommissionRate,
  );
  const requestedAmount = optionalNumber(payload.consortiumPaymentAmount);
  return {
    executionType,
    commissionInputType,
    commissionRate:
      requestedRate !== null
        ? Math.min(1, Math.max(0, requestedRate))
        : null,
    consortiumCommissionRate:
      executionType === "ì»¨ì†Œ" && commissionInputType === "rate" &&
      requestedConsortiumRate !== null
        ? Math.min(1, Math.max(0, requestedConsortiumRate))
        : null,
    consortiumPaymentAmount:
      executionType === "ì»¨ì†Œ" && commissionInputType === "amount" &&
      requestedAmount !== null
        ? Math.min(100_000_000_000, Math.max(0, Math.round(requestedAmount)))
        : null,
  };
}

function cleanSupplySettlement(
  payload: Record<string, unknown>,
  catalogSupply?: ProductSupplySetting,
  existing?: Record<string, unknown>,
  productIdentity?: { catalogItemId?: unknown; productName?: unknown },
) {
  const settlement = cleanConsortiumSettlement(payload);
  const hasRequestedSupplyType = Object.prototype.hasOwnProperty.call(
    payload,
    "supplyType",
  );
  const requestedSupplyType =
    (hasRequestedSupplyType
      ? clean(payload.supplyType) === "direct"
      : catalogSupply
        ? catalogSupply.supplyType === "direct"
        : clean(existing?.supply_type) === "direct")
      ? "direct"
      : "partner";
  const supplyType = normalizeProductSupplyType({
    ...productIdentity,
    supplyType: requestedSupplyType,
  });
  const partnerOnly = isPartnerOnlyProduct(productIdentity ?? {});
  const requestedMargin = optionalRate(payload.marginRate);
  const existingMargin = optionalRate(existing?.margin_rate);
  const hasRequestedMarginRate = Object.prototype.hasOwnProperty.call(
    payload,
    "marginRate",
  );
  const hasRequestedCommissionRate = Object.prototype.hasOwnProperty.call(
    payload,
    "commissionRate",
  );
  const marginRate =
    supplyType === "direct"
      ? resolveEquipmentSnapshotRate({
          requestedProvided: hasRequestedMarginRate,
          requestedRate: requestedMargin,
          catalogRate: catalogSupply?.marginRate,
          existingRate: existingMargin,
        })
      : null;
  const commissionRate =
    supplyType === "partner"
      ? resolveEquipmentSnapshotRate({
          requestedProvided: hasRequestedCommissionRate,
          requestedRate: settlement.commissionRate,
          existingRate:
            optionalRate(existing?.commission_rate) ??
            (partnerOnly
              ? optionalRate(existing?.margin_rate) ?? catalogSupply?.marginRate
              : null),
        })
      : null;
  return {
    ...settlement,
    supplyType,
    commissionRate,
    marginRate,
  };
}

function optionalRate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(1, parsed);
}

function inferItemStatus(item: Record<string, unknown>) {
  const requested = cleanStatus(item.status, itemStatuses, "");
  if (requested) return requested;
  const awardedQty = cleanQuantity(item.awardedQty);
  const installedQty = cleanQuantity(item.installedQty);
  if (installedQty > 0 && awardedQty > 0) {
    return installedQty >= awardedQty ? "ì„¤ì¹˜ ì™„ë£Œ" : "ì„¤ì¹˜ ì¤‘";
  }
  if (installedQty > 0) return "ì„¤ì¹˜ ì¤‘";
  if (awardedQty > 0) return "ìˆ˜ì£¼";
  return "ì œì•ˆ";
}

function inferProjectStatus(items: Record<string, unknown>[]) {
  const statuses = items.map(inferItemStatus);
  if (statuses.length && statuses.every((status) => status === "ì„¤ì¹˜ ì™„ë£Œ")) {
    return "ì„¤ì¹˜ ì™„ë£Œ";
  }
  if (statuses.includes("ì„¤ì¹˜ ì¤‘")) return "ì„¤ì¹˜ ì¤‘";
  if (statuses.includes("ë°œì£¼")) return "ë°œì£¼";
  if (statuses.includes("ìˆ˜ì£¼") || items.some((item) => cleanQuantity(item.awardedQty) > 0)) {
    return "ìˆ˜ì£¼";
  }
  if (statuses.includes("ê²¬ì ")) return "ê²¬ì ";
  return "ì œì•ˆ";
}

function inferProjectStatusFromRecord(
  payload: Record<string, unknown>,
  items: Record<string, unknown>[],
) {
  const requested = cleanStatus(payload.projectStatus, projectStatuses, "");
  if (requested) return requested;

  const awardStage = normalizeAwardStage(payload.awardStage, payload.awardStatus);
  const awardStatus = clean(payload.awardStatus);
  const text = [
    payload.topic,
    payload.summary,
    payload.nextAction,
    payload.progressSchedule,
    payload.notes,
  ]
    .map(clean)
    .filter(Boolean)
    .join(" ");

  if (/ì·¨ì†Œ|ë¬´ì‚°/.test(text)) return "ì·¨ì†Œ";
  if (/ë³´ë¥˜|ìž ì • ì¤‘ë‹¨/.test(text)) return "ë³´ë¥˜";
  if (
    /ì„¤ì¹˜ ì™„ë£Œ|ê³µì‚¬ ì™„ë£Œ|ì™„ê³µ|ë‚©í’ˆ ì™„ë£Œ|ê²€ìˆ˜ ì™„ë£Œ|êµìœ¡ ì™„ë£Œ/.test(text) ||
    awardStage === "ê²€ìˆ˜Â·êµìœ¡ ì§„í–‰" ||
    isCompletedAwardStage(awardStage)
  ) {
    return "ì„¤ì¹˜ ì™„ë£Œ";
  }
  if (/ì„¤ì¹˜ ì¤‘|ê³µì‚¬ ì¤‘|ì‹œê³µ ì¤‘|ëª©ê³µ|ì‹œìŠ¤í…œ ìž‘ì—…/.test(text)) {
    return "ì„¤ì¹˜ ì¤‘";
  }
  if (/ë°œì£¼/.test(text)) return "ë°œì£¼";
  if (
    ["ìœ„ì¦ˆì—… ìˆ˜ì£¼", "í˜‘ë ¥ì‚¬ ìˆ˜ì£¼"].includes(awardStatus) ||
    /ìˆ˜ì£¼|ê³„ì•½/.test(text) ||
    ["ê³„ì•½", "ì¼ì • ì¡°ìœ¨"].includes(awardStage)
  ) {
    return "ìˆ˜ì£¼";
  }
  if (/ê²¬ì /.test(text)) return "ê²¬ì ";
  return items.length ? inferProjectStatus(items) : "ì œì•ˆ";
}

function progressiveProjectStatus(previous: unknown, next: string) {
  if (next === "ë³´ë¥˜" || next === "ì·¨ì†Œ") return next;
  const rank = new Map(
    ["ì œì•ˆ", "ê²¬ì ", "ìˆ˜ì£¼", "ë°œì£¼", "ì„¤ì¹˜ ì¤‘", "ì„¤ì¹˜ ì™„ë£Œ"].map(
      (status, index) => [status, index],
    ),
  );
  const current = clean(previous);
  if (!rank.has(current)) return next;
  return (rank.get(next) ?? -1) >= (rank.get(current) ?? -1)
    ? next
    : current;
}

async function readProjects(organization: string, businessRound = 1) {
  const d1 = await ensureEquipmentReady();
  await reconcileEquipmentProjectsForBusiness(organization, businessRound);
  const projects = await d1
    .prepare(
      `SELECT p.*, COALESCE(m.display_name, 'ë“±ë¡ìž') AS created_by_name
       FROM equipment_projects p
       LEFT JOIN members m ON m.id = p.created_by
       WHERE p.organization = ? AND p.business_round = ?
       ORDER BY p.updated_at DESC, p.id DESC`,
    )
    .bind(organization, businessRound)
    .all<Record<string, unknown>>();
  if (!projects.results.length) return [];

  const projectIds = projects.results.map(
    (project: Record<string, unknown>) => Number(project.id),
  );
  const placeholders = projectIds.map(() => "?").join(", ");
  const items = await d1
    .prepare(
      `SELECT *
       FROM equipment_items
       WHERE project_id IN (${placeholders})
       ORDER BY sort_order ASC, id ASC`,
    )
    .bind(...projectIds)
    .all<Record<string, unknown>>();
  const itemsByProject = new Map<number, Record<string, unknown>[]>();
  const canonicalProducts = await readCanonicalProductMap(d1);
  items.results.forEach((item: Record<string, unknown>) => {
    const projectId = Number(item.project_id);
    const current = itemsByProject.get(projectId) ?? [];
    const canonical = canonicalProducts.get(clean(item.catalog_item_id));
    const productName = canonical?.name ?? clean(item.product_name);
    const supplyType = normalizeProductSupplyType({
      catalogItemId: item.catalog_item_id,
      productName,
      supplyType: item.supply_type,
    });
    current.push({
      ...item,
      product_name: productName,
      supply_type: supplyType,
      margin_rate: supplyType === "direct" ? item.margin_rate : null,
      commission_rate:
        supplyType === "partner" && isPartnerOnlyProduct({
          catalogItemId: item.catalog_item_id,
          productName,
        })
          ? item.commission_rate ?? item.margin_rate ?? canonical?.commissionRate ?? null
          : item.commission_rate,
    });
    itemsByProject.set(projectId, current);
  });
  return projects.results.map((project: Record<string, unknown>) => ({
    ...project,
    items: itemsByProject.get(Number(project.id)) ?? [],
  }));
}

async function syncOrganizationEquipmentSchedule(
  organization: string,
  businessRound = 1,
) {
  if (!organization) return;
  const d1 = await ensureRecordsReady();
  const latestSchedule = await d1
    .prepare(
      `SELECT progress_schedule, source_chat
       FROM activities
       WHERE organization = ? AND business_round = ? AND progress_schedule <> ''
       ORDER BY COALESCE(activity_date, '') DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization, businessRound)
    .first<{ progress_schedule: string; source_chat: string }>();
  if (
    latestSchedule?.progress_schedule &&
    clean(latestSchedule.source_chat) !== "ì‚¬ì´íŠ¸ AI ìž…ë ¥"
  ) {
    await syncEquipmentItemsFromProgressSchedule(
      organization,
      latestSchedule.progress_schedule,
      businessRound,
    );
  }
}

export async function GET(request: Request) {
  try {
    const member = await requireApprovedMember();
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("protection") === "1") {
      await ensureRecordsReady();
      const d1 = await ensureEquipmentReady();
      const items = await d1
        .prepare(
          `WITH latest_activities AS (
             SELECT organization, progress_manager,
                    ROW_NUMBER() OVER (
                      PARTITION BY organization
                      ORDER BY COALESCE(activity_date, '') DESC, id DESC
                    ) AS row_number
             FROM activities
           )
           SELECT i.*, p.organization, p.name AS project_name,
                  C÷½¼¶‰žËkºwµç@€ÁÉ½É•ÍÍ¥Ù•AÉ½©•ÑMÑ…ÑÕÌ¡ÁÉ½©•Ð¹ÍÑ…ÑÕÌ°¥¹™•ÉÉ•‘MÑ…ÑÕÌ¤°4(€€€€€€€€€‰Õ‘•ÑQåÁ”°4(€€€€€€€€€‰Õ‘•ÑQåÁ”°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ=É¥¥¹…±9…µ”°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•ÑÉ½ÕÁ%°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ5…Ñ¡MÑ…ÑÕÌ°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ5…Ñ¡5•Ñ¡½°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•ÑI•ÅÕ•ÍÑ%°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ-¥¹°4(€€€€€€€€€9Õµ‰•È¡ÁÉ½©•Ð¹¥¤°4(€€€€€€€€¤4(€€€€€€€€¹ÉÕ¸ ¤ì4(€€€€€…Ý…¥ÐÍå¹ÅÕ¥Áµ•¹Ñ%Ñ•µÍÉ½µAÉ½É•ÍÍM¡•‘Õ±” 4(€€€€€€€½É…¹¥é…Ñ¥½¸°4(€€€€€€€±•…¸¡Á…å±½…¹ÁÉ½É•ÍÍM¡•‘Õ±”¤°4(€€€€€€€‰ÕÍ¥¹•ÍÍI½Õ¹°4(€€€€€€¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€€€½¬èÑÉÕ”°4(€€€€€€€ÁÉ½©•ÑÌè…Ý…¥ÐÉ•…‘AÉ½©•ÑÌ¡½É…¹¥é…Ñ¥½¸°‰ÕÍ¥¹•ÍÍI½Õ¹¤°4(€€€€€ô¤ì4(€€€ô4(4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²‚²z”ƒ²Š®–c®–ðƒ¶fW²vã¶VÐƒ²Žó²ã²jP¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÀô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€¥˜€ 4(€€€€€•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€˜˜4(€€€€€•ÉÉ½È¹µ•ÍÍ…”¹Ñ½1½Ý•É…Í” ¤¹¥¹±Õ‘•Ì ‰Õ¹¥ÅÕ”ˆ¤4(€€€€¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€ì•ÉÉ½Èè€‹ªÂg²v ƒªâÃªÒ²^@ƒ®>g²vó¶Vpƒ²
³²^®ª²vÐƒ²vÓ®¾àƒ²z#²*×®.#®.¸ˆô°4(€€€€€€€ìÍÑ…ÑÕÌè€ÐÀäô°4(€€€€€€¤ì4(€€€ô4(€€€É•ÑÕÉ¸…•ÍÍÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(4)™Õ¹Ñ¥½¸½ÁÑ¥½¹…±A½Í¥Ñ¥Ù•%¹Ñ••È¡Ù…±Õ”èÕ¹­¹½Ý¸¤ì4(€½¹ÍÐÁ…ÉÍ•€ô9Õµ‰•È¡Ù…±Õ”¤ì4(€É•ÑÕÉ¸9Õµ‰•È¹¥Í%¹Ñ••È¡Á…ÉÍ•¤€˜˜Á…ÉÍ•€ø€À€üÁ…ÉÍ•€è¹Õ±°ì4)ô4(4)•áÁ½ÉÐ…Íå¹Œ™Õ¹Ñ¥½¸AUP¡É•ÅÕ•ÍÐèI•ÅÕ•ÍÐ¤ì4(€ÑÉäì4(€€€½¹ÍÐµ•µ‰•È€ô…Ý…¥ÐÉ•ÅÕ¥É•AÉ¥µ…Éå=Ý¹•È ¤ì4(€€€½¹ÍÐÁ…å±½…€ô€¡…Ý…¥ÐÉ•ÅÕ•ÍÐ¹©Í½¸ ¤¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì4(€€€½¹ÍÐ­¥¹€ô±•…¸¡Á…å±½…¹­¥¹¤ì4(€€€½¹ÍÐ¥€ô9Õµ‰•È¡Á…å±½…¹¥¤ì4(€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡¥¤ñð¥€ð€Ä¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²"c²‚W¶V€ƒ¶V·®ª§²vƒ¶fW²vã¶VÐƒ²Žó²ã²jP¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÀô¤ì4(€€€ô4(€€€½¹ÍÐÄ€ô…Ý…¥Ð•¹ÍÕÉ•ÅÕ¥Áµ•¹ÑI•…‘ä ¤ì4(4(€€€¥˜€¡­¥¹€ôôô€‰ÁÉ½©•Ðµ½ÍÑÌˆ¤ì4(€€€€€½¹ÍÐÁÉ½©•Ð€ô…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€UAQ•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•ÑÌMP4(€€€€€€€€€€€½¹ÍÑÉÕÑ¥½¹}…µ½Õ¹Ð€ô€ü°…ÑÕ…±}½¹ÍÑÉÕÑ¥½¹}½ÍÐ€ô€ü°4(€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€]!I¥€ô€ü4(€€€€€€€€€€IQUI9%9€©€°4(€€€€€€€€¤4(€€€€€€€€¹‰¥¹ 4(€€€€€€€€€±•…¹M¥¹•‘µ½Õ¹Ð¡Á…å±½…¹½¹ÍÑÉÕÑ¥½¹µ½Õ¹Ð¤°4(€€€€€€€€€±•…¹M¥¹•‘µ½Õ¹Ð¡Á…å±½…¹…ÑÕ…±½¹ÍÑÉÕÑ¥½¹½ÍÐ¤°4(€€€€€€€€€¥°4(€€€€€€€€¤4(€€€€€€€€¹™¥ÉÍÐ ¤ì4(€€€€€¥˜€ …ÁÉ½©•Ð¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²
³²^²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÐô¤ì4(€€€€€ô4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ìÁÉ½©•Ðô¤ì4(€€€ô4(4(€€€¥˜€¡­¥¹€ôôô€‰ÁÉ½©•Ðˆ¤ì4(€€€€€½¹ÍÐ½É…¹¥é…Ñ¥½¸€ô±•…¸¡Á…å±½…¹½É…¹¥é…Ñ¥½¸¤ì4(€€€€€½¹ÍÐ¹…µ”€ô±•…¸¡Á…å±½…¹¹…µ”¤ì4(€€€€€¥˜€ …½É…¹¥é…Ñ¥½¸ñð€…¹…µ”¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸ 4(€€€€€€€€€ì•ÉÉ½Èè€‹ªâÃªÒ®ªªÎðƒ²
³²^®ª²vƒ²z®‚—¶VÐƒ²Žó²ã²jP¸ˆô°4(€€€€€€€€€ìÍÑ…ÑÕÌè€ÐÀÀô°4(€€€€€€€€¤ì4(€€€€€ô4(€€€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€M1PÀ¸¨°=1M¡„¹…Ý…É‘}ÍÑ…ÑÕÌ°€Ÿ®¾ã²‚Tœ¤L±¥¹­•‘Ý…É‘MÑ…ÑÕÌ4(€€€€€€€€€€I=4•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•ÑÌÀ4(€€€€€€€€€€1P)=%8…Ñ¥Ù¥Ñ¥•Ì„=8„¹¥€ôÀ¹…Ñ¥Ù¥Ñå}¥4(€€€€€€€€€€]!IÀ¹¥€ô€ý€°4(€€€€€€€€¤4(€€€€€€€€¹‰¥¹¡¥¤4(€€€€€€€€¹™¥ÉÍÐñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø ¤ì4(€€€€€¥˜€ …ÁÉ•Ù¥½ÕÌ¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²
³²^²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÐô¤ì4(€€€€€ô4(€€€€€…Ý…¥Ð•¹ÍÕÉ•	Õ‘•Ñ9…µ•ÍI•…‘ä ¤ì4(€€€€€½¹ÍÐ‰Õ‘•Ñ5•Ñ…‘…Ñ„€ô…Ý…¥ÐÉ•Í½±Ù•	Õ‘•ÑI•½É‘5•Ñ…‘…Ñ„¡Ä°ì4(€€€€€€€‰Õ‘•ÑQåÁ”èÁ…å±½…¹‰Õ‘•ÑQåÁ”€üüÁÉ•Ù¥½ÕÌ¹‰Õ‘•Ñ}ÑåÁ”°4(€€€€€€€‰Õ‘•Ñ=É¥¥¹…±9…µ”è4(€€€€€€€€€Á…å±½…¹‰Õ‘•Ñ=É¥¥¹…±9…µ”€üü4(€€€€€€€€€ÁÉ•Ù¥½ÕÌ¹‰Õ‘•Ñ}½É¥¥¹…±}¹…µ”€üü4(€€€€€€€€€Á…å±½…¹‰Õ‘•ÑQåÁ”€üü4(€€€€€€€€€ÁÉ•Ù¥½ÕÌ¹‰Õ‘•Ñ}ÑåÁ”°4(€€€€€€€‰Õ‘•ÑÉ½ÕÁ%èÁ…å±½…¹‰Õ‘•ÑÉ½ÕÁ%€üüÁÉ•Ù¥½ÕÌ¹‰Õ‘•Ñ}É½ÕÁ}¥°4(€€€€€€€‰Õ‘•Ñ5…Ñ¡MÑ…ÑÕÌè4(€€€€€€€€€Á…å±½…¹‰Õ‘•Ñ5…Ñ¡MÑ…ÑÕÌ€üüÁÉ•Ù¥½ÕÌ¹‰Õ‘•Ñ}µ…Ñ¡}ÍÑ…ÑÕÌ°4(€€€€€€€‰Õ‘•Ñ5…Ñ¡5•Ñ¡½è4(€€€€€€€€€Á…å±½…¹‰Õ‘•Ñ5…Ñ¡5•Ñ¡½€üüÁÉ•Ù¥½ÕÌ¹‰Õ‘•Ñ}µ…Ñ¡}µ•Ñ¡½°4(€€€€€€€‰Õ‘•ÑI•ÅÕ•ÍÑ%è4(€€€€€€€€€Á…å±½…¹‰Õ‘•ÑI•ÅÕ•ÍÑ%€üü4(€€€€€€€€€Á…å±½…¹‰Õ‘•Ñ9…µ•I•ÅÕ•ÍÑ%€üü4(€€€€€€€€€ÁÉ•Ù¥½ÕÌ¹‰Õ‘•Ñ}É•ÅÕ•ÍÑ}¥°4(€€€€€€€‰Õ‘•Ñ-¥¹èÁ…å±½…¹‰Õ‘•Ñ-¥¹€üüÁÉ•Ù¥½ÕÌ¹‰Õ‘•Ñ}­¥¹°4(€€€€€€€…Ý…É‘MÑ…ÑÕÌèÁÉ•Ù¥½ÕÌ¹±¥¹­•‘Ý…É‘MÑ…ÑÕÌ€üüÁ…å±½…¹…Ý…É‘MÑ…ÑÕÌ€üü€‹®¾ã²‚Tˆ°4(€€€€€ô¤ì4(€€€€€½¹ÍÐÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸€ô±•…¸¡ÁÉ•Ù¥½ÕÌ¹½É…¹¥é…Ñ¥½¸¤ì4(€€€€€¥˜€ 4(€€€€€€€Á…å±½…¹Íå¹=É…¹¥é…Ñ¥½¸€ôôôÑÉÕ”€˜˜4(€€€€€€€ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸€˜˜4(€€€€€€€ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸€„ôô½É…¹¥é…Ñ¥½¸4(€€€€€€¤ì4(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•I•½É‘ÍI•…‘ä ¤ì4(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•5…ÁI•…‘ä ¤ì4(€€€€€€€…Ý…¥Ð•¹ÍÕÉ•…µÁ…¥¹ÍI•…‘ä ¤ì4(€€€€€€€…Ý…¥ÐÄ¹‰…Ñ ¡l4(€€€€€€€€€Ä4(€€€€€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€€€€€UAQ…Ñ¥Ù¥Ñ¥•Ì4(€€€€€€€€€€€€€€MP½É…¹¥é…Ñ¥½¸€ô€ü°ÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¸€ô€ý€°4(€€€€€€€€€€€€¤4(€€€€€€€€€€€€¹‰¥¹¡½É…¹¥é…Ñ¥½¸¹Í±¥” À°€ÄÈÀ¤°ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸¤°4(€€€€€€€€€Ä4(€€€€€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€€€€€1QI=4½É…¹¥é…Ñ¥½¹}±½…Ñ¥½¹Ì4(€€€€€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¸€ô€ü4(€€€€€€€€€€€€€€€€9a%MQL€ 4(€€€€€€€€€€€€€€€€€€M1P€ÄI=4½É…¹¥é…Ñ¥½¹}±½…Ñ¥½¹Ì]!I½É…¹¥é…Ñ¥½¸€ô€ü4(€€€€€€€€€€€€€€€€€¥€°4(€€€€€€€€€€€€¤4(€€€€€€€€€€€€¹‰¥¹¡ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸°½É…¹¥é…Ñ¥½¸¤°4(€€€€€€€€€Ä4(€€€€€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€€€€€UAQ½É…¹¥é…Ñ¥½¹}±½…Ñ¥½¹Ì4(€€€€€€€€€€€€€€MP½É…¹¥é…Ñ¥½¸€ô€ü°ÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¸€ô€ý€°4(€€€€€€€€€€€€¤4(€€€€€€€€€€€€¹‰¥¹¡½É…¹¥é…Ñ¥½¸¹Í±¥” À°€ÄÈÀ¤°ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸¤°4(€€€€€€€€€Ä4(€€€€€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€€€€€1QI=4Í…±•Í}…µÁ…¥¹}Ñ…É•ÑÌ4(€€€€€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¸€ô€ü4(€€€€€€€€€€€€€€€€9…µÁ…¥¹}¥%8€ 4(€€€€€€€€€€€€€€€€€€M1P…µÁ…¥¹}¥4(€€€€€€€€€€€€€€€€€€I=4Í…±•Í}…µÁ…¥¹}Ñ…É•ÑÌ4(€€€€€€€€€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¸€ô€ü4(€€€€€€€€€€€€€€€€€¥€°4(€€€€€€€€€€€€¤4(€€€€€€€€€€€€¹‰¥¹¡ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸°½É…¹¥é…Ñ¥½¸¤°4(€€€€€€€€€Ä4(€€€€€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€€€€€UAQÍ…±•Í}…µÁ…¥¹}Ñ…É•ÑÌ4(€€€€€€€€€€€€€€MP½É…¹¥é…Ñ¥½¸€ô€ü°ÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¸€ô€ý€°4(€€€€€€€€€€€€¤4(€€€€€€€€€€€€¹‰¥¹¡½É…¹¥é…Ñ¥½¸¹Í±¥” À°€ÄÈÀ¤°ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸¤°4(€€€€€€€€€Ä4(€€€€€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€€€€€UAQ•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•ÑÌ4(€€€€€€€€€€€€€€MP½É…¹¥é…Ñ¥½¸€ô€ü°ÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€€€€€]!I½É…¹¥é…Ñ¥½¸€ô€ý€°4(€€€€€€€€€€€€¤4(€€€€€€€€€€€€¹‰¥¹¡½É…¹¥é…Ñ¥½¸¹Í±¥” À°€ÄÈÀ¤°ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸¤°4(€€€€€€€t¤ì4(€€€€€ô4(€€€€€½¹ÍÐÁÉ½©•Ð€ô…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€UAQ•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•ÑÌMP4(€€€€€€€€€€€½É…¹¥é…Ñ¥½¸€ô€ü°¹…µ”€ô€ü°ÍÑ…ÑÕÌ€ô€ü°‰Õ‘•Ñ}ÑåÁ”€ô€ü°¹½Ñ•Ì€ô€ü°4(€€€€€€€€€€€‰Õ‘•Ñ}½É¥¥¹…±}¹…µ”€ô€ü°‰Õ‘•Ñ}É½ÕÁ}¥€ô€ü°4(€€€€€€€€€€€‰Õ‘•Ñ}µ…Ñ¡}ÍÑ…ÑÕÌ€ô€ü°‰Õ‘•Ñ}µ…Ñ¡}µ•Ñ¡½€ô€ü°4(€€€€€€€€€€€‰Õ‘•Ñ}É•ÅÕ•ÍÑ}¥€ô€ü°‰Õ‘•Ñ}­¥¹€ô€ü°4(€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€]!I¥€ô€ü4(€€€€€€€€€€IQUI9%9€©€°4(€€€€€€€€¤4(€€€€€€€€¹‰¥¹ 4(€€€€€€€€€½É…¹¥é…Ñ¥½¸¹Í±¥” À°€ÄÈÀ¤°4(€€€€€€€€€¹…µ”¹Í±¥” À°€ÄØÀ¤°4(€€€€€€€€€±•…¹MÑ…ÑÕÌ¡Á…å±½…¹ÍÑ…ÑÕÌ°ÁÉ½©•ÑMÑ…ÑÕÍ•Ì°€‹²‚s²V ˆ¤°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹ÍÑ½É•‘9…µ”°4(€€€€€€€€€±•…¸¡Á…å±½…¹¹½Ñ•Ì¤¹Í±¥” À°€É|ÀÀÀ¤°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ=É¥¥¹…±9…µ”°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•ÑÉ½ÕÁ%°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ5…Ñ¡MÑ…ÑÕÌ°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ5…Ñ¡5•Ñ¡½°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•ÑI•ÅÕ•ÍÑ%°4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ-¥¹°4(€€€€€€€€€¥°4(€€€€€€€€¤4(€€€€€€€€¹™¥ÉÍÐñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø ¤ì4(€€€€€¥˜€ …ÁÉ½©•Ð¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²
³²^²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÐô¤ì4(€€€€€ô4(€€€€€…Ý…¥Ð±¥¹­	Õ‘•Ñ9…µ•¹Ñ¥Ñä¡Ä°ì4(€€€€€€€•¹Ñ¥ÑåQåÁ”è€‰•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•Ðˆ°4(€€€€€€€•¹Ñ¥Ñå%è9Õµ‰•È¡ÁÉ½©•Ð¹¥¤°4(€€€€€€€É½ÕÁ%è‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•ÑÉ½ÕÁ%°4(€€€€€€€½É¥¥¹…±9…µ”è‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ=É¥¥¹…±9…µ”°4(€€€€€€€…±¥…Í-•äè4(€€€€€€€€€‰Õ‘•Ñ5•Ñ…‘…Ñ„¹É•Í½±ÕÑ¥½¸ü¹…±¥…Í-•ä€üü4(€€€€€€€€€¹½Éµ…±¥é•	Õ‘•Ñ9…µ•-•ä¡‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ=É¥¥¹…±9…µ”¤°4(€€€€€ô¤ì4(€€€€€¥˜€¡‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•ÑI•ÅÕ•ÍÑ%¤ì4(€€€€€€€…Ý…¥Ð±¥¹­	Õ‘•ÑI•ÅÕ•ÍÑI•½É¡Ä°ì4(€€€€€€€€€É•ÅÕ•ÍÑ%è‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•ÑI•ÅÕ•ÍÑ%°4(€€€€€€€€€•¹Ñ¥ÑåQåÁ”è€‰•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•Ðˆ°4(€€€€€€€€€•¹Ñ¥Ñå%è9Õµ‰•È¡ÁÉ½©•Ð¹¥¤°4(€€€€€€€€€½É¥¥¹…±9…µ”è‰Õ‘•Ñ5•Ñ…‘…Ñ„¹‰Õ‘•Ñ=É¥¥¹…±9…µ”°4(€€€€€€€€€½É…¹¥é…Ñ¥½¸°4(€€€€€€€ô¤ì4(€€€€€ô4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì4(€€€€€€€ÁÉ½©•Ð°4(€€€€€€€É•¹…µ•‘=É…¹¥é…Ñ¥½¸è4(€€€€€€€€€ÁÉ•Ù¥½ÕÍ=É…¹¥é…Ñ¥½¸€„ôô½É…¹¥é…Ñ¥½¸€ü½É…¹¥é…Ñ¥½¸€è¹Õ±°°4(€€€€€ô¤ì4(€€€ô4(4(€€€¥˜€¡­¥¹€ôôô€‰¥Ñ•´ˆ¤ì4(€€€€€±•ÐÁÉ½‘ÕÑ9…µ”€ô±•…¸¡Á…å±½…¹ÁÉ½‘ÕÑ9…µ”¤ì4(€€€€€¥˜€ …ÁÉ½‘ÕÑ9…µ”¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹¶J#®ª§®ª²vƒ²z®‚—¶VÐƒ²Žó²ã²jP¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÀô¤ì4(€€€€€ô4(€€€€€½¹ÍÐÕ¹¥ÑAÉ¥”€ô±•…¹M¥¹•‘µ½Õ¹Ð¡Á…å±½…¹…Ñ…±½U¹¥ÑAÉ¥”¤ì4(€€€€€½¹ÍÐ…Ñ…±½%Ñ•µ%€ô±•…¸¡Á…å±½…¹…Ñ…±½%Ñ•µ%¤¹Í±¥” À°€ÄØÀ¤ì4(€€€€€½¹ÍÐ…¹½¹¥…±AÉ½‘ÕÐ€ô€¡…Ý…¥ÐÉ•…‘…¹½¹¥…±AÉ½‘ÕÑ5…À¡Ä¤¤¹•Ð 4(€€€€€€€…Ñ…±½%Ñ•µ%°4(€€€€€€¤ì4(€€€€€¥˜€¡…¹½¹¥…±AÉ½‘ÕÐ¤ÁÉ½‘ÕÑ9…µ”€ô…¹½¹¥…±AÉ½‘ÕÐ¹¹…µ”ì4(€€€€€½¹ÍÐ•á¥ÍÑ¥¹%Ñ•´€ô…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É” ‰M1P€¨I=4•ÅÕ¥Áµ•¹Ñ}¥Ñ•µÌ]!I¥€ô€üˆ¤4(€€€€€€€€¹‰¥¹¡¥¤4(€€€€€€€€¹™¥ÉÍÐñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø ¤ì4(€€€€€¥˜€ …•á¥ÍÑ¥¹%Ñ•´¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹¶J#®ª§²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÐô¤ì4(€€€€€ô4(€€€€€½¹ÍÐÁÉ½‘ÕÑMÕÁÁ±å5…À€ô…Ý…¥ÐÉ•…‘AÉ½‘ÕÑMÕÁÁ±åM•ÑÑ¥¹5…À ¤ì4(€€€€€½¹ÍÐÁÉ•Í•ÉÙ•Íá¥ÍÑ¥¹…Ñ…±½œ€ô4(€€€€€€€±•…¸¡•á¥ÍÑ¥¹%Ñ•´¹…Ñ…±½}¥Ñ•µ}¥¤€ôôô…Ñ…±½%Ñ•µ%ì4(€€€€€½¹ÍÐÍ•ÑÑ±•µ•¹Ð€ô±•…¹MÕÁÁ±åM•ÑÑ±•µ•¹Ð (€€€€€€€Á…å±½…°(€€€€€€€ÁÉ½‘ÕÑMÕÁÁ±å5…À¹•Ð¡…Ñ…±½%Ñ•µ%¤°(€€€€€€€ÁÉ•Í•ÉÙ•Íá¥ÍÑ¥¹…Ñ…±½œ€ü•á¥ÍÑ¥¹%Ñ•´€èÕ¹‘•™¥¹•°(€€€€€€€ì…Ñ…±½%Ñ•µ%°ÁÉ½‘ÕÑ9…µ”ô°(€€€€€€¤ì(€€€€€½¹ÍÐÍÕÁÁ±¥•É1¥¹¬èAÉ½‘ÕÑY•¹‘½É1¥¹¬ðÕ¹‘•™¥¹•€ô…Ñ…±½%Ñ•µ%4(€€€€€€€€ü€ 4(€€€€€€€€€€€€¡…Ý…¥ÐÉ•…‘AÉ½‘ÕÑY•¹‘½É1¥¹­5…À ¤¤…Ì5…Àð4(€€€€€€€€€€€€€ÍÑÉ¥¹œ°4(€€€€€€€€€€€€€AÉ½‘ÕÑY•¹‘½É1¥¹¬4(€€€€€€€€€€€€ø4(€€€€€€€€€€¤¹•Ð¡…Ñ…±½%Ñ•µ%¤4(€€€€€€€€èÕ¹‘•™¥¹•ì4(€€€€€½¹ÍÐÍÕÁÁ±¥•ÉY•¹‘½É%€ô4(€€€€€€€Í•ÑÑ±•µ•¹Ð¹ÍÕÁÁ±åQåÁ”€ôôô€‰Á…ÉÑ¹•Èˆ4(€€€€€€€€€€üÍÕÁÁ±¥•É1¥¹¬ü¹ÍÕÁÁ±¥•ÉY•¹‘½É%€üü4(€€€€€€€€€€€€¡ÁÉ•Í•ÉÙ•Íá¥ÍÑ¥¹…Ñ…±½œ4(€€€€€€€€€€€€€€ü½ÁÑ¥½¹…±A½Í¥Ñ¥Ù•%¹Ñ••È¡•á¥ÍÑ¥¹%Ñ•´¹ÍÕÁÁ±¥•É}Ù•¹‘½É}¥¤4(€€€€€€€€€€€€€€è¹Õ±°¤4(€€€€€€€€€€è¹Õ±°ì4(€€€€€½¹ÍÐÍÕÁÁ±¥•ÉY•¹‘½É9…µ”€ô4(€€€€€€€Í•ÑÑ±•µ•¹Ð¹ÍÕÁÁ±åQåÁ”€ôôô€‰Á…ÉÑ¹•Èˆ4(€€€€€€€€€€üÍÕÁÁ±¥•É1¥¹¬ü¹ÍÕÁÁ±¥•ÉY•¹‘½É9…µ”€üü4(€€€€€€€€€€€€¡ÁÉ•Í•ÉÙ•Íá¥ÍÑ¥¹…Ñ…±½œ4(€€€€€€€€€€€€€€ü±•…¸¡•á¥ÍÑ¥¹%Ñ•´¹ÍÕÁÁ±¥•É}Ù•¹‘½É}¹…µ”¤¹Í±¥” À°€ÌÀÀ¤4(€€€€€€€€€€€€€€è€ˆˆ¤4(€€€€€€€€€€è€ˆˆì4(€€€€€½¹ÍÐ¥Ñ•´€ô…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€UAQ•ÅÕ¥Áµ•¹Ñ}¥Ñ•µÌMP4(€€€€€€€€€€€ÁÉ½‘ÕÑ}¹…µ”€ô€ü°ÍÁ•¥™¥…Ñ¥½¸€ô€ü°ÁÉ½Á½Í•‘}ÅÑä€ô€ü°…Ý…É‘•‘}ÅÑä€ô€ü°4(€€€€€€€€€€€¥¹ÍÑ…±±•‘}ÅÑä€ô€ü°Õ¹¥Ð€ô€ü°ÍÑ…ÑÕÌ€ô€ü°¹½Ñ•Ì€ô€ü°…Ñ…±½}¥Ñ•µ}¥€ô€ü°4(€€€€€€€€€€€…Ñ…±½}Õ¹¥Ñ}ÁÉ¥”€ô€ü°ÁÉ¥•}ÍÑ…ÑÕÌ€ô€ü°…Ñ…±½}¹½Ñ”€ô€ü°4(€€€€€€€€€€€•á•ÕÑ¥½¹}ÑåÁ”€ô€ü°4(€€€€€€€€€€€½µµ¥ÍÍ¥½¹}¥¹ÁÕÑ}ÑåÁ”€ô€ü°½µµ¥ÍÍ¥½¹}É…Ñ”€ô€ü°4(€€€€€€€€€€€ÍÕÁÁ±å}ÑåÁ”€ô€ü°µ…É¥¹}É…Ñ”€ô€ü°ÁÉ½ÕÉ•µ•¹Ñ}™••}É…Ñ”€ô€ü°4(€€€€€€€€€€€½¹Í½ÉÑ¥Õµ}½µµ¥ÍÍ¥½¹}É…Ñ”€ô€ü°4(€€€€€€€€€€€½¹Í½ÉÑ¥Õµ}Á…åµ•¹Ñ}…µ½Õ¹Ð€ô€ü°4(€€€€€€€€€€€ÍÕÁÁ±¥•É}Ù•¹‘½É}¥€ô€ü°ÍÕÁÁ±¥•É}Ù•¹‘½É}¹…µ”€ô€ü°4(€€€€€€€€€€€ÕÁ‘…Ñ•‘}‰ä€ô€ü°4(€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€]!I¥€ô€ü4(€€€€€€€€€€IQUI9%9€©€°4(€€€€€€€€¤4(€€€€€€€€¹‰¥¹ 4(€€€€€€€€€ÁÉ½‘ÕÑ9…µ”¹Í±¥” À°€ÄàÀ¤°4(€€€€€€€€€±•…¸¡Á…å±½…¹ÍÁ•¥™¥…Ñ¥½¸¤¹Í±¥” À°€ÄàÀ¤°4(€€€€€€€€€±•…¹EÕ…¹Ñ¥Ñä¡Á…å±½…¹ÁÉ½Á½Í•‘EÑä¤°4(€€€€€€€€€±•…¹EÕ…¹Ñ¥Ñä¡Á…å±½…¹…Ý…É‘•‘EÑä¤°4(€€€€€€€€€±•…¹EÕ…¹Ñ¥Ñä¡Á…å±½…¹¥¹ÍÑ…±±•‘EÑä¤°4(€€€€€€€€€±•…¸¡Á…å±½…¹Õ¹¥Ð¤¹Í±¥” À°€ÈÀ¤ñð€‹®2 ˆ°4(€€€€€€€€€¥¹™•É%Ñ•µMÑ…ÑÕÌ¡Á…å±½…¤°4(€€€€€€€€€±•…¸¡Á…å±½…¹¹½Ñ•Ì¤¹Í±¥” À°€Å|ÀÀÀ¤°4(€€€€€€€€€…Ñ…±½%Ñ•µ%°4(€€€€€€€€€Õ¹¥ÑAÉ¥”°4(€€€€€€€€€±•…¹AÉ¥•MÑ…ÑÕÌ¡Á…å±½…¹ÁÉ¥•MÑ…ÑÕÌ°Õ¹¥ÑAÉ¥”¤°4(€€€€€€€€€±•…¸¡Á…å±½…¹…Ñ…±½9½Ñ”¤¹Í±¥” À°€Å|ÀÀÀ¤°4(€€€€€€€€€Í•ÑÑ±•µ•¹Ð¹•á•ÕÑ¥½¹QåÁ”°4(€€€€€€€€€Í•ÑÑ±•µ•¹Ð¹½µµ¥ÍÍ¥½¹%¹ÁÕÑQåÁ”°4(€€€€€€€€€Í•ÑÑ±•µ•¹Ð¹½µµ¥ÍÍ¥½¹I…Ñ”°4(€€€€€€€€€Í•ÑÑ±•µ•¹Ð¹ÍÕÁÁ±åQåÁ”°4(€€€€€€€€€Í•ÑÑ±•µ•¹Ð¹µ…É¥¹I…Ñ”°4(€€€€€€€€€±•…¹AÉ½ÕÉ•µ•¹Ñ••I…Ñ” 4(€€€€€€€€€€€Á…å±½…¹ÁÉ½ÕÉ•µ•¹Ñ••I…Ñ”°4(€€€€€€€€€€€Á…å±½…°4(€€€€€€€€€€€…¹½¹¥…±AÉ½‘ÕÐ°4(€€€€€€€€€€¤°4(€€€€€€€€€Í•ÑÑ±•µ•¹Ð¹½¹Í½ÉÑ¥Õµ½µµ¥ÍÍ¥½¹I…Ñ”°4(€€€€€€€€€Í•ÑÑ±•µ•¹Ð¹½¹Í½ÉÑ¥ÕµA…åµ•¹Ñµ½Õ¹Ð°4(€€€€€€€€€ÍÕÁÁ±¥•ÉY•¹‘½É%°4(€€€€€€€€€ÍÕÁÁ±¥•ÉY•¹‘½É9…µ”°4(€€€€€€€€€µ•µ‰•È¹¥°4(€€€€€€€€€¥°4(€€€€€€€€¤4(€€€€€€€€¹™¥ÉÍÐñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø ¤ì4(€€€€€¥˜€ …¥Ñ•´¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹¶J#®ª§²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÐô¤ì4(€€€€€ô4(€€€€€…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€€‰UAQ•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•ÑÌMPÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@]!I¥€ô€üˆ°4(€€€€€€€€¤4(€€€€€€€€¹‰¥¹¡9Õµ‰•È¡¥Ñ•´¹ÁÉ½©•Ñ}¥¤¤4(€€€€€€€€¹ÉÕ¸ ¤ì4(€€€€€½¹ÍÐÁÉ½©•Ð€ô…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É” ‰M1P½É…¹¥é…Ñ¥½¸I=4•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•ÑÌ]!I¥€ô€üˆ¤4(€€€€€€€€¹‰¥¹¡9Õµ‰•È¡¥Ñ•´¹ÁÉ½©•Ñ}¥¤¤4(€€€€€€€€¹™¥ÉÍÐñì½É…¹¥é…Ñ¥½¸èÍÑÉ¥¹œôø ¤ì4(€€€€€¥˜€¡ÁÉ½©•Ðü¹½É…¹¥é…Ñ¥½¸¤ì4(€€€€€€€…Ý…¥ÐÍå¹=É…¹¥é…Ñ¥½¹ÅÕ¥Áµ•¹ÑM¡•‘Õ±”¡ÁÉ½©•Ð¹½É…¹¥é…Ñ¥½¸¤ì4(€€€€€ô4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì¥Ñ•´ô¤ì4(€€€ô4(4(€€€¥˜€¡­¥¹€ôôô€‰ÁÉ½Ñ•Ñ¥½¸ˆ¤ì4(€€€€€½¹ÍÐÁÉ½Ñ•Ñ¥½¹MÑ…ÑÕÌ€ô±•…¹MÑ…ÑÕÌ 4(€€€€€€€Á…å±½…¹ÁÉ½Ñ•Ñ¥½¹MÑ…ÑÕÌ°4(€€€€€€€ÁÉ½Ñ•Ñ¥½¹MÑ…ÑÕÍ•Ì°4(€€€€€€€€‹².ƒ²Ê´ƒ¶V²jPˆ°4(€€€€€€¤ì4(€€€€€½¹ÍÐ¥Ñ•´€ô…Ý…¥ÐÄ4(€€€€€€€€¹ÁÉ•Á…É” 4(€€€€€€€€€UAQ•ÅÕ¥Áµ•¹Ñ}¥Ñ•µÌMP4(€€€€€€€€€€€€ÁÉ½Ñ•Ñ¥½¹}ÍÑ…ÑÕÌ€ô€ü°4(€€€€€€€€€€€€ÁÉ½Ñ•Ñ¥½¹}½µÁ±•Ñ•‘}…Ð€ôM]!8€ü€ô€Ÿ².ƒ²Ê´ƒ²f®Ž0œ4(€€€€€€€€€€€€€€Q!8UII9Q}Q%5MQ5@1M9U109°4(€€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ôUII9Q}Q%5MQ5@4(€€€€€€€€€€]!I¥€ô€ü4(€€€€€€€€€€IQUI9%9€©€°4(€€€€€€€€¤4(€€€€€€€€¹‰¥¹¡ÁÉ½Ñ•Ñ¥½¹MÑ…ÑÕÌ°ÁÉ½Ñ•Ñ¥½¹MÑ…ÑÕÌ°¥¤4(€€€€€€€€¹™¥ÉÍÐñI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øø ¤ì4(€€€€€¥˜€ …¥Ñ•´¤ì4(€€€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹¶J#®ª§²vƒ²Âû²ž ƒ®ªï¶Z#²*×®.#®.¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÐô¤ì4(€€€€€ô4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì¥Ñ•´ô¤ì4(€€€ô4(4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²"c²‚Tƒ²Š®–c®–ðƒ¶fW²vã¶VÐƒ²Žó²ã²jP¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÀô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€É•ÑÕÉ¸…•ÍÍÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(4)•áÁ½ÉÐ…Íå¹Œ™Õ¹Ñ¥½¸1Q¡É•ÅÕ•ÍÐèI•ÅÕ•ÍÐ¤ì4(€ÑÉäì4(€€€…Ý…¥ÐÉ•ÅÕ¥É•AÉ¥µ…Éå=Ý¹•È ¤ì4(€€€½¹ÍÐÁ…å±½…€ô€¡…Ý…¥ÐÉ•ÅÕ•ÍÐ¹©Í½¸ ¤¤…ÌI•½ÉñÍÑÉ¥¹œ°Õ¹­¹½Ý¸øì4(€€€½¹ÍÐ­¥¹€ô±•…¸¡Á…å±½…¹­¥¹¤ì4(€€€½¹ÍÐ¥€ô9Õµ‰•È¡Á…å±½…¹¥¤ì4(€€€¥˜€ …9Õµ‰•È¹¥Í%¹Ñ••È¡¥¤ñð¥€ð€Ä¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²
·²‚s¶V€ƒ¶V·®ª§²vƒ¶fW²vã¶VÐƒ²Žó²ã²jP¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÀô¤ì4(€€€ô4(€€€½¹ÍÐÄ€ô…Ý…¥Ð•¹ÍÕÉ•ÅÕ¥Áµ•¹ÑI•…‘ä ¤ì4(4(€€€¥˜€¡­¥¹€ôôô€‰ÁÉ½©•Ðˆ¤ì4(€€€€€…Ý…¥ÐÄ¹‰…Ñ ¡l4(€€€€€€€Ä¹ÁÉ•Á…É” ‰1QI=4•ÅÕ¥Áµ•¹Ñ}¥Ñ•µÌ]!IÁÉ½©•Ñ}¥€ô€üˆ¤¹‰¥¹¡¥¤°4(€€€€€€€Ä¹ÁÉ•Á…É” ‰1QI=4•ÅÕ¥Áµ•¹Ñ}ÁÉ½©•ÑÌ]!I¥€ô€üˆ¤¹‰¥¹¡¥¤°4(€€€€€t¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì½¬èÑÉÕ”ô¤ì4(€€€ô4(€€€¥˜€¡­¥¹€ôôô€‰¥Ñ•´ˆ¤ì4(€€€€€…Ý…¥ÐÄ¹ÁÉ•Á…É” ‰1QI=4•ÅÕ¥Áµ•¹Ñ}¥Ñ•µÌ]!I¥€ô€üˆ¤¹‰¥¹¡¥¤¹ÉÕ¸ ¤ì4(€€€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì½¬èÑÉÕ”ô¤ì4(€€€ô4(€€€É•ÑÕÉ¸I•ÍÁ½¹Í”¹©Í½¸¡ì•ÉÉ½Èè€‹²
·²‚pƒ²Š®–c®–ðƒ¶fW²vã¶VÐƒ²Žó²ã²jP¸ˆô°ìÍÑ…ÑÕÌè€ÐÀÀô¤ì4(€ô…Ñ €¡•ÉÉ½È¤ì4(€€€É•ÑÕÉ¸…•ÍÍÉÉ½ÉI•ÍÁ½¹Í”¡•ÉÉ½È¤ì4(€ô4)ô4(