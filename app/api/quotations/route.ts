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
import { removeDriveFile } from "../../../lib/google-drive-storage";

export const dynamic = "force-dynamic";

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
    return Response.json({ quotations, recentConsortiumRates: consortiumRates });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    return Response.json({ quotation: await saveAuthoredQuotation(payload, member) });
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
    return Response.json({ quotation: await trashAuthoredQuotation(id, member) });
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
      return Response.json({ quotation: await restoreAuthoredQuotation(id, member) });
    }
    if (action === "purge") {
      await requireAdminMember();
      const { d1, row } = await quotationForPermanentDeletion(id);
      for (const fileId of [row.drive_pdf_file_id, row.drive_xlsx_file_id, row.source_file_id].map(String).filter(Boolean)) {
        await removeDriveFile(fileId);
      }
      await d1.prepare("DELETE FROM authored_quotations WHERE id=? AND deleted_at <> ''").bind(id).run();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "지원하지 않는 견적서 처리입니다." }, { status: 400 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

