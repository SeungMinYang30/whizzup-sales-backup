"use client";

import { useEffect, useState } from "react";
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

type DownloadKind = "full" | "emergency" | "offline";

type DriveBackupOption = {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  folderPath: string;
};

type StandbyScheduleState = {
  origin: string;
  configured: boolean;
  schedule: string;
};

const tableLabels: Record<string, string> = {
  members: "구성원·권한",
  member_rejections: "가입 거절 이력",
  member_account_archives: "삭제 계정 보관 기록",
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
  const [backupFileName, setBackupFileName] = useState("");
  const [driveBackups, setDriveBackups] = useState<DriveBackupOption[]>([]);
  const [selectedDriveBackupId, setSelectedDriveBackupId] = useState("");
  const [backupInspection, setBackupInspection] =
    useState<BackupInspection | null>(null);
  const [backupError, setBackupError] = useState("");
  const [standbySchedule, setStandbySchedule] =
    useState<StandbyScheduleState | null>(null);
  const [standbyScheduleAvailable, setStandbyScheduleAvailable] = useState(false);
  const [standbyScheduleError, setStandbyScheduleError] = useState("");
  const [safetyBackupDownloaded, setSafetyBackupDownloaded] = useState(false);
  useEffect(() => {
    const savedAt = window.localStorage.getItem("whizzup-last-full-backup-at");
    const timestamp = savedAt ? Date.parse(savedAt) : Number.NaN;
    if (Number.isFinite(timestamp) && Date.now() - timestamp <= 30 * 60 * 1000) {
      setSafetyBackupDownloaded(true);
    }
  }, []);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");

  async function loadDriveBackups() {
    try {
      setBusy((current) => current || "list-drive-backups");
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-drive-backups" }),
      });
      const payload = (await response.json()) as {
        backups?: DriveBackupOption[];
        error?: string;
      };
      if (!response.ok || !payload.backups) {
        throw new Error(payload.error || "Google Drive 백업 목록을 불러오지 못했습니다.");
      }
      setDriveBackups(payload.backups);
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "Google Drive 백업 목록을 불러오지 못했습니다.",
      );
    } finally {
      setBusy((current) => (current === "list-drive-backups" ? "" : current));
    }
  }

  useEffect(() => {
    if (canManageBackup) void loadDriveBackups();
    // The Drive list only needs an initial refresh when backup access changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageBackup]);

  useEffect(() => {
    if (!canManageBackup || !isPrimaryOwner) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/standby-schedule", {
          cache: "no-store",
        });
        if (response.status === 404) return;
        const payload = (await response.json()) as {
          origin?: string;
          schedule?: { configured?: boolean; schedule?: string };
        };
        if (!response.ok || cancelled) return;
        setStandbyScheduleAvailable(true);
        setStandbySchedule({
          origin: payload.origin || "",
          configured: payload.schedule?.configured === true,
          schedule: payload.schedule?.schedule || "*/10 * * * *",
        });
      } catch {
        // The Sites standby intentionally has no scheduler endpoint.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManageBackup, isPrimaryOwner]);

  async function configureStandbyReplication() {
    try {
      setBusy("configure-standby");
      setStandbyScheduleError("");
      const response = await fetch("/api/standby-schedule", { method: "POST" });
      const payload = (await response.json()) as {
        ok?: boolean;
        origin?: string;
        error?: string;
        schedule?: { schedule?: string };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "대기판 자동 복제를 설정하지 못했습니다.");
      }
      setStandbyScheduleAvailable(true);
      setStandbySchedule({
        origin: payload.origin || standbySchedule?.origin || "",
        configured: true,
        schedule: payload.schedule?.schedule || "*/10 * * * *",
      });
      notify("Sites 대기판 예약과 즉시 동기화를 완료했습니다.");
    } catch (error) {
      setStandbyScheduleError(
        error instanceof Error
          ? error.message
          : "대기판 자동 복제를 설정하지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  async function download(kind: DownloadKind, safety = false) {
    try {
      setBusy(safety ? "safety-download" : `download-${kind}`);
      if (kind === "full") {
        const response = await fetch("/api/backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive-full-backup" }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          archive?: { fileName?: string; folderPath?: string };
          error?: string;
        };
        if (!response.ok || !payload.ok || !payload.archive) {
          throw new Error(payload.error || "Google Drive 백업을 만들지 못했습니다.");
        }
        const now = new Date().toISOString();
        window.localStorage.setItem("whizzup-last-full-backup-at", now);
        if (safety) setSafetyBackupDownloaded(true);
        await loadDriveBackups();
        notify(
          safety
            ? `복원 직전 안전 백업을 Google Drive에 저장했습니다. (${payload.archive.folderPath})`
            : `Google Drive 백업 완료: ${payload.archive.folderPath}/${payload.archive.fileName}`,
        );
        return;
      }
      if (kind === "emergency") {
        const response = await fetch("/api/backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive-emergency-recovery" }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          archive?: {
            fileName?: string;
            folderPath?: string;
            verified?: boolean;
          };
          error?: string;
        };
        if (
          !response.ok ||
          !payload.ok ||
          !payload.archive?.verified
        ) {
          throw new Error(
            payload.error || "Google Drive 비상복구 패키지를 만들지 못했습니다.",
          );
        }
        notify(
          `비상복구 패키지 저장·검증 완료: ${payload.archive.folderPath}/${payload.archive.fileName}`,
        );
        return;
      }
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive-offline-standalone" }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        archive?: {
          fileName?: string;
          folderPath?: string;
          verified?: boolean;
        };
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.archive?.verified) {
        throw new Error(
          payload.error || "Google Drive 오프라인 독립판을 만들지 못했습니다.",
        );
      }
      notify(
        `오프라인 독립판 저장·검증 완료: ${payload.archive.folderPath}/${payload.archive.fileName}`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "백업 작업을 완료하지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  async function inspectDriveBackup(fileId: string) {
    const selected = driveBackups.find((backup) => backup.fileId === fileId);
    setSelectedDriveBackupId(fileId);
    setBackupFileName(selected?.fileName || "");
    setBackupInspection(null);
    setBackupError("");
    setRestoreConfirmation("");
    if (!fileId) return;
    try {
      setBusy("inspect-backup");
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "inspect-drive-backup",
          driveFileId: fileId,
        }),
      });
      const payload = (await response.json()) as {
        inspection?: BackupInspection;
        error?: string;
      };
      if (!response.ok || !payload.inspection) {
        throw new Error(payload.error || "백업 파일을 검사하지 못했습니다.");
      }
      setBackupInspection(payload.inspection);
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "Google Drive 백업을 검사하지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  async function restoreBackup() {
    if (!selectedDriveBackupId || !backupInspection) return;
    if (
      !window.confirm(
        "현재 업무 DB를 선택한 백업 시점으로 전체 교체합니다. 계속할까요?",
      )
    ) {
      return;
    }
    try {
      setBusy("restore");
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore-drive-backup",
          driveFileId: selectedDriveBackupId,
          confirmation: restoreConfirmation,
          safetyBackupDownloaded,
        }),
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
      setBackupInspection(null);
      setBackupFileName("");
      setSelectedDriveBackupId("");
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
                파일로 Google Drive에 날짜·시간별 저장합니다.
              </p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={() => void download("full")}
            >
              {busy === "download-full"
                ? "Google Drive 백업 중…"
                : "Google Drive에 전체 DB 백업"}
            </button>
          </section>
          <section className="backup-recovery-action backup-recovery-action-restore">
            <div>
              <strong>Google Drive 백업 복원</strong>
              <p>
                날짜·시간별 백업을 선택해 무결성을 검사한 뒤 원본 ID와 연결
                관계를 유지한 채 복원합니다.
              </p>
            </div>
            <div className="backup-drive-picker">
              <select
                aria-label="Google Drive 백업 선택"
                value={selectedDriveBackupId}
                disabled={Boolean(busy)}
                onChange={(event) => void inspectDriveBackup(event.target.value)}
              >
                <option value="">
                  {busy === "list-drive-backups"
                    ? "Drive 백업 불러오는 중…"
                    : "복원할 Drive 백업 선택"}
                </option>
                {driveBackups.map((backup) => (
                  <option key={backup.fileId} value={backup.fileId}>
                    {backup.fileName} · {(backup.sizeBytes / 1024 / 1024).toFixed(1)}MB
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost-button"
                disabled={Boolean(busy)}
                onClick={() => void loadDriveBackups()}
              >
                목록 새로고침
              </button>
            </div>
          </section>
        </div>
        <p className="backup-security-note">
          로그인 세션, OAuth 토큰·비밀키, OpenAI API 비밀값은 백업 파일에
          포함되지 않습니다.
        </p>

        {standbyScheduleAvailable && standbySchedule && (
          <div className="standby-replication-control">
            <div>
              <strong>Sites 비상 대기판</strong>
              <p>
                {standbySchedule.configured
                  ? "운영 DB를 10분마다 별도 D1 대기판에 복제하고 있습니다."
                  : "운영 DB를 별도 D1 대기판에 10분마다 복제할 수 있습니다."}
              </p>
              {standbySchedule.origin && <small>{standbySchedule.origin}</small>}
            </div>
            <button
              type="button"
              className={standbySchedule.configured ? "ghost-button" : "primary-button"}
              disabled={Boolean(busy)}
              onClick={() => void configureStandbyReplication()}
            >
              {busy === "configure-standby"
                ? "동기화 중…"
                : standbySchedule.configured
                  ? "지금 동기화"
                  : "10분 자동 복제 시작"}
            </button>
          </div>
        )}
        {standbyScheduleError && (
          <div className="backup-error">{standbyScheduleError}</div>
        )}

        {backupFileName && (
          <p className="backup-selected-file">선택 파일 · {backupFileName}</p>
        )}
        {backupError && <div className="backup-error">{backupError}</div>}
        {busy === "inspect-backup" && (
          <div className="backup-checking">Drive 백업과 데이터 연결을 검사하는 중…</div>
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
                  <p>Google Drive에 저장한 뒤 복원을 진행합니다.</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={Boolean(busy)}
                  onClick={() => void download("full", true)}
                >
                  {safetyBackupDownloaded
                    ? "Drive 안전 백업 완료"
                    : "Drive에 복원 직전 백업"}
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

      <article className="panel backup-portability-card">
        <div className="backup-restore-heading">
          <div>
            <span className="section-kicker">PORTABILITY &amp; OFFLINE</span>
            <h3>서비스 이전·오프라인 대비</h3>
            <p>
              Vercel을 사용할 수 없는 상황에도 다른 호스팅에서 작업을 이어가거나,
              인터넷 없이 최신 업무 자료를 열 수 있는 관리자 전용 패키지입니다.
            </p>
          </div>
          <span className="backup-owner-badge">운영자 전용</span>
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
              현재 배포의 전체 사이트 소스, 최신 DB 백업, 파일 목록과 이전
              안내서를 ZIP 하나로 묶어 Google Drive에 시간별 저장합니다.
            </p>
            <ul className="backup-inclusion-list">
              <li>화면·기능·DB 구조·테스트가 포함된 사이트 원본</li>
              <li>저장 시점의 전체 업무 데이터</li>
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
                ? "Drive 저장·검증 중…"
                : "Google Drive에 비상복구 저장"}
            </button>
            <p className="backup-security-note">
              저장 후 Drive 파일을 다시 읽어 해시를 확인합니다. 새 서버에서는
              인증과 데이터베이스 연결값을 다시 설정해야 합니다.
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
              최신 데이터를 내장한 독립 HTML과 원본 JSON을 ZIP으로 묶어
              Google Drive에 시간별 저장합니다. 필요할 때 내려받아 압축을 푼
              뒤 Chrome 또는 Edge에서 열면 인터넷 없이 사용할 수 있습니다.
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
                ? "Drive 저장·검증 중…"
                : "Google Drive에 오프라인 독립판 저장"}
            </button>
            <p className="backup-security-note">
              저장 후 Drive 파일을 다시 읽어 크기와 해시를 검증합니다.
              ChatGPT 로그인·Google 동기화·지도 외부검색·실시간 공동작업은
              인터넷 연결형 사이트에서만 작동합니다.
            </p>
          </section>
        </div>
      </article>
    </section>
    </section>
  );
}
