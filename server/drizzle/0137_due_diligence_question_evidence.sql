ALTER TABLE `sbl_due_diligence_questions`
  ADD COLUMN rationale text NULL,
  ADD COLUMN generation_key varchar(96) NULL,
  ADD COLUMN generation_keys json NULL,
  ADD COLUMN template_item_id varchar(64) NULL,
  ADD COLUMN deleted_at datetime(3) NULL,
  ADD UNIQUE KEY uq_dd_question_generation (project_id, generation_key);
--> statement-breakpoint
UPDATE `sbl_due_diligence_questions` SET generation_keys = JSON_ARRAY() WHERE generation_keys IS NULL;
--> statement-breakpoint
ALTER TABLE `sbl_due_diligence_questions` MODIFY COLUMN generation_keys json NOT NULL DEFAULT (JSON_ARRAY());
--> statement-breakpoint
ALTER TABLE `sbl_due_diligence_question_evidence`
  ADD COLUMN file_version int NULL,
  ADD COLUMN excerpt text NULL,
  ADD COLUMN locator varchar(255) NULL,
  ADD COLUMN content_hash varchar(64) NULL,
  ADD COLUMN source_kind varchar(16) NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE `sbl_due_diligence_question_packs` ADD COLUMN skill_snapshot json NULL;
