import {
  accessErrorResponse,
  requireAdminMember,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  type AuthoredQuotation,
  listAuthoredQuotations,
  quotationForPermanentDeletion,
  restoreAuthoredQuotation,
  saveAuthoredQuotation,
  trashAuthoredQuotation,
} from "../../../lib/authored-quotations";
import {
  archiveDriveFile,
  archiveDriveFilesByContext,
  listDriveFilesByContext,
  organizeDriveFile,
  removeDriveFile,
  removeDriveFilesByContext,
  syncDriveFileCopyFromSource,
} from "../../../lib/google-drive-storage";
import {
  QUOTATION_LIBRARY_FOLDER_SEGMENTS,
  quotationDownloadName,
  quotationInstitutionFolderSegments,
  quotationSourceFileName,
} from "../../../lib/quotation-file-name";
import { syncFinalQuotationProtectionItems } from "../../../lib/quotation-protection-sync";

export const dynamic = "force-dynamic";

const QUOTATION_ARCHIVE_CATEGORY = "삭제 견적서";
const QUOTATION_MIRROR_TYPES = [
  "authored-quotation-pdf-mirror",
  "authored-quotation-xlsx-mirror",
  "authored-quotation-source-mirror",
];

function quotationContextId(row: Record<string, unknown>, id: number) {
  return `${String(row.organization ?? "")}|${Math.max(1, Number(row.business_round) || 1)}|${id}`;
}

async function quotationRegion(d1: Awaited<ReturnType<typeof quotationForPermanentDeletion>>["d1"], row: Record<string, unknown>) {
  const match = await d1.prepare(`SELECT region FROM activities
    WHERE organization = ? AND business_round = ? AND TRIM(region) <> ''
    ORDER BY updated_at DESC, id DESC LIMIT 1`)
    .bind(String(row.organization ?? ""), Math.max(1, Number(row.business_round) || 1))
    .first<{ region: string }>();
  return String(match?.region || "");
}

function quotationNamingInput(row: Record<string, unknown>, region: string) {
  return {
    region,
    organization: row.organization,
    businessRound: row.business_round,
    projectTitle: row.project_title,
    quoteDate: row.quote_date,
    quoteNumber: row.quote_number,
    revisionNumber: row.revision_number,
  };
}

async function archiveQuotationDriveFiles(id: number, row: Record<string, unknown>) {
  for (const fileId of [row.drive_pdf_file_id, row.drive_xlsx_file_id, row.source_file_id]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)) {
    await archiveDriveFile(fileId, QUOTATION_ARCHIVE_CATEGORY);
  }
  await archiveDriveFilesByContext({
    contextTypes: QUOTATION_MIRROR_TYPES,
    contextId: quotationContextId(row, id),
    category: QUOTATION_ARCHIVE_CATEGORY,
  });
}

async function restoreQuotationDriveFiles(
  id: number,
  d1: Awaited<ReturnType<typeof quotationForPermanentDeletion>>["d1"],
  row: Record<string, unknown>,
) {
  const region = await quotationRegion(d1, row);
  const naming = quotationNamingInput(row, region);
  const folderSegments = quotationInstitutionFolderSegments(naming);
  const contextId = quotationContextId(row, id);
  const fileSpecs = [
    { id: String(row.drive_pdf_file_id ?? ""), type: "authored-quotation-pdf-mirror", name: quotationDownloadName(naming, "pdf") },
    { id: String(row.drive_xlsx_file_id ?? ""), type: "authored-quotation-xlsx-mirror", name: quotationDownloadName(naming, "xlsx") },
    { id: String(row.source_file_id ?? ""), type: "authored-quotation-source-mirror", name: quotationSourceFileName(naming, row.source_file_name || "원본.xlsx") },
  ];
  for (const spec of fileSpecs) {
    if (spec.id) await organizeDriveFile(spec.id, folderSegments, spec.name);
  }
  const mirrors = await listDriveFilesByContext({ contextTypes: QUOTATION_MIRROR_TYPES, contextId });
  for (const mirror of mirrors) {
    const spec = fileSpecs.find((item) => item.type === mirror.appProperties?.contextType);
    if (spec) await organizeDriveFile(mirror.id, [...QUOTATION_LIBRARY_FOLDER_SEGMENTS], spec.name);
  }
  for (const spec of fileSpecs) {
    if (!spec.id || mirrors.some((mirror) => mirror.appProperties?.contextType === spec.type)) continue;
    await syncDriveFileCopyFromSource({
      sourceFileId: spec.id,
      name: spec.name,
      folderSegments: [...QUOTATION_LIBRARY_FOLDER_SEGMENTS],
      contextType: spec.type,
      contextId,
    });
  }
}

