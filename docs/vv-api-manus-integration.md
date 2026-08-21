# VV-API ⇄ Manus ⇄ Copilot AI Agents Integration

This document describes how the Manus integration is wired **into the VV-API server app itself** (not only into CI workflows), how "access to all tasks in Manus" works, and how Copilot AI agents are dispatched from VV-API.

## Architecture

```
Manus (tasks, connectors, skills)
        ⇅  HTTPS API (MANUS_API_KEY, server-side only)
VV-API server (Express + tRPC)
  ├─ server/integrations/manus.ts          Manus connector (list/get/create tasks)
  ├─ server/integrations/connectors.ts     Runtime registry over connections.json
  ├─ server/integrations/copilotAgents.ts  Copilot AI agents bridge (GitHub issues)
  └─ server/integrationsRouter.ts          Admin-only tRPC surface (integrations.*)
        ⇅  GitHub REST (HUB_GITHUB_TOKEN, server-side only)
Copilot coding agents (issues labeled `copilot-task`, assignee `copilot`)
        ⇅
Repo-creation hub (docs/repo-hub.md)  +  Manus email bridge (docs/manus-email-bridge.md)
```

## Required environment variables / secrets (server-side only, never client-side, never logged)

| Variable | Purpose | Required for |
| --- | --- | --- |
| `MANUS_API_KEY` | Manus API key, sent only in the `x-manus-api-key` header | `integrations.manus.*` |
| `MANUS_API_BASE` | Optional override of the Manus API base URL (default `https://api.manus.ai`) | optional |
| `HUB_GITHUB_TOKEN` | GitHub token for creating Copilot task issues in GalyVverse repos | `integrations.copilot.*` |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Email bridge (CI workflow, unchanged) | email channels |
| `MANUS_WORKFLOW_EMAIL` / `MANUS_TASKBOT_EMAIL` | Manus email channels (CI workflow, unchanged) | email channels |
| `FIRECRAWL_API_KEY`, `JWT_SECRET` | Existing research integrations (see `integration-notes.md`) | research |

## tRPC endpoints (all **admin-only**, mounted at `integrations` in `server/routers.ts`)

- `integrations.status` — connectors/skills registry state derived from root `connections.json`: which integrations exist, whether each is configured (env-presence booleans only — **no secret values are ever returned**), triggers, and channel routing.
- `integrations.manus.listTasks({ limit?, cursor?, status? })` — lists tasks in the connected Manus account with pagination passthrough. This is what provides **access to all tasks in Manus**: page through with `cursor` until `nextCursor` is `null`.
- `integrations.manus.getTask({ taskId })` — fetches a single Manus task.
- `integrations.manus.createTask({ title?, prompt, agent?, mode? })` — creates a new Manus task.
- `integrations.copilot.dispatchTask({ title, body, owner?, repo?, assignToCopilot?, labels? })` — creates a GitHub issue (default repo `GalyVverse/Twin-Flame`) labeled `copilot-task` and assigned to `copilot`, so the Copilot coding agent picks it up. This complements the existing hub workflows, which forward issues onward via the email bridge.
- `integrations.copilot.syncFromManus({ taskId, owner?, repo? })` — fetches a Manus task and dispatches it as a Copilot task (title/body mapping), i.e. Manus → VV-API → Copilot AI agent.

## Manus API details used by the connector

- Base: `https://api.manus.ai` (override with `MANUS_API_BASE`).
- Auth: API key in the `x-manus-api-key` request header only.
- Routes: `GET /v2/task.list`, `GET /v2/task.get`, `POST /v2/task.create` (per Manus's published API docs; the response parser is intentionally tolerant of `tasks`/`data`/`task` envelope variants). Manus "Connectors" (MCP integrations) and "Skills" are account-level Manus features; VV-API reflects its own connector/skill wiring through `integrations.status`.

## Graceful degradation

Nothing throws at import time. When `MANUS_API_KEY` is missing, every Manus call returns `{ ok: false, configured: false, error: "Manus is not configured…" }` without touching the network; when `HUB_GITHUB_TOKEN` is missing, Copilot dispatch returns a typed not-configured result. `integrations.status` always works and shows exactly which env vars are missing per integration.

## Security notes

- All credentials are environment/secret based; none appear in source, responses, logs, or `connections.json`.
- Every `integrations.*` procedure uses `adminProcedure` (role `admin` required) because these endpoints expose org automation.
- Provider error messages are truncated and scrubbed of the API key before being returned.
- Dynamic URL segments (repo owner/name, task ids) are zod-validated and URL-encoded.
- Manus task content synced to GitHub is treated as **untrusted data**: it is quoted verbatim in the issue body for owner review and is never interpreted as instructions.
- Copilot dispatch creates reviewable issues only — no merges, deployments, or settings changes.

## Related docs

- [Repo-creation hub](./repo-hub.md)
- [Manus email bridge](./manus-email-bridge.md)
- Root `integration-notes.md` (server-side-secret rules for Anchor Browser and Firecrawl)
