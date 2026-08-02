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

type TrashActionResponse = {
  error?: string;
  processed?: number;
  processedIds?: string[];
  failedCount?: number;
  failures?: Array<{
    id: string;
    displayName: string;
    error: string;
  }>;
};

function actionResultMessage(
  action: string,
  payload: TrashActionResponse,
) {
  const processed = payload.processed ?? payload.processedIds?.length ?? 0;
  const failures = payload.failures || [];
  if (!failures.length) return `${processed}개 항목을 ${action}했습니다.`;
  const names = failures
    .slice(0, 3)
    .map((failure) => failure.displayName)
    .join(", ");
  return `${processed}개 ${action}, ${failures.length}개 실패: ${names}${
    failures.length > 3 ? ` 외 ${failures.length - 3}개` : ""
  }`;
}

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
      setSelectedIds([]);
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

  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const busy = Boolean(busyId);

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : items.map((item) => item.id));
  }

  async function restoreSelected() {
    if (!selectedIds.length || busy) return;
    if (!window.confirm(`선택한 ${selectedIds.length}개 항목을 원래 위치로 복원할까요?`)) return;
    setBusyId("bulk-restore");
    try {
      const response = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const payload = (await response.json()) as TrashActionResponse;
      if (!response.ok) throw new Error(payload.error || "선택 항목을 복원하지 못했습니다.");
      const processedIds = new Set(payload.processedIds || []);
      setItems((current) =>
        current.filter((item) => !processedIds.has(item.id)),
      );
      setSelectedIds((current) =>
        current.filter((id) => !processedIds.has(id)),
      );
      if (processedIds.size) await onDataChanged();
      notify(actionResultMessage("복원", payload));
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "선택 항목을 복원하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteSelected() {
    if (!selectedIds.length || busy) return;
    if (!window.confirm(`선택한 ${selectedIds.length}개 항목을 영구 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다.`)) return;
    setBusyId("bulk-delete");
    try {
      const response = await fetch("/api/trash", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const payload = (await response.json()) as TrashActionResponse;
      if (!response.ok) throw new Error(payload.error || "선택 항목을 영구 삭제하지 못했습니다.");
      const processedIds = new Set(payload.processedIds || []);
      setItems((current) =>
        current.filter((item) => !processedIds.has(item.id)),
      );
      setSelectedIds((current) =>
        current.filter((id) => !processedIds.has(id)),
      );
      notify(actionResultMessage("영구 삭제", payload));
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "선택 항목을 영구 삭제하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function emptyTrash() {
    if (!items.length || busy) return;
    const confirmation = window.prompt(
      `휴지통의 ${items.length}개 항목을 모두 영구 삭제합니다.\n계속하려면 '휴지통 비우기'를 입력해 주세요.`,
    );
    if (confirmation?.trim() !== "휴지통 비우기") return;
    setBusyId("empty");
    try {
      const response = await fetch("/api/trash", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const payload = (await response.json()) as TrashActionResponse;
      if (!response.ok) throw new Error(payload.error || "휴지통을 비우지 못했습니다.");
      const processedIds = new Set(payload.processedIds || []);
      setItems((current) =>
        current.filter((item) => !processedIds.has(item.id)),
      );
      setSelectedIds((current) =>
        current.filter((id) => !processedIds.has(id)),
      );
      notify(actionResultMessage("영구 삭제", payload));
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "휴지통을 비우지 못했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function restore(item: TrashItem) {
    if (!window.confirm(`${item.displayName} 항목을 원래 위치로 복원할까요?`)) return;
    setBusyId(item.id);
    try {
      const response = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const payload = (await response.json()) as TrashActionResponse;
      if (!response.ok) throw new Error(payload.error || "복원하지 못했습니다.");
      if (payload.failures?.length) {
        throw new Error(payload.failures[0].error || "복원하지 못했습니다.");
      }
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setSelectedIds((current) => current.filter((id) => id !== item.id));
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
      const payload = (await response.json()) as TrashActionResponse;
      if (!response.ok) throw new Error(payload.error || "영구 삭제하지 못했습니다.");
      if (payload.failures?.length) {
        throw new Error(
          payload.failures[0].error || "영구 삭제하지 못했습니다.",
        );
      }
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setSelectedIds((current) => current.filter((id) => id !== item.id));
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
          <div className="trash-header-actions">
            <button
              type="button"
              className="trash-empty-all"
              onClick={() => void emptyTrash()}
              disabled={loading || busy || items.length === 0}
            >
              휴지통 전체 비우기
            </button>
            <button type="button" onClick={() => void loadTrash()} disabled={loading || busy}>
              새로고침
            </button>
          </div>
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
            <div className="trash-selection-bar">
              <label>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={busy}
                />
                전체 선택
              </label>
              <span>{selectedIds.length}개 선택</span>
              <div>
                <button
                  type="button"
                  className="trash-bulk-restore"
                  disabled={!selectedIds.length || busy}
                  onClick={() => void restoreSelected()}
                >
                  선택 복구
                </button>
                <button
                  type="button"
                  className="trash-bulk-delete"
                  disabled={!selectedIds.length || busy}
                  onClick={() => void deleteSelected()}
                >
                  선택 영구 삭제
                </button>
              </div>
            </div>
            {items.map((item) => (
              <article
                className={`trash-item ${selectedIds.includes(item.id) ? "selected" : ""}`}
                key={item.id}
              >
                <label className="trash-select" aria-label={`${item.displayName} 선택`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    disabled={busy}
                  />
                </label>
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
                    disabled={busy}
                    onClick={() => void restore(item)}
                  >
                    {busyId === item.id ? "처리 중…" : "복원"}
                  </button>
                  <button
                    type="button"
                    className="trash-delete"
                    disabled={busy}
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
