CREATE INDEX IF NOT EXISTS `members_status_idx`
ON `members` (`status`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauth_codes_expiry_idx`
ON `oauth_codes` (`expires_at`, `used_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauth_tokens_member_idx`
ON `oauth_tokens` (`member_id`, `revoked_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activities_follow_up_idx`
ON `activities` (`follow_up_required`, `follow_up_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activities_award_idx`
ON `activities` (`award_status`, `organization`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activities_organization_date_idx`
ON `activities` (`organization`, `activity_date` DESC, `id` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activities_date_idx`
ON `activities` (`activity_date` DESC, `id` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activities_manager_created_idx`
ON `activities` (`progress_manager`, `created_at` DESC, `id` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activity_authors_member_idx`
ON `activity_authors` (`member_id`, `activity_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organization_locations_region_idx`
ON `organization_locations` (`region`, `organization`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sales_campaign_targets_assignee_idx`
ON `sales_campaign_targets` (`assigned_member_id`, `campaign_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `equipment_projects_org_idx`
ON `equipment_projects` (`organization`, `updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `equipment_items_project_idx`
ON `equipment_items` (`project_id`, `sort_order`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_recommendations_org_idx`
ON `ai_recommendations` (`organization`, `updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `manager_alert_ack_snoozed_idx`
ON `manager_alert_acknowledgements` (`member_id`, `snoozed_until`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activity_review_ack_snoozed_idx`
ON `activity_review_acknowledgements` (`member_id`, `snoozed_until`);
--> statement-breakpoint
UPDATE `activities`
SET `execution_type` = '직영', `consortium_company` = ''
WHERE `execution_type` IS NULL
   OR `execution_type` = ''
   OR `execution_type` = '미정';
