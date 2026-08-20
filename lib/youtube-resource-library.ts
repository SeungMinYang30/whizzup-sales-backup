import { getD1 } from "../db";

const statements = [
  `CREATE TABLE IF NOT EXISTS youtube_resource_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL UNIQUE,
    youtube_url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'video',
    published_at TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS youtube_resource_links_created_idx
   ON youtube_resource_links (created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS youtube_channel_videos (
    video_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT NOT NULL DEFAULT '',
    youtube_url TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'video',
    published_at TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    sync_source TEXT NOT NULL DEFAULT '',
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS youtube_channel_videos_active_idx
   ON youtube_channel_videos (active, published_at DESC, video_id)`,
];

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

export type YouTubeResourceLinkRow = {
  id: number;
  video_id: string;
  youtube_url: string;
  title: string;
  description: string;
  thumbnail_url: string;
  kind: string;
  published_at: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
};

export type YouTubeChannelVideoRow = {
  video_id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  youtube_url: string;
  kind: string;
  published_at: string;
  active: number;
  sync_source: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export function ensureYouTubeResourceLibraryReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = getD1();
      await d1.batch(statements.map((statement) => d1.prepare(statement)));
      await d1.prepare("PRAGMA optimize").run();
      return d1;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}
