"use client";

type ResilientFetchInit = RequestInit & {
  timeoutMs?: number;
  retries?: number;
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);

function delayedRetry(attempt: number) {
  const delayMs = Math.min(3_000, 450 * 2 ** attempt);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function resilientFetch(
  input: RequestInfo | URL,
  init: ResilientFetchInit = {},
) {
  const {
    timeoutMs = 15_000,
    retries: requestedRetries,
    signal: externalSignal,
    ...requestInit
  } = init;
  const method = String(requestInit.method || "GET").toUpperCase();
  const retries = requestedRetries ?? (["GET", "HEAD"].includes(method) ? 1 : 0);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const abortFromOutside = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromOutside();
    else externalSignal?.addEventListener("abort", abortFromOutside, { once: true });
    const timeout = setTimeout(() => controller.abort("request-timeout"), timeoutMs);

    try {
      const response = await fetch(input, {
        ...requestInit,
        signal: controller.signal,
      });
      if (attempt < retries && RETRYABLE_STATUS.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        await delayedRetry(attempt);
        continue;
      }
      if (
        !response.ok
        && !response.headers.get("content-type")?.toLowerCase().includes("json")
      ) {
        throw new Error(
          response.status >= 500
            ? "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
            : "요청을 처리하지 못했습니다. 다시 시도해 주세요.",
        );
      }
      return response;
    } catch (error) {
      if (externalSignal?.aborted) throw error;
      if (attempt < retries) {
        await delayedRetry(attempt);
        continue;
      }
      if (controller.signal.aborted) {
        throw new Error(
          "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromOutside);
    }
  }

  throw new Error("서버에 연결하지 못했습니다. 다시 시도해 주세요.");
}
