import {
  RESOURCE_UPLOAD_CHUNK_BYTES,
  RESOURCE_UPLOAD_MAX_RETRIES,
  RESOURCE_UPLOAD_RETRY_BASE_DELAY_MS,
} from "./resource-upload-config";

export type ResourceUploadErrorCode =
  | "VERCEL_PAYLOAD_LIMIT"
  | "DRIVE_AUTH"
  | "NETWORK"
  | "SESSION_EXPIRED"
  | "CANCELLED"
  | "UPLOAD_FAILED";

export class ResourceUploadError extends Error {
  readonly code: ResourceUploadErrorCode;
  readonly status?: number;

  constructor(code: ResourceUploadErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ResourceUploadError";
    this.code = code;
    this.status = status;
  }
}

export type UploadableResourceFile = {
  name: string;
  type: string;
  size: number;
  slice(start?: number, end?: number, contentType?: string): Blob;
};

export type UploadedResourceFile = {
  fileId: string;
  folderId: string;
  originalName: string;
};

type UploadProgress = {
  fileName: string;
  fileIndex: number;
  fileCount: number;
  transferredBytes: number;
  totalBytes: number;
  percent: number;
};

type UploadOptions = {
  title: string;
  category: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  onProgress?: (progress: UploadProgress) => void;
  onFileComplete?: (file: UploadedResourceFile) => void;
};

type ErrorPayload = { code?: string; error?: string };

function errorMessage(code: ResourceUploadErrorCode, fallback?: string) {
  if (code === "VERCEL_PAYLOAD_LIMIT") return "업로드 청크가 Vercel 요청 용량 제한을 초과했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.";
  if (code === "DRIVE_AUTH") return "Google Drive 인증이 만료되었거나 권한이 없습니다. 관리자에게 Drive 연결을 확인해 달라고 요청해 주세요.";
  if (code === "NETWORK") return "네트워크 연결이 불안정하여 업로드하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.";
  if (code === "SESSION_EXPIRED") return "업로드 세션이 만료되었습니다. 파일을 다시 선택해 업로드해 주세요.";
  if (code === "CANCELLED") return "업로드를 취소했습니다.";
  return fallback || "파일 업로드 중 오류가 발생했습니다. 다시 시도해 주세요.";
}

function normalizeError(error: unknown, status?: number, payload?: ErrorPayload) {
  if (error instanceof ResourceUploadError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ResourceUploadError("CANCELLED", errorMessage("CANCELLED"));
  }
  if (status === 413 || payload?.code === "VERCEL_PAYLOAD_LIMIT") {
    return new ResourceUploadError("VERCEL_PAYLOAD_LIMIT", errorMessage("VERCEL_PAYLOAD_LIMIT"), status);
  }
  if (status === 401 || status === 403 || payload?.code === "DRIVE_AUTH") {
    return new ResourceUploadError("DRIVE_AUTH", errorMessage("DRIVE_AUTH"), status);
  }
  if (status === 404 || status === 410 || payload?.code === "DRIVE_SESSION_EXPIRED") {
    return new ResourceUploadError("SESSION_EXPIRED", errorMessage("SESSION_EXPIRED"), status);
  }
  if (error instanceof TypeError) {
    return new ResourceUploadError("NETWORK", errorMessage("NETWORK"));
  }
  const fallback = payload?.error || (error instanceof Error ? error.message : "");
  return new ResourceUploadError("UPLOAD_FAILED", errorMessage("UPLOAD_FAILED", fallback), status);
}

async function responsePayload(response: Response) {
  return (await response.json().catch(() => ({}))) as ErrorPayload & {
    uploadUrl?: string;
    folderId?: string;
    complete?: boolean;
    file?: { id?: string };
  };
}

function retryable(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export async function uploadResourceFilesSequentially(
  files: UploadableResourceFile[],
  options: UploadOptions,
) {
  if (files.length > 10) throw new ResourceUploadError("UPLOAD_FAILED", "한 번에 최대 10개 파일까지 업로드할 수 있습니다.");
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const uploaded: UploadedResourceFile[] = [];
  let completedBytes = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    if (options.signal?.aborted) throw new ResourceUploadError("CANCELLED", errorMessage("CANCELLED"));

    let sessionResponse: Response;
    try {
      sessionResponse = await fetchImpl("/api/resources/upload-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          title: options.title,
          category: options.category,
        }),
        signal: options.signal,
      });
    } catch (error) {
      throw normalizeError(error);
    }
    const session = await responsePayload(sessionResponse);
    if (!sessionResponse.ok || !session.uploadUrl || !session.folderId) {
      throw normalizeError(new Error(session.error), sessionResponse.status, session);
    }

    let fileId = "";
    for (let start = 0; start < file.size; start += RESOURCE_UPLOAD_CHUNK_BYTES) {
      const endExclusive = Math.min(file.size, start + RESOURCE_UPLOAD_CHUNK_BYTES);
      let chunkSucceeded = false;
      let lastError: ResourceUploadError | null = null;

      for (let attempt = 0; attempt <= RESOURCE_UPLOAD_MAX_RETRIES; attempt += 1) {
        if (options.signal?.aborted) throw new ResourceUploadError("CANCELLED", errorMessage("CANCELLED"));
        try {
          const chunkResponse = await fetchImpl("/api/resources/upload-session", {
            method: "PUT",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "Content-Range": `bytes ${start}-${endExclusive - 1}/${file.size}`,
              "X-Drive-Upload-Url": session.uploadUrl,
            },
            body: file.slice(start, endExclusive),
            signal: options.signal,
          });
          const chunk = await responsePayload(chunkResponse);
          if (!chunkResponse.ok) {
            lastError = normalizeError(new Error(chunk.error), chunkResponse.status, chunk);
            if (!retryable(chunkResponse.status) || attempt === RESOURCE_UPLOAD_MAX_RETRIES) throw lastError;
          } else {
            if (chunk.complete) fileId = chunk.file?.id || "";
            chunkSucceeded = true;
            const transferredBytes = completedBytes + endExclusive;
            options.onProgress?.({
              fileName: file.name,
              fileIndex,
              fileCount: files.length,
              transferredBytes,
              totalBytes,
              percent: totalBytes ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : 100,
            });
            break;
          }
        } catch (error) {
          lastError = normalizeError(error);
          if (lastError.code === "CANCELLED") throw lastError;
          if (lastError.code !== "NETWORK" || attempt === RESOURCE_UPLOAD_MAX_RETRIES) throw lastError;
        }
        await sleep(RESOURCE_UPLOAD_RETRY_BASE_DELAY_MS * 2 ** attempt);
      }

      if (!chunkSucceeded) throw lastError || new ResourceUploadError("UPLOAD_FAILED", errorMessage("UPLOAD_FAILED"));
    }

    if (!fileId) throw new ResourceUploadError("UPLOAD_FAILED", `${file.name} 업로드 완료 정보를 확인하지 못했습니다.`);
    const completed = { fileId, folderId: session.folderId, originalName: file.name };
    uploaded.push(completed);
    options.onFileComplete?.(completed);
    completedBytes += file.size;
  }

  return uploaded;
}

export function resourceUploadErrorMessage(error: unknown) {
  return normalizeError(error).message;
}
