# Manus Email Bridge

Automates the Copilot → Manus task handoff for this hub. When a task appears
in this repository (an issue opened/assigned, a `repository_dispatch` event,
or a manual `workflow_dispatch`), a GitHub Actions workflow composes a task
email and delivers it to your Manus email channels — so Manus can pick it up
as a task, with zero addresses or credentials committed to the repository.

## How it works

```
 GitHub issue opened / assigned ─┐
 repository_dispatch             ├─► .github/workflows/dispatch-task-email.yml
   (copilot-task-created)        │        │  builds payload (task-email.schema.json)
 workflow_dispatch (manual) ─────┘        ▼
                                   scripts/send-task-email.js
                                     │  validates payload
                                     │  routes via connections.json channels
                                     ▼
                          SMTP (implicit TLS, secrets only)
                              │                       │
                              ▼                       ▼
                 MANUS_WORKFLOW_EMAIL       MANUS_TASKBOT_EMAIL
                 (notifications / CI)       (Manus task intake)
```

Additionally, `.github/workflows/create-repo.yml` has an optional,
non-blocking `notify` job that emails the workflow channel after a
successful repo-creation run. It skips itself when secrets are absent and
never fails the main job.

## Finding your Manus task email

Manus supports creating tasks by email. In Manus, open **Settings** and look
for your **personalized task email address** — messages sent to that address
become Manus tasks. Store it in the `MANUS_TASKBOT_EMAIL` secret. Use your
regular Manus workflow/notification address for `MANUS_WORKFLOW_EMAIL`.

## Required GitHub secrets

Configure under **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| `MANUS_WORKFLOW_EMAIL` | Manus workflow email — notifications, repo-creation and CI status |
| `MANUS_TASKBOT_EMAIL` | Manus taskbot email — personalized Manus task-intake address |
| `SMTP_HOST` | SMTP server hostname (implicit TLS) |
| `SMTP_PORT` | SMTP port (optional, default `465`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password / app password |
| `SMTP_FROM` | From address (optional, defaults to `SMTP_USER`) |

If the SMTP secrets or both `MANUS_*_EMAIL` secrets are missing, the
workflows log a message and skip sending — they never fail the run and never
guess addresses.

## Triggers

1. **`issues` (opened, assigned):** the issue title becomes the subject and
   the issue body plus URL become the email body; routed to the `taskbot`
   channel as a `copilot-task`. Label an issue `no-email` to opt out.
2. **`repository_dispatch` (type `copilot-task-created`):** send a full
   payload (see `schemas/task-email.schema.json`) as `client_payload.task`.
3. **`workflow_dispatch`:** manual run with `subject`, `body`, `channel`, and
   `taskType` inputs from the Actions tab.

### repository_dispatch example

```bash
# GITHUB_PAT is a fine-grained PAT with repo Contents access; keep it in
# your local environment, never in the repository.
auth_header="Authorization: Bearer ${GITHUB_PAT}"
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "$auth_header" \
  https://api.github.com/repos/GalyVverse/Twin-Flame/dispatches \
  -d '{
    "event_type": "copilot-task-created",
    "client_payload": {
      "task": {
        "subject": "Build the applications dashboard",
        "body": "Please scaffold the dashboard described in requests/example.json.",
        "channel": "taskbot",
        "taskType": "copilot-task",
        "source": "copilot"
      }
    }
  }'
```

### Local dry run

```bash
MANUS_WORKFLOW_EMAIL=you@example.com MANUS_TASKBOT_EMAIL=bot@example.com \
  node scripts/send-task-email.js my-payload.json --dry-run
```

Dry runs print the channel, redacted recipients, and subject without opening
any SMTP connection.

## connections.json routing

`connections.json` is the registry that wires this repository's skills and
integrations to the email channels. Each `channels` entry names the env
var/secret holding its address (never the address itself) and its routing
rules; each `integrations` entry (github-repo-hub, copilot, manus,
anchor-browser, firecrawl) declares its triggers and which channel it routes
to. `scripts/send-task-email.js` reads this file to resolve the recipients
for the payload's `channel` field (`workflow`, `taskbot`, or `both`).

The Anchor Browser and Firecrawl integrations are credential-gated,
server-side-only research integrations (see `integration-notes.md`); the
bridge routes only their status notifications to the workflow channel and
never transmits their credentials.

## Security notes

- **No addresses or credentials in the repo.** Everything is resolved at
  runtime from GitHub Actions secrets / env vars; logs show recipients only
  in redacted form (`f***@example.com`).
- **SMTP header injection prevention:** subjects and addresses are stripped
  of CR/LF and control characters; addresses must match a strict pattern;
  message bodies are dot-stuffed per RFC 5321.
- **GitHub Actions script injection prevention:** untrusted event text
  (issue titles/bodies, dispatch payloads) is passed to scripts only via
  environment variables, never interpolated into `run:` script bodies.
- **Least privilege:** workflows run with `permissions: contents: read` and
  send email only — they never write to the repository or merge anything.
- **Transport:** implicit TLS (port 465) with `AUTH LOGIN`/`AUTH PLAIN`;
  credentials are never logged or written to disk.

See also: [VV-API ⇄ Manus ⇄ Copilot integration](./vv-api-manus-integration.md) for the in-app tRPC surface.
