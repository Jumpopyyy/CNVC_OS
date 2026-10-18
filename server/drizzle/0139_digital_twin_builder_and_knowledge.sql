ALTER TABLE `sbl_digital_twins` ADD COLUMN description varchar(1000) NOT NULL DEFAULT '', ADD COLUMN description_mode varchar(16) NOT NULL DEFAULT 'auto';
--> statement-breakpoint
CREATE TABLE `sbl_digital_twin_build_sessions` (
 id char(36) NOT NULL PRIMARY KEY, owner_user_id char(36) NOT NULL, scope_key varchar(64) NOT NULL, conversation_id char(36) NOT NULL,
 created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_twin_build_scope(owner_user_id,scope_key),
 CONSTRAINT fk_twin_build_owner FOREIGN KEY (owner_user_id) REFERENCES `sbl_users`(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sbl_digital_twin_inquiries` (
 id char(36) NOT NULL PRIMARY KEY, twin_id char(36) NOT NULL, owner_user_id char(36) NOT NULL, caller_user_id char(36) NOT NULL, project_id char(36) NOT NULL,
 question text NOT NULL, fingerprint varchar(64) NOT NULL, status varchar(24) NOT NULL DEFAULT '待补充', reply longtext NULL,
 created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), answered_at datetime(3) NULL,
 UNIQUE KEY uq_twin_inquiry_fingerprint(twin_id,caller_user_id,fingerprint), KEY idx_twin_inquiry_owner(owner_user_id,status,created_at),
 CONSTRAINT fk_twin_inquiry_twin FOREIGN KEY (twin_id) REFERENCES `sbl_digital_twins`(id) ON DELETE CASCADE,
 CONSTRAINT fk_twin_inquiry_owner FOREIGN KEY (owner_user_id) REFERENCES `sbl_users`(id) ON DELETE CASCADE,
 CONSTRAINT fk_twin_inquiry_caller FOREIGN KEY (caller_user_id) REFERENCES `sbl_users`(id) ON DELETE CASCADE,
 CONSTRAINT fk_twin_inquiry_project FOREIGN KEY (project_id) REFERENCES `sbl_projects`(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sbl_digital_twin_project_knowledge` (
 id char(36) NOT NULL PRIMARY KEY, twin_id char(36) NOT NULL, owner_user_id char(36) NOT NULL, project_id char(36) NOT NULL, inquiry_id char(36) NULL,
 title varchar(255) NOT NULL, content longtext NOT NULL, version int NOT NULL DEFAULT 1, created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_twin_knowledge_project(twin_id,project_id),
 CONSTRAINT fk_twin_knowledge_twin FOREIGN KEY (twin_id) REFERENCES `sbl_digital_twins`(id) ON DELETE CASCADE,
 CONSTRAINT fk_twin_knowledge_owner FOREIGN KEY (owner_user_id) REFERENCES `sbl_users`(id) ON DELETE CASCADE,
 CONSTRAINT fk_twin_knowledge_project FOREIGN KEY (project_id) REFERENCES `sbl_projects`(id) ON DELETE CASCADE,
 CONSTRAINT fk_twin_knowledge_inquiry FOREIGN KEY (inquiry_id) REFERENCES `sbl_digital_twin_inquiries`(id) ON DELETE SET NULL
);