function normalizedItemKey(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "");
}

function quotationItemKeys(item: AuthoredQuotation["items"][number]) {
  return [
    item.productId && item.productId !== "__construction_cost__" ? `product:${item.productId}` : "",
    item.procurementNumber ? `procurement:${normalizedItemKey(item.procurementNumber)}` : "",
    item.name ? `item:${normalizedItemKey(item.name)}|${normalizedItemKey(item.specification)}` : "",
  ].filter(Boolean);
}

function latestConsortiumRates(quotations: AuthoredQuotation[]) {
  const rates: Record<string, { rate: number; quoteNumber: string; quoteDate: string }> = {};
  [...quotations]
    .filter((quote) => quote.status === "final" && quote.executionType === "컨소")
    .sort((left, right) =>
      right.quoteDate.localeCompare(left.quoteDate) ||
      right.revisionNumber - left.revisionNumber ||
      right.id - left.id,
    )
    .forEach((quote) => {
      quote.items.forEach((item) => {
        if (item.productId === "__construction_cost__" || item.consortiumRate <= 0) return;
        quotationItemKeys(item).forEach((key) => {
          if (!rates[key]) {
            rates[key] = {
              rate: item.consortiumRate,
              quoteNumber: quote.quoteNumber,
              quoteDate: quote.quoteDate,
            };
          }
        });
      });
    });
  return rates;
}

