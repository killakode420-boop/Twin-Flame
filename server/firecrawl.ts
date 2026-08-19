import { z } from "zod";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";

const firecrawlSearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(10).default(5),
  sources: z.array(z.enum(["web", "images", "news"])).min(1).default(["web"]),
  includeDomains: z.array(z.string().min(1)).max(20).optional(),
  excludeDomains: z.array(z.string().min(1)).max(20).optional(),
  safeSearch: z.boolean().default(true),
});

export type FirecrawlSearchInput = z.infer<typeof firecrawlSearchSchema>;

type FirecrawlError = {
  success?: false;
  error?: string;
  message?: string;
};

function getFirecrawlApiKey() {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not configured. Add it in project settings before running web research.");
  }
  return apiKey;
}

async function firecrawlFetch(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getFirecrawlApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as FirecrawlError & Record<string, unknown>;
  if (!response.ok) {
    const message = payload.error || payload.message || `Firecrawl request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

export async function validateFirecrawlCredential() {
  try {
    await firecrawlFetch("/v2/search", {
      query: "Firecrawl",
      limit: 1,
      sources: ["web"],
      safeSearch: true,
    });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Credential validation failed." };
  }
}

export async function searchWeb(input: FirecrawlSearchInput) {
  const parsed = firecrawlSearchSchema.parse(input);
  return firecrawlFetch("/v2/search", parsed);
}

export async function scrapeUrl(input: { url: string; formats?: Array<"markdown" | "html">; onlyMainContent?: boolean; jsonOptions?: { prompt: string; schema: Record<string, unknown> } }) {
  const url = z.string().url().parse(input.url);
  return firecrawlFetch("/v2/scrape", {
    url,
    formats: input.formats ?? ["markdown"],
    onlyMainContent: input.onlyMainContent ?? true,
    ...(input.jsonOptions ? { jsonOptions: input.jsonOptions } : {}),
  });
}

export async function mapSite(input: { url: string; search?: string; limit?: number }) {
  const url = z.string().url().parse(input.url);
  return firecrawlFetch("/v2/map", { url, search: input.search, limit: Math.min(Math.max(input.limit ?? 25, 1), 100) });
}

export async function runResearchAgent(input: { prompt: string; urls?: string[] }) {
  const prompt = z.string().trim().min(3).max(2_000).parse(input.prompt);
  const urls = input.urls?.map(url => z.string().url().parse(url));
  return firecrawlFetch("/v2/agent", { prompt, ...(urls?.length ? { urls } : {}) });
}
