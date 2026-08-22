import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  getSiteLayout,
  listSiteLayoutRevisions,
  listSiteLayouts,
  saveSiteLayout,
  SiteLayoutConflictError,
  SiteLayoutInputError,
  siteLayoutPdfFromBase64,
  syncSiteLayoutDriveFiles,
  trashSiteLayout,
} from "../../../lib/site-layout-drafts";

export const dynamic = "force-dynamic";

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function siteLayoutErrorResponse(error: unknown) {
  if (error instanceof SiteLayoutConflictError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        layout: error.layout,
      },
      { status: error.status },
    );
  }
  if (error instanceof SiteLayoutInputError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return accessErrorResponse(error);
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const params = new URL(request.url).searchParams;
    const id = positiveInteger(params.get("id"));
    if (!id) {
      return Response.json({
        layouts: await listSiteLayouts({ query: params.get("q") }),
      });
    }
    const layout = await getSiteLayout(id);
    if (!layout) {
      throw new SiteLayoutInputError(
        "기초도면을 찾지 못했습니다.",
        404,
        "NOT_FOUND",
      );
    }
    const revisions = params.get("revisions") === "1"
      ? await listSiteLayoutRevisions(id)
      : undefined;
    return Response.json({ layout, ...(revisions ? { revisions } : {}) });
  } catch (error) {
    return siteLayoutErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const pdf = siteLayoutPdfFromBase64(payload.a3PdfBase64);
    const isNew = !positiveInteger(payload.id);
    const saved = await saveSiteLayout(payload, member);
    let layout = saved.layout;
    try {
      layout = await syncSiteLayoutDriveFiles({
        id: saved.layout.id,
        syncToken: saved.syncToken,
        pdf,
      });
    } catch (error) {
      if (
        error instanceof SiteLayoutConflictError
        || (error instanceof SiteLayoutInputError && error.status === 409)
      ) {
        throw error;
      }
      console.error("Site layout Drive sync failed after durable database save", {
        id: saved.layout.id,
        editVersion: saved.layout.editVersion,
        error,
      });
      const latest = await getSiteLayout(saved.layout.id);
      if (latest && latest.driveSyncToken !== saved.syncToken) {
        throw new SiteLayoutConflictError(latest);
      }
      layout = latest ?? saved.layout;
    }
    return Response.json({ layout }, { status: isNew ? 201 : 200 });
  } catch (error) {
    return siteLayoutErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  return POST(request);
}

export async function DELETE(request: Request) {
  try {
    const member = await requireApprovedMember();
    const params = new URL(request.url).searchParams;
    const id = positiveInteger(params.get("id"));
    const baseVersion = positiveInteger(params.get("baseVersion"));
    return Response.json(await trashSiteLayout(id, baseVersion, member));
  } catch (error) {
    return siteLayoutErrorResponse(error);
  }
}
