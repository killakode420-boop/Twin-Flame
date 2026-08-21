import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManusTask, getManusTask, isManusConfigured, listManusTasks, manusApiBase, MANUS_DEFAULT_API_BASE } from "./manus";

const originalKey = process.env.MANUS_API_KEY;
const originalBase = process.env.MANUS_API_BASE;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  if (originalKey === undefined) delete process.env.MANUS_API_KEY;
  else process.env.MANUS_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.MANUS_API_BASE;
  else process.env.MANUS_API_BASE = originalBase;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Manus connector — not configured", () => {
  beforeEach(() => {
    delete process.env.MANUS_API_KEY;
  });

  it("reports not configured without throwing", () => {
    expect(isManusConfigured()).toBe(false);
  });

  it("returns a typed not-configured result instead of calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await listManusTasks();
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
    if (!result.ok) expect(result.error).toContain("MANUS_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the default API base when MANUS_API_BASE is unset", () => {
    delete process.env.MANUS_API_BASE;
    expect(manusApiBase()).toBe(MANUS_DEFAULT_API_BASE);
  });
});

describe("Manus connector — configured (mocked fetch, hermetic)", () => {
  beforeEach(() => {
    process.env.MANUS_API_KEY = "test-key-not-a-real-secret";
    process.env.MANUS_API_BASE = "https://manus.test";
  });

  it("lists tasks with pagination passthrough and sends the API key header only", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ tasks: [{ id: "t1", title: "Task one", status: "running" }], next_cursor: "abc" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const result = await listManusTasks({ limit: 5, cursor: "start", status: "running" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0].id).toBe("t1");
      expect(result.data.nextCursor).toBe("abc");
    }
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain("https://manus.test/v2/task.list");
    expect(String(url)).toContain("limit=5");
    expect(String(url)).toContain("cursor=start");
    expect((init.headers as Record<string, string>)["x-manus-api-key"]).toBe("test-key-not-a-real-secret");
  });

  it("creates a task and returns the parsed payload", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ task: { id: "t9", title: "Created", status: "queued" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await createManusTask({ title: "Created", prompt: "Do the thing" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe("t9");
    const [, init] = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { message: { content: string }; title: string };
    expect(body.message.content).toBe("Do the thing");
    expect(body.title).toBe("Created");
  });

  it("surfaces API errors as typed failures with the key redacted", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ error: "Bad request including test-key-not-a-real-secret" }, 400));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await getManusTask("t1");
    expect(result.ok).toBe(false);
    if (!result.ok && result.configured) {
      expect(result.status).toBe(400);
      expect(result.error).not.toContain("test-key-not-a-real-secret");
      expect(result.error).toContain("[redacted]");
    }
  });

  it("returns a network failure result instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));
    const result = await listManusTasks();
    expect(result.ok).toBe(false);
    if (!result.ok && result.configured) expect(result.status).toBe(0);
  });
});