export async function GET(request: Request) {
  try {
    const member = await requireApprovedMember();
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("q") ?? "";
    const organization = searchParams.get("organization") ?? "";
    const businessRound = Number(searchParams.get("businessRound"));
    const deleted = searchParams.get("deleted") === "only" ? "only" as const : "active" as const;
    const quotations = await listAuthoredQuotations({
        query,
        organization,
        businessRound:
          organization && Number.isSafeInteger(businessRound) && businessRound > 0
            ? businessRound
            : undefined,
        deleted,
        member,
      }) as AuthoredQuotation[];
    if (searchParams.get("summary") === "1") {
      const latestByRoot = new Map<number, (typeof quotations)[number]>();
      quotations.forEach((quote) => {
        const rootId = quote.revisionRootId || quote.id;
        const current = latestByRoot.get(rootId);
        if (!current || quote.revisionNumber > current.revisionNumber || (quote.revisionNumber === current.revisionNumber && quote.id > current.id)) {
          latestByRoot.set(rootId, quote);
        }
      });
      const groups = new Map<string, (typeof quotations)[number][]>();
      latestByRoot.forEach((quote) => {
        const key = `${quote.organization}\u001f${quote.businessRound}`;
        groups.set(key, [...(groups.get(key) ?? []), quote]);
      });
      const summaries = [...groups.values()].map((quotes) => {
        const finalQuotes = quotes.filter((quote) => quote.status === "final");
        const selected = finalQuotes.length ? finalQuotes : quotes;
        const primaryQuote = [...selected].sort((left, right) => right.id - left.id)[0];
        const regularItems = selected.flatMap((quote) => quote.items.filter((item) => item.productId !== "__construction_cost__"));
        const constructionItems = selected.flatMap((quote) => quote.items.filter((item) => item.productId === "__construction_cost__"));
        const budgetMap = new Map<string, (typeof selected)[number]["budgets"][number]>();
        selected.flatMap((quote) => quote.budgets).forEach((budget) => {
          const current = budgetMap.get(budget.key);
          budgetMap.set(budget.key, current
            ? { ...current, allocatedAmount: current.allocatedAmount + budget.allocatedAmount }
            : budget);
        });
        return {
          organization: quotes[0].organization,
          businessRound: quotes[0].businessRound,
          projectCount: selected.length,
          itemCount: regularItems.length,
          contractAmountReference: selected.reduce((sum, quote) => sum + quote.totalAmount, 0),
          quoteStatus: finalQuotes.length ? "complete" : "draft",
          quoteItemCount: regularItems.length,
          quoteMissingAmountItemCount: regularItems.filter((item) => item.unitPrice <= 0).length,
          quoteConstructionCount: constructionItems.length,
          executionType: primaryQuote?.executionType ?? "직영",
          consortiumCompany:
            primaryQuote?.executionType === "컨소"
              ? primaryQuote.consortiumCompany
              : "",
          constructionAmount: constructionItems.reduce(
            (sum, item) => sum + item.amount,
            0,
          ),
          items: regularItems.map((item) => ({
            id: item.id,
            productId: item.productId,
            name: item.name,
            specification: item.specification,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            amount: item.amount,
            note: item.note,
          })),
          budgets: Array.from(budgetMap.values()),
          quotationCount: selected.length,
        };
      });
      return Response.json({ summaries, totalCount: latestByRoot.size });
    }
    const consortiumRates = deleted === "active"
      ? latestConsortiumRates(await listAuthoredQuotations({ deleted: "active", member }) as AuthoredQuotation[])
      : {};
    if (deleted === "only") {
      for (const quotation of quotations) {
        const stored = await quotationForPermanentDeletion(quotation.id);
        // 과거에 먼저 휴지통으로 들어간 견적도 보관 폴더로 정리하되,
        // Drive의 일시 오류 때문에 휴지통 목록 자체가 열리지 않게 하지는 않습니다.
        await archiveQuotationDriveFiles(quotation.id, stored.row).catch((error) => {
          console.error("Failed to reconcile trashed quotation files", quotation.id, error);
        });
      }
    }
    return Response.json({ quotations, recentConsortiumRates: consortiumRates });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const quotation = await saveAuthoredQuotation(payload, member);
    let protectionSync:
      | Awaited<ReturnType<typeof syncFinalQuotationProtectionItems>>
      | { status: "warning"; added: 0; linked: 0; skipped: 0; projectId: null; warning: string }
      | undefined;
    if (quotation.status === "final") {
      try {
        protectionSync = await syncFinalQuotationProtectionItems(quotation, member);
      } catch (error) {
        console.error("Final quotation protection sync failed", {
          quotationId: quotation.id,
          error,
        });
        protectionSync = {
          status: "warning",
          added: 0,
          linked: 0,
          skipped: 0,
          projectId: null,
          warning:
            "견적은 저장됐지만 영업보호 품목 반영을 완료하지 못했습니다. 견적 목록에서 다시 최종 저장하거나 운영자에게 확인해 주세요.",
        };
      }
    }
    return Response.json({ quotation, protectionSync });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  return POST(request);
}

export async function DELETE(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return Response.json({ error: "삭제할 견적서 정보가 필요합니다." }, { status: 400 });
    }
    const quotation = await trashAuthoredQuotation(id, member);
    const stored = await quotationForPermanentDeletion(id);
    try {
      await archiveQuotationDriveFiles(id, stored.row);
    } catch (error) {
      await restoreAuthoredQuotation(id, member).catch(() => undefined);
      await restoreQuotationDriveFiles(id, stored.d1, stored.row).catch(() => undefined);
      throw error;
    }
    return Response.json({ quotation });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const id = Number(payload.id);
    const action = String(payload.action ?? "");
    if (!Number.isSafeInteger(id) || id < 1) {
      return Response.json({ error: "처리할 견적서 정보가 필요합니다." }, { status: 400 });
    }
    if (action === "restore") {
      const member = await requireApprovedMember();
      const stored = await quotationForPermanentDeletion(id);
      const quotation = await restoreAuthoredQuotation(id, member);
      try {
        await restoreQuotationDriveFiles(id, stored.d1, stored.row);
      } catch (error) {
        await trashAuthoredQuotation(id, member).catch(() => undefined);
        await archiveQuotationDriveFiles(id, stored.row).catch(() => undefined);
        throw error;
      }
      return Response.json({ quotation });
    }
    if (action === "purge") {
      await requireAdminMember();
      const { d1, row } = await quotationForPermanentDeletion(id);
      for (const fileId of [row.drive_pdf_file_id, row.drive_xlsx_file_id, row.source_file_id]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)) {
        await removeDriveFile(fileId);
      }
      const contextId = quotationContextId(row, id);
      await removeDriveFilesByContext({
        folderSegments: [...QUOTATION_LIBRARY_FOLDER_SEGMENTS],
        contextTypes: [
          "authored-quotation-pdf-mirror",
          "authored-quotation-xlsx-mirror",
          "authored-quotation-source-mirror",
        ],
        contextId,
      });
      await d1.prepare("DELETE FROM authored_quotations WHERE id=? AND deleted_at <> ''").bind(id).run();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "지원하지 않는 견적서 처리입니다." }, { status: 400 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

