ALTER TABLE `activities` ADD COLUMN `sync_id` text;
ALTER TABLE `organization_locations` ADD COLUMN `sync_id` text;
ALTER TABLE `sales_campaigns` ADD COLUMN `sync_id` text;
ALTER TABLE `sales_campaign_targets` ADD COLUMN `sync_id` text;
ALTER TABLE `equipment_projects` ADD COLUMN `sync_id` text;
ALTER TABLE `equipment_items` ADD COLUMN `sync_id` text;

CREATE UNIQUE INDEX IF NOT EXISTS `activities_sync_id_unique`
	ON `activities` (`sync_id`) WHERE `sync_id` IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS `organization_locations_sync_id_unique`
	ON `organization_locations` (`sync_id`) WHERE `sync_id` IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS `sales_campaigns_sync_id_unique`
	ON `sales_campaigns` (`sync_id`) WHERE `sync_id` IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS `sales_campaign_targets_sync_id_unique`
	ON `sales_campaign_targets` (`sync_id`) WHERE `sync_id` IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS `equipment_projects_sync_id_unique`
	ON `equipment_projects` (`sync_id`) WHERE `sync_id` IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS `equipment_items_sync_id_unique`
	ON `equipment_items` (`sync_id`) WHERE `sync_id` IS NOT NULL;
