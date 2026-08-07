"use client";

import { useEffect, useMemo, useState } from "react";

type DataControlUnit = {
  id: string;
  organization: string;
  businessRound: number;
  region: string;
  status: string;
  awardStatus: string;
  awardCompany: string;
  progressManager: string;
  source: string;
  budgetNames: string[];
  activityCount: number;
  activityIds: number[];
  latestActivityDate: string;
  testLike: boolean;
};

type ArchiveItem = {
  id: string;
  entityType: string;
  displayName: string;
  itemCount: number;
  deletedByName: string;
  deletedAt: string;
  expiresAt: string;
};

type ControlEvent = {
  id: number;
  action: "archive" | "restore" | "purge";
  subject: string;
  itemCount: number;
  archiveIds: string[];
  actorName: string;
  createdAt: string;
};

type Payload = {
  units: DataControlUnit[];
  archives: ArchiveItem[];
  events: ControlEvent[];
};

type PanelTab = "cleanup" | "archive" | "history";

const categoryOptions = [
  ["all", "전체"],
  ["pre", "수주 전"],
  ["whizzup", "위즈업 수주"],
  ["partner", "협력사 수주"],
  ["other", "타업체 수주"],
  ["test", "테스트 추정"],
] as const;

function formatDate(value: string) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function archiveDaysLeft(expiresAt: string) {
  return Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000),
  );
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}

