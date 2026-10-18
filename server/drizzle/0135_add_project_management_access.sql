CREATE TABLE `sbl_project_management_access_policies` (
  `user_id` varchar(36) NOT NULL,
  `mode` varchar(8) NOT NULL DEFAULT 'custom',
  `read_scope` varchar(8) NOT NULL,
  `edit_scope` varchar(8) NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_project_management_access_policy_user` FOREIGN KEY (`user_id`) REFERENCES `sbl_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_project_management_access_mode` CHECK (`mode` IN ('inherit','custom')),
  CONSTRAINT `chk_project_management_access_read_scope` CHECK (`read_scope` IN ('none','own','all')),
  CONSTRAINT `chk_project_management_access_edit_scope` CHECK (`edit_scope` IN ('none','own','all'))
);
--> statement-breakpoint
CREATE TABLE `sbl_project_management_access_grants` (
  `user_id` varchar(36) NOT NULL,
  `project_id` varchar(36) NOT NULL,
  `can_view` boolean NOT NULL,
  `can_edit` boolean NOT NULL,
  UNIQUE KEY `uq_project_management_access_grant` (`user_id`,`project_id`),
  KEY `idx_project_management_access_project` (`project_id`,`user_id`),
  CONSTRAINT `fk_project_management_access_grant_user` FOREIGN KEY (`user_id`) REFERENCES `sbl_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_management_access_grant_project` FOREIGN KEY (`project_id`) REFERENCES `sbl_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_project_management_access_grant_edit` CHECK (`can_edit` = 0 OR `can_view` = 1)
);
