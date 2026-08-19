import { describe, expect, it } from "vitest";
import { validateFirecrawlCredential } from "./firecrawl";

describe("Firecrawl credential", () => {
  it("authenticates with a minimal protected search request", async () => {
    const result = await validateFirecrawlCredential();
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  }, 20_000);
});

