import {
  AccessError,
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  BudgetRequestSuggestionError,
  findBudgetCatalogSuggestions,
  listActiveBudgetCatalog,
  submitBudgetNameRequest,
} from "../../../lib/budget-names";
import {
  readRegisteredQuoteForBudget,
  resolveBudgetAmountPresentation,
} from "../../../lib/budget-policy";
import { getD1 } from "../../../db";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  try {
    const member = await requireApprovedMember();
    const url = new URL(request.url);
    const query = clean(url.searchParams.get("q"));
    const organization = clean(url.searchParams.get("organization"));
    const businessRound = Number(url.searchParams.get("businessRound")) || 1;
    const awardStatus = clean(url.searchParams.get("awardStatus"));
    const budgetKind = clean(url.searchParams.get("budgetKind"));
    const budgetAmountMode = clean(url.searchParams.get("budgetAmountMode"));
    const budgetAmount = clean(url.searchParams.get("budgetAmount"));
    const budgetAmountOverride = clean(
      url.searchParams.get("budgetAmountOverride"),
    );
    const payload = await listActiveBudgetCatalog(member);
    const suggestions = query
      ? await findBudgetCatalogSuggestions(query)
      : [];
    let quoteSummary:
      | (Awaited<ReturnType<typeof readRegisteredQuoteForBudget>> & {
          amountSource?: string;
          displayAmount?: string;
          manualAmount?: string;
        })
      | null = null;
    if (organization) {
      const quote = await readRegisteredQuoteForBudget(getD1(), {
        organization,
        businessRound,
        awardStatus,
      });
      quoteSummary =
        budgetKind === "purpose" || budgetKind === "self"
          ? resolveBudgetAmountPresentation({
              budgetKind,
              budgetAmountMode:
                budgetAmountMode === "quote_auto" ? "quote_auto" : "manual",
              budgetAmount,
              budgetAmountOverride,
              quote,
            })
          : quote;
    }
    return Response.json({ ...payload, suggestions, quoteSummary });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    if (clean(payload.action) !== "submit-request") {
      return Response.json(
        { error: "지원하지 않는 예산명 신청 작업입니다." },
        { status: 400 },
      );
    }
    return Response.json(await submitBudgetNameRequest(member, payload));
  } catch (error) {
    if (error instanceof BudgetRequestSuggestionError) {
      return Response.json(
        { error: error.message, suggestions: error.suggestions },
        { status: 409 },
      );
    }
    if (error instanceof AccessError) return accessErrorResponse(error);
    if (error instanceof Error && error.message) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}
