import { accessErrorResponse, requirePrimaryOwner } from "../../../../lib/collaboration";
import { compareLegacySource, mergeLegacySource } from "../../../../lib/legacy-source-merge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    await requirePrimaryOwner();
    return Response.json(await compareLegacySource(new URL(request.url).origin), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requirePrimaryOwner();
    return Response.json(await mergeLegacySource(
      { id: member.id, displayName: member.displayName },
      new URL(request.url).origin,
    ));
  } catch (error) {
    console.error("Legacy source merge failed", error);
    return accessErrorResponse(error);
  }
}
