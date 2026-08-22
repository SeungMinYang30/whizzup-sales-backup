import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import {
  googleDriveStorageErrorResponse,
} from "../../../../lib/google-drive-storage";
import {
  retrySiteLayoutDriveSync,
  SiteLayoutConflictError,
  SiteLayoutInputError,
  siteLayoutDriveFile,
  siteLayoutPdfFromBase64,
} from "../../../../lib/site-layout-drafts";

export const dynamic = "force-dynamic";

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function errorResponse(error: unknown) {
  if (error instanceof SiteLayoutConflictError) {
    return Response.json(
      { error: error.message, code: error.code, layout: error.layout },
      { status: error.status },
    );
  }
  if (error instanceof SiteLayoutInputError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return googleDriveStorageErrorResponse(error) ?? accessErrorResponse(error);
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const params = new URL(request.url).searchParams;
    const id = positiveInteger(params.get("id"));
    const kind = params.get("kind") === "pdf" ? "pdf" as const : "json" as const;
    if (!id) {
      throw new SiteLayoutInputError("올바른 기초도면 ID가 필요합니다.");
    }
    const stored = await siteLayoutDriveFile(id, kind);
    return new Response(stored.response.body, {
      headers: {
        "Content-Type": kind === "pdf" ? "application/pdf" : "application/json; charset=utf-8",
        "Content-Disposition": `${kind === "pdf" ? "inline" : "attachment"}; filename="site-layout.${kind}"; filename*=UTF-8''${encodeURIComponent(stored.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const id = positiveInteger(payload.id);
    if (!id) {
      throw new SiteLayoutInputError("올바른 기초도면 ID가 필요합니다.");
    }
    const layout = await retrySiteLayoutDriveSync({
      id,
      pdf: siteLayoutPdfFromBase64(payload.a3PdfBase64),
    });
    return Response.json({ layout });
  } catch (error) {
    return errorResponse(error);
  }
}
