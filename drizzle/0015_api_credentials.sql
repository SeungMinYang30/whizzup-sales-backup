CREATE TABLE IF NOT EXISTS `api_credentials` (
  `id` integer PRIMARY KEY CHECK (`id` = 1),
  `encrypted_key` text NOT NULL,
  `iv` text NOT NULL,
  `key_last4` text NOT NULL,
  `model` text NOT NULL,
  `updated_by` integer,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
