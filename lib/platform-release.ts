import sitesRelease from "../.openai/sites-release.json";
import vercelSync from "../.openai/vercel-sync.json";

export type ReleasePlatform = "vercel" | "sites";

export const PLATFORM_RELEASE = {
  platform: "sites" as ReleasePlatform,
  platformLabel: "Sites 대기판",
  deploymentVersion: `v${sitesRelease.version}`,
  fallbackSourceCommit: sitesRelease.sourceCommit,
  sourceCommittedAt: sitesRelease.releasedAt,
  upstreamVercelCommit: vercelSync.vercelCommit,
  upstreamSyncedAt: vercelSync.syncedAt,
};
