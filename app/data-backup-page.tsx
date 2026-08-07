"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import TrashPage from "./trash-page";

type BackupInspection = {
  valid: true;
  formatVersion: number;
  schemaVersion: string;
  createdAt: string;
  checksum: string;
  totalRows: number;
  counts: Record<string, number>;
  excluded: string[];
  compatibilityNotices: string[];
};

type CsvInspection = {
  totalRows: number;
  importableRows: number;
  duplicateRows: number;
  errorRows: number;
  errors: { row: number; message: string }[];
};

type DownloadKind = "full" | "activities-csv" | "emergency" | "offline";

const tableLabels: Record<string, string> = {
  members: "구성원·권한",
  activities: "기관 활동 기록",
  activity_authors: "기록 입력자",
  app_settings: "사이트 설정",
  organization_locations: "지도 주소·좌표",
  organization_schedules: "기관 일정",
  sales_campaigns: "영업 묶음",
  sales_campaign_targets: "묶음 영업 대상",
  joint_projects: "공동사업",
  joint_project_members: "공동사업 기관 연결",
  joint_project_events: "공동사업 변경 이력",
  equipment_projects: "사업",
  equipment_items: "품목·설치 상태",
  data_control_events: "선택 정리·복구 이력",
  holdem_weekly_scores: "홀덤 주간 순위",
};

function responseFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const matched = disposition.match(/filename="([^"]+)"/i);
  return matched?.[1] || fallback;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function formatDateTime(value: string) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

async function compressedJsonRequest(payload: unknown) {
  const json = JSON.stringify(payload);
  if (typeof CompressionStream === "undefined") {
    return {
      headers: { "Content-Type": "application/json" },
      body: json,
    };
  }

  const compressed = new Blob([json])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return {
    headers: { "Content-Type": "application/gzip" },
    body: await new Response(compressed).arrayBuffer(),
  };
}

async function downloadableBlob(response: Response) {
  if (response.headers.get("x-whizzup-content-encoding") !== "gzip") {
    return response.blob();
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "이 브라우저는 대용량 백업 압축 해제를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요.",
    );
  }
  const compressed = new Blob([await response.arrayBuffer()]).stream();
  const decompressed = compressed.pipeThrough(new DecompressionStream("gzip"));
  return new Response(decompressed, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }).blob();
}

