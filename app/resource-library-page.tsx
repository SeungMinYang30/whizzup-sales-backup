"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

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

type Draft = { title: string; category: string; content: string };

const defaultCategories = ["제안서", "매뉴얼", "계약·공문", "제품자료", "교육자료", "서식", "기타"];
const uploadChunkBytes = 5 * 1024 * 1024;
const videoExtensions = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "mpeg", "mpg"]);

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

function isVideoAttachment(file: ResourceAttachment) {
  if (file.mimeType.toLowerCase().startsWith("video/")) return true;
  const extension = file.originalName.toLowerCase().split(".").pop() || "";
  return videoExtensions.has(extension);
}

export default function ResourceLibraryPage({
  memberId,
  isAdmin,
}: {
  memberId: number;
  isAdmin: boolean;
}) {
  const [posts, setPosts] = useState<ResourcePost[]>([]);
  const [categories, setCategories] = useState(defaultCategories);
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
  const [libraryKind, setLibraryKind] = useState<"documents" | "videos">("documents");
  const [draft, setDraft] = useState<Draft>({ title: "", category: "제안서", content: "" });
  const [editDraft, setEditDraft] = useState<Draft>({ title: "", category: "기타", content: "" });
  const filesRef = useRef<HTMLInputElement>(null);
  const editFilesRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams();
      if (query.trim()) search.set("q", query.trim());
      if (category) search.set("category", category);
      const response = await fetch(`/api/resources?${search}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        posts?: ResourcePost[];
        categories?: string[];
        configured?: boolean;
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.posts)) throw new Error(payload.error || "자료를 불러오지 못했습니다.");
      setPosts(payload.posts);
      if (Array.isArray(payload.categories)) setCategories(payload.categories);
      setConfigured(payload.configured !== false);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [category, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    const files = Array.from(filesRef.current?.files ?? []);
    if (!files.length || busy) return;
    setBusy(true);
    setMessage("");
    setUploadProgress("업로드를 준비하고 있습니다.");
    setUploadPercent(0);
    const uploaded: Array<{
      fileId: string;
      folderId: string;
      originalName: string;
    }> = [];
    try {
      if (files.length > 10) throw new Error("한 번에 10개까지 첨부할 수 있습니다.");
      let completedBytes = 0;
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      for (const file of files) {
        const sessionResponse = await fetch("/api/resources/upload-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            title: draft.title,
            category: draft.category,
          }),
        });
        const session = (await sessionResponse.json().catch(() => ({}))) as {
          uploadUrl?: string;
          folderId?: string;
          error?: string;
        };
        if (!sessionResponse.ok || !session.uploadUrl || !session.folderId) {
          throw new Error(session.error || `${file.name} 업로드를 시작하지 못했습니다.`);
        }
        let fileId = "";
        for (let start = 0; start < file.size; start += uploadChunkBytes) {
          const endExclusive = Math.min(file.size, start + uploadChunkBytes);
          const chunkResponse = await fetch("/api/resources/upload-session", {
            method: "PUT",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "Content-Range": `bytes ${start}-${endExclusive - 1}/${file.size}`,
              "X-Drive-Upload-Url": session.uploadUrl,
            },
            body: file.slice(start, endExclusive),
          });
          const chunk = (await chunkResponse.json().catch(() => ({}))) as {
            complete?: boolean;
            file?: { id?: string };
            error?: string;
          };
          if (!chunkResponse.ok) throw new Error(chunk.error || `${file.name} 업로드 중 오류가 발생했습니다.`);
          if (chunk.complete) fileId = chunk.file?.id || "";
          const currentBytes = completedBytes + endExclusive;
          const percent = totalBytes ? Math.min(100, Math.round((currentBytes / totalBytes) * 100)) : 100;
          setUploadPercent(percent);
          setUploadProgress(`${file.name} 업로드 중 · ${percent}%`);
        }
        if (!fileId) throw new Error(`${file.name} 업로드 완료 정보를 확인하지 못했습니다.`);
        uploaded.push({ fileId, folderId: session.folderId, originalName: file.name });
        completedBytes += file.size;
      }
      setUploadProgress("게시글 정보를 저장하고 있습니다.");
      setUploadPercent(100);
      const response = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, files: uploaded }),
      });
      const payload = (await response.json().catch(() => ({}))) as { post?: ResourcePost; error?: string };
      if (!response.ok || !payload.post) throw new Error(payload.error || "자료를 등록하지 못했습니다.");
      setDraft({ title: "", category: "제안서", content: "" });
      if (filesRef.current) filesRef.current.value = "";
      setUploadOpen(false);
      setMessage("자료를 등록했습니다.");
      await load();
    } catch (error) {
      if (uploaded.length) {
        await fetch("/api/resources/upload-session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: uploaded.map((item) => item.fileId) }),
        }).catch(() => undefined);
      }
      setMessage(error instanceof Error ? error.message : "자료를 등록하지 못했습니다.");
    } finally {
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
    if (!files.length || attachmentBusy) return;
    setAttachmentBusy(true);
    setMessage("");
    setAttachmentProgress("업로드를 준비하고 있습니다.");
    setAttachmentPercent(0);
    const uploaded: Array<{ fileId: string; folderId: string; originalName: string }> = [];
    try {
      if (mode === "replace" && files.length !== 1) throw new Error("교체할 파일 한 개를 선택해 주세요.");
      if (files.length > 10) throw new Error("한 번에 10개까지 첨부할 수 있습니다.");
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      let completedBytes = 0;
      for (const file of files) {
        const sessionResponse = await fetch("/api/resources/upload-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            title: post.title,
            category: post.category,
          }),
        });
        const session = (await sessionResponse.json().catch(() => ({}))) as {
          uploadUrl?: string;
          folderId?: string;
          error?: string;
        };
        if (!sessionResponse.ok || !session.uploadUrl || !session.folderId) {
          throw new Error(session.error || `${file.name} 업로드를 시작하지 못했습니다.`);
        }
        let fileId = "";
        for (let start = 0; start < file.size; start += uploadChunkBytes) {
          const endExclusive = Math.min(file.size, start + uploadChunkBytes);
          const chunkResponse = await fetch("/api/resources/upload-session", {
            method: "PUT",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "Content-Range": `bytes ${start}-${endExclusive - 1}/${file.size}`,
              "X-Drive-Upload-Url": session.uploadUrl,
            },
            body: file.slice(start, endExclusive),
          });
          const chunk = (await chunkResponse.json().catch(() => ({}))) as {
            complete?: boolean;
            file?: { id?: string };
            error?: string;
          };
          if (!chunkResponse.ok) throw new Error(chunk.error || `${file.name} 업로드 중 오류가 발생했습니다.`);
          if (chunk.complete) fileId = chunk.file?.id || "";
          const percent = totalBytes
            ? Math.min(100, Math.round(((completedBytes + endExclusive) / totalBytes) * 100))
            : 100;
          setAttachmentPercent(percent);
          setAttachmentProgress(`${file.name} 업로드 중 · ${percent}%`);
        }
        if (!fileId) throw new Error(`${file.name} 업로드 완료 정보를 확인하지 못했습니다.`);
        uploaded.push({ fileId, folderId: session.folderId, originalName: file.name });
        completedBytes += file.size;
      }
      setAttachmentProgress(mode === "replace" ? "기존 파일을 교체하고 있습니다." : "새 파일을 추가하고 있습니다.");
      setAttachmentPercent(100);
      const response = await fetch("/api/resources/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, mode, attachmentId, files: uploaded }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "파일 변경을 완료하지 못했습니다.");
      if (editFilesRef.current) editFilesRef.current.value = "";
      setMessage(mode === "replace" ? "파일을 교체했습니다." : "새 파일을 추가했습니다.");
      await load();
    } catch (error) {
      if (uploaded.length) {
        await fetch("/api/resources/upload-session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: uploaded.map((item) => item.fileId) }),
        }).catch(() => undefined);
      }
      setMessage(error instanceof Error ? error.message : "파일 변경을 완료하지 못했습니다.");
    } finally {
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
    .filter((entry) => entry.attachments.length > 0);
  const documentCount = posts.reduce(
    (count, post) => count + post.attachments.filter((file) => !isVideoAttachment(file)).length,
    0,
  );
  const videoCount = posts.reduce(
    (count, post) => count + post.attachments.filter(isVideoAttachment).length,
    0,
  );
  const visibleFileCount = libraryKind === "videos" ? videoCount : documentCount;

  return (
    <section className="resource-library-page">
      <header className="resource-library-hero">
        <div>
          <span className="section-kicker">SHARED RESOURCE LIBRARY</span>
          <h2>자료실</h2>
        </div>
        <div className="resource-hero-actions">
          <button type="button" className="primary-button" onClick={() => setUploadOpen((value) => !value)}>
            {uploadOpen ? "등록 닫기" : "+ 자료 등록"}
          </button>
        </div>
      </header>

      {!configured && (
        <div className="resource-library-warning">배포 설정에 Google Drive 연결 정보를 등록하면 파일 첨부를 사용할 수 있습니다.</div>
      )}
      {message && <div className="resource-library-message">{message}</div>}

      {uploadOpen && (
        <form className="resource-upload-form" onSubmit={upload}>
          <label>
            <span>분류</span>
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>제목</span>
            <input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="예: 가상현실 스포츠실 제안서" />
          </label>
          <label className="wide">
            <span>설명</span>
            <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="사용처나 참고 내용을 적어 주세요." />
          </label>
          <label className="wide resource-file-picker">
            <span>첨부 파일</span>
            <input ref={filesRef} required type="file" multiple />
            <small>문서와 영상은 파일 형식에 따라 자동으로 나뉩니다 · 최대 10개</small>
            {uploadProgress && (
              <div className="resource-upload-progress" role="status" aria-live="polite">
                <span style={{ width: `${uploadPercent}%` }} />
                <small>{uploadProgress}</small>
              </div>
            )}
          </label>
          <div className="resource-form-actions">
            <button type="button" className="secondary-button" onClick={() => setUploadOpen(false)}>취소</button>
            <button type="submit" className="primary-button" disabled={busy || !configured}>{busy ? "등록 중…" : "자료 등록"}</button>
          </div>
        </form>
      )}

      <nav className="resource-library-tabs" aria-label="자료 종류">
        <button
          type="button"
          className={libraryKind === "documents" ? "active" : ""}
          aria-pressed={libraryKind === "documents"}
          onClick={() => setLibraryKind("documents")}
        >
          <span>문서 자료</span><strong>{documentCount}</strong>
        </button>
        <button
          type="button"
          className={libraryKind === "videos" ? "active" : ""}
          aria-pressed={libraryKind === "videos"}
          onClick={() => setLibraryKind("videos")}
        >
          <span>영상 자료</span><strong>{videoCount}</strong>
        </button>
      </nav>

      <div className="resource-library-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목·설명 검색" />
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">전체 분류</option>
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
        <span>{visibleFileCount}개</span>
      </div>

      <div className="resource-post-list">
        {visiblePosts.map(({ post, attachments }) => {
          const canEdit = isAdmin || post.createdBy === memberId;
          return (
            <article key={post.id} className="resource-post-card">
              {editing === post.id ? (
                <div className="resource-edit-form">
                  <select value={editDraft.category} onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })}>
                    {categories.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <input value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} />
                  <textarea value={editDraft.content} onChange={(event) => setEditDraft({ ...editDraft, content: event.target.value })} />
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
                            disabled={attachmentBusy}
                            onChange={(event) => {
                              const next = Array.from(event.target.files ?? []);
                              void uploadEditFiles(post, next, "replace", file.id);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <button type="button" className="danger" disabled={attachmentBusy} onClick={() => void deleteAttachment(post, file)}>삭제</button>
                      </div>
                    ))}
                    <label className="resource-add-files">
                      <span>+ 새 파일 추가</span>
                      <input
                        ref={editFilesRef}
                        type="file"
                        multiple
                        disabled={attachmentBusy}
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
                  <div><button type="button" onClick={() => setEditing(null)}>취소</button><button type="button" className="primary-button" onClick={() => void saveEdit(post)}>저장</button></div>
                </div>
              ) : (
                <>
                  <header>
                    <div className="resource-post-summary"><em>{post.category}</em><h3>{post.title}</h3><small>{displayDate(post.createdAt)}</small></div>
                    <div className="resource-post-actions">
                      {canEdit && <button type="button" onClick={() => { setEditing(post.id); setEditDraft({ title: post.title, category: post.category, content: post.content }); }}>수정</button>}
                      {isAdmin && <button type="button" className="danger" onClick={() => void archive(post)}>삭제</button>}
                    </div>
                  </header>
                  {post.content && <p className="resource-post-content">{post.content}</p>}
                  <div className="resource-attachment-list">
                    {attachments.map((file) => (
                      <a key={file.id} href={file.downloadUrl}>
                        <span>{file.originalName}</span><small>{formatBytes(file.sizeBytes)} · 내려받기</small>
                      </a>
                    ))}
                  </div>
                </>
              )}
            </article>
          );
        })}
        {!loading && !visiblePosts.length && (
          <div className="empty-state">등록된 {libraryKind === "videos" ? "영상" : "문서"} 자료가 없습니다.</div>
        )}
        {loading && <div className="empty-state">자료를 불러오는 중입니다.</div>}
      </div>
    </section>
  );
}