export default function DataControlPanel({
  safetyBackupDownloaded,
  onSafetyBackup,
  onDataChanged,
  notify,
  backupBusy,
}: {
  safetyBackupDownloaded: boolean;
  onSafetyBackup: () => Promise<void>;
  onDataChanged: () => Promise<void>;
  notify: (message: string) => void;
  backupBusy: boolean;
}) {
  const [tab, setTab] = useState<PanelTab>("cleanup");
  const [payload, setPayload] = useState<Payload>({
    units: [],
    archives: [],
    events: [],
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [region, setRegion] = useState("all");
  const [manager, setManager] = useState("all");
  const [source, setSource] = useState("all");
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<string[]>([]);

  async function load() {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/data-control", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response, "전체 기관 목록을 불러오지 못했습니다."));
      }
      const next = (await response.json()) as Payload;
      setPayload(next);
      setSelectedUnitIds((current) =>
        current.filter((id) => next.units.some((unit) => unit.id === id)),
      );
      setSelectedArchiveIds((current) =>
        current.filter((id) => next.archives.some((archive) => archive.id === id)),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "데이터 관리 화면을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const regions = useMemo(
    () =>
      [...new Set(payload.units.map((unit) => unit.region).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right, "ko"),
      ),
    [payload.units],
  );
  const managers = useMemo(
    () =>
      [
        ...new Set(payload.units.map((unit) => unit.progressManager).filter(Boolean)),
      ].sort((left, right) => left.localeCompare(right, "ko")),
    [payload.units],
  );
  const sources = useMemo(
    () =>
      [...new Set(payload.units.map((unit) => unit.source).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right, "ko"),
      ),
    [payload.units],
  );

  const filteredUnits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return payload.units.filter((unit) => {
      if (region !== "all" && unit.region !== region) return false;
      if (manager !== "all" && unit.progressManager !== manager) return false;
      if (source !== "all" && unit.source !== source) return false;
      if (category === "pre" && unit.awardStatus !== "미정") return false;
      if (category === "whizzup" && unit.awardStatus !== "위즈업 수주") return false;
      if (category === "partner" && unit.awardStatus !== "협력사 수주") return false;
      if (category === "other" && unit.awardStatus !== "타업체 수주") return false;
      if (category === "test" && !unit.testLike) return false;
      if (
        needle &&
        ![
          unit.organization,
          unit.region,
          unit.status,
          unit.awardStatus,
          unit.awardCompany,
          unit.progressManager,
          unit.source,
          unit.budgetNames.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [category, manager, payload.units, query, region, source]);

  const selectedUnits = useMemo(
    () => payload.units.filter((unit) => selectedUnitIds.includes(unit.id)),
    [payload.units, selectedUnitIds],
  );
  const selectedActivityCount = selectedUnits.reduce(
    (total, unit) => total + unit.activityCount,
    0,
  );
  const allFilteredSelected =
    filteredUnits.length > 0 &&
    filteredUnits.every((unit) => selectedUnitIds.includes(unit.id));

  function toggleAllFiltered() {
    const filteredIds = filteredUnits.map((unit) => unit.id);
    setSelectedUnitIds((current) =>
      allFilteredSelected
        ? current.filter((id) => !filteredIds.includes(id))
        : [...new Set([...current, ...filteredIds])],
    );
  }

  async function archiveSelected() {
    if (!selectedUnits.length) {
      notify("보관할 기관·사업을 선택해 주세요.");
      return;
    }
    if (!safetyBackupDownloaded) {
      notify("선택 정리 전 전체 DB 안전 백업을 먼저 내려받아 주세요.");
      return;
    }
    const confirmation = window.prompt(
      `선택한 기관·사업 ${selectedUnits.length}개와 활동 ${selectedActivityCount}건을 30일 보관함으로 이동합니다.\n같은 기관의 다른 사업과 공용 지도 위치는 유지됩니다.\n계속하려면 '선택 보관'을 입력해 주세요.`,
      "",
    );
    if (confirmation?.trim() !== "선택 보관") return;

    const createdArchiveIds: string[] = [];
    try {
      setBusy("archive");
      const ids = [...new Set(selectedUnits.flatMap((unit) => unit.activityIds))];
      let archived = 0;
      for (const idChunk of chunks(ids, 500)) {
        const response = await fetch("/api/records", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: idChunk, dataControl: true }),
        });
        if (!response.ok) {
          throw new Error(
            await readError(response, "선택 데이터를 보관함으로 이동하지 못했습니다."),
          );
        }
        const result = (await response.json()) as {
          deletedCount?: number;
          trashBatchId?: string;
        };
        archived += Number(result.deletedCount) || 0;
        if (result.trashBatchId) createdArchiveIds.push(result.trashBatchId);
      }
      setSelectedUnitIds([]);
      await Promise.all([load(), onDataChanged()]);
      notify(`활동 ${archived.toLocaleString("ko-KR")}건을 복구 가능한 보관함으로 이동했습니다.`);
      setTab("archive");
    } catch (caught) {
      const archiveError =
        caught instanceof Error ? caught.message : "선택 데이터를 정리하지 못했습니다.";
      if (createdArchiveIds.length) {
        const rollback = await fetch("/api/trash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: createdArchiveIds, dataControl: true }),
        }).catch(() => null);
        if (rollback?.ok) {
          await Promise.all([load(), onDataChanged()]);
          notify(`${archiveError} 앞서 이동된 항목은 자동으로 원상 복구했습니다.`);
          return;
        }
      }
      notify(`${archiveError} 보관·복구 탭에서 이동 여부를 확인해 주세요.`);
    } finally {
      setBusy("");
    }
  }

  async function restoreSelected() {
    if (!selectedArchiveIds.length) return;
    if (
      !window.confirm(
        `선택한 보관 항목 ${selectedArchiveIds.length}개를 원래 연결 관계로 복구할까요?`,
      )
    ) {
      return;
    }
    try {
      setBusy("restore");
      const response = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedArchiveIds, dataControl: true }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "선택 항목을 복구하지 못했습니다."));
      }
      setSelectedArchiveIds([]);
      await Promise.all([load(), onDataChanged()]);
      notify("선택한 기관·사업과 연결 자료를 복구했습니다.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "선택 항목을 복구하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function purgeSelected() {
    if (!selectedArchiveIds.length) return;
    if (!safetyBackupDownloaded) {
      notify("영구 삭제 전 전체 DB 안전 백업을 먼저 내려받아 주세요.");
      return;
    }
    const confirmation = window.prompt(
      `선택한 보관 항목 ${selectedArchiveIds.length}개를 복구할 수 없게 영구 삭제합니다.\n계속하려면 '영구 삭제'를 입력해 주세요.`,
      "",
    );
    if (confirmation?.trim() !== "영구 삭제") return;
    try {
      setBusy("purge");
      const response = await fetch("/api/trash", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedArchiveIds, dataControl: true }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "선택 항목을 영구 삭제하지 못했습니다."));
      }
      setSelectedArchiveIds([]);
      await load();
      notify("선택한 보관 항목을 영구 삭제했습니다.");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "영구 삭제하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="panel data-control-panel">
      <div className="backup-restore-heading data-control-heading">
        <div>
          <span className="section-kicker">OWNER DATA CONTROL</span>
          <h3>전체 기관·사업 백업 및 선택 정리</h3>
          <p>
            수주 전·후를 한곳에서 구분해 보고, 전체 백업 후 선택한 사업만
            복구 가능한 보관함으로 옮깁니다.
          </p>
        </div>
        <span className="backup-owner-badge">운영관리자 본인 전용</span>
      </div>

      <div className="data-control-tabs" role="tablist" aria-label="데이터 관리 구분">
        <button
          type="button"
          className={tab === "cleanup" ? "active" : ""}
          onClick={() => setTab("cleanup")}
        >
          선택 데이터 정리
          <span>{payload.units.length.toLocaleString("ko-KR")}</span>
        </button>
        <button
          type="button"
          className={tab === "archive" ? "active" : ""}
          onClick={() => setTab("archive")}
        >
          보관·복구
          <span>{payload.archives.length.toLocaleString("ko-KR")}</span>
        </button>
        <button
          type="button"
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          처리 이력
          <span>{payload.events.length.toLocaleString("ko-KR")}</span>
        </button>
      </div>

      {error && (
        <div className="backup-error">
          {error}
          <button type="button" onClick={() => void load()}>
            다시 불러오기
          </button>
        </div>
      )}

      {tab === "cleanup" && (
        <>
          <div className="data-control-safety">
            <div>
              <strong>
                {safetyBackupDownloaded ? "✓ 이번 화면에서 안전 백업 완료" : "정리 전 안전 백업 필수"}
              </strong>
              <span>보관 이동은 30일 동안 복구할 수 있고, 영구 삭제는 별도 확인이 필요합니다.</span>
            </div>
            <button
              type="button"
              className={safetyBackupDownloaded ? "ghost-button done" : "primary-button"}
              disabled={backupBusy || Boolean(busy)}
              onClick={() => void onSafetyBackup()}
            >
              {backupBusy ? "전체 백업 만드는 중…" : safetyBackupDownloaded ? "안전 백업 다시 받기" : "전체 DB 안전 백업 받기"}
            </button>
          </div>

          <div className="data-control-filters">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="기관명·예산·담당자·수주업체 검색"
            />
            <select value={region} onChange={(event) => setRegion(event.target.value)}>
              <option value="all">전체 지역</option>
              {regions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select value={manager} onChange={(event) => setManager(event.target.value)}>
              <option value="all">전체 담당자</option>
              {managers.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="all">전체 등록 경로</option>
              {sources.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>

          <div className="data-control-categories">
            {categoryOptions.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={category === value ? "active" : ""}
                onClick={() => setCategory(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="data-control-selection">
            <label>
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAllFiltered}
              />
              현재 검색 결과 전체 선택
            </label>
            <span>
              사업 {selectedUnits.length.toLocaleString("ko-KR")}개 · 활동{" "}
              {selectedActivityCount.toLocaleString("ko-KR")}건 선택
            </span>
            <button
              type="button"
              className="data-control-archive-button"
              disabled={!selectedUnits.length || Boolean(busy)}
              onClick={() => void archiveSelected()}
            >
              {busy === "archive" ? "보관함으로 이동 중…" : "선택 항목 보관"}
            </button>
          </div>

          <div className="data-control-table-wrap">
            {loading ? (
              <div className="backup-checking">전체 기관·사업을 불러오는 중…</div>
            ) : filteredUnits.length === 0 ? (
              <div className="data-control-empty">조건에 맞는 기관·사업이 없습니다.</div>
            ) : (
              <table className="data-control-table">
                <thead>
                  <tr>
                    <th>선택</th>
                    <th>기관·사업</th>
                    <th>구분</th>
                    <th>지역·예산</th>
                    <th>진행 담당자</th>
                    <th>등록 경로</th>
                    <th>기록</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUnits.map((unit) => (
                    <tr key={unit.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${unit.organization} ${unit.businessRound}차 사업 선택`}
                          checked={selectedUnitIds.includes(unit.id)}
                          onChange={() =>
                            setSelectedUnitIds((current) =>
                              current.includes(unit.id)
                                ? current.filter((id) => id !== unit.id)
                                : [...current, unit.id],
                            )
                          }
                        />
                      </td>
                      <td>
                        <strong>{unit.organization}</strong>
                        <span>{unit.businessRound}차 사업 · 최근 {unit.latestActivityDate || "날짜 미정"}</span>
                      </td>
                      <td>
                        <span className={`data-control-award award-${unit.awardStatus === "미정" ? "pre" : unit.awardStatus === "위즈업 수주" ? "ours" : unit.awardStatus === "협력사 수주" ? "partner" : "other"}`}>
                          {unit.awardStatus === "미정" ? "수주 전" : unit.awardStatus}
                        </span>
                        <small>{unit.awardCompany || unit.status}</small>
                      </td>
                      <td>
                        <strong>{unit.region || "지역 미정"}</strong>
                        <span>{unit.budgetNames.join(", ") || "예산 미정"}</span>
                      </td>
                      <td>{unit.progressManager}</td>
                      <td>
                        {unit.source}
                        {unit.testLike && <small className="test-like">테스트 추정</small>}
                      </td>
                      <td>{unit.activityCount.toLocaleString("ko-KR")}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "archive" && (
        <>
          <div className="data-control-selection">
            <label>
              <input
                type="checkbox"
                checked={
                  payload.archives.length > 0 &&
                  payload.archives.every((item) => selectedArchiveIds.includes(item.id))
                }
                onChange={() =>
                  setSelectedArchiveIds((current) =>
                    payload.archives.every((item) => current.includes(item.id))
                      ? []
                      : payload.archives.map((item) => item.id),
                  )
                }
              />
              보관 항목 전체 선택
            </label>
            <span>{selectedArchiveIds.length.toLocaleString("ko-KR")}개 선택</span>
            <div className="data-control-archive-actions">
              <button
                type="button"
                disabled={!selectedArchiveIds.length || Boolean(busy)}
                onClick={() => void restoreSelected()}
              >
                {busy === "restore" ? "복구 중…" : "선택 복구"}
              </button>
              <button
                type="button"
                className="danger"
                disabled={!selectedArchiveIds.length || Boolean(busy)}
                onClick={() => void purgeSelected()}
              >
                {busy === "purge" ? "영구 삭제 중…" : "영구 삭제"}
              </button>
            </div>
          </div>
          <div className="data-control-archive-list">
            {payload.archives.length === 0 ? (
              <div className="data-control-empty">복구 가능한 보관 항목이 없습니다.</div>
            ) : (
              payload.archives.map((item) => (
                <label key={item.id} className="data-control-archive-row">
                  <input
                    type="checkbox"
                    checked={selectedArchiveIds.includes(item.id)}
                    onChange={() =>
                      setSelectedArchiveIds((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                  />
                  <div>
                    <strong>{item.displayName}</strong>
                    <span>
                      {item.itemCount.toLocaleString("ko-KR")}건 · {item.deletedByName} ·{" "}
                      {formatDate(item.deletedAt)}
                    </span>
                  </div>
                  <em>{archiveDaysLeft(item.expiresAt)}일 내 복구</em>
                </label>
              ))
            )}
          </div>
        </>
      )}

      {tab === "history" && (
        <div className="data-control-history">
          {payload.events.length === 0 ? (
            <div className="data-control-empty">선택 정리·복구 이력이 없습니다.</div>
          ) : (
            payload.events.map((event) => (
              <div key={event.id}>
                <span className={`history-${event.action}`}>
                  {event.action === "archive"
                    ? "보관"
                    : event.action === "restore"
                      ? "복구"
                      : "영구 삭제"}
                </span>
                <div>
                  <strong>{event.subject}</strong>
                  <p>
                    {event.itemCount.toLocaleString("ko-KR")}건 · {event.actorName}
                  </p>
                </div>
                <time>{formatDate(event.createdAt)}</time>
              </div>
            ))
          )}
        </div>
      )}
    </article>
  );
}
