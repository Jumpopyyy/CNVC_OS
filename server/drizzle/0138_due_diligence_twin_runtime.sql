ALTER TABLE `sbl_digital_twin_publications` ADD COLUMN public_boundaries text NULL, ADD COLUMN public_content_confirmed_at datetime(3) NULL;
--> statement-breakpoint
ALTER TABLE `sbl_digital_twin_learning_candidates` ADD COLUMN source_refs json NULL, ADD COLUMN conflict_note text NULL;
--> statement-breakpoint
ALTER TABLE `sbl_digital_twin_skill_versions` ADD COLUMN source_refs json NULL, ADD COLUMN task_scopes json NULL;
--> statement-breakpoint
ALTER TABLE `sbl_digital_twin_versions` ADD COLUMN skill_snapshot json NULL;
--> statement-breakpoint
CREATE TABLE `sbl_digital_twin_dialogue_sessions` (
 id char(36) NOT NULL PRIMARY KEY, twin_id char(36) NOT NULL, caller_user_id char(36) NOT NULL, publication_id char(36) NULL,
 scope_key varchar(128) NOT NULL, conversation_id char(36) NOT NULL, created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_twin_dialogue_scope(caller_user_id,twin_id,scope_key),
 CONSTRAINT fk_twin_dialogue_twin FOREIGN KEY (twin_id) REFERENCES `sbl_digital_twins`(id) ON DELETE CASCADE,
 CONSTRAINT fk_twin_dialogue_caller FOREIGN KEY (caller_user_id) REFERENCES `sbl_users`(id) ON DELETE CASCADE,
 CONSTRAINT fk_twin_dialogue_publication FOREIGN KEY (publication_id) REFERENCES `sbl_digital_twin_publications`(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `sbl_digital_twin_runtime_calls` (
 id char(36) NOT NULL PRIMARY KEY, twin_id char(36) NOT NULL, caller_user_id char(36) NOT NULL, project_id char(36) NULL, conversation_id char(36) NULL,
 task varchar(32) NOT NULL, snapshot json NOT NULL, model_name varchar(255) NULL, status varchar(24) NOT NULL, created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_twin_runtime_caller(caller_user_id,created_at),
 CONSTRAINT fk_twin_runtime_twin FOREIGN KEY (twin_id) REFERENCES `sbl_digital_twins`(id) ON DELETE RESTRICT,
 CONSTRAINT fk_twin_runtime_caller FOREIGN KEY (caller_user_id) REFERENCES `sbl_users`(id) ON DELETE RESTRICT,
 CONSTRAINT fk_twin_runtime_project FOREIGN KEY (project_id) REFERENCES `sbl_projects`(id) ON DELETE SET NULL
);
