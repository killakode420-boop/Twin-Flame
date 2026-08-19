CREATE TABLE `analytics_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`domain` varchar(255) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`data` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analytics_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`thread_id` int NOT NULL,
	`user_id` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` longtext NOT NULL,
	`research_run_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`research_run_id` int,
	`source_type` enum('search','scrape','map','agent','browser','upload','note') NOT NULL,
	`title` varchar(512) NOT NULL,
	`source_url` varchar(2048),
	`storage_key` varchar(1024),
	`content_hash` varchar(128),
	`excerpt` text,
	`content` longtext,
	`tags` json,
	`provenance` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_monitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`label` varchar(255) NOT NULL,
	`target_url` varchar(2048) NOT NULL,
	`cron_expression` varchar(64) NOT NULL,
	`schedule_cron_task_uid` varchar(65),
	`last_content_hash` varchar(128),
	`is_enabled` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_monitors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`thread_id` int,
	`operation` enum('search','scrape','map','agent','browser','analytics','upload') NOT NULL,
	`query` text NOT NULL,
	`status` enum('queued','running','completed','failed','approval_required') NOT NULL DEFAULT 'queued',
	`provider` varchar(64) NOT NULL,
	`result` json,
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `research_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_threads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `worker_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`parent_research_run_id` int,
	`worker_type` enum('web_research','document_analysis','domain_analytics','change_monitor') NOT NULL,
	`purpose` text NOT NULL,
	`allowed_domains` json,
	`max_sources` int NOT NULL DEFAULT 10,
	`max_duration_seconds` int NOT NULL DEFAULT 120,
	`status` enum('draft','awaiting_approval','queued','running','completed','cancelled','failed') NOT NULL DEFAULT 'draft',
	`result_summary` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `worker_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `analytics_snapshots_user_domain_idx` ON `analytics_snapshots` (`user_id`,`domain`);--> statement-breakpoint
CREATE INDEX `chat_messages_thread_created_idx` ON `chat_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_items_user_created_idx` ON `knowledge_items` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `research_monitors_schedule_task_idx` ON `research_monitors` (`schedule_cron_task_uid`);--> statement-breakpoint
CREATE INDEX `research_runs_user_created_idx` ON `research_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `research_threads_user_updated_idx` ON `research_threads` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `worker_tasks_user_created_idx` ON `worker_tasks` (`user_id`,`created_at`);