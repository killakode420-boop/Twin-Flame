import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { callDataApi } from "./_core/dataApi";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { connectAnchorAgent, getAnchorStatus, startAnchorSession } from "./anchor";
import { mapSite, runResearchAgent, scrapeUrl, searchWeb } from "./firecrawl";
import { integrationsRouter } from "./integrationsRouter";
import { storagePut } from "./storage";

const researchSystemPrompt = `You are VV, a precise, privacy-aware personal research assistant. Give concise, source-conscious answers. Clearly separate confirmed evidence from inferences, and never claim to have browsed a source that was not provided in the conversation.`;

function asText(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function persistResearch(input: { userId: number; threadId?: number; operation: "search" | "scrape" | "map" | "agent"; query: string; result: unknown }) {
  const runId = await db.createResearchRun({ userId: input.userId, threadId: input.threadId, operation: input.operation, query: input.query, provider: "Firecrawl" });
  try {
    await db.completeResearchRun(runId, input.result);
    await db.addKnowledgeItem({
      userId: input.userId,
      researchRunId: runId,
      sourceType: input.operation,
      title: `${input.operation[0].toUpperCase()}${input.operation.slice(1)}: ${input.query.slice(0, 180)}`,
      excerpt: asText(input.result).slice(0, 2_000),
      content: asText(input.result),
      provenance: { provider: "Firecrawl", operation: input.operation, collectedAt: new Date().toISOString() },
    });
    return runId;
  } catch (error) {
    await db.failResearchRun(runId, error instanceof Error ? error.message : "Research persistence failed.");
    throw error;
  }
}

export const appRouter = router({
  system: systemRouter,
  integrations: integrationsRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  workspace: router({
    summary: protectedProcedure.query(({ ctx }) => db.getWorkspaceSummary(ctx.user.id)),
    threads: protectedProcedure.query(({ ctx }) => db.listThreads(ctx.user.id)),
    messages: protectedProcedure.input(z.object({ threadId: z.number().int().positive() })).query(({ ctx, input }) => db.listMessages(ctx.user.id, input.threadId)),
    runs: protectedProcedure.query(({ ctx }) => db.listResearchRuns(ctx.user.id)),
  }),
  chat: router({
    send: protectedProcedure.input(z.object({ threadId: z.number().int().positive().optional(), content: z.string().trim().min(1).max(8_000), deepThinking: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
      const threadId = input.threadId ?? await db.createThread(ctx.user.id, input.content.slice(0, 80));
      const previous = await db.listMessages(ctx.user.id, threadId);
      await db.saveMessage({ userId: ctx.user.id, threadId, role: "user", content: input.content });
      const messages = [
        { role: "system" as const, content: researchSystemPrompt },
        ...previous.slice(-12).map(message => ({ role: message.role, content: message.content })),
        { role: "user" as const, content: input.content },
      ];
      const result = await invokeLLM({ messages, ...(input.deepThinking ? { thinking: { type: "enabled", budget_tokens: 2048 } } : {}) });
      const content = typeof result.choices[0]?.message.content === "string" ? result.choices[0].message.content : "I could not generate a usable response.";
      await db.saveMessage({ userId: ctx.user.id, threadId, role: "assistant", content });
      return { threadId, content };
    }),
  }),
  research: router({
    search: protectedProcedure.input(z.object({ query: z.string().trim().min(2).max(500), threadId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
      const result = await searchWeb({ query: input.query, limit: 5, sources: ["web"], safeSearch: true });
      const runId = await persistResearch({ userId: ctx.user.id, threadId: input.threadId, operation: "search", query: input.query, result });
      return { runId, result };
    }),
    scrape: protectedProcedure.input(z.object({ url: z.string().url(), threadId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
      const result = await scrapeUrl({ url: input.url });
      const runId = await persistResearch({ userId: ctx.user.id, threadId: input.threadId, operation: "scrape", query: input.url, result });
      return { runId, result };
    }),
    map: protectedProcedure.input(z.object({ url: z.string().url(), threadId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
      const result = await mapSite({ url: input.url, limit: 30 });
      const runId = await persistResearch({ userId: ctx.user.id, threadId: input.threadId, operation: "map", query: input.url, result });
      return { runId, result };
    }),
    agent: protectedProcedure.input(z.object({ prompt: z.string().trim().min(3).max(2_000), threadId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
      const result = await runResearchAgent({ prompt: input.prompt });
      const runId = await persistResearch({ userId: ctx.user.id, threadId: input.threadId, operation: "agent", query: input.prompt, result });
      return { runId, result };
    }),
    extract: protectedProcedure.input(z.object({ url: z.string().url(), prompt: z.string().trim().min(3).max(1_000), schema: z.record(z.string(), z.unknown()), threadId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
      const result = await scrapeUrl({ url: input.url, formats: ["markdown"], jsonOptions: { prompt: input.prompt, schema: input.schema } });
      const runId = await persistResearch({ userId: ctx.user.id, threadId: input.threadId, operation: "scrape", query: input.url, result });
      return { runId, result };
    }),
  }),
  anchor: router({
    status: protectedProcedure.query(({ ctx }) => getAnchorStatus(ctx.user.id)),
    connect: protectedProcedure.input(z.object({ identityToken: z.string().min(1).optional(), identityProvider: z.string().min(1).optional() })).mutation(({ ctx, input }) => connectAnchorAgent(ctx.user.id, input.identityToken, input.identityProvider)),
    startSession: protectedProcedure.mutation(async ({ ctx }) => {
      const runId = await db.createResearchRun({ userId: ctx.user.id, operation: "browser", query: "Anchor Browser session", provider: "Anchor Browser", status: "approval_required" });
      try {
        const session = await startAnchorSession(ctx.user.id);
        await db.completeResearchRun(runId, { sessionId: session.id, liveViewAvailable: Boolean(session.liveViewUrl) });
        return session;
      } catch (error) {
        await db.failResearchRun(runId, error instanceof Error ? error.message : "Browser session failed.");
        throw error;
      }
    }),
  }),
  analytics: router({
    domain: protectedProcedure.input(z.object({ domain: z.string().trim().min(3).max(255) })).mutation(async ({ ctx, input }) => {
      const domain = input.domain.replace(/^https?:\/\//, "").split("/")[0];
      const end = new Date();
      end.setMonth(end.getMonth() - 1);
      const start = new Date(end);
      start.setMonth(start.getMonth() - 2);
      const dates = { start_date: start.toISOString().slice(0, 7), end_date: end.toISOString().slice(0, 7), main_domain_only: true };
      const calls = await Promise.allSettled([
        callDataApi("Similarweb/get_visits_total", { pathParams: { domain }, query: { ...dates, country: "world", granularity: "monthly" } }),
        callDataApi("Similarweb/get_global_rank", { pathParams: { domain }, query: dates }),
        callDataApi("Similarweb/get_traffic_sources_desktop", { pathParams: { domain }, query: { ...dates, country: "world", granularity: "monthly" } }),
        callDataApi("Similarweb/incoming_traffic_mobile_web_referrals", { pathParams: { domain }, query: { ...dates, country: "ww", granularity: "monthly", limit: "8", offset: "0" } }),
      ]);
      const data = { visits: calls[0], rank: calls[1], channels: calls[2], referrers: calls[3] };
      await db.saveAnalyticsSnapshot(ctx.user.id, domain, data);
      return data;
    }),
  }),
  knowledge: router({
    list: protectedProcedure.query(({ ctx }) => db.listKnowledgeItems(ctx.user.id)),
    upload: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(255), mimeType: z.enum(["application/pdf", "text/plain", "text/markdown"]), base64: z.string().min(1).max(10_000_000) })).mutation(async ({ ctx, input }) => {
      const runId = await db.createResearchRun({ userId: ctx.user.id, operation: "upload", query: input.name, provider: "VV Storage" });
      try {
        const bytes = Buffer.from(input.base64, "base64");
        const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const stored = await storagePut(`knowledge/${ctx.user.id}/${Date.now()}-${safeName}`, bytes, input.mimeType);
        const id = await db.addKnowledgeItem({ userId: ctx.user.id, researchRunId: runId, sourceType: "upload", title: input.name, storageKey: stored.key, excerpt: `Uploaded ${input.mimeType} document.`, provenance: { provider: "VV Storage", url: stored.url, mimeType: input.mimeType } });
        await db.completeResearchRun(runId, { knowledgeItemId: id, storageUrl: stored.url });
        return { id, url: stored.url };
      } catch (error) {
        await db.failResearchRun(runId, error instanceof Error ? error.message : "Upload failed.");
        throw error;
      }
    }),
  }),
  monitors: router({
    list: protectedProcedure.query(({ ctx }) => db.listMonitors(ctx.user.id)),
    draft: protectedProcedure.input(z.object({ label: z.string().trim().min(2).max(255), targetUrl: z.string().url(), cronExpression: z.string().regex(/^\S+(\s+\S+){5}$/, "Use a six-part UTC cron expression.") })).mutation(({ ctx, input }) => db.createMonitor({ userId: ctx.user.id, ...input })),
  }),
  workers: router({
    list: protectedProcedure.query(({ ctx }) => db.listWorkerTasks(ctx.user.id)),
    propose: protectedProcedure.input(z.object({ workerType: z.enum(["web_research", "document_analysis", "domain_analytics", "change_monitor"]), purpose: z.string().trim().min(10).max(1_000), allowedDomains: z.array(z.string().min(1)).max(20).optional(), maxSources: z.number().int().min(1).max(25).default(10), maxDurationSeconds: z.number().int().min(30).max(300).default(120) })).mutation(({ ctx, input }) => db.createWorkerTask({ userId: ctx.user.id, ...input })),
  }),
});

export type AppRouter = typeof appRouter;
