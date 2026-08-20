CREATE TABLE IF NOT EXISTS `member_identity_migrations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_member_id` integer,
  `source_email` text NOT NULL,
  `target_member_id` integer,
  `target_email` text NOT NULL,
  `migrated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `member_identity_migrations` (`source_member_id`, `source_email`, `target_member_id`, `target_email`)
SELECT old_member.id, old_member.email, new_member.id, new_member.email
FROM members old_member, members new_member
WHERE lower(old_member.email) = 'freeyang3@nate.com'
  AND lower(new_member.email) = 'freeyang30@gmail.com'
  AND old_member.id <> new_member.id
  AND NOT EXISTS (
    SELECT 1 FROM `member_identity_migrations`
    WHERE source_member_id = old_member.id AND target_member_id = new_member.id
  );
--> statement-breakpoint
INSERT INTO `members` (`email`, `display_name`, `role`, `permissions`, `status`, `is_sales`, `created_at`, `approved_at`, `last_seen_at`)
SELECT 'freeyang3@nate.com', display_name, 'admin', permissions, 'approved', is_sales, created_at, COALESCE(approved_at, CURRENT_TIMESTAMP), last_seen_at
FROM members
WHERE lower(email) = 'freeyang30@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM members WHERE lower(email) = 'freeyang3@nate.com');
--> statement-breakpoint
INSERT INTO `member_identity_migrations` (`source_member_id`, `source_email`, `target_member_id`, `target_email`)
SELECT old_member.id, old_member.email, new_member.id, new_member.email
FROM members old_member, members new_member
WHERE lower(old_member.email) = 'freeyang3@nate.com'
  AND lower(new_member.email) = 'freeyang30@gmail.com'
  AND old_member.id <> new_member.id
  AND NOT EXISTS (
    SELECT 1 FROM `member_identity_migrations`
    WHERE source_member_id = old_member.id AND target_member_id = new_member.id
  );
--> statement-breakpoint
DELETE FROM `manager_alert_acknowledgements`
WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com')
  AND EXISTS (
    SELECT 1 FROM `manager_alert_acknowledgements` existing
    WHERE existing.member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com')
      AND existing.organization = `manager_alert_acknowledgements`.organization
  );
--> statement-breakpoint
DELETE FROM `activity_review_acknowledgements`
WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com')
  AND EXISTS (
    SELECT 1 FROM `activity_review_acknowledgements` existing
    WHERE existing.member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com')
      AND existing.activity_id = `activity_review_acknowledgements`.activity_id
  );
--> statement-breakpoint
UPDATE `holdem_weekly_scores`
SET best_chips = MAX(best_chips, COALESCE((
      SELECT incoming.best_chips FROM `holdem_weekly_scores` incoming
      WHERE incoming.member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com')
        AND incoming.week_start = `holdem_weekly_scores`.week_start
    ), best_chips)),
    games_played = games_played + COALESCE((
      SELECT incoming.games_played FROM `holdem_weekly_scores` incoming
      WHERE incoming.member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com')
        AND incoming.week_start = `holdem_weekly_scores`.week_start
    ), 0),
    wins = wins + COALESCE((
      SELECT incoming.wins FROM `holdem_weekly_scores` incoming
      WHERE incoming.member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com')
        AND incoming.week_start = `holdem_weekly_scores`.week_start
    ), 0),
    updated_at = CURRENT_TIMESTAMP
WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com')
  AND EXISTS (
    SELECT 1 FROM `holdem_weekly_scores` incoming
    WHERE incoming.member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com')
      AND incoming.week_start = `holdem_weekly_scores`.week_start
  );
--> statement-breakpoint
DELETE FROM `holdem_weekly_scores`
WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com')
  AND EXISTS (
    SELECT 1 FROM `holdem_weekly_scores` existing
    WHERE existing.member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com')
      AND existing.week_start = `holdem_weekly_scores`.week_start
  );
--> statement-breakpoint
UPDATE `activity_authors` SET member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `manager_alert_acknowledgements` SET member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `activity_review_acknowledgements` SET member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `holdem_weekly_scores` SET member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `oauth_codes` SET member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `oauth_tokens` SET member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `sales_campaign_targets` SET assigned_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE assigned_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `activity_assignment_history` SET to_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE to_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `activity_assignment_history` SET changed_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE changed_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `deletion_batches` SET deleted_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE deleted_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `deletion_batches` SET restored_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE restored_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `activity_change_batches` SET actor_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE actor_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `activity_change_batches` SET undone_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE undone_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `activity_change_items` SET undone_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE undone_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `data_control_events` SET actor_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE actor_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `budget_name_requests` SET requester_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE requester_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `organization_schedules` SET assignee_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE assignee_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `complex_projects` SET manager_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE manager_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `activities` SET updated_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by_member_id = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `app_settings` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `api_credentials` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `school_directory_credentials` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `organization_locations` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `sales_campaigns` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `equipment_projects` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `equipment_items` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `equipment_items` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `ai_recommendations` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `quotation_documents` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `award_vendors` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `award_vendors` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `award_vendor_documents` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `accounting_settlements` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `accounting_commission_entries` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `accounting_collection_receipts` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `product_vendor_links` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `product_supply_settings` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `budget_name_groups` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `budget_name_groups` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `budget_name_aliases` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `joint_projects` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `inventory_products` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `inventory_products` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `inventory_transactions` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `organization_schedules` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `organization_schedules` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `construction_schedule_projects` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `construction_schedule_projects` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `complex_projects` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `complex_projects` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `complex_project_item_details` SET updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE updated_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `resource_posts` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `resource_posts` SET archived_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE archived_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `resource_attachments` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `oauth_clients` SET created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE created_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `members` SET approved_by = (SELECT id FROM members WHERE lower(email) = 'freeyang3@nate.com') WHERE approved_by = (SELECT id FROM members WHERE lower(email) = 'freeyang30@gmail.com');
--> statement-breakpoint
UPDATE `members`
SET display_name = COALESCE(NULLIF((SELECT display_name FROM members WHERE lower(email) = 'freeyang30@gmail.com'), ''), display_name),
    role = 'admin',
    status = 'approved',
    is_sales = MAX(is_sales, COALESCE((SELECT is_sales FROM members WHERE lower(email) = 'freeyang30@gmail.com'), 0)),
    approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP)
WHERE lower(email) = 'freeyang3@nate.com';
--> statement-breakpoint
DELETE FROM `members`
WHERE lower(email) = 'freeyang30@gmail.com'
  AND EXISTS (SELECT 1 FROM members WHERE lower(email) = 'freeyang3@nate.com');
--> statement-breakpoint
UPDATE `members`
SET email = 'freeyang30@gmail.com', role = 'admin', status = 'approved', approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP)
WHERE lower(email) IN ('freeyang3@nate.com', 'freeyang30@gmail.com');
