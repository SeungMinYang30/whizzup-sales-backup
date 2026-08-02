CREATE TABLE `ai_recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`activity_id` integer NOT NULL,
	`organization` text NOT NULL,
	`meeting_summary` text DEFAULT '' NOT NULL,
	`interests_json` text DEFAULT '[]' NOT NULL,
	`recommended_products_json` text DEFAULT '[]' NOT NULL,
	`follow_up_questions_json` text DEFAULT '[]' NOT NULL,
	`recommended_actions_json` text DEFAULT '[]' NOT NULL,
	`applied_products_json` text DEFAULT '[]' NOT NULL,
	`applied_questions_json` text DEFAULT '[]' NOT NULL,
	`applied_actions_json` text DEFAULT '[]' NOT NULL,
	`follow_up_date` text,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_recommendations_activity_idx` ON `ai_recommendations` (`activity_id`);
