import { getD1 } from "../db";

export type ReplicationSyncState = {
  id: number;
  source_origin: string;
  source_created_at: string | null;
  source_checksum: string;
  source_counts_json: string;
  status: "idle" | "syncing" | "succeeded" | "failed";
  last_attempt_at: string | null;
  last_success_at: string | null;
  duration_ms: number | null;
  error_message: string;
  operating_mode: "replica" | "primary";
  cutover_at: string | null;
  cutover_by: number | null;
};

export async function getReplicationSyncState() {
  return getD1()
    .prepare(
      `SELECT id, source_origin, source_created_at, source_checksum,
              source_counts_json, status, last_attempt_at, last_success_at,
              duration_ms, error_message, operating_mode, cutover_at, cutover_by
       FROM replication_sync_state
       WHERE id = 1`,
    )
    .first<ReplicationSyncState>();
}

export async function isStandbyPrimaryMode() {
  const state = await getReplicationSyncState();
  return state?.operating_mode === "primary";
}

export async function markStandbyPrimaryMode(memberId: number) {
  await getD1()
    .prepare(
      `INSERT INTO replication_sync_state (
         id, operating_mode, status, error_message, cutover_at, cutover_by
       ) VALUES (1, 'primary', 'succeeded', '', CURRENT_TIMESTAMP, ?)
       ON CONFLICT(id) DO UPDATE SET
         operating_mode = 'primary',
         status = 'succeeded',
         error_message = '',
         cutover_at = CURRENT_TIMESTAMP,
         cutover_by = excluded.cutover_by`,
    )
    .bind(memberId)
    .run();
}

export async function markStandbyReplicaMode(memberId: number) {
  await getD1()
    .prepare(
      `INSERT INTO replication_sync_state (
         id, operating_mode, status, error_message, cutover_at, cutover_by
       ) VALUES (1, 'replica', 'succeeded', '', CURRENT_TIMESTAMP, ?)
       ON CONFLICT(id) DO UPDATE SET
         operating_mode = 'replica',
         status = 'succeeded',
         error_message = '',
         cutover_at = CURRENT_TIMESTAMP,
         cutover_by = excluded.cutover_by`,
    )
    .bind(memberId)
    .run();
}

// Compatibility aliases for older deployments and source-sync tests.
export const isVercelPrimaryMode = isStandbyPrimaryMode;
export const markVercelPrimaryMode = markStandbyPrimaryMode;

export async function markReplicationAttempt(sourceOrigin: string) {
  await getD1()
    .prepare(
      `INSERT INTO replication_sync_state (
         id, source_origin, status, last_attempt_at, error_message
       ) VALUES (1, ?, 'syncing', CURRENT_TIMESTAMP, '')
       ON CONFLICT(id) DO UPDATE SET
         source_origin = excluded.source_origin,
         status = 'syncing',
         last_attempt_at = CURRENT_TIMESTAMP,
         error_message = ''`,
    )
    .bind(sourceOrigin)
    .run();
}

export async function markReplicationSuccess(input: {
  sourceOrigin: string;
  sourceCreatedAt: string;
  sourceChecksum: string;
  sourceCountsJson: string;
  durationMs: number;
  keepLocked?: boolean;
}) {
  await getD1()
    .prepare(
      `INSERT INTO replication_sync_state (
         id, source_origin, source_created_at, source_checksum,
         source_counts_json, status, last_attempt_at, last_success_at,
         duration_ms, error_message
       ) VALUES (
         1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ''
       )
       ON CONFLICT(id) DO UPDATE SET
         source_origin = excluded.source_origin,
         source_created_at = excluded.source_created_at,
         source_checksum = excluded.source_checksum,
         source_counts_json = excluded.source_counts_json,
         status = excluded.status,
         last_attempt_at = CURRENT_TIMESTAMP,
         last_success_at = CURRENT_TIMESTAMP,
         duration_ms = excluded.duration_ms,
         error_message = ''`,
    )
    .bind(
      input.sourceOrigin,
      input.sourceCreatedAt,
      input.sourceChecksum,
      input.sourceCountsJson,
      input.keepLocked ? "syncing" : "succeeded",
      input.durationMs,
    )
    .run();
}

export async function markReplicationFailure(input: {
  sourceOrigin: string;
  durationMs: number;
  errorMessage: string;
}) {
  await getD1()
    .prepare(
      `INSERT INTO replication_sync_state (
         id, source_origin, status, last_attempt_at, duration_ms, error_message
       ) VALUES (1, ?, 'failed', CURRENT_TIMESTAMP, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_origin = excluded.source_origin,
         status = 'failed',
         last_attempt_at = CURRENT_TIMESTAMP,
         duration_ms = excluded.duration_ms,
         error_message = excluded.error_message`,
    )
    .bind(
      input.sourceOrigin,
      input.durationMs,
      input.errorMessage.slice(0, 500),
    )
    .run();
}
