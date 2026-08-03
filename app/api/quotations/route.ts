import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  listAuthoredQuotations,
  saveAuthoredQuotation,
} from "../../../lib/authored-quotations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ quotations: await listAuthoredQuotations(query) });
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

