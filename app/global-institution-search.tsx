"use client";

import { useEffect, useRef, useState } from "react";

type Institution = {
  id: number;
  organization: string;
  businessRound: number;
  region: string;
  awardStatus: string;
  awardStage: string;
  progressManager: string;
  contactName: string;
  contactPhone: string;
};

export default function GlobalInstitutionSearch({
  onOpen,
}: {
  onOpen: (organization: string, businessRound: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Institution[]>([]);
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/institutions/search?q=${encodeURIComponent(query.trim())}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => response.json())
        .then((payload: { institutions?: Institution[] }) => {
          setItems(Array.isArray(payload.institutions) ? payload.institutions : []);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="global-institution-search" ref={shellRef}>
      <span aria-hidden="true">⌕</span>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="기관명·담당자·연락처·지역 통합 검색"
        aria-label="전체 기관 통합 검색"
      />
      {open && query.trim().length >= 2 ? (
        <div className="global-institution-results">
          {items.length ? items.map((item) => (
            <button
              type="button"
              key={`${item.organization}-${item.businessRound}`}
              onClick={() => {
                onOpen(item.organization, item.businessRound);
                setOpen(false);
              }}
            >
              <span><strong>{item.organization}</strong><small>{item.region || "지역 미등록"} · {item.businessRound}차 사업</small></span>
              <span><b>{item.awardStatus}</b><small>{item.progressManager || item.contactName || "담당자 미정"}</small></span>
            </button>
          )) : <p>검색 결과가 없습니다.</p>}
        </div>
      ) : null}
    </div>
  );
}
