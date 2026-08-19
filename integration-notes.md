# VV API Integration Notes

## Anchor Browser Agent Access

Official documentation confirms that agent onboarding begins with `GET https://api.anchorbrowser.io/v1/agent-access`, then retrieves a challenge through `GET /v1/agent-access/challenge`. The challenge response contains an opaque `token`, a natural-language or arithmetic `challenge.prompt`, instructions, and a `next` path. VV API must compute the prompt answer server-side and submit `{ "token": "…", "answer": <integer> }` to `POST /v1/agent-access`. The onboarding GET flow alone does not issue an API key.

The issued credential must remain server-side and be sent only in the provider-designated API-key header, described by the challenge instructions. Optional `identity_token` may be included for enhanced credits; `identity_provider` is optional for standard Google, GitHub Actions, and Vercel JWT issuers. The browser integration must never expose a credential in client-side code or save a token in the browser.

Anchor advertises cloud browser sessions with Playwright/Puppeteer CDP connection, task execution, managed identities, and human-intervention support. VV API will use it only after the user explicitly selects a browser-assisted research action, and will persist resulting sources with provenance in the personal knowledge base.

Sources: https://docs.anchorbrowser.io/introduction and https://docs.anchorbrowser.io/api-reference/agent-access/get-agent-access-challenge.

## Firecrawl Agent Onboarding

The official Firecrawl onboarding skill distinguishes in-session command-line use from persistent product integration. VV API is a product integration and therefore uses a protected server-side `FIRECRAWL_API_KEY`, never a client-side credential.

When no valid key exists, the documented browser authorization fallback uses PKCE: generate a `session_id`, `code_verifier`, and SHA-256 `code_challenge`; open `https://www.firecrawl.dev/cli-auth` with the challenge and session fragment; then poll `POST https://www.firecrawl.dev/api/auth/cli/status` with the session identifier and verifier until the response is complete. The returned key must be sent only to the project’s secure secret store and validated with a minimal protected request.

Firecrawl also documents a keyless free fallback for search, scrape, interact, parse, and research-index use through an official client surface; it is rate-limited and does not unlock crawl, map, monitor, extraction, batch scrape, or agent features. VV API will present this as an explicitly limited fallback rather than silently treating it as full access.

Source: https://www.firecrawl.dev/agent-onboarding/SKILL.md.

The current PKCE authorization session remains in `pending` state. The linked browser is still on Firecrawl’s sign-in page, so no authorization has been completed and no API key has been retrieved or stored. The app integration must remain in its credential-gated state until the authorization finishes and the status endpoint returns `complete`.

Follow-up checks confirm that the authorization flow has advanced to GitHub OAuth but remains on GitHub’s sign-in page. Firecrawl cannot issue the PKCE API key until that interactive identity step and the subsequent Firecrawl approval complete.
