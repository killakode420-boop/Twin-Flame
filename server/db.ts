import { and, count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  analyticsSnapshots,
  chatMessages,
  InsertUser,
  knowledgeItems,
  researchMonitors,
  researchRuns,
  researchThreads,
  userIntegrations,
  users,
  workerTasks,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

async function mustDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable. Please try again shortly.");
  return db;
}

export async function listThreads(userId: number) {
  const db = await mustDb();
  return db.select().from(researchThreads).where(eq(researchThreads.userId, userId)).orderBy(desc(researchThreads.updatedAt)).limit(50);
}

export async function createThread(userId: number, title: string) {
  const db = await mustDb();
  const result = await db.insert(researchThreads).values({ userId, title });
  return Number(result[0].insertId);
}

export async function listMessages(userId: number, threadId: number) {
  const db = await mustDb();
  const thread = (await db.select().from(researchThreads).where(and(eq(researchThreads.id, threadId), eq(researchThreads.userId, userId))).limit(1))[0];
  if (!thread) throw new Error("Conversation not found.");
  return db.select().from(chatMessages).where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.userId, userId))).orderBy(chatMessages.createdAt);
}

export async function saveMessage(input: { userId: number; threadId: number; role: "user" | "assistant" | "system"; content: string; researchRunId?: number }) {
  const db = await mustDb();
  await db.insert(chatMessages).values(input);
  await db.update(researchThreads).set({ updatedAt: new Date() }).where(eq(researchThreads.id, input.threadId));
}

export async function createResearchRun(input: { userId: number; threadId?: number; operation: "search" | "scrape" | "map" | "agent" | "browser" | "analytics" | "upload"; query: string; provider: string; status?: "queued" | "running" | "completed" | "failed" | "approval_required" }) {
  const db = await mustDb();
  const result = await db.insert(researchRuns).values({ ...input, status: input.status ?? "running" });
  return Number(result[0].insertId);
}

export async function completeResearchRun(id: number, result: unknown) {
  const db = await mustDb();
  await db.update(researchRuns).set({ status: "completed", result, completedAt: new Date() }).where(eq(researchRuns.id, id));
}

export async function failResearchRun(id: number, errorMessage: string) {
  const db = await mustDb();
  await db.update(researchRuns).set({ status: "failed", errorMessage, completedAt: new Date() }).where(eq(researchRuns.id, id));
}

export async function listResearchRuns(userId: number) {
  const db = await mustDb();
  return db.select().from(researchRuns).where(eq(researchRuns.userId, userId)).orderBy(desc(researchRuns.createdAt)).limit(30);
}

export async function addKnowledgeItem(input: { userId: number; researchRunId?: number; sourceType: "search" | "scrape" | "map" | "agent" | "browser" | "upload" | "note"; title: string; sourceUrl?: string; storageKey?: string; contentHash?: string; excerpt?: string; content?: string; tags?: string[]; provenance?: Record<string, unknown> }) {
  const db = await mustDb();
  const result = await db.insert(knowledgeItems).values(input);
  return Number(result[0].insertId);
}

export async function listKnowledgeItems(userId: number) {
  const db = await mustDb();
  return db.select().from(knowledgeItems).where(eq(knowledgeItems.userId, userId)).orderBy(desc(knowledgeItems.updatedAt)).limit(100);
}

export async function saveAnalyticsSnapshot(userId: number, domain: string, data: unknown) {
  const db = await mustDb();
  await db.insert(analyticsSnapshots).values({ userId, domain, provider: "Similarweb", data });
}

export async function createMonitor(input: { userId: number; label: string; targetUrl: string; cronExpression: string }) {
  const db = await mustDb();
  const result = await db.insert(researchMonitors).values(input);
  return Number(result[0].insertId);
}

export async function listMonitors(userId: number) {
  const db = await mustDb();
  return db.select().from(researchMonitors).where(eq(researchMonitors.userId, userId)).orderBy(desc(researchMonitors.updatedAt));
}

export async function createWorkerTask(input: { userId: number; parentResearchRunId?: number; workerType: "web_research" | "document_analysis" | "domain_analytics" | "change_monitor"; purpose: string; allowedDomains?: string[]; maxSources?: number; maxDurationSeconds?: number }) {
  const db = await mustDb();
  const result = await db.insert(workerTasks).values({ ...input, status: "awaiting_approval" });
  return Number(result[0].insertId);
}

export async function listWorkerTasks(userId: number) {
  const db = await mustDb();
  return db.select().from(workerTasks).where(eq(workerTasks.userId, userId)).orderBy(desc(workerTasks.createdAt)).limit(50);
}

export async function getWorkspaceSummary(userId: number) {
  const db = await mustDb();
  const [threadCount] = await db.select({ value: count() }).from(researchThreads).where(eq(researchThreads.userId, userId));
  const [knowledgeCount] = await db.select({ value: count() }).from(knowledgeItems).where(eq(knowledgeItems.userId, userId));
  const [workerCount] = await db.select({ value: count() }).from(workerTasks).where(and(eq(workerTasks.userId, userId), eq(workerTasks.status, "running")));
  return { threads: threadCount?.value ?? 0, knowledge: knowledgeCount?.value ?? 0, activeWorkers: workerCount?.value ?? 0 };
}

export async function getIntegration(userId: number, provider: string) {
  const db = await mustDb();
  return (await db.select().from(userIntegrations).where(and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, provider))).limit(1))[0];
}

export async function upsertIntegration(input: { userId: number; provider: string; apiKeyCiphertext: string; identityTokenCiphertext?: string; providerProjectId?: string }) {
  const db = await mustDb();
  await db.insert(userIntegrations).values(input).onDuplicateKeyUpdate({
    set: {
      apiKeyCiphertext: input.apiKeyCiphertext,
      identityTokenCiphertext: input.identityTokenCiphertext ?? null,
      providerProjectId: input.providerProjectId ?? null,
      updatedAt: new Date(),
    },
  });
}
