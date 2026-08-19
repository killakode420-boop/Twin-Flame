CREATE TABLE `user_integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`provider` varchar(64) NOT NULL,
	`api_key_ciphertext` text NOT NULL,
	`identity_token_ciphertext` text,
	`provider_project_id` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_integrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_integrations_user_provider_idx` UNIQUE(`user_id`,`provider`)
);
