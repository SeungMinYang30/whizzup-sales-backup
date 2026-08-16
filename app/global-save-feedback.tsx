"use client";

import { useEffect, useRef, useState } from "react";

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

type SaveFeedbackDetail = { message: string };

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const rawUrl = input instanceof Request ? input.url : String(input);
  try {
    return { method, url: new URL(rawUrl, window.location.href) };
  } catch {
    return { method, url: null };
  }
}

function isUserDataMutation(method: string, url: URL | null) {
  return Boolean(
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

export function showGlobalSaveError(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SaveFeedbackDetail>(SAVE_FEEDBACK_EVENT, {
    detail: { message },
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
  const [feedback, setFeedback] = useState<{ id: number; message: string } | null>(null);
  const lastFeedbackRef = useRef({ message: "", at: 0 });

  useEffect(() => {
    const notify = (message: string) => {
      const normalized = message.trim();
      if (!normalized) return;
      const now = Date.now();
      if (lastFeedbackRef.current.message === normalized && now - lastFeedbackRef.current.at < 2_000) return;
      lastFeedbackRef.current = { message: normalized, at: now };
      setFeedback({ id: now, message: normalized });
    };
    const handleFeedback = (event: Event) => {
      notify((event as CustomEvent<SaveFeedbackDetail>).detail?.message || "저장 내용을 확인해 주세요.");
    };
    const handleInvalid = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
        notify(fieldLabel(target));
      }
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const details = requestDetails(input, init);
      const mutation = isUserDataMutation(details.method, details.url);
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

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  if (!feedback) return null;
  return <div className="global-save-feedback" role="alert" aria-live="assertive">
    <div><strong>입력·저장 내용을 확인해 주세요</strong><span>{feedback.message}</span></div>
    <button type="button" aria-label="알림 닫기" onClick={() => setFeedback(null)}>×</button>
  </div>;
}
