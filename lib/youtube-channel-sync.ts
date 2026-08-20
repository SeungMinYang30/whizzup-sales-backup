export type ChannelVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  youtubeUrl: string;
  kind: "video" | "shorts";
  source: "channel";
};

export type ChannelSyncResult = {
  videos: ChannelVideo[];
  complete: boolean;
  mode: "youtube-data-api" | "channel-continuation";
  warnings: string[];
};

type JsonRecord = Record<string, unknown>;

const YOUTUBE_API_ROOT = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_BROWSE_ROOT = "https://www.youtube.com/youtubei/v1/browse";
const MAX_CONTINUATION_PAGES = 100;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const source = record(value);
  if (typeof source.simpleText === "string") return source.simpleText.trim();
  if (typeof source.content === "string") return source.content.trim();
  if (typeof source.accessibilityText === "string") return source.accessibilityText.trim();
  if (Array.isArray(source.runs)) {
    return source.runs.map((item) => String(record(item).text || "")).join("").trim();
  }
  return "";
}

function thumbnailValue(value: unknown, videoId: string): string {
  const source = record(value);
  const thumbnails = Array.isArray(source.thumbnails)
    ? source.thumbnails
    : Array.isArray(record(source.image).sources)
      ? record(source.image).sources as unknown[]
      : [];
  return thumbnails
    .map((item) => String(record(item).url || ""))
    .filter(Boolean)
    .at(-1) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function validVideoId(value: unknown): string {
  const videoId = String(value || "");
  return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : "";
}

function videoFromRenderer(value: unknown, kind: "video" | "shorts"): ChannelVideo | null {
  const source = record(value);
  const videoId = validVideoId(
    source.videoId
      || source.contentId
      || record(record(record(source.onTap).innertubeCommand).reelWatchEndpoint).videoId
      || record(record(source.navigationEndpoint).watchEndpoint).videoId,
  );
  if (!videoId) return null;

  const metadata = record(record(source.metadata).lockupMetadataViewModel);
  const overlay = record(source.overlayMetadata);
  const title = textValue(source.title)
    || textValue(metadata.title)
    || textValue(overlay.primaryText)
    || textValue(source.headline)
    || "위즈업 YouTube 영상";
  const description = textValue(source.descriptionSnippet)
    || textValue(source.descriptionText)
    || (kind === "shorts" ? "위즈업 공식 YouTube Shorts" : "위즈업 공식 YouTube 일반 영상");
  const thumbnail = record(source.thumbnail);
  const contentImage = record(record(source.contentImage).thumbnailViewModel);
  const publishedAt = textValue(source.publishedTimeText);
  return {
    videoId,
    title,
    description,
    publishedAt,
    thumbnailUrl: thumbnailValue(
      Object.keys(thumbnail).length ? thumbnail : record(contentImage.image),
      videoId,
    ),
    youtubeUrl: kind === "shorts"
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`,
    kind,
    source: "channel",
  };
}

export function collectYouTubePage(value: unknown, kind: "video" | "shorts") {
  const videos = new Map<string, ChannelVideo>();
  const continuations = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const source = node as JsonRecord;
    const continuation = record(source.continuationCommand);
    if (typeof continuation.token === "string" && continuation.token) {
      continuations.add(continuation.token);
    }

    const renderers = [
      source.videoRenderer,
      source.gridVideoRenderer,
      source.playlistVideoRenderer,
      source.reelItemRenderer,
      source.shortsLockupViewModel,
    ];
    if (source.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") renderers.push(source);
    for (const renderer of renderers) {
      const video = videoFromRenderer(renderer, kind);
      if (video) videos.set(video.videoId, video);
    }
    Object.values(source).forEach(visit);
  };
  visit(value);
  return { videos: [...videos.values()], continuations: [...continuations] };
}

export function extractYouTubeInitialData(html: string): unknown {
  const markers = ["var ytInitialData = ", "window[\"ytInitialData\"] = ", "ytInitialData = "];
  const markerIndex = markers
    .map((marker) => ({ marker, index: html.indexOf(marker) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0];
  if (!markerIndex) return null;
  const start = html.indexOf("{", markerIndex.index + markerIndex.marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function youtubeClientConfig(html: string) {
  const apiKey = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1] || "";
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1]
    || "2.20260801.00.00";
  return { apiKey, clientVersion };
}

async function fetchChannelTab(url: string, kind: "video" | "shorts") {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
    },
  });
  if (!response.ok) throw new Error(`YouTube ${kind} tab request failed: ${response.status}`);
  const html = await response.text();
  const initialData = extractYouTubeInitialData(html);
  if (!initialData) throw new Error(`YouTube ${kind} tab data was not found`);
  const config = youtubeClientConfig(html);
  const firstPage = collectYouTubePage(initialData, kind);
  const videos = new Map(firstPage.videos.map((video) => [video.videoId, video] as const));
  const queued = [...firstPage.continuations];
  const visited = new Set<string>();
  let complete = true;

  while (queued.length && visited.size < MAX_CONTINUATION_PAGES) {
    const token = queued.shift() || "";
    if (!token || visited.has(token)) continue;
    visited.add(token);
    if (!config.apiKey) {
      complete = false;
      break;
    }
    try {
      const continuationResponse = await fetch(`${YOUTUBE_BROWSE_ROOT}?key=${encodeURIComponent(config.apiKey)}`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-YouTube-Client-Name": "1",
          "X-YouTube-Client-Version": config.clientVersion,
        },
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion: config.clientVersion, hl: "ko", gl: "KR" } },
          continuation: token,
        }),
      });
      if (!continuationResponse.ok) throw new Error(`continuation request failed: ${continuationResponse.status}`);
      const page = collectYouTubePage(await continuationResponse.json(), kind);
      page.videos.forEach((video) => videos.set(video.videoId, video));
      page.continuations.forEach((nextToken) => {
        if (!visited.has(nextToken)) queued.push(nextToken);
      });
    } catch (error) {
      console.error(`YouTube ${kind} continuation failed`, error);
      complete = false;
      break;
    }
  }
  if (queued.length) complete = false;
  return { videos: [...videos.values()], complete };
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`YouTube Data API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchWithDataApi(channelId: string, apiKey: string, shortsUrl: string): Promise<ChannelSyncResult> {
  const warnings: string[] = [];
  const channelUrl = new URL(`${YOUTUBE_API_ROOT}/channels`);
  channelUrl.searchParams.set("part", "contentDetails");
  channelUrl.searchParams.set("id", channelId);
  channelUrl.searchParams.set("key", apiKey);
  const channel = await fetchJson<{ items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>(channelUrl);
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || "";
  if (!uploads) throw new Error("YouTube uploads playlist was not found");

  const videoIds: string[] = [];
  let pageToken = "";
  do {
    const playlistUrl = new URL(`${YOUTUBE_API_ROOT}/playlistItems`);
    playlistUrl.searchParams.set("part", "contentDetails");
    playlistUrl.searchParams.set("playlistId", uploads);
    playlistUrl.searchParams.set("maxResults", "50");
    playlistUrl.searchParams.set("key", apiKey);
    if (pageToken) playlistUrl.searchParams.set("pageToken", pageToken);
    const page = await fetchJson<{ items?: Array<{ contentDetails?: { videoId?: string } }>; nextPageToken?: string }>(playlistUrl);
    page.items?.forEach((item) => {
      const videoId = validVideoId(item.contentDetails?.videoId);
      if (videoId) videoIds.push(videoId);
    });
    pageToken = page.nextPageToken || "";
  } while (pageToken);

  let shorts = { videos: [] as ChannelVideo[], complete: false };
  try {
    shorts = await fetchChannelTab(shortsUrl, "shorts");
  } catch (error) {
    console.error("YouTube Shorts classification failed", error);
    warnings.push("Shorts 탭을 확인하지 못해 일부 영상 구분이 일반 동영상으로 표시될 수 있습니다.");
  }
  const shortsIds = new Set(shorts.videos.map((video) => video.videoId));
  const videos: ChannelVideo[] = [];
  for (let index = 0; index < videoIds.length; index += 50) {
    const detailsUrl = new URL(`${YOUTUBE_API_ROOT}/videos`);
    detailsUrl.searchParams.set("part", "snippet,status");
    detailsUrl.searchParams.set("id", videoIds.slice(index, index + 50).join(","));
    detailsUrl.searchParams.set("maxResults", "50");
    detailsUrl.searchParams.set("key", apiKey);
    const details = await fetchJson<{
      items?: Array<{
        id?: string;
        status?: { privacyStatus?: string };
        snippet?: {
          title?: string;
          description?: string;
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
      }>;
    }>(detailsUrl);
    details.items?.forEach((item) => {
      const videoId = validVideoId(item.id);
      if (!videoId || item.status?.privacyStatus !== "public") return;
      const kind = shortsIds.has(videoId) ? "shorts" as const : "video" as const;
      const thumbnails = Object.values(item.snippet?.thumbnails || {});
      videos.push({
        videoId,
        title: String(item.snippet?.title || "위즈업 YouTube 영상"),
        description: String(item.snippet?.description || ""),
        publishedAt: String(item.snippet?.publishedAt || ""),
        thumbnailUrl: String(thumbnails.at(-1)?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
        youtubeUrl: kind === "shorts"
          ? `https://www.youtube.com/shorts/${videoId}`
          : `https://www.youtube.com/watch?v=${videoId}`,
        kind,
        source: "channel",
      });
    });
  }
  return { videos, complete: true, mode: "youtube-data-api", warnings };
}

async function fetchWithContinuations(videosUrl: string, shortsUrl: string): Promise<ChannelSyncResult> {
  const warnings: string[] = [];
  const [videosResult, shortsResult] = await Promise.allSettled([
    fetchChannelTab(videosUrl, "video"),
    fetchChannelTab(shortsUrl, "shorts"),
  ]);
  const videosPage = videosResult.status === "fulfilled"
    ? videosResult.value
    : { videos: [] as ChannelVideo[], complete: false };
  const shortsPage = shortsResult.status === "fulfilled"
    ? shortsResult.value
    : { videos: [] as ChannelVideo[], complete: false };
  if (videosResult.status === "rejected") warnings.push("공식 채널의 동영상 탭을 불러오지 못했습니다.");
  if (shortsResult.status === "rejected") warnings.push("공식 채널의 Shorts 탭을 불러오지 못했습니다.");
  const merged = new Map(videosPage.videos.map((video) => [video.videoId, video] as const));
  shortsPage.videos.forEach((video) => merged.set(video.videoId, video));
  return {
    videos: [...merged.values()],
    complete: videosPage.complete && shortsPage.complete,
    mode: "channel-continuation",
    warnings,
  };
}

export async function syncPublicYouTubeChannel(options: {
  channelId: string;
  videosUrl: string;
  shortsUrl: string;
  apiKey?: string;
}): Promise<ChannelSyncResult> {
  if (options.apiKey) {
    try {
      return await fetchWithDataApi(options.channelId, options.apiKey, options.shortsUrl);
    } catch (error) {
      console.error("YouTube Data API sync failed; falling back to public channel pages", error);
      const fallback = await fetchWithContinuations(options.videosUrl, options.shortsUrl);
      fallback.warnings.unshift("YouTube 공식 API 호출에 실패해 공개 채널 페이지 방식으로 동기화했습니다.");
      return fallback;
    }
  }
  return fetchWithContinuations(options.videosUrl, options.shortsUrl);
}
