/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const VERCEL_ORIGIN = "https://whizzup-sales-hub.vercel.app";
const PUBLIC_HOSTS = new Set(["whizzup.kr", "www.whizzup.kr"]);
const DIRECT_WRITE_ALLOWLIST = [
  "/api/standby-sync",
  "/api/standby-cutover",
  "/api/local-auth/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/session",
];

type GatewayState = {
  mode: "vercel" | "sites";
  transition: boolean;
};

async function gatewayState(env: Env): Promise<GatewayState> {
  try {
    const row = await env.DB.prepare(
      `SELECT operating_mode, status
       FROM replication_sync_state
       WHERE id = 1`,
    ).first<{ operating_mode: string; status: string }>();
    return {
      mode: row?.operating_mode === "primary" ? "sites" : "vercel",
      transition: row?.status === "syncing",
    };
  } catch {
    return { mode: "vercel", transition: false };
  }
}

function unsafeMethod(request: Request) {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
}

function directWriteAllowed(pathname: string) {
  return DIRECT_WRITE_ALLOWLIST.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  );
}

function lockedResponse(message: string) {
  return Response.json(
    { error: message, continuityLocked: true },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "15",
        "X-WHIZZUP-Continuity-Lock": "true",
      },
    },
  );
}

async function proxyToVercel(request: Request, url: URL) {
  const target = new URL(`${url.pathname}${url.search}`, VERCEL_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-WHIZZUP-Gateway", "sites-edge");
  const upstream = await fetch(
    new Request(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method.toUpperCase())
        ? undefined
        : request.body,
      redirect: "manual",
    }),
  );
  const responseHeaders = new Headers(upstream.headers);
  const location = responseHeaders.get("location");
  if (location) {
    try {
      const redirect = new URL(location, VERCEL_ORIGIN);
      if (redirect.origin === VERCEL_ORIGIN) {
        responseHeaders.set(
          "location",
          `${url.origin}${redirect.pathname}${redirect.search}${redirect.hash}`,
        );
      }
    } catch {
      // Preserve non-URL Location values unchanged.
    }
  }
  responseHeaders.set("X-WHIZZUP-Gateway", "sites-edge");
  responseHeaders.set("X-WHIZZUP-Gateway-Mode", "vercel");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const state = await gatewayState(env);
    if (url.pathname === "/api/continuity-gateway") {
      return Response.json(
        {
          ok: true,
          gateway: "sites-edge",
          mode: state.mode,
          transition: state.transition,
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-WHIZZUP-Gateway": "sites-edge",
            "X-WHIZZUP-Gateway-Mode": state.mode,
          },
        },
      );
    }

    const publicGatewayRequest = PUBLIC_HOSTS.has(url.hostname.toLowerCase());
    if (state.transition && unsafeMethod(request)) {
      return lockedResponse("서비스 전환을 검증하고 있습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (publicGatewayRequest && state.mode === "vercel") {
      return proxyToVercel(request, url);
    }
    if (
      !publicGatewayRequest &&
      state.mode === "vercel" &&
      unsafeMethod(request) &&
      !directWriteAllowed(url.pathname)
    ) {
      return lockedResponse(
        "대기판은 현재 읽기 전용입니다. 업무 입력은 whizzup.kr에서 진행해 주세요.",
      );
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    headers.set("X-WHIZZUP-Gateway-Mode", state.mode);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
