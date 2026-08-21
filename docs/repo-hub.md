# GalyVverse Repo Hub

This repository doubles as a **JSON-driven hub** that automates creating new
repositories in the `GalyVverse` GitHub organization whenever a new task or
application is created in Manus (with Copilot) — or manually.

## Architecture overview

```
Manus / Copilot task ──► repository_dispatch (manus-task-created)
Human / tooling      ──► workflow_dispatch inputs
Git commit           ──► push of a new requests/*.json file
                              │
                              ▼
              .github/workflows/create-repo.yml
                              │  HUB_GITHUB_TOKEN = secrets.HUB_ORG_TOKEN
                              ▼
                    scripts/create-repo.js
          1. validate request (schemas/repo-request.schema.json rules)
          2. load hub.config.json → resolve template descriptor
          3. GET  /repos/{org}/{name}          (existence check)
          4. POST /orgs/{org}/repos            (create repo)
          5. PUT  /repos/{org}/{name}/topics   (apply topics)
          6. PUT  /repos/{org}/{name}/contents/{path}  (seed template files)
```

Key files:

| File | Purpose |
| --- | --- |
| `hub.config.json` | Org name, default repo settings, naming rules, template registry |
| `schemas/repo-request.schema.json` | JSON Schema (draft-07) for requests |
| `requests/` | Drop-a-file trigger; `example.json` is a skippable sample (`dryRun: true`) |
| `scripts/create-repo.js` | Node ESM script (built-in `fetch`/`fs`, zero new dependencies) |
| `template.json` | The `web-db-user` template descriptor (`files` map: path → content) |

## Request schema

A request is a JSON object validated against
[`schemas/repo-request.schema.json`](../schemas/repo-request.schema.json):

```json
{
  "name": "my-new-app",
  "description": "App created from a Manus task",
  "template": "web-db-user",
  "visibility": "private",
  "topics": ["galyvverse", "manus"],
  "source": "manus",
  "dryRun": false
}
```

- `name` (required) must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` — this
  strict pattern also prevents URL/path injection in API calls.
- `template` defaults to `web-db-user`; it must be registered in
  `hub.config.json` under `templates`.
- `visibility` is one of `private` (default), `public`, `internal`.
- `dryRun: true` logs planned actions without making any API call; the
  push-triggered workflow skips such files.

## Three ways to trigger

### 1. Manus / Copilot → `repository_dispatch`

When Manus (or a Copilot automation) creates a new task/application, it POSTs a
`repository_dispatch` event with type `manus-task-created` and the request in
`client_payload.request`:

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $DISPATCH_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/GalyVverse/Twin-Flame/dispatches \
  -d '{
    "event_type": "manus-task-created",
    "client_payload": {
      "request": {
        "name": "my-new-app",
        "description": "Created from a Manus task",
        "template": "web-db-user",
        "visibility": "private",
        "topics": ["galyvverse", "manus"],
        "source": "manus"
      }
    }
  }'
```

`$DISPATCH_TOKEN` only needs permission to send dispatch events to this repo
(`contents: read/write` on Twin-Flame is sufficient); the actual repo creation
uses the separate `HUB_ORG_TOKEN` secret inside the workflow.

### 2. Manual → `workflow_dispatch`

In GitHub → Actions → “Create GalyVverse Repository” → *Run workflow*, fill in
`name`, `description`, `template`, `visibility`. Or via CLI:

```bash
gh workflow run create-repo.yml -R GalyVverse/Twin-Flame \
  -f name=my-new-app -f description="Manual run" -f visibility=private
```

### 3. Drop a JSON file in `requests/`

Commit a new file such as `requests/my-new-app.json` (conforming to the
schema) to `main`. The workflow processes **newly added** request files and
skips any with `"dryRun": true` (like `requests/example.json`). Use a pull
request so the request is owner-reviewed before it lands on `main`.

## Required secret: `HUB_ORG_TOKEN`

The default `GITHUB_TOKEN` **cannot create organization repositories**, so the
workflow reads an org-scoped token from the repository secret `HUB_ORG_TOKEN`
and exposes it to the script as the `HUB_GITHUB_TOKEN` environment variable.

Setup (fine-grained PAT):

1. GitHub → Settings → Developer settings → Fine-grained personal access
   tokens → *Generate new token*.
2. Resource owner: **GalyVverse** organization.
3. Organization permissions: **Administration: Read and write** (required to
   create repositories). Repository permissions: **Contents: Read and write**
   and **Administration: Read and write** for “All repositories” (or the
   pattern of repos the hub creates), so the script can seed files and set
   topics.
4. Add it to this repo: Settings → Secrets and variables → Actions →
   *New repository secret* → name `HUB_ORG_TOKEN`.

A GitHub App installation token with equivalent org/repo permissions also
works.

## Security notes

- **Secrets live only in GitHub Actions secrets.** Never commit tokens to
  `hub.config.json`, request files, templates, or code. The script reads the
  token exclusively from the `HUB_GITHUB_TOKEN` env var and never logs it.
- Repo names and topics are validated against strict patterns before any API
  call, and every dynamic URL path segment is `encodeURIComponent`-encoded.
- The workflow runs with a minimal `permissions: contents: read` block; all
  privileged actions go through the dedicated `HUB_ORG_TOKEN`.
- The script refuses to overwrite an existing repository.
- Request bodies from `repository_dispatch` are untrusted input: they are
  schema-validated and can only select templates already registered in
  `hub.config.json`. Rotate `HUB_ORG_TOKEN` if you suspect exposure.
- Prefer the pull-request flow for `requests/*.json` so a human reviews each
  creation before it executes.
