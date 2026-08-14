"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  compareResourceLibraryPosts,
  DOCUMENT_RESOURCE_CATEGORIES,
  isVideoResourceFile,
  VIDEO_RESOURCE_CATEGORIES,
} from "../lib/resource-library-categories";
import {
  resourceUploadErrorMessage,
  uploadResourceFilesSequentially,
  type UploadedResourceFile,
} from "../lib/resource-upload-client";

type ResourceAttachment = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdByName: string;
  createdAt: string;
  downloadUrl: string;
};

type ResourcePost = {
  id: number;
  category: string;
  title: string;
  content: string;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  attachments: ResourceAttachment[];
};

type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  youtubeUrl: string;
  kind: "video" | "shorts";
  source: "channel" | "manual";
};

type YouTubeCounts = {
  total: number;
  video: number;
  shorts: number;
  channel: number;
  manual: number;
};

type Draft = { title: string; category: string; content: string };

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${Math.max(0, value)}B`;
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

function isVideoFile(file: { mimeType?: string; type?: string; originalName?: string; name?: string }) {
  const mimeType = String(file.mimeType || file.type || "").toLowerCase();
  const fileName = String(file.originalName || file.name || "");
  return isVideoResourceFile(fileName, mimeType);
}

function isVideoAttachment(file: ResourceAttachment) {
  return isVideoFile(file);
}

export default function ResourceLibraryPage({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  const [posts, setPosts] = useState<ResourcePost[]>([]);
  const [configured, setConfigured] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const [attachmentPercent, setAttachmentPercent] = useState(0);
  const [reconciling, setReconciling] = useState(false);
  const [libraryKind, setLibraryKind] = useState<"documents" | "videos">("documents");
  const [youtubeVideos, setYoutubeVideos] = useState<YouTubeVideo[]>([]);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeKind, setYoutubeKind] = useState<"all" | "video" | "shorts">("all");
  const [youtubeCounts, setYoutubeCounts] = useState<YouTubeCounts>({ total: 0, video: 0, shorts: 0, channel: 0, manual: 0 });
  const [youtubeSyncLabel, setYoutubeSyncLabel] = useState("공개 영상 전체 목록을 확인합니다.");
  const [selectedVideo, setSelectedVideo] = useState<YouTubeVideo | null>(null);
  const [youtubeRegisterOpen, setYoutubeRegisterOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeRegistering, setYoutubeRegistering] = useState(false);
  const [expandedPosts, setExpandedPosts] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState<Draft>({ title: "", category: "제안서", content: "" });
  const [editDraft, setEditDraft] = useState<Draft>({ title: "", category: "기타", content: "" });
  const filesRef = useRef<HTMLInputElement>(null);
  const editFilesRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const attachmentAbortRef = useRef<AbortController | null>(null);
  const uploadLockRef = useRef(false);
  const attachmentLockRef = useRef(false);
  const recoveryStartedRef = useRef(false);
  const categories = libraryKind === "videos"
    ? VIDEO_RESOURCE_CATEGORIES
    : DOCUMENT_RESOURCE_CATEGORIES;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (query.trim()) search.set("q", query.trim());
      if (category) search.set("category", category);
      const response = await fetch(`/api/resources?${search}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        posts?: ResourcePost[];
        configured?: boolean;
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.posts)) throw new Error(payload.error || "자료를 불러오지 못했습니다.");
      setPosts(payload.posts);
      setConfigured(payload.configured !== false);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [category, query]);

  const loadYouTube = useCallback(async () => {
    setYoutubeLoading(true);
    try {
      const response = await fetch("/api/resources/youtube", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        videos?: YouTubeVideo[];
        counts?: YouTubeCounts;
        syncMode?: "youtube-data-api" | "channel-continuation" | "cached";
        complete?: boolean;
        warnings?: string[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.videos)) {
        throw new Error(payload.error || "유튜브 영상을 불러오지 못했습니다.");
      }
      setYoutubeVideos(payload.videos);
      const computedCounts = {
        total: payload.videos.length,
        video: payload.videos.filter((video) => video.kind === "video").length,
        shorts: payload.videos.filter((video) => video.kind === "shorts").length,
        channel: payload.videos.filter((video) => video.source === "channel").length,
        manual: payload.videos.filter((video) => video.source === "manual").length,
      };
      setYoutubeCounts(payload.counts || computedCounts);
      const modeLabel = payload.syncMode === "youtube-data-api"
        ? "YouTube 공식 API"
        : payload.syncMode === "channel-continuation"
          ? "공개 채널 전체 페이지"
          : "마지막 정상 목록";
      setYoutubeSyncLabel(
        `${modeLabel} 동기화${payload.complete ? " 완료" : " 확인 중"} · 공식 채널 ${payload.counts?.channel ?? computedCounts.channel}개 · 직접 등록 ${payload.counts?.manual ?? computedCounts.manual}개`
        + (payload.warnings?.length ? ` · ${payload.warnings[0]}` : ""),
      );
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "유튜브 영상을 불러오지 못했습니다.");
    } finally {
      setYoutubeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (libraryKind !== "documents") return;
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [libraryKind, load]);

  useEffect(() => {
    if (!isAdmin || recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    void reconcileVideos(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  function selectLibraryKind(nextKind: "documents" | "videos") {
    if (busy || attachmentBusy) return;
    const nextCategories = nextKind === "videos"
      ? VIDEO_RESOURCE_CATEGORIES
      : DOCUMENT_RESOURCE_CATEGORIES;
    setLibraryKind(nextKind);
    setUploadOpen(false);
    setCategory("");
    setQuery("");
    setYoutubeKind("all");
    if (nextKind === "videos" && youtubeVideos.length === 0) void loadYouTube();
    setEditing(null);
    setDraft((current) => ({ ...current, category: nextCategories[0] }));
  }

  function progressLabel(fileName: string, percent: number, transferredBytes: number, totalBytes: number) {
    return `${fileName} 업로드 중 · ${percent}% · ${formatBytes(transferredBytes)} / ${formatBytes(totalBytes)}`;
  }

  async function cleanupUploadedFiles(uploaded: UploadedResourceFile[]) {
    if (!uploaded.length) return;
    await fetch("/api/resources/upload-session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds: uploaded.map((item) => item.fileId) }),
    }).catch(() => undefined);
  }

  function closeUploadForm() {
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      return;
    }
    if (!busy) setUploadOpen(false);
  }

  function closeEditForm() {
    if (attachmentAbortRef.current) {
      attachmentAbortRef.current.abort();
      return;
    }
    if (!attachmentBusy && !busy) setEditing(null);
  }

  function togglePost(postId: number) {
    setExpandedPosts((current) => {
      const next = new Set(current);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  async function reconcileVideos(silent = false) {
    if (reconciling) return;
    setReconciling(true);
    if (!silent) setMessage("Google Drive의 누락 영상을 확인하고 있습니다.");
    try {
      const response = await fetch("/api/resources/reconcile", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { recovered?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "누락 영상을 확인하지 못했습니다.");
      const recovered = Math.max(0, Number(payload.recovered) || 0);
      if (recovered > 0) {
        setMessage(`목록에서 빠진 영상 ${recovered}개를 복구했습니다.`);
        await load();
      } else if (!silent) {
        setMessage("누락된 영상이 없습니다. Google Drive와 자료실이 일치합니다.");
      }
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "누락 영상을 확인하지 못했습니다.");
    } finally {
      setReconciling(false);
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    const files = Array.from(filesRef.current?.files ?? []);
    if (!files.length || busy || uploadLockRef.current) return;
    uploadLockRef.current = true;
    setBusy(true);
    setMessage("");
    setUploadProgress("업로드를 준비하고 있습니다.");
    setUploadPercent(0);
    const uploaded: UploadedResourceFile[] = [];
    let databaseCommitted = false;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    try {
      const expectsVideo = libraryKind === "videos";
      const mismatched = files.find((file) => isVideoFile(file) !== expectsVideo);
      if (mismatched) {
        throw new Error(
          expectsVideo
            ? "영상 자료에는 영상 파일만 등록해 주세요."
            : "문서 자료에는 영상 파일을 함께 등록할 수 없습니다.",
        );
      }
      await uploadResourceFilesSequentially(files, {
        title: draft.title,
        category: draft.category,
        signal: controller.signal,
        onFileComplete: (file) => uploaded.push(file),
        onProgress: (progress) => {
          setUploadPercent(progress.percent);
          setUploadProgress(progressLabel(
            progress.fileName,
            progress.percent,
            progress.transferredBytes,
            progress.totalBytes,
          ));
        },
      });
      if (controller.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      uploadAbortRef.current = null;
      setUploadProgress("게시글 정보를 저장하고 있습니다.");
      setUploadPercent(100);
      const response = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, files: uploaded }),
      });
      const payload = (await response.json().catch(() => ({}))) as { post?: ResourcePost; error?: string };
      if (!response.ok || !payload.post) throw new Error(payload.error || "자료를 등록하지 못했습니다.");
      databaseCommitted = true;
      setDraft({ title: "", category: categories[0], content: "" });
      if (filesRef.current) filesRef.current.value = "";
      setUploadOpen(false);
      setMessage("자료를 등록했습니다.");
      await load();
    } catch (error) {
      if (!databaseCommitted) await cleanupUploadedFiles(uploaded);
      setMessage(resourceUploadErrorMessage(error));
    } finally {
      uploadAbortRef.current = null;
      uploadLockRef.current = false;
      setBusy(false);
      setUploadProgress("");
      setUploadPercent(0);
    }
  }

  async function saveEdit(post: ResourcePost) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/resources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, ...editDraft }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "자료를 수정하지 못했습니다.");
      setEditing(null);
      setMessage("자료 정보를 수정했습니다.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 수정하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEditFiles(
    post: ResourcePost,
    files: File[],
    mode: "add" | "replace",
    attachmentId?: number,
  ) {
    if (!files.length || attachmentBusy || attachmentLockRef.current) return;
    attachmentLockRef.current = true;
    setAttachmentBusy(true);
    setMessage("");
    setAttachmentProgress("업로드를 준비하고 있습니다.");
    setAttachmentPercent(0);
    const uploaded: UploadedResourceFile[] = [];
    let attachmentCommitted = false;
    const controller = new AbortController();
    attachmentAbortRef.current = controller;
    try {
      if (mode === "replace" && files.length !== 1) throw new Error("교체할 파일 한 개를 선택해 주세요.");
      const expectsVideo = libraryKind === "videos";
      const mismatched = files.find((file) => isVideoFile(file) !== expectsVideo);
      if (mismatched) {
        throw new Error(
          expectsVideo
            ? "영상 자료에는 영상 파일만 추가해 주세요."
            : "문서 자료에는 영상 파일을 추가할 수 없습니다.",
        );
      }
      await uploadResourceFilesSequentially(files, {
        title: post.title,
        category: post.category,
        signal: controller.signal,
        onFileComplete: (file) => uploaded.push(file),
        onProgress: (progress) => {
          setAttachmentPercent(progress.percent);
          setAttachmentProgress(progressLabel(
            progress.fileName,
            progress.percent,
            progress.transferredBytes,
            progress.totalBytes,
          ));
        },
      });
      if (controller.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      attachmentAbortRef.current = null;
      setAttachmentProgress(mode === "replace" ? "기존 파일을 교체하고 있습니다." : "새 파일을 추가하고 있습니다.");
      setAttachmentPercent(100);
      const response = await fetch("/api/resources/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, mode, attachmentId, files: uploaded }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "파일 변경을 완료하지 못했습니다.");
      attachmentCommitted = true;
      if (editFilesRef.current) editFilesRef.current.value = "";
      setMessage(mode === "replace" ? "파일을 교체했습니다." : "새 파일을 추가했습니다.");
      await load();
    } catch (error) {
      if (!attachmentCommitted) await cleanupUploadedFiles(uploaded);
      setMessage(resourceUploadErrorMessage(error));
    } finally {
      attachmentAbortRef.current = null;
      attachmentLockRef.current = false;
      setAttachmentBusy(false);
      setAttachmentProgress("");
      setAttachmentPercent(0);
    }
  }

  async function deleteAttachment(post: ResourcePost, file: ResourceAttachment) {
    if (attachmentBusy || !window.confirm(`'${file.originalName}' 파일을 삭제할까요?`)) return;
    setAttachmentBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/resources/attachments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, attachmentId: file.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "파일을 삭제하지 못했습니다.");
      setMessage("파일을 삭제했습니다.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파일을 삭제하지 못했습니다.");
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function archive(post: ResourcePost) {
    if (busy || !window.confirm(`'${post.title}' 자료를 삭제할까요?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/resources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "자료를 삭제하지 못했습니다.");
      setMessage("자료를 삭제했습니다.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const visiblePosts = posts
    .map((post) => ({
      post,
      attachments: post.attachments.filter((file) =>
        libraryKind === "videos" ? isVideoAttachment(file) : !isVideoAttachment(file),
      ),
    }))
    .filter((entry) => entry.attachments.length > 0)
    .sort((left, right) => compareResourceLibraryPosts(
      left.post,
      right.post,
      libraryKind === "videos",
    ));
  const documentCount = posts.reduce(
    (count, post) => count + post.attachments.filter((file) => !isVideoAttachment(file)).length,
    0,
  );
  const videoCount = youtubeVideos.length;
  const visibleFileCount = libraryKind === "videos" ? videoCount : documentCount;
  const filteredYoutubeVideos = youtubeVideos.filter((video) => {
    const matchesKind = youtubeKind === "all" || video.kind === youtubeKind;
    const needle = query.trim().toLocaleLowerCase("ko-KR");
    const matchesQuery = !needle
      || `${video.title} ${video.description}`.toLocaleLowerCase("ko-KR").includes(needle);
    return matchesKind && matchesQuery;
  });

  async function copyYouTubeLink(video: YouTubeVideo) {
    try {
      await navigator.clipboard.writeText(video.youtubeUrl);
      setMessage("유튜브 링크를 복사했습니다.");
    } catch {
      setMessage("링크를 복사하지 못했습니다. 유튜브에서 열어 주소를 복사해 주세요.");
    }
  }

  async function shareYouTubeVideo(video: YouTubeVideo) {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: video.title, url: video.youtubeUrl });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyYouTubeLink(video);
  }

  async function registerYouTubeUrl(event: FormEvent) {
    event.preventDefault();
    if (youtubeRegistering || !youtubeUrl.trim()) return;
    setYoutubeRegistering(true);
    setMessage("");
    try {
      const response = await fetch("/api/resources/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        video?: YouTubeVideo;
        created?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.video) throw new Error(payload.error || "유튜브 주소를 등록하지 못했습니다.");
      setYoutubeUrl("");
      setYoutubeRegisterOpen(false);
      await loadYouTube();
      setMessage(payload.created
        ? "유튜브 영상을 자료실에 등록했습니다."
        : "이미 자료실에 있는 유튜브 영상입니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "유튜브 주소를 등록하지 못했습니다.");
    } finally {
      setYoutubeRegistering(false);
    }
  }

  return (
    <section className="resource-library-page">
      <header className="resource-library-hero">
        <div>
          <span className="section-kicker">SHARED RESOURCE LIBRARY</span>
          <h2>자료실</h2>
        </div>
        <div className="resource-hero-actions">
          {libraryKind === "documents" ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || attachmentBusy}
              onClick={() => setUploadOpen((value) => !value)}
            >
              {uploadOpen ? "등록 닫기" : "+ 문서 등록"}
            </button>
          ) : (
            <a className="resource-youtube-channel-link" href="https://www.youtube.com/@whizzup_official" target="_blank" rel="noreferrer">
              유튜브 채널 열기
            </a>
          )}
        </div>
      </header>

      {libraryKind === "documents" && !configured && (
        <div className="resource-library-warning">배포 설정에 Google Drive 연결 정보를 등록하면 파일 첨부를 사용할 수 있습니다.</div>
      )}
      {message && <div className="resource-library-message">{message}</div>}

      {libraryKind === "documents" && uploadOpen && (
        <form className="resource-upload-form" onSubmit={upload}>
          <fieldset className="resource-upload-kind" disabled={busy}>
            <legend>자료 종류</legend>
            <button
              type="button"
              className={libraryKind === "documents" ? "active" : ""}
              aria-pressed={libraryKind === "documents"}
              onClick={() => selectLibraryKind("documents")}
            >
              문서 자료
            </button>
          </fieldset>
          <label>
            <span>분류</span>
            <select disabled={busy} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>제목</span>
            <input
              required
              disabled={busy}
              maxLength={160}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="예: 가상현실 스포츠실 제안서"
            />
          </label>
          <label className="wide">
            <span>설명</span>
            <textarea disabled={busy} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="사용처나 참고 내용을 적어 주세요." />
          </label>
          <label className="wide resource-file-picker">
            <span>첨부 파일</span>
            <input
              ref={filesRef}
              required
              disabled={busy}
              type="file"
              multiple
            />
            <small>
              문서 자료에는 영상 파일을 함께 등록할 수 없습니다 · 최대 10개
            </small>
            {uploadProgress && (
              <div className="resource-upload-progress" role="status" aria-live="polite">
                <span style={{ width: `${uploadPercent}%` }} />
                <small>{uploadProgress}</small>
              </div>
            )}
          </label>
          <div className="resource-form-actions">
            <button type="button" className="secondary-button" onClick={closeUploadForm}>{busy ? "업로드 취소" : "취소"}</button>
            <button type="submit" className="primary-button" disabled={busy || !configured}>{busy ? "등록 중…" : "자료 등록"}</button>
          </div>
        </form>
      )}

      <nav className="resource-library-tabs" aria-label="자료 종류">
        <button
          type="button"
          className={libraryKind === "documents" ? "active" : ""}
          aria-pressed={libraryKind === "documents"}
          onClick={() => selectLibraryKind("documents")}
        >
          <span>문서 자료</span><strong>{documentCount}</strong>
        </button>
        <button
          type="button"
          className={libraryKind === "videos" ? "active" : ""}
          aria-pressed={libraryKind === "videos"}
          onClick={() => selectLibraryKind("videos")}
        >
          <span>영상 자료</span><strong>{videoCount}</strong>
        </button>
      </nav>

      {libraryKind === "videos" ? (
        <section className="resource-youtube-library">
          <div className="resource-youtube-intro">
            <div>
              <strong>위즈업 공식 유튜브</strong>
              <span>채널에 공개된 동영상과 Shorts가 자동으로 표시됩니다.</span>
              <small>{youtubeSyncLabel}</small>
            </div>
            <div className="resource-youtube-intro-actions">
              <button type="button" onClick={() => setYoutubeRegisterOpen((value) => !value)}>
                {youtubeRegisterOpen ? "등록 닫기" : "+ 유튜브 주소 등록"}
              </button>
              <button type="button" onClick={() => void loadYouTube()} disabled={youtubeLoading}>
                {youtubeLoading ? "불러오는 중…" : "새로고침"}
              </button>
            </div>
          </div>
          {youtubeRegisterOpen && (
            <form className="resource-youtube-register" onSubmit={registerYouTubeUrl}>
              <div>
                <strong>누락된 유튜브 영상 등록</strong>
                <span>일반 영상·Shorts 주소를 붙여 넣으면 제목과 썸네일을 자동으로 가져옵니다.</span>
              </div>
              <input
                type="url"
                required
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=… 또는 https://youtube.com/shorts/…"
              />
              <div>
                <button type="button" onClick={() => { setYoutubeRegisterOpen(false); setYoutubeUrl(""); }}>취소</button>
                <button type="submit" className="primary" disabled={youtubeRegistering}>
                  {youtubeRegistering ? "확인 중…" : "주소 등록"}
                </button>
              </div>
            </form>
          )}
          <div className="resource-youtube-filters">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="영상 제목·설명 검색"
            />
            <div className="resource-youtube-filter-buttons" aria-label="영상 종류">
              {([
                ["all", `전체 ${youtubeCounts.total}`],
                ["video", `동영상 ${youtubeCounts.video}`],
                ["shorts", `Shorts ${youtubeCounts.shorts}`],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={youtubeKind === value ? "active" : ""}
                  aria-pressed={youtubeKind === value}
                  onClick={() => setYoutubeKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span>{filteredYoutubeVideos.length}개</span>
          </div>
          <div className="resource-youtube-grid">
            {filteredYoutubeVideos.map((video) => (
              <article key={video.videoId} className={`resource-youtube-card ${video.kind}`}>
                <button
                  type="button"
                  className="resource-youtube-thumbnail"
                  onClick={() => setSelectedVideo(video)}
                  aria-label={`${video.title} 재생`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={video.thumbnailUrl} alt="" loading="lazy" />
                  <span className="resource-youtube-play" aria-hidden="true">▶</span>
                  <em>{video.kind === "shorts" ? "Shorts" : "동영상"}</em>
                  {video.source === "manual" && <i>직접 등록</i>}
                </button>
                <div className="resource-youtube-card-body">
                  <strong title={video.title}>{video.title}</strong>
                  <p>{video.description || "위즈업 공식 유튜브 영상입니다."}</p>
                  <time dateTime={video.publishedAt}>{displayDate(video.publishedAt)}</time>
                </div>
                <div className="resource-youtube-card-actions">
                  <button type="button" onClick={() => void copyYouTubeLink(video)}>링크 복사</button>
                  <button type="button" onClick={() => void shareYouTubeVideo(video)}>공유</button>
                  <a href={video.youtubeUrl} target="_blank" rel="noreferrer">유튜브 열기</a>
                </div>
              </article>
            ))}
          </div>
          {!youtubeLoading && !filteredYoutubeVideos.length && (
            <div className="empty-state">조건에 맞는 유튜브 영상이 없습니다.</div>
          )}
          {youtubeLoading && !youtubeVideos.length && (
            <div className="empty-state">유튜브 영상을 불러오는 중입니다.</div>
          )}
        </section>
      ) : (
        <>
      <div className="resource-library-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목·설명 검색" />
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">전체 분류</option>
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
        <span>{visibleFileCount}개</span>
      </div>

      <div className="resource-post-list">
        <div className="resource-list-head" aria-hidden="true">
          <span>분류</span>
          <span>제목·설명</span>
          <span>첨부</span>
          <span>등록자</span>
          <span>등록일</span>
          <span></span>
          <span>관리</span>
        </div>
        {visiblePosts.map(({ post, attachments }) => {
          const expanded = expandedPosts.has(post.id);
          return (
            <article key={post.id} className="resource-post-card">
              {editing === post.id ? (
                <div className="resource-edit-form">
                  <select disabled={busy || attachmentBusy} value={editDraft.category} onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })}>
                    {categories.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <input disabled={busy || attachmentBusy} value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} />
                  <textarea disabled={busy || attachmentBusy} value={editDraft.content} onChange={(event) => setEditDraft({ ...editDraft, content: event.target.value })} />
                  <div className="resource-edit-attachments">
                    <strong>현재 파일</strong>
                    {post.attachments.map((file) => (
                      <div key={file.id} className="resource-edit-file-row">
                        <span>{file.originalName}</span>
                        <small>{formatBytes(file.sizeBytes)}</small>
                        <label className="resource-file-action">
                          교체
                          <input
                            type="file"
                            disabled={busy || attachmentBusy}
                            onChange={(event) => {
                              const next = Array.from(event.target.files ?? []);
                              void uploadEditFiles(post, next, "replace", file.id);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <button type="button" className="danger" disabled={busy || attachmentBusy} onClick={() => void deleteAttachment(post, file)}>삭제</button>
                      </div>
                    ))}
                    <label className="resource-add-files">
                      <span>+ 새 파일 추가</span>
                      <input
                        ref={editFilesRef}
                        type="file"
                        multiple
                        disabled={busy || attachmentBusy}
                        onChange={(event) => void uploadEditFiles(post, Array.from(event.target.files ?? []), "add")}
                      />
                    </label>
                    {attachmentProgress && (
                      <div className="resource-upload-progress" role="status" aria-live="polite">
                        <span style={{ width: `${attachmentPercent}%` }} />
                        <small>{attachmentProgress}</small>
                      </div>
                    )}
                  </div>
                  <div>
                    <button type="button" onClick={closeEditForm}>{attachmentBusy ? "업로드 취소" : "취소"}</button>
                    <button type="button" className="primary-button" disabled={busy || attachmentBusy} onClick={() => void saveEdit(post)}>저장</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="resource-post-row">
                    <button
                      type="button"
                      className="resource-post-toggle"
                      aria-expanded={expanded}
                      aria-controls={`resource-post-details-${post.id}`}
                      onClick={() => togglePost(post.id)}
                    >
                      <em>{post.category}</em>
                      <span className="resource-post-title">
                        <strong>{post.title}</strong>
                        <small>{post.content || "설명이 등록되지 않았습니다."}</small>
                      </span>
                      <span className="resource-post-file-count">첨부 {attachments.length}개</span>
                      <span className="resource-post-author">{post.createdByName}</span>
                      <span className="resource-post-date">{displayDate(post.createdAt)}</span>
                      <span className={`resource-post-chevron${expanded ? " expanded" : ""}`} aria-hidden="true">⌄</span>
                    </button>
                    <div className="resource-post-actions">
                      <button type="button" onClick={() => { setEditing(post.id); setExpandedPosts((current) => new Set(current).add(post.id)); setEditDraft({ title: post.title, category: post.category, content: post.content }); }}>수정</button>
                      {isAdmin && <button type="button" className="danger" onClick={() => void archive(post)}>삭제</button>}
                    </div>
                  </div>
                  {expanded && (
                    <div className="resource-post-details" id={`resource-post-details-${post.id}`}>
                      {post.content && <p className="resource-post-content">{post.content}</p>}
                      <div className="resource-attachment-list">
                        {attachments.map((file) => (
                          <a key={file.id} href={file.downloadUrl}>
                            <span>{file.originalName}</span><small>{formatBytes(file.sizeBytes)} · 내려받기</small>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}
        {!loading && !visiblePosts.length && (
          <div className="empty-state">등록된 문서 자료가 없습니다.</div>
        )}
        {loading && <div className="empty-state">자료를 불러오는 중입니다.</div>}
      </div>
        </>
      )}

      {selectedVideo && (
        <div className="resource-video-modal" role="dialog" aria-modal="true" aria-label={selectedVideo.title} onClick={() => setSelectedVideo(null)}>
          <div className="resource-video-modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="resource-video-modal-head">
              <strong>{selectedVideo.title}</strong>
              <button type="button" onClick={() => setSelectedVideo(null)} aria-label="영상 닫기">×</button>
            </div>
            <div className={`resource-video-frame ${selectedVideo.kind}`}>
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${selectedVideo.videoId}?autoplay=1`}
                title={selectedVideo.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
            <div className="resource-video-modal-actions">
              <button type="button" onClick={() => void copyYouTubeLink(selectedVideo)}>링크 복사</button>
              <button type="button" onClick={() => void shareYouTubeVideo(selectedVideo)}>공유</button>
              <a href={selectedVideo.youtubeUrl} target="_blank" rel="noreferrer">유튜브에서 보기</a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
