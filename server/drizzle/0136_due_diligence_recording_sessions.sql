CREATE TABLE `sbl_due_diligence_recording_sessions` (
  id varchar(36) NOT NULL, project_id varchar(36) NOT NULL, interview_id varchar(36) NOT NULL,
  owner_user_id varchar(36) NOT NULL, client_request_id varchar(36) NOT NULL, active_key varchar(36) NULL,
  source varchar(16) NOT NULL DEFAULT 'browser', file_name varchar(255) NOT NULL, mime_type varchar(128) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'recording', current_epoch int NOT NULL DEFAULT 0,
  epochs json NOT NULL DEFAULT (JSON_ARRAY()), duration_seconds int NOT NULL DEFAULT 0,
  byte_size bigint NOT NULL DEFAULT 0, lease_expires_at datetime(3) NULL, last_checkpoint_at datetime(3) NULL,
  archive_run_token varchar(36) NULL, archive_lease_expires_at datetime(3) NULL,
  file_ids json NOT NULL DEFAULT (JSON_ARRAY()), error_message text NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_dd_recording_request (owner_user_id,client_request_id),
  UNIQUE KEY uq_dd_recording_active (active_key), KEY idx_dd_recording_interview (interview_id,created_at),
  KEY idx_dd_recording_pending (status,updated_at),
  CONSTRAINT fk_dd_recording_project FOREIGN KEY (project_id) REFERENCES `sbl_projects`(id) ON DELETE CASCADE,
  CONSTRAINT fk_dd_recording_interview FOREIGN KEY (interview_id) REFERENCES `sbl_due_diligence_interviews`(id) ON DELETE CASCADE,
  CONSTRAINT fk_dd_recording_owner FOREIGN KEY (owner_user_id) REFERENCES `sbl_users`(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `sbl_due_diligence_recording_chunks` (
  id varchar(36) NOT NULL, session_id varchar(36) NOT NULL, epoch int NOT NULL, sequence int NOT NULL,
  byte_size int NOT NULL, sha256 varchar(64) NOT NULL, created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_dd_recording_chunk (session_id,epoch,sequence),
  CONSTRAINT fk_dd_recording_chunk_session FOREIGN KEY (session_id) REFERENCES `sbl_due_diligence_recording_sessions`(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sbl_due_diligence_artifact_tasks` (
  id varchar(36) NOT NULL, project_id varchar(36) NOT NULL, interview_id varchar(36) NOT NULL,
  created_by varchar(36) NOT NULL, actor_role varchar(64) NOT NULL, kind varchar(32) NOT NULL DEFAULT 'summary',
  status varchar(24) NOT NULL DEFAULT 'queued', transcript_version int NULL, source_hash varchar(64) NOT NULL,
  source_text longtext NOT NULL, total_chunks int NOT NULL DEFAULT 0, completed_chunks int NOT NULL DEFAULT 0,
  chunk_results json NOT NULL DEFAULT (JSON_ARRAY()), merge_state json NULL, summary longtext NULL,
  question_suggestions json NOT NULL DEFAULT (JSON_ARRAY()), archive_file_id varchar(36) NULL,
  run_token varchar(36) NULL, lease_expires_at datetime(3) NULL, attempts int NOT NULL DEFAULT 0, error_message text NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id), UNIQUE KEY uq_dd_artifact_source (interview_id,kind,source_hash),
  KEY idx_dd_artifact_pending (kind,status,updated_at),
  CONSTRAINT fk_dd_artifact_project FOREIGN KEY (project_id) REFERENCES `sbl_projects`(id) ON DELETE CASCADE,
  CONSTRAINT fk_dd_artifact_interview FOREIGN KEY (interview_id) REFERENCES `sbl_due_diligence_interviews`(id) ON DELETE CASCADE,
  CONSTRAINT fk_dd_artifact_actor FOREIGN KEY (created_by) REFERENCES `sbl_users`(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dd_artifact_file FOREIGN KEY (archive_file_id) REFERENCES `sbl_project_files`(id) ON DELETE RESTRICT
);
