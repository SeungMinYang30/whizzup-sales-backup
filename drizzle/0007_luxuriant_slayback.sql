CREATE TABLE `organization_locations` (
	`organization` text PRIMARY KEY NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`road_address` text DEFAULT '' NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`place_name` text DEFAULT '' NOT NULL,
	`place_id` text DEFAULT '' NOT NULL,
	`updated_by` integer,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