export default function DataBackupPage({
  onDataChanged,
  notify,
  isPrimaryOwner,
  canManageBackup,
  canManageTrash,
}: {
  onDataChanged: () => Promise<void>;
  notify: (message: string) => void;
  isPrimaryOwner: boolean;
  canManageBackup: boolean;
  canManageTrash: boolean;
}) {
  const [activeSection, setActiveSection] = useState<"trash" | "backup">(
    canManageTrash ? "trash" : "backup",
  );
  const [busy, setBusy] = useState("");
  const [lastBackupAt, setLastBackupAt] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.localStorage.getItem("whizzup-last-full-backup-at") ?? ""),
  );
  const [pageOpenedAt] = useState(() => Date.now());
  const [backupFileName, setBackupFileName] = useState("");
  const [backupPayload, setBackupPayload] = useState<unknown>(null);
  const [backupInspection, setBackupInspection] =
    useState<BackupInspection | null>(null);
  const [backupError, setBackupError] = useState("");
  const [safetyBackupDownloaded, setSafetyBackupDownloaded] = useState(false);
  useEffect(() => {
    const savedAt = window.localStorage.getItem("whizzup-last-full-backup-at");
    const timestamp = savedAt ? Date.parse(savedAt) : Number.NaN;
    if (Number.isFinite(timestamp) && Date.now() - timestamp <= 30 * 60 * 1000) {
      setSafetyBackupDownloaded(true);
    }
  }, []);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvInspection, setCsvInspection] =
    useState<CsvInspection | null>(null);
  const [csvError, setCsvError] = useState("");

  const backupReminder = useMemo(() => {
    if (!lastBackupAt) return "첫 전체 백업을 내려받아 안전한 폴더에 보관해 주세요.";
    const elapsed = pageOpenedAt - new Date(lastBackupAt).getTime();
    const days = Math.max(0, Math.floor(elapsed / 86_400_000));
    return days >= 7
      ? `마지막 전체 백업 후 ${days}일이 지났습니다. 새 백업을 권장합니다.`
      : `마지막 전체 백업: ${formatDateTime(lastBackupAt)}`;
  }, [lastBackupAt, pageOpenedAt]);

  async function download(kind: DownloadKind, safety = false) {
    try {
      setBusy(safety ? "safety-download" : `download-${kind}`);
      const response = await fetch(`/api/backup?kind=${kind}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          await readError(response, "백업 파일을 만들지 못했습니다."),
        );
      }
      const blob = await downloadableBlob(response);
      saveBlob(
        blob,
        responseFilename(
          response,
          kind === "full"
            ? "WHIZZUP_full_backup.json"
            : kind === "activities-csv"
              ? "WHIZZUP_activities.csv"
              : kind === "emergency"
                ? "WHIZZUP_emergency_recovery.zip"
                : "WHIZZUP_offline_edition.zip",
        ),
      );
      if (kind === "full" || kind === "emergency" || kind === "offline") {
        const now = new Date().toISOString();
        setLastBackupAt(now);
        window.localStorage.setItem("whizzup-last-full-backup-at", now);
        if (kind === "full" && safety) setSafetyBackupDownloaded(true);
        notify(
          kind === "emergency"
            ? "비상복구 패키지를 내려받았습니다."
            : kind === "offline"
              ? "오프라인 독립판을 내려받았습니다."
              : safety
            ? "복원 직전 안전 백업을 내려받았습니다."
            : "전체 DB 백업 파일을 내려받았습니다.",
        );
      } else {
        notify("전체 활동 CSV를 내려받았습니다.");
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "파일을 내려받지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  async function inspectBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupFileName(file.name);
    setBackupPayload(null);
    setBackupInspection(null);
    setBackupError("");
    setRestoreConfirmation("");
    if (file.size > 12 * 1024 * 1024) {
      setBackupError("12MB 이하의 전체 백업 파일을 선택해 주세요.");
      return;
    }
    try {
      setBusy("inspect-backup");
      const text = await file.text();
      const backup = JSON.parse(text) as unknown;
      const request = await compressedJsonRequest({
        action: "inspect-backup",
        backup,
      });
      const response = await fetch("/api/backup", {
        method: "POST",
        ...request,
      });
      const payload = (await response.json()) as {
        inspection?: BackupInspection;
        error?: string;
      };
      if (!response.ok || !payload.inspection) {
        throw new Error(payload.error || "백업 파일을 검사하지 못했습니다.");
      }
      setBackupPayload(backup);
      setBackupInspection(payload.inspection);
    } catch (error) {
      setBackupError(
        error instanceof SyntaxError
          ? "JSON 형식의 WHIZZUP 전체 백업 파일이 아닙니다."
          : error instanceof Error
            ? error.message
            : "백업 파일을 검사하지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  async function restoreBackup() {
    if (!backupPayload || !backupInspection) return;
    if (
      !window.confirm(
        "현재 업무 DB를 선택한 백업 시점으로 전체 교체합니다. 계속할까요?",
      )
    ) {
      return;
    }
    try {
      setBusy("restore");
      const request = await compressedJsonRequest({
        action: "restore-backup",
        backup: backupPayload,
        confirmation: restoreConfirmation,
        safetyBackupDownloaded,
      });
      const response = await fetch("/api/backup", {
        method: "POST",
        ...request,
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "전체 DB를 복원하지 못했습니다.");
      }
      await onDataChanged();
      notify("전체 DB 복원이 완료되었습니다.");
      setBackupPayload(null);
      setBackupInspection(null);
      setBackupFileName("");
      setRestoreConfirmation("");
      setSafetyBackupDownloaded(false);
    } catch (error) {
      setBackupError(
        error instanceof Error ? error.message : "전체 DB를 복원하지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  async function inspectCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCsvFileName(file.name);
    setCsvText("");
    setCsvInspection(null);
    setCsvError("");
    if (file.size > 12 * 1024 * 1024) {
      setCsvError("12MB 이하의 활동 CSV 파일을 선택해 주세요.");
      return;
    }
    try {
      setBusy("inspect-csv");
      const csv = await file.text();
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect-csv", csv }),
      });
      const payload = (await response.json()) as {
        inspection?: CsvInspection;
        error?: string;
      };
      if (!response.ok || !payload.inspection) {
        throw new Error(payload.error || "CSV를 검사하지 못했습니다.");
      }
      setCsvText(csv);
      setCsvInspection(payload.inspection);
    } catch (error) {
      setCsvError(
        error instanceof Error ? error.message : "CSV를 검사하지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  async function importCsv() {
    if (!csvText || !csvInspection || csvInspection.errorRows > 0) return;
    try {
      setBusy("import-csv");
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import-csv", csv: csvText }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        result?: { importedRows?: number };
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "활동 CSV를 불러오지 못했습니다.");
      }
      await onDataChanged();
      notify(
        `${payload.result?.importedRows ?? 0}건의 활동 기록을 불러왔습니다.`,
      );
      setCsvFileName("");
      setCsvText("");
      setCsvInspection(null);
    } catch (error) {
      setCsvError(
        error instanceof Error ? error.message : "활동 CSV를 불러오지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  const sectionTabs = (
    <div className="backup-section-tabs" role="tablist" aria-label="데이터 복구 메뉴">
      {canManageTrash && (
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "trash"}
          className={activeSection === "trash" ? "active" : ""}
          onClick={() => setActiveSection("trash")}
        >
          휴지통 복구
        </button>
      )}
      {canManageBackup && (
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "backup"}
          className={activeSection === "backup" ? "active" : ""}
          onClick={() => setActiveSection("backup")}
        >
          전체 DB 백업·복원
        </button>
      )}
    </div>
  );

  if (activeSection === "trash" && canManageTrash) {
    return (
      <section className="backup-workspace">
        {sectionTabs}
        <TrashPage
          onDataChanged={onDataChanged}
          notify={notify}
          canPermanentlyDelete={isPrimaryOwner}
        />
      </section>
    );
  }

  return (
    <section className="backup-workspace">
      {sectionTabs}
    <section className="backup-layout">
      <article className="panel backup-hero">
        <div>
          <span className="section-kicker">DATA SAFETY</span>
          <h2>업무 데이터 전체를 한 파일로 안전하게 보관</h2>
          <p>
            기관 기록뿐 아니라 지도 주소·좌표, 영업 묶음, 수주 사업과 품목,
            구성원 권한까지 함께 저장합니다.
          </p>
        </div>
        <div className="backup-reminder">
          <span>주 1회 권장</span>
          <strong>{backupReminder}</strong>
        </div>
      </article>

      <div className="backup-card-grid backup-card-grid-single">
        <article className="panel backup-card">
          <div className="backup-card-number">01</div>
          <span className="section-kicker">ACTIVITY CSV</span>
          <h3>활동 CSV 불러오기</h3>
          <p>
            엑셀에서 정리한 기관 활동을 추가합니다. 기존 기록과 같은 ID나
            내용은 자동으로 건너뜁니다.
          </p>
          <div className="backup-inline-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={Boolean(busy)}
              onClick={() => void download("activities-csv")}
            >
              전체 활동 CSV 받기
            </button>
            <label className="backup-file-button">
              CSV 파일 선택
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void inspectCsvFile(event)}
              />
            </label>
          </div>
          {csvFileName && (
            <p className="backup-selected-file">선택 파일 · {csvFileName}</p>
          )}
          {csvError && <div className="backup-error">{csvError}</div>}
          {csvInspection && (
            <div className="backup-inspection">
              <div className="backup-stat-row">
                <span>
                  전체 <strong>{csvInspection.totalRows}</strong>
                </span>
                <span className="success">
                  추가 <strong>{csvInspection.importableRows}</strong>
                </span>
                <span>
                  중복 <strong>{csvInspection.duplicateRows}</strong>
                </span>
                <span className={csvInspection.errorRows ? "danger" : ""}>
                  오류 <strong>{csvInspection.errorRows}</strong>
                </span>
              </div>
              {csvInspection.errors.length > 0 && (
                <ul className="backup-error-list">
                  {csvInspection.errors.map((item) => (
                    <li key={`${item.row}-${item.message}`}>
                      {item.row}행 · {item.message}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="setup-primary"
                disabled={
                  Boolean(busy) ||
                  csvInspection.importableRows === 0 ||
                  csvInspection.errorRows > 0
                }
                onClick={() => void importCsv()}
              >
                {busy === "import-csv"
                  ? "기록 불러오는 중…"
                  : `${csvInspection.importableRows}건 불러오기`}
              </button>
            </div>
          )}
          <p className="backup-security-note">
            CSV는 활동 기록용입니다. 지도·품목·권한까지 복구하려면 전체 DB
            백업을 사용해 주세요.
          </p>
        </article>
      </div>

      <article className="panel backup-portability-card">
        <div className="backup-restore-heading">
          <div>
            <span className="section-kicker">PORTABILITY &amp; OFFLINE</span>
            <h3>서비스 이전·오프라인 대비</h3>
            <p>
              Sites를 사용할 수 없는 상황에도 다른 호스팅에서 작업을 이어가거나,
              인터넷 없이 최신 업무 자료를 열 수 있는 관리자 전용 패키지입니다.
            </p>
          </div>
          <span className="backup-owner-badge">운영관리자 전용</span>
        </div>

        <div className="backup-portability-grid">
          <section className="backup-package-card">
            <div className="backup-package-heading">
              <span className="backup-card-number">02</span>
              <div>
                <span className="section-kicker">EMERGENCY RECOVERY</span>
                <h4>비상복구 패키지</h4>
              </div>
            </div>
            <p>
              전체 사이트 소스, 최신 DB 백업, 파일 목록과 이전 안내서를 ZIP
              하나로 저장합니다. 다른 호스팅이나 새 Codex 작업에서 이어갈 때
              사용합니다.
            </p>
            <ul className="backup-inclusion-list">
              <li>화면·기능·DB 구조·테스트가 포함된 사이트 원본</li>
              <li>다운로드 시점의 전체 업무 데이터</li>
              <li>다른 호스팅 및 Codex 복구 시작 안내서</li>
              <li>로그인 토큰·API 키 등 비밀값은 자동 제외</li>
            </ul>
            <button
              type="button"
              className="primary-button backup-main-action"
              disabled={Boolean(busy)}
              onClick={() => void download("emergency")}
            >
              {busy === "download-emergency"
                ? "비상복구 패키지 만드는 중…"
                : "비상복구 패키지 내려받기"}
            </button>
            <p className="backup-security-note">
              새 서버에서는 인증과 데이터베이스 연결값을 다시 설정해야 합니다.
            </p>
          </section>

          <section className="backup-package-card backup-package-offline">
            <div className="backup-package-heading">
              <span className="backup-card-number">03</span>
              <div>
                <span className="section-kicker">OFFLINE EDITION</span>
                <h4>오프라인 독립판</h4>
              </div>
            </div>
            <p>
              최신 데이터를 내장한 독립 HTML과 원본 JSON을 ZIP으로 저장합니다.
              압축을 푼 뒤 Chrome 또는 Edge에서 파일을 열면 인터넷 없이
              사용할 수 있습니다.
            </p>
            <ul className="backup-inclusion-list">
              <li>전체 자료의 표별 열람과 통합 검색</li>
              <li>행 추가·수정·삭제와 로컬 작업본 저장</li>
              <li>온라인 복원용 전체 JSON 다시 내보내기</li>
              <li>설치와 서버 실행 없이 파일을 직접 열어 사용</li>
            </ul>
            <button
              type="button"
              className="primary-button backup-main-action"
              disabled={Boolean(busy)}
              onClick={() => void download("offline")}
            >
              {busy === "download-offline"
                ? "오프라인 독립판 만드는 중…"
                : "오프라인 독립판 내려받기"}
            </button>
            <p className="backup-security-note">
              ChatGPT 로그인·GPT Actions·지도 외부검색·실시간 공동작업은
              인터넷 연결형 사이트에서만 작동합니다.
            </p>
          </section>
        </div>
      </article>

      <article className="panel backup-restore-card">
        <div className="backup-restore-heading">
          <div>
            <span className="section-kicker">DISASTER RECOVERY</span>
            <h3>전체 DB 백업·복원</h3>
            <p>
              전체 업무 데이터를 한 파일로 보관하고, 필요할 때 같은 화면에서
              검사한 뒤 안전하게 복원합니다.
            </p>
          </div>
        </div>

        <div className="backup-recovery-actions">
          <section className="backup-recovery-action backup-recovery-action-download">
            <div>
              <strong>현재 전체 DB 백업</strong>
              <p>
                기관 기록, 지도, 수주·품목, 담당자와 권한을 복원 가능한 원본
                파일로 저장합니다.
              </p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={() => void download("full")}
            >
              {busy === "download-full"
                ? "전체 백업 만드는 중…"
                : "전체 DB 백업 받기"}
            </button>
          </section>
          <section className="backup-recovery-action backup-recovery-action-restore">
            <div>
              <strong>저장한 전체 DB 복원</strong>
              <p>
                백업 파일을 먼저 검사하고, 원본 ID와 연결 관계를 유지한 채
                복원합니다.
              </p>
            </div>
            <label className="backup-file-button">
              전체 백업 파일 선택
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => void inspectBackupFile(event)}
              />
            </label>
          </section>
        </div>
        <p className="backup-security-note">
          로그인 세션, OAuth 토큰·비밀키, OpenAI API 비밀값은 백업 파일에
          포함되지 않습니다.
        </p>

        {backupFileName && (
          <p className="backup-selected-file">선택 파일 · {backupFileName}</p>
        )}
        {backupError && <div className="backup-error">{backupError}</div>}
        {busy === "inspect-backup" && (
          <div className="backup-checking">파일과 데이터 연결을 검사하는 중…</div>
        )}

        {backupInspection && (
          <div className="restore-inspection">
            <div className="restore-summary">
              <span className="restore-valid">✓ 복원 가능한 백업</span>
              <strong>{formatDateTime(backupInspection.createdAt)}</strong>
              <small>
                총 {backupInspection.totalRows.toLocaleString("ko-KR")}행 ·
                무결성 코드 {backupInspection.checksum.slice(0, 12)}
              </small>
            </div>
            {backupInspection.compatibilityNotices.map((notice) => (
              <div className="restore-compatibility-notice" key={notice}>
                <strong>이전 백업 호환 안내</strong>
                <span>{notice}</span>
              </div>
            ))}
            <div className="restore-count-grid">
              {Object.entries(backupInspection.counts).map(([table, count]) => (
                <div key={table}>
                  <span>{tableLabels[table] || table}</span>
                  <strong>{count.toLocaleString("ko-KR")}</strong>
                </div>
              ))}
            </div>
            <div className="restore-safety">
              <div className={safetyBackupDownloaded ? "done" : ""}>
                <span>{safetyBackupDownloaded ? "✓" : "1"}</span>
                <div>
                  <strong>현재 DB를 먼저 안전 백업</strong>
                  <p>문제가 생기면 복원 전 상태로 되돌릴 수 있습니다.</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={Boolean(busy)}
                  onClick={() => void download("full", true)}
                >
                  {safetyBackupDownloaded ? "안전 백업 완료" : "복원 직전 백업 받기"}
                </button>
              </div>
              <div
                className={
                  safetyBackupDownloaded && restoreConfirmation === "복원"
                    ? "done"
                    : ""
                }
              >
                <span>
                  {safetyBackupDownloaded && restoreConfirmation === "복원"
                    ? "✓"
                    : "2"}
                </span>
                <label>
                  <strong>확인을 위해 ‘복원’ 입력</strong>
                  <input
                    value={restoreConfirmation}
                    onChange={(event) =>
                      setRestoreConfirmation(event.target.value)
                    }
                    placeholder="복원"
                    disabled={!safetyBackupDownloaded || Boolean(busy)}
                  />
                </label>
              </div>
            </div>
            <button
              type="button"
              className="outline-danger restore-submit"
              disabled={
                Boolean(busy) ||
                !safetyBackupDownloaded ||
                restoreConfirmation !== "복원"
              }
              onClick={() => void restoreBackup()}
            >
              {busy === "restore"
                ? "전체 DB 복원 중…"
                : "선택한 시점으로 전체 복원"}
            </button>
          </div>
        )}
      </article>
    </section>
    </section>
  );
}
