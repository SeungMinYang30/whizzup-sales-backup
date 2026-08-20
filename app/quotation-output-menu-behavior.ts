"use client";

import { useEffect, useState } from "react";
import { personDisplayLabel } from "../lib/person-label";

type SessionMember = {
  displayName?: string;
  display_name?: string;
  jobTitle?: string;
  job_title?: string;
};

function menuElement(target: EventTarget | null) {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  return element?.closest<HTMLDetailsElement>("details.quotation-output-menu") ?? null;
}

function closeMenus(except: HTMLDetailsElement | null = null) {
  document.querySelectorAll<HTMLDetailsElement>("details.quotation-output-menu[open]").forEach((details) => {
    if (details !== except) {
      details.open = false;
      details.classList.remove("quotation-output-menu-upward");
      const workspace = details.closest<HTMLElement>(".quotation-workspace");
      if (workspace && !workspace.querySelector("details.quotation-output-menu[open]")) {
        workspace.classList.remove("quotation-workspace-menu-open");
      }
    }
  });
}

function positionOpenMenu(details: HTMLDetailsElement) {
  const workspace = details.closest<HTMLElement>(".quotation-workspace");
  if (!details.open) {
    details.classList.remove("quotation-output-menu-upward");
    if (workspace && !workspace.querySelector("details.quotation-output-menu[open]")) {
      workspace.classList.remove("quotation-workspace-menu-open");
    }
    return;
  }

  workspace?.classList.add("quotation-workspace-menu-open");
  details.classList.remove("quotation-output-menu-upward");
  const panel = details.querySelector<HTMLElement>(".quotation-output-menu-panel");
  if (!panel) return;
  const summary = details.querySelector<HTMLElement>("summary");
  const panelRect = panel.getBoundingClientRect();
  const summaryRect = summary?.getBoundingClientRect() ?? details.getBoundingClientRect();
  const roomBelow = window.innerHeight - summaryRect.bottom;
  const roomAbove = summaryRect.top;
  if (panelRect.bottom > window.innerHeight - 12 && roomAbove > roomBelow) {
    details.classList.add("quotation-output-menu-upward");
  }
}

export function closeQuotationOutputMenu(target: EventTarget | null) {
  const details = menuElement(target);
  if (details) details.open = false;
}

export function useAutoCloseQuotationOutputMenus() {
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => closeMenus(menuElement(event.target));
    const closeAfterAction = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest(".quotation-output-menu-panel > button, .quotation-output-menu-panel > a")) {
        closeQuotationOutputMenu(event.target);
      }
    };
    const closeOnScroll = () => closeMenus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    const positionOnToggle = (event: Event) => {
      const details = event.target instanceof HTMLDetailsElement && event.target.matches("details.quotation-output-menu")
        ? event.target
        : null;
      if (details) window.requestAnimationFrame(() => positionOpenMenu(details));
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("click", closeAfterAction);
    document.addEventListener("scroll", closeOnScroll, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("toggle", positionOnToggle, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("click", closeAfterAction);
      document.removeEventListener("scroll", closeOnScroll, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("toggle", positionOnToggle, true);
    };
  }, []);
}

export function useInspectionVisitorName() {
  const [visitorName, setVisitorName] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ member?: SessionMember }>;
      })
      .then((payload) => {
        if (!payload || controller.signal.aborted) return;
        const name = personDisplayLabel(payload.member ?? {});
        if (name) setVisitorName(name);
      })
      .catch(() => {
        // 세션 이름을 읽지 못하면 저장된 견적 수정자 이름을 출력 시 대체값으로 사용합니다.
      });
    return () => controller.abort();
  }, []);
  return [visitorName, setVisitorName] as const;
}

export async function resolveInspectionVisitorName(visitorName: string, fallbackName: string) {
  const enteredName = visitorName.trim();
  if (enteredName) return enteredName;
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) return fallbackName;
    const payload = await response.json() as { member?: SessionMember };
    return personDisplayLabel(payload.member ?? {}) || fallbackName;
  } catch {
    return fallbackName;
  }
}
