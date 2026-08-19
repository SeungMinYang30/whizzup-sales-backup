"use client";

import { useEffect, useState } from "react";

const SAVE_FEEDBACK_EVENT = "whizzup:save-feedback";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NON_SAVE_API_PREFIXES = [
  "/api/auth/",
  "/api/local-auth/",
  "/api/oauth/",
  "/api/ai/",
  "/api/presence",
  "/api/session",
  "/api/quotations/reconcile",
  "/api/resources/reconcile",
  "/api/standby-sync",
];

type SaveFeedbackDetail = {
  message: string;
  targetSelector?: string;
  target?: HTMLElement;
};

type SaveFeedbackState = SaveFeedbackDetail & { id: number };

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const rawUrl = input instanceof Request ? input.url : String(input);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const readOnly = headers.get("X-WHIZZUP-Request-Mode") === "read";
  try {
    return { method, url: new URL(rawUrl, window.location.href), readOnly };
  } catch {
    return { method, url: null, readOnly };
  }
}

function isUserDataMutation(method: string, url: URL | null, readOnly = false) {
  return Boolean(
    !readOnly
    &&
    MUTATION_METHODS.has(method)
    && url
    && url.origin === window.location.origin
    && url.pathname.startsWith("/api/")
    && !NON_SAVE_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)),
  );
}

function mutationFailureFallback(method: string) {
  if (method === "DELETE") return "삭제하지 못했습니다. 입력값과 연결된 자료를 확인해 주세요.";
  return "저장하지 못했습니다. 필수 입력값과 인터넷 연결을 확인해 주세요.";
}

function fieldLabel(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  const label = target.closest("label")?.querySelector("span")?.textContent?.trim()
    || target.getAttribute("aria-label")?.trim()
    || target.getAttribute("placeholder")?.trim();
  return label ? `${label} 항목을 확인해 주세요.` : "필수 입력값을 확인해 주세요.";
}

export function showGlobalSaveError(message: string, targetSelector?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SaveFeedbackDetail>(SAVE_FEEDBACK_EVENT, {
    detail: { message, targetSelector },
  }));
}

async function responseErrorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown; message?: unknown };
    const message = String(payload.error || payload.message || "").trim();
    return message || fallback;
  } catch {
    return fallback;
  }
}

export default function GlobalSaveFeedback() {
  const [feedback, setFeedback] = useState<SaveFeedbackState | null>(null);

  useEffect(() => {
    const notify = (message: string, targetSelector?: string, target?: HTMLElement) => {
      const normalized = message.trim();
      if (!normalized) return;
      const now = Date.now();
      setFeedback({ id: now, message: normalized, targetSelector, target });
    };
    const handleFeedback = (event: Event) => {
      const detail = (event as CustomEvent<SaveFeedbackDetail>).detail;
      notify(detail?.message || "저장 내용을 확인해 주세요.", detail?.targetSelector, detail?.target);
    };
    const handleInvalid = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
        event.preventDefault();
        notify(fieldLabel(target), undefined, target);
      }
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const details = requestDetails(input, init);
      const mutation = isUserDataMutation(details.method, details.url, details.readOnly);
      try {
        const response = await originalFetch(input, init);
        if (mutation && !response.ok) {
          const fallback = mutationFailureFallback(details.method);
          void responseErrorMessage(response.clone(), fallback).then(notify);
        }
        return response;
      } catch (error) {
        if (mutation && !(error instanceof DOMException && error.name === "AbortError")) {
          notify("저장 요청을 보내지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
        }
        throw error;
      }
    };
    window.addEventListener(SAVE_FEEDBACK_EVENT, handleFeedback);
    document.addEventListener("invalid", handleInvalid, true);
    return () => {
      window.fetch = originalFetch;
      window.removeEventListener(SAVE_FEEDBACK_EVENT, handleFeedback);
      document.removeEventListener("invalid", handleInvalid, true);
    };
  }, []);

  if (!feedback) return null;
  const hasTarget = Boolean(feedback.target || feedback.targetSelector);
  const moveToTarget = () => {
    const target = feedback.target
      || (feedback.targetSelector ? document.querySelector<HTMLElement>(feedback.targetSelector) : null);
    setFeedback(null);
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("save-feedback-target");
      window.setTimeout(() => target.classList.remove("save-feedback-target"), 2_000);
    });
  };
  return <div className="global-save-feedback" role="presentation">
    <section className="global-save-feedback-dialog" role="alertdialog" aria-modal="true" aria-labelledby="global-save-feedback-title" aria-describedby="global-save-feedback-message">
      <header><strong id="global-save-feedback-title">입력·저장 내용을 확인해 주세요</strong><button type="button" aria-label="알림 닫기" onClick={() => setFeedback(null)}>×</button></header>
      <p id="global-save-feedback-message">{feedback.message}</p>
      <footer>{hasTarget && <button type="button" onClick={moveToTarget}>누락 항목 보기</button>}<button className="primary" type="button" onClick={() => setFeedback(null)}>확인</button></footer>
    </section>
  </div>;
}
