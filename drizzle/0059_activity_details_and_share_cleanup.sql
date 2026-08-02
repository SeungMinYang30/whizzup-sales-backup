ALTER TABLE `activities` ADD COLUMN `detail_level` text DEFAULT 'compact' NOT NULL;
ALTER TABLE `activities` ADD COLUMN `detail_summary` text DEFAULT '' NOT NULL;
ALTER TABLE `activities` ADD COLUMN `detail_key_facts_json` text DEFAULT '[]' NOT NULL;
ALTER TABLE `activities` ADD COLUMN `detail_sections_json` text DEFAULT '[]' NOT NULL;
ALTER TABLE `activities` ADD COLUMN `raw_input` text DEFAULT '' NOT NULL;

DELETE FROM `ai_recommendations`;
