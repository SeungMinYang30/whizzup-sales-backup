import { NextResponse } from "next/server";
import {
  AccessError,
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import {
  ensureYouTubeResourceLibraryReady,
  type YouTubeChannelVideoRow,
  type YouTubeResourceLinkRow,
} from "../../../../lib/youtube-resource-library";
import {
  syncPublicYouTubeChannel,
  type ChannelVideo,
} from "../../../../lib/youtube-channel-sync";

export const dynamic = "force-dynamic";

const CHANNEL_ID = "UCAM4hF7-RTRtXNk5Vwd_3pw";
const CHANNEL_HANDLE = "@whizzup_official";
const CHANNEL_VIDEOS_URL = `https://www.youtube.com/${CHANNEL_HANDLE}/videos`;
const CHANNEL_SHORTS_URL = `https://www.youtube.com/${CHANNEL_HANDLE}/shorts`;

type YouTubeVideo = Omit<ChannelVideo, "source"> & {
  source: "channel" | "manual";
};

function parseYouTubeUrl(rawValue: unknown) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  let kind: "video" | "shorts" = "video";
  if (hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "shorts") {
      videoId = parts[1] || "";
      kind = "shorts";
    } else if (["embed", "live"].includes(parts[0])) {
      videoId = parts[1] || "";
    } else {
      videoId = url.searchParams.get("v") || "";
    }
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return {
    videoId,
    kind,
    youtubeUrl: kind === "shorts"
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function manualVideo(row: YouTubeResourceLinkRow): YouTubeVideo {
  return {
    videoId: row.video_id,
    title: row.title || "YouTube 영상",
    description: row.description || "담당자가 직접 등록한 유튜브 영상입니다.",
    publishedAt: row.published_at || row.created_at,
    thumbnailUrl: row.thumbnail_url || `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`,
    youtubeUrl: row.youtube_url,
    kind: row.kind === "shorts" ? "shorts" : "video",
    source: "manual",
  };
}

function channelVideo(row: YouTubeChannelVideoRow): YouTubeVideo {
  return {
    videoId: row.video_id,
    title: row.title || "위즈업 YouTube 영상",
    description: row.description,
    publishedAt: row.published_at,
    thumbnailUrl: row.thumbnail_url || `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`,
    youtubeUrl: row.youtube_url,
    kind: row.kind === "shorts" ? "shorts" : "video",
    source: "channel",
  };
}

async function manualVideos() {
  const d1 = await ensureYouTubeResourceLibraryReady();
  const rows = await d1
    .prepare("SELECT * FROM youtube_resource_links ORDER BY created_at DESC, id DESC")
    .all<YouTubeResourceLinkRow>();
  return rows.results.map(manualVideo);
}

async function cachedChannelVideos() {
  const d1 = await ensureYouTubeResourceLibraryReady();
  const rows = await d1
    .prepare("SELECT * FROM youtube_channel_videos WHERE active = 1 ORDER BY published_at DESC, video_id DESC")
    .all<YouTubeChannelVideoRow>();
  return rows.results.map(channelVideo);
}

async function persistChannelVideos(
  videos: ChannelVideo[],
  syncSource: "youtube-data-api" | "channel-continuation",
  complete: boolean,
) {
  if (!videos.length) return;
  const d1 = await ensureYouTubeResourceLibraryReady();
  const statements = videos.map((video) => d1.prepare(
    `INSERT INTO youtube_channel_videos (
      video_id, title, description, thumbnail_url, youtube_url, kind,
      published_at, active, sync_source, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(video_id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      thumbnail_url = excluded.thumbnail_url,
      youtube_url = excluded.youtube_url,
      kind = excluded.kind,
      published_at = excluded.published_at,
      active = 1,
      sync_source = excluded.sync_source,
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    video.videoId,
    video.title.slice(0, 500),
    video.description.slice(0, 5000),
    video.thumbnailUrl.slice(0, 1000),
    video.youtubeUrl.slice(0, 1000),
    video.kind,
    video.publishedAt.slice(0, 100),
    syncSource,
  ));
  if (complete) {
    statements.unshift(d1.prepare(
      "UPDATE youtube_channel_videos SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE active <> 0",
    ));
  }
  await d1.batch(statements);
}

async function isPublicManualVideo(video: YouTubeVideo) {
  const oEmbedUrl = new URL("https://www.youtube.com/oembed");
  oEmbedUrl.searchParams.set("url", video.youtubeUrl);
  oEmbedUrl.searchParams.set("format", "json");
  try {
    const response = await fetch(oEmbedUrl, { cache: "no-store" });
    if (response.ok) return true;
    if ([401, 403, 404].includes(response.status)) return false;
  } catch (error) {
    console.error(`Manual YouTube visibility check failed for ${video.videoId}`, error);
  }
  return true;
}

export async function GET() {
  try {
    const [registered, cached] = await Promise.all([manualVideos(), cachedChannelVideos()]);
    let channel = cached;
    let syncMode: "youtube-data-api" | "channel-continuation" | "cached" = "cached";
    let complete = false;
    const warnings: string[] = [];
    try {
      const result = await syncPublicYouTubeChannel({
        channelId: CHANNEL_ID,
        videosUrl: CHANNEL_VIDEOS_URL,
        shortsUrl: CHANNEL_SHORTS_URL,
        apiKey: process.env.YOUTUBE_DATA_API_KEY?.trim(),
      });
      syncMode = result.mode;
      complete = result.complete;
      warnings.push(...result.warnings);
      if (result.videos.length) {
        await persistChannelVideos(result.videos, result.mode, result.complete);
        channel = await cachedChannelVideos();
      } else {
        warnings.push("채널에서 새 목록을 받지 못해 마지막 정상 동기화 목록을 표시합니다.");
      }
    } catch (error) {
      console.error("YouTube public channel sync failed; using cache", error);
      warnings.push("YouTube 연결이 원활하지 않아 마지막 정상 동기화 목록을 표시합니다.");
    }

    const merged = new Map(channel.map((video) => [video.videoId, video] as const));
    const manualOnly = registered.filter((video) => !merged.has(video.videoId));
    const visibility = await Promise.all(manualOnly.map(isPublicManualVideo));
    manualOnly.forEach((video, index) => {
      if (visibility[index]) merged.set(video.videoId, video);
    });
    registered.forEach((video) => {
      const existing = merged.get(video.videoId);
      if (existing) merged.set(video.videoId, { ...existing, source: "manual" });
    });

    const videos = [...merged.values()].sort((left, right) =>
      String(right.publishedAt).localeCompare(String(left.publishedAt))
      || right.videoId.localeCompare(left.videoId),
    );
    const counts = {
      total: videos.length,
      video: videos.filter((video) => video.kind === "video").length,
      shorts: videos.filter((video) => video.kind === "shorts").length,
      channel: channel.length,
      manual: videos.filter((video) => video.source === "manual").length,
    };
    return NextResponse.json({
      videos,
      counts,
      syncMode,
      complete,
      warnings,
      channelId: CHANNEL_ID,
      channelHandle: CHANNEL_HANDLE,
      channelUrl: `https://www.youtube.com/${CHANNEL_HANDLE}`,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("YouTube resource sync failed", error);
    return NextResponse.json(
      { error: "유튜브 영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const body = await request.json().catch(() => ({})) as { url?: unknown };
    const parsed = parseYouTubeUrl(body.url);
    if (!parsed) {
      return NextResponse.json(
        { error: "올바른 유튜브 영상 또는 Shorts 주소를 입력해 주세요." },
        { status: 400 },
      );
    }

    const oEmbedUrl = new URL("https://www.youtube.com/oembed");
    oEmbedUrl.searchParams.set("url", parsed.youtubeUrl);
    oEmbedUrl.searchParams.set("format", "json");
    const metadata = await fetch(oEmbedUrl, { cache: "no-store" })
      .then(async (response) => response.ok
        ? response.json() as Promise<{ title?: string; thumbnail_url?: string; author_name?: string }>
        : null)
      .catch(() => null);
    if (!metadata?.title) {
      return NextResponse.json(
        { error: "공개 상태의 유튜브 영상을 확인할 수 없습니다. 주소와 공개 여부를 확인해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureYouTubeResourceLibraryReady();
    const result = await d1.prepare(
      `INSERT OR IGNORE INTO youtube_resource_links (
        video_id, youtube_url, title, description, thumbnail_url, kind,
        published_at, created_by, created_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
    ).bind(
      parsed.videoId,
      parsed.youtubeUrl,
      String(metadata.title).trim().slice(0, 300),
      metadata.author_name ? `${metadata.author_name} YouTube 영상` : "담당자가 직접 등록한 유튜브 영상입니다.",
      String(metadata.thumbnail_url || `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`).slice(0, 600),
      parsed.kind,
      member.id,
      member.displayName,
    ).run();
    const row = await d1.prepare("SELECT * FROM youtube_resource_links WHERE video_id = ? LIMIT 1")
      .bind(parsed.videoId)
      .first<YouTubeResourceLinkRow>();
    if (!row) throw new Error("등록한 영상을 불러오지 못했습니다.");
    return NextResponse.json({ video: manualVideo(row), created: Number(result.meta.changes || 0) > 0 });
  } catch (error) {
    if (error instanceof AccessError) return accessErrorResponse(error);
    console.error("YouTube resource link registration failed", error);
    return NextResponse.json({ error: "유튜브 주소를 등록하지 못했습니다." }, { status: 500 });
  }
}
