import {
  boolean,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const researchThreads = mysqlTable(
  "research_threads",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("research_threads_user_updated_idx").on(table.userId, table.updatedAt)]
);

export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    threadId: int("thread_id").notNull(),
    userId: int("user_id").notNull(),
    role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
    content: longtext("content").notNull(),
    researchRunId: int("research_run_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => [index("chat_messages_thread_created_idx").on(table.threadId, table.createdAt)]
);

export const researchRuns = mysqlTable(
  "research_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    threadId: int("thread_id"),
    operation: mysqlEnum("operation", ["search", "scrape", "map", "agent", "browser", "analytics", "upload"]).notNull(),
    query: text("query").notNull(),
    status: mysqlEnum("status", ["queued", "running", "completed", "failed", "approval_required"]).default("queued").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    result: json("result"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  table => [index("research_runs_user_created_idx").on(table.userId, table.createdAt)]
);

export const knowledgeItems = mysqlTable(
  "knowledge_items",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    researchRunId: int("research_run_id"),
    sourceType: mysqlEnum("source_type", ["search", "scrape", "map", "agent", "browser", "upload", "note"]).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    sourceUrl: varchar("source_url", { length: 2048 }),
    storageKey: varchar("storage_key", { length: 1024 }),
    contentHash: varchar("content_hash", { length: 128 }),
    excerpt: text("excerpt"),
    content: longtext("content"),
    tags: json("tags"),
    provenance: json("provenance"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("knowledge_items_user_created_idx").on(table.userId, table.createdAt)]
);

export const analyticsSnapshots = mysqlTable(
  "analytics_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    data: json("data").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => [index("analytics_snapshots_user_domain_idx").on(table.userId, table.domain)]
);

export const researchMonitors = mysqlTable(
  "research_monitors",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    targetUrl: varchar("target_url", { length: 2048 }).notNull(),
    cronExpression: varchar("cron_expression", { length: 64 }).notNull(),
    scheduleCronTaskUid: varchar("schedule_cron_task_uid", { length: 65 }),
    lastContentHash: varchar("last_content_hash", { length: 128 }),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("research_monitors_schedule_task_idx").on(table.scheduleCronTaskUid)]
);

export const workerTasks = mysqlTable(
  "worker_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    parentResearchRunId: int("parent_research_run_id"),
    workerType: mysqlEnum("worker_type", ["web_research", "document_analysis", "domain_analytics", "change_monitor"]).notNull(),
    purpose: text("purpose").notNull(),
    allowedDomains: json("allowed_domains"),
    maxSources: int("max_sources").default(10).notNull(),
    maxDurationSeconds: int("max_duration_seconds").default(120).notNull(),
    status: mysqlEnum("status", ["draft", "awaiting_approval", "queued", "running", "completed", "cancelled", "failed"]).default("draft").notNull(),
    resultSummary: text("result_summary"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  table => [index("worker_tasks_user_created_idx").on(table.userId, table.createdAt)]
);

export const userIntegrations = mysqlTable(
  "user_integrations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    identityTokenCiphertext: text("identity_token_ciphertext"),
    providerProjectId: varchar("provider_project_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("user_integrations_user_provider_idx").on(table.userId, table.provider)]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
