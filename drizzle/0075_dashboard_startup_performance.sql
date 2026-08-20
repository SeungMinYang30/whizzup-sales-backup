CREATE INDEX IF NOT EXISTS `activities_progress_schedule_idx`
ON `activities` (`organization`, `activity_date`, `id`)
WHERE TRIM(COALESCE(`progress_schedule`, '')) <> '';
--> statement-breakpoint
PRAGMA optimize;
