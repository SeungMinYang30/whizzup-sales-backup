import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("영상 자료실은 위즈업 공개 유튜브 채널을 전체 페이지 동기화한다", async () => {
  const [page, route, sync] = await Promise.all([
    read("../app/resource-library-page.tsx"),
    read("../app/api/resources/youtube/route.ts"),
    read("../lib/youtube-channel-sync.ts"),
  ]);

  assert.match(route, /UCAM4hF7-RTRtXNk5Vwd_3pw/);
  assert.match(route, /CHANNEL_VIDEOS_URL/);
  assert.match(route, /CHANNEL_SHORTS_URL/);
  assert.match(sync, /playlistItems/);
  assert.match(sync, /do \{[\s\S]*\} while \(pageToken\)/);
  assert.match(sync, /while \(queued\.length/);
  assert.match(sync, /continuation/);
  assert.match(sync, /MAX_CONTINUATION_PAGES/);
  assert.match(sync, /LOCKUP_CONTENT_TYPE_VIDEO/);
  assert.match(route, /new Map\(/);
  assert.match(route, /\/shorts\//);
  assert.match(page, /\/api\/resources\/youtube/);
  assert.match(page, /위즈업 공식 유튜브/);
  assert.match(page, /링크 복사/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /youtube-nocookie\.com\/embed/);
});

test("YouTube 채널 캐시는 전체 동기화 때만 비공개·삭제 영상을 제외하고 직접 등록은 보존한다", async () => {
  const [route, store, migration, styles] = await Promise.all([
    read("../app/api/resources/youtube/route.ts"),
    read("../lib/youtube-resource-library.ts"),
    read("../drizzle/0086_youtube_channel_video_cache.sql"),
    read("../app/globals.css"),
  ]);
  assert.match(route, /syncPublicYouTubeChannel/);
  assert.match(route, /if \(complete\)/);
  assert.match(route, /UPDATE youtube_channel_videos SET active = 0/);
  assert.match(route, /INSERT INTO youtube_channel_videos/);
  assert.match(route, /SELECT \* FROM youtube_resource_links/);
  assert.doesNotMatch(route, /DELETE FROM youtube_resource_links/);
  assert.match(store, /youtube_channel_videos/);
  assert.match(migration, /youtube_channel_videos_active_idx/);
  assert.match(styles, /repeat\(auto-fill, minmax\(270px, 320px\)\)/);
});

test("전체·동영상·Shorts 집계와 공식 API 대체 경로가 고정 14개 회귀를 막는다", async () => {
  const [page, route, sync] = await Promise.all([
    read("../app/resource-library-page.tsx"),
    read("../app/api/resources/youtube/route.ts"),
    read("../lib/youtube-channel-sync.ts"),
  ]);
  assert.match(route, /counts = \{/);
  assert.match(route, /shorts: videos\.filter/);
  assert.match(page, /전체 \$\{youtubeCounts\.total\}/);
  assert.match(page, /동영상 \$\{youtubeCounts\.video\}/);
  assert.match(page, /Shorts \$\{youtubeCounts\.shorts\}/);
  assert.match(sync, /YOUTUBE_DATA_API_KEY|apiKey/);
  assert.match(sync, /falling back to public channel pages/);
  assert.doesNotMatch(sync, /slice\(0,\s*14\)|maxResults",\s*"14"/);
});

test("문서 자료 등록 기능은 유지하고 영상 탭에서는 유튜브 채널을 연다", async () => {
  const page = await read("../app/resource-library-page.tsx");
  assert.match(page, /\+ 문서 등록/);
  assert.match(page, /libraryKind === "documents" && uploadOpen/);
  assert.match(page, /https:\/\/www\.youtube\.com\/@whizzup_official/);
});

test("누락된 유튜브 주소는 승인된 담당자가 중복 없이 보완 등록한다", async () => {
  const [page, route, store, migration] = await Promise.all([
    read("../app/resource-library-page.tsx"),
    read("../app/api/resources/youtube/route.ts"),
    read("../lib/youtube-resource-library.ts"),
    read("../drizzle/0085_youtube_resource_links.sql"),
  ]);
  assert.match(page, /\+ 유튜브 주소 등록/);
  assert.match(page, /일반 영상·Shorts 주소를 붙여 넣으면/);
  assert.match(route, /requireApprovedMember/);
  assert.match(route, /youtube\.com\/oembed/);
  assert.match(route, /INSERT OR IGNORE INTO youtube_resource_links/);
  assert.match(store, /video_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /youtube_resource_links_video_idx/);
});
