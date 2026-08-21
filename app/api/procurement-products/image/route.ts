import { accessErrorResponse, requireApprovedMember } from "../../../../lib/collaboration";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function allowedImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "g2b.go.kr" || url.hostname.endsWith(".g2b.go.kr"));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const sourceUrl = new URL(request.url).searchParams.get("url") || "";
    if (!allowedImageUrl(sourceUrl)) {
      return Response.json({ error: "허용되지 않은 나라장터 이미지 주소입니다." }, { status: 400 });
    }

    const response = await fetch(sourceUrl, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || !response.body) {
      return Response.json({ error: "나라장터 이미지를 불러오지 못했습니다." }, { status: 502 });
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() || "";
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (!contentType.startsWith("image/") || (contentLength > 0 && contentLength > MAX_IMAGE_BYTES)) {
      return Response.json({ error: "지원하지 않는 나라장터 이미지입니다." }, { status: 415 });
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: "나라장터 이미지 용량이 너무 큽니다." }, { status: 413 });
    }
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, max-age=21600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
