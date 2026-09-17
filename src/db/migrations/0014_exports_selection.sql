PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`body_id` text,
	`cycle_id` text,
	`activity_ids` text,
	`status` text NOT NULL,
	`progress` text,
	`object_key` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_exports`("id", "body_id", "cycle_id", "activity_ids", "status", "progress", "object_key", "created_at") SELECT "id", "body_id", "cycle_id", NULL, "status", "progress", "object_key", "created_at" FROM `exports`;--> statement-breakpoint
DROP TABLE `exports`;--> statement-breakpoint
ALTER TABLE `__new_exports` RENAME TO `exports`;--> statement-breakpoint
PRAGMA foreign_keys=ON;