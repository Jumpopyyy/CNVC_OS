ALTER TABLE `sbl_digital_twins` ADD COLUMN `library_bindings` json NOT NULL DEFAULT (JSON_ARRAY());
--> statement-breakpoint
ALTER TABLE `sbl_digital_twin_versions` ADD COLUMN `library_bindings` json NOT NULL DEFAULT (JSON_ARRAY());
