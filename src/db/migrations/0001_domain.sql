CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`occurred_on` text NOT NULL,
	`provider` text,
	`duration_minutes` integer,
	`item_count` integer DEFAULT 1,
	`activity_type` text NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_evidence` (
	`activity_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ae_pk` ON `activity_evidence` (`activity_id`,`evidence_id`);--> statement-breakpoint
CREATE TABLE `bodies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`fee_scope` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cert_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_version_id` text NOT NULL,
	`from_cert_id` text NOT NULL,
	`to_cert_id` text NOT NULL,
	`relation` text NOT NULL,
	`credits_x100` integer,
	FOREIGN KEY (`rule_version_id`) REFERENCES `rule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cert_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_version_id` text NOT NULL,
	`certification_id` text NOT NULL,
	`cycle_months` integer NOT NULL,
	`total_credits_x100` integer NOT NULL,
	`annual_min_x100` integer,
	`annual_min_severity` text,
	`fee_amount_cents` integer,
	`fee_currency` text,
	`fee_period_months` integer,
	`fee_params` text,
	FOREIGN KEY (`rule_version_id`) REFERENCES `rule_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`certification_id`) REFERENCES `certifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cr_rv_cert` ON `cert_requirements` (`rule_version_id`,`certification_id`);--> statement-breakpoint
CREATE TABLE `certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`body_id` text NOT NULL,
	`name` text NOT NULL,
	`abbreviation` text NOT NULL,
	`credit_unit_label` text NOT NULL,
	`expires` integer NOT NULL,
	`retired_on` text,
	FOREIGN KEY (`body_id`) REFERENCES `bodies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_version_id` text NOT NULL,
	`certification_id` text,
	`type` text NOT NULL,
	`params` text NOT NULL,
	`severity` text DEFAULT 'hard' NOT NULL,
	FOREIGN KEY (`rule_version_id`) REFERENCES `rule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `credit_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`held_cert_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`credits_x100` integer NOT NULL,
	`category_key` text,
	`status` text NOT NULL,
	`submitted_at` text,
	`resolved_at` text,
	`issuer_reference` text,
	`rule_version_id` text NOT NULL,
	`crediting_rule_id` text,
	`suggested_credits_x100` integer,
	`override_reason` text,
	`explanation` text,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`held_cert_id`) REFERENCES `held_certifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ca_activity_cert` ON `credit_applications` (`activity_id`,`held_cert_id`);--> statement-breakpoint
CREATE INDEX `ca_cycle` ON `credit_applications` (`cycle_id`);--> statement-breakpoint
CREATE TABLE `credit_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_version_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`parent_key` text,
	FOREIGN KEY (`rule_version_id`) REFERENCES `rule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `crediting_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_version_id` text NOT NULL,
	`activity_type` text NOT NULL,
	`body_label` text NOT NULL,
	`basis` text NOT NULL,
	`minutes_per_credit` integer,
	`credits_per_item_x100` integer,
	`rounding` text NOT NULL,
	`category_key` text,
	`cap_per_cycle_x100` integer,
	`cap_per_year_x100` integer,
	`cap_per_item_x100` integer,
	`evidence_required` integer DEFAULT true NOT NULL,
	`applies_to_cert_id` text,
	FOREIGN KEY (`rule_version_id`) REFERENCES `rule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cr_rv_type` ON `crediting_rules` (`rule_version_id`,`activity_type`);--> statement-breakpoint
CREATE TABLE `cycle_rule_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`from_rule_version_id` text NOT NULL,
	`to_rule_version_id` text NOT NULL,
	`diff` text NOT NULL,
	`changed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`held_cert_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`rule_version_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`held_cert_id`) REFERENCES `held_certifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_version_id`) REFERENCES `rule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cy_held_seq` ON `cycles` (`held_cert_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`extracted_text` text,
	`extraction_status` text NOT NULL,
	`extraction_method` text,
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_sha256_unique` ON `evidence` (`sha256`);--> statement-breakpoint
CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`body_id` text NOT NULL,
	`cycle_id` text NOT NULL,
	`status` text NOT NULL,
	`progress` text,
	`object_key` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `held_certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`certification_id` text NOT NULL,
	`cert_number` text,
	`earned_on` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	FOREIGN KEY (`certification_id`) REFERENCES `certifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`row_count` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`body_id` text NOT NULL,
	`member_number` text,
	`since` text,
	FOREIGN KEY (`body_id`) REFERENCES `bodies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_key_unique` ON `notifications` (`key`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`due_on` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`paid_on` text,
	`confirmation_ref` text,
	`status` text DEFAULT 'due' NOT NULL,
	`waive_reason` text
);
--> statement-breakpoint
CREATE TABLE `renewals` (
	`id` text PRIMARY KEY NOT NULL,
	`closed_cycle_id` text NOT NULL,
	`opened_cycle_id` text,
	`renewed_on` text NOT NULL,
	`issuer_confirmation` text,
	`notes` text,
	FOREIGN KEY (`closed_cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rule_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`body_id` text NOT NULL,
	`version` integer NOT NULL,
	`effective_from` text NOT NULL,
	`source_url` text NOT NULL,
	`source_title` text NOT NULL,
	`verified_on` text NOT NULL,
	`catalog_commit` text,
	`notes` text,
	FOREIGN KEY (`body_id`) REFERENCES `bodies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rv_body_version` ON `rule_versions` (`body_id`,`version`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
