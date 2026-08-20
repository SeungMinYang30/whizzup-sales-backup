"use client";

import { useEffect, useRef, useState } from "react";

export type GlobalInstitutionSearchItem = {
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

type CachedInstitutionSearch = {
  items: GlobalInstitutionSearchItem[];
  cachedAt: number;
};

const SEARCH_CACHE_TTL_MS = 30_000;

export default function GlobalInstitutionSearch({
  onOpen,
}: {
  onOpen: (institution: GlobalInstitutionSearchItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GlobalInstitutionSearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef(new Map<string, CachedInstitutionSearch>());

  useEffect(() => {
    if (query.trim().length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    const cached = cacheRef.current.get(normalizedQuery);
    if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
      setItems(cached.items);
      setLoading(false);
      setOpen(true);
      return;
    }
    cacheRef.current.delete(normalizedQuery);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/institutions/search?q=${encodeURIComponent(query.trim())}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            institutions?: GlobalInstitutionSearchItem[];
          };
          if (!response.ok) throw new Error("기관 검색을 완료하지 못했습니다.");
          return payload;
        })
        .then((payload) => {
          const nextItems = Array.isArray(payload.institutions)
            ? payload.institutions
            : [];
          if (nextItems.length) {
            cacheRef.current.set(normalizedQuery, {
              items: nextItems,
              cachedAt: Date.now(),
            });
          } else {
            cacheRef.current.delete(normalizedQuery);
          }
          setItems(nextItems);
          setOpen(true);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 120);
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
          {loading ? <p>기관을 검색하는 중입니다.</p> : items.length ? items.map((item) => (
            <button
              type="button"
              key={`${item.organization}-${item.businessRound}`}
              onClick={() => {
                onOpen(item);
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
