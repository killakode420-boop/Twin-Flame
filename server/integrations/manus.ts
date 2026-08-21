import { z } from "zod";

/**
 * Manus connector for VV-API.
 *
 * Server-side only. The API key is read exclusively from the environment
 * (`MANUS_API_KEY`) and is never logged, never returned to clients, and never
 * placed in source control.
 *
 * Endpoint shape is based on the publicly documented Manus API
 * (base `https://api.manus.ai`, auth header `x-manus-api-key`, RPC-style
 * `/v2/task.*` routes). If Manus revises its surface, override the base URL
 * with `MANUS_API_BASE`; nothing here is hard-coded to a credential.
 * When no key is configured the module degrades gracefully: functions return
 * a typed "not configured" result instead of throwing at import time.
 */

export const MANUS_DEFAULT_API_BASE = "https://api.manus.ai";

const API_KEY_HEADER = "x-manus-api-key";

export type ManusNotConfigured = {
  ok: false;
  configured: false;
  error: string;
};

export type ManusFailure = { ok: false; configured: true; status: number; error: string };

export type ManusSuccess<T> = { ok: true; configured: true; data: T };

export type ManusResult<T> = ManusSuccess<T> | ManusFailure | ManusNotConfigured;

export const manusTaskSchema = z
  .object({
    id: z.string().optional(),
    task_id: z.string().optional(),
    title: z.string().optional(),
    prompt: z.string().optional(),
    status: z.string().optional(),
    mode: z.string().optional(),
    agent: z.string().optional(),
    created_at: z.union([z.string(), z.number()]).optional(),
    updated_at: z.union([z.string(), z.number()]).optional(),
  })
  .loose();

export type ManusTask = z.infer<typeof manusTaskSchema>;

export const listManusTasksInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(2_000).optional(),
  status: z.string().max(100).optional(),
});

export type ListManusTasksInput = z.infer<typeof listManusTasksInputSchema>;

export const createManusTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  prompt: z.string().trim().min(1).max(20_000),
  agent: z.string().trim().min(1).max(100).optional(),
  mode: z.string().trim().min(1).max(100).optional(),
});

export type CreateManusTaskInput = z.infer<typeof createManusTaskInputSchema>;

export type ManusTaskList = { tasks: ManusTask[]; nextCursor: string | null };

function notConfigured(): ManusNotConfigured {
  return {
    ok: false,
    configured: false,
    error: "Manus is not configured. Set the MANUS_API_KEY server-side secret to enable task access.",
  };
}

function apiKey() {
  const key = process.env.MANUS_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

export function manusApiBase() {
  const base = process.env.MANUS_API_BASE?.trim();
  return (base && base.length > 0 ? base : MANUS_DEFAULT_API_BASE).replace(/\/+$/, "");
}

export function isManusConfigured() {
  return apiKey() !== null;
}

function redactedError(payload: Record<string, unknown>, status: number) {
  const message =
    typeof payload.error === "string"
      ? payload.error
      : typeof payload.message === "string"
        ? payload.message
        : `Manus API request failed with status ${status}.`;
  // Defensive: never propagate anything that looks like a credential.
  const key = apiKey();
  return (key ? message.replaceAll(key, "[redacted]") : message).slice(0, 500);
}

async function manusFetch<T>(
  path: string,
  init: { method?: "GET" | "POST"; query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<ManusResult<T>> {
  const key = apiKey();
  if (!key) return notConfigured();
  const url = new URL(`${manusApiBase()}${path}`);
  for (const [name, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        [API_KEY_HEADER]: key,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      configured: true,
      status: 0,
      error: error instanceof Error ? error.message.slice(0, 500) : "Manus API request failed before a response was received.",
    };
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return { ok: false, configured: true, status: response.status, error: redactedError(payload, response.status) };
  }
  return { ok: true, configured: true, data: payload as T };
}

function normalizeTaskList(payload: Record<string, unknown>): ManusTaskList {
  const rawTasks = Array.isArray(payload.tasks) ? payload.tasks : Array.isArray(payload.data) ? payload.data : [];
  const tasks: ManusTask[] = [];
  for (const item of rawTasks) {
    const parsed = manusTaskSchema.safeParse(item);
    if (parsed.success) tasks.push(parsed.data);
  }
  const nextCursor = typeof payload.next_cursor === "string" ? payload.next_cursor : typeof payload.cursor === "string" ? payload.cursor : null;
  return { tasks, nextCursor };
}

/** Lists tasks in the connected Manus account, with pagination passthrough. */
export async function listManusTasks(params?: ListManusTasksInput): Promise<ManusResult<ManusTaskList>> {
  const input = listManusTasksInputSchema.parse(params ?? {});
  const result = await manusFetch<Record<string, unknown>>("/v2/task.list", {
    query: {
      limit: input.limit !== undefined ? String(input.limit) : undefined,
      cursor: input.cursor,
      status: input.status,
    },
  });
  if (!result.ok) return result;
  return { ok: true, configured: true, data: normalizeTaskList(result.data) };
}

/** Fetches a single Manus task by id. */
export async function getManusTask(id: string): Promise<ManusResult<ManusTask>> {
  const taskId = z.string().trim().min(1).max(200).parse(id);
  const result = await manusFetch<Record<string, unknown>>("/v2/task.get", { query: { task_id: taskId } });
  if (!result.ok) return result;
  const raw = (result.data.task ?? result.data.data ?? result.data) as unknown;
  const parsed = manusTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, configured: true, status: 502, error: "Manus returned a task payload VV-API could not interpret." };
  }
  return { ok: true, configured: true, data: parsed.data };
}

/** Creates a new Manus task from a title/prompt (optionally selecting agent/mode). */
export async function createManusTask(input: CreateManusTaskInput): Promise<ManusResult<ManusTask>> {
  const parsedInput = createManusTaskInputSchema.parse(input);
  const result = await manusFetch<Record<string, unknown>>("/v2/task.create", {
    method: "POST",
    body: {
      ...(parsedInput.title ? { title: parsedInput.title } : {}),
      message: { content: parsedInput.prompt },
      ...(parsedInput.agent ? { agent: parsedInput.agent } : {}),
      ...(parsedInput.mode ? { mode: parsedInput.mode } : {}),
    },
  });
  if (!result.ok) return result;
  const raw = (result.data.task ?? result.data.data ?? result.data) as unknown;
  const parsed = manusTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, configured: true, status: 502, error: "Manus accepted the task but returned an unexpected payload." };
  }
  return { ok: true, configured: true, data: parsed.data };
}
