CREATE TABLE IF NOT EXISTS `replication_sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`source_origin` text NOT NULL DEFAULT '',
	`source_created_at` text,
	`source_checksum` text NOT NULL DEFAULT '',
	`source_counts_json` text NOT NULL DEFAULT '{}',
	`status` text NOT NULL DEFAULT 'idle',
	`last_attempt_at` text,
	`last_success_at` text,
	`duration_ms` integer,
	`error_message` text NOT NULL DEFAULT '',
	`operating_mode` text NOT NULL DEFAULT 'replica',
	`cutover_at` text,
	`cutover_by` integer,
	CONSTRAINT `replication_sync_state_singleton` CHECK (`id` = 1),
	CONSTRAINT `replication_sync_state_status` CHECK (`status` IN ('idle', 'syncing', 'succeeded', 'failed')),
	CONSTRAINT `replication_sync_state_mode` CHECK (`operating_mode` IN ('replica', 'primary'))
);
