"use client";

import { useCallback, useEffect, useState } from "react";

type TrashItem = {
  id: string;
  entityType: "record" | "institution" | "quotation";
  displayName: string;
  itemCount: number;
  storedBytes: number;
  deletedByName: string;
  deletedAt: string;
  expiresAt: string;
};

type Props = {
  onDataChanged: () => void | Promise<void>;
  notify: (message: string) => void;
};

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function daysRemaining(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

function entityLabel(item: TrashItem) {
  if (item.entityType === "institution") return `기관 ${item.itemCount}곳`;
  if (item.entityType === "quotation") return "견적서";
  return `활동 기록 ${item.itemCount}건`;
}

function formatBytes(value: number) {
  if (!value) return "";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(value / 1024)).toLocaleString("ko-KR")}KB`;
}

export default function TrashPage({ onDataChanged, notify }: Props) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadTrash = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/trash", { cache: "no-store" });
      const payload = (await response.json()) as {
        items?: TrashItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "휴지통을 불러오지 못했습니다.");
      setItems(payload.items || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "휴지통을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTrash(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTrash]);

  async function restore(item: TrashItem) {
    if (!window.confirm(`${item.displayName} 항목을 원래 위치로 복원할까요?`)) return;
    setBusyId(item.id);
    try {
      const response = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "복원하지 못했습니다.");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      await onDataChanged();
      notify(`${item.displayName} 항목을 복원했습니다.`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "복원하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function permanentlyDelete(item: TrashItem) {
    if (
      !window.confirm(
        `${item.displayName} 항목을 영구 삭제할까요?\n\n이 작업은 다시 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    setBusyId(item.id);
    try {
      const response = await fetch("/api/trash", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "영구 삭제하지 못했습니다.");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      notify(`${item.displayName} 항목을 영구 삭제했습니다.`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "영구 삭제하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="trash-layout">
      <article className="panel trash-panel">
        <div className="panel-header trash-panel-header">
          <div>
            <span className="section-kicker">ADMIN ONLY · 30 DAYS</span>
            <h2>삭제된 항목</h2>
            <p>삭제 후 30일 안에 기관·활동 기록·견적서를 원래 상태로 복원할 수 있습니다.</p>
          </div>
          <button type="button" onClick={() => void loadTrash()} disabled={loading}>
            새로고침
          </button>
        </div>

        {loading ? (
          <div className="loading-state"><i /><span>삭제된 항목을 확인하는 중입니다</span></div>
        ) : error ? (
          <div className="trash-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadTrash()}>다시 불러오기</button>
          </div>
        ) : items.length === 0 ? (
          <div className="trash-empty">
            <span aria-hidden="true">✓</span>
            <strong>휴지통이 비어 있습니다</strong>
            <p>삭제한 항목은 이곳에 30일 동안 보관됩니다.</p>
          </div>
        ) : (
          <div className="trash-list">
            {items.map((item) => (
              <article className="trash-item" key={item.id}>
                <div className={`trash-type trash-type-${item.entityType}`}>
                  {item.entityType === "institution" ? "기관" : item.entityType === "quotation" ? "PDF" : "기록"}
                </div>
                <div className="trash-item-main">
                  <div>
                    <span>{entityLabel(item)}</span>
                    <strong>{item.displayName}</strong>
                  </div>
                  <p>
                    {item.deletedByName} 삭제 · {formatDate(item.deletedAt)}
                    {item.storedBytes > 0 ? ` · 파일 ${formatBytes(item.storedBytes)}` : ""}
                  </p>
                </div>
                <div className="trash-expiry">
                  <span>자동 영구 삭제까지</span>
                  <strong>{daysRemaining(item.expiresAt)}일</strong>
                </div>
                <div className="trash-actions">
                  <button
                    type="button"
                    className="trash-restore"
                    disabled={busyId === item.id}
                    onClick={() => void restore(item)}
                  >
                    {busyId === item.id ? "처리 중…" : "복원"}
                  </button>
                  <button
                    type="button"
                    className="trash-delete"
                    disabled={busyId === item.id}
                    onClick={() => void permanentlyDelete(item)}
                  >
                    영구 삭제
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
