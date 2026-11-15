CREATE TABLE `connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`updated_at` integer NOT NULL
);
