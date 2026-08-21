#!/usr/bin/env node
/**
 * GalyVverse task-email bridge — send-task-email script.
 *
 * Forwards a Copilot/GitHub task from this hub to the Manus email channels.
 * Reads a JSON task payload (file path via argv, or inline JSON via the
 * TASK_EMAIL_PAYLOAD env var), validates it against the rules mirrored from
 * schemas/task-email.schema.json, resolves recipient addresses from the
 * connections.json channel registry (env vars MANUS_WORKFLOW_EMAIL and/or
 * MANUS_TASKBOT_EMAIL), and delivers an RFC 5322 plain-text message over a
 * minimal built-in SMTP client (implicit TLS, default port 465, AUTH LOGIN
 * with AUTH PLAIN fallback). Zero npm dependencies.
 *
 * Security:
 *  - SMTP credentials and recipient addresses are read ONLY from environment
 *    variables. They are never logged (recipients are shown redacted) and
 *    never written to disk.
 *  - Subject and address header values are stripped of CR/LF to prevent SMTP
 *    header injection; addresses are validated against a strict pattern.
 *  - Message body is dot-stuffed per RFC 5321.
 *
 * Usage:
 *   node scripts/send-task-email.js path/to/payload.json
 *   node scripts/send-task-email.js path/to/payload.json --dry-run
 *   TASK_EMAIL_PAYLOAD='{"subject":"…","body":"…"}' node scripts/send-task-email.js
 *
 * Environment:
 *   MANUS_WORKFLOW_EMAIL  recipient for the 'workflow' channel
 *   MANUS_TASKBOT_EMAIL   recipient for the 'taskbot' channel
 *   SMTP_HOST             SMTP server hostname (implicit TLS)
 *   SMTP_PORT             SMTP port (default 465)
 *   SMTP_USER             SMTP username
 *   SMTP_PASS             SMTP password
 *   SMTP_FROM             From address (default SMTP_USER)
 *
 * Exit codes:
 *   0 success (or dry run)
 *   1 invalid payload
 *   2 missing configuration / secrets
 *   3 SMTP failure
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connect as tlsConnect } from "node:tls";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import process from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHANNELS = new Set(["workflow", "taskbot", "both"]);
const TASK_TYPES = new Set([
  "new-repo",
  "copilot-task",
  "application",
  "integration",
  "notification",
  "other",
]);
// Pragmatic address pattern: one @, no whitespace/control chars, dotted domain.
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function fail(code, message) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    fail(1, `cannot read ${label} at ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(1, `${label} at ${path} is not valid JSON: ${err.message}`);
  }
}

function loadPayload(argvPath) {
  if (argvPath) {
    return { payload: readJson(resolve(ROOT, argvPath), "payload file"), origin: argvPath };
  }
  if (process.env.TASK_EMAIL_PAYLOAD) {
    try {
      return {
        payload: JSON.parse(process.env.TASK_EMAIL_PAYLOAD),
        origin: "TASK_EMAIL_PAYLOAD env var",
      };
    } catch (err) {
      fail(1, `TASK_EMAIL_PAYLOAD env var is not valid JSON: ${err.message}`);
    }
  }
  fail(1, "no payload provided. Pass a JSON file path or set TASK_EMAIL_PAYLOAD.");
}

/** Mirror of schemas/task-email.schema.json. Returns a list of errors. */
function validatePayload(p) {
  const errors = [];
  if (typeof p !== "object" || p === null || Array.isArray(p)) {
    return ["payload must be a JSON object"];
  }
  if (typeof p.subject !== "string" || p.subject.trim().length === 0 || p.subject.length > 300) {
    errors.push('"subject" is required and must be a non-empty string (max 300 chars)');
  }
  if (typeof p.body !== "string" || p.body.length === 0 || p.body.length > 100000) {
    errors.push('"body" is required and must be a non-empty string (max 100000 chars)');
  }
  if (p.channel !== undefined && !CHANNELS.has(p.channel)) {
    errors.push('"channel" must be one of: workflow, taskbot, both');
  }
  if (p.taskType !== undefined && !TASK_TYPES.has(p.taskType)) {
    errors.push(
      '"taskType" must be one of: new-repo, copilot-task, application, integration, notification, other'
    );
  }
  if (p.source !== undefined && (typeof p.source !== "string" || p.source.length > 100)) {
    errors.push('"source" must be a string (max 100 chars)');
  }
  if (
    p.metadata !== undefined &&
    (typeof p.metadata !== "object" || p.metadata === null || Array.isArray(p.metadata))
  ) {
    errors.push('"metadata" must be an object');
  }
  if (p.dryRun !== undefined && typeof p.dryRun !== "boolean") {
    errors.push('"dryRun" must be a boolean');
  }
  return errors;
}

/** Strip CR/LF and other control characters from header values (anti-injection). */
function sanitizeHeaderValue(value) {
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").trim();
}

function sanitizeAddress(value, label, code) {
  const addr = sanitizeHeaderValue(value);
  if (!EMAIL_PATTERN.test(addr)) {
    fail(code, `${label} is not a valid email address`);
  }
  return addr;
}

function redact(addr) {
  const at = addr.indexOf("@");
  if (at <= 1) return `***@${addr.slice(at + 1)}`;
  return `${addr[0]}***@${addr.slice(at + 1)}`;
}

/** Resolve recipients from connections.json channel registry + env vars. */
function resolveRecipients(channel, connections) {
  const channelKeys =
    channel === "workflow"
      ? ["manusWorkflowEmail"]
      : channel === "taskbot"
        ? ["manusTaskbotEmail"]
        : ["manusWorkflowEmail", "manusTaskbotEmail"];

  const recipients = [];
  const missing = [];
  for (const key of channelKeys) {
    const entry = connections?.channels?.[key];
    if (!entry || typeof entry.envVar !== "string") {
      fail(2, `connections.json is missing channels.${key}.envVar`);
    }
    const value = process.env[entry.envVar];
    if (!value) {
      missing.push(entry.envVar);
      continue;
    }
    recipients.push(sanitizeAddress(value, `env var ${entry.envVar}`, 2));
  }
  if (recipients.length === 0) {
    fail(2, `no recipients resolved for channel "${channel}". Missing env vars: ${missing.join(", ")}`);
  }
  if (missing.length > 0) {
    console.error(`WARN: skipping unset channel env vars: ${missing.join(", ")}`);
  }
  return recipients;
}

function buildMessage({ from, recipients, subject, body, taskType, source, metadata }) {
  const lines = [String(body)];
  const footer = [];
  if (taskType) footer.push(`Task type: ${taskType}`);
  if (source) footer.push(`Source: ${source}`);
  if (metadata && Object.keys(metadata).length > 0) {
    footer.push(`Metadata: ${JSON.stringify(metadata, null, 2)}`);
  }
  if (footer.length > 0) {
    lines.push("", "--", ...footer);
  }
  const bodyText = lines.join("\r\n").replace(/\r?\n/g, "\r\n");

  const messageId = `<${Date.now()}.${randomBytes(8).toString("hex")}@${sanitizeHeaderValue(hostname()) || "localhost"}>`;
  const headers = [
    `From: ${from}`,
    `To: ${recipients.join(", ")}`,
    `Subject: ${sanitizeHeaderValue(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  // Dot-stuffing per RFC 5321 §4.5.2.
  const stuffed = bodyText
    .split("\r\n")
    .map((l) => (l.startsWith(".") ? `.${l}` : l))
    .join("\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${stuffed}\r\n`;
}

/** Minimal SMTP client over implicit TLS with AUTH LOGIN / AUTH PLAIN. */
function sendSmtp({ host, port, user, pass, from, recipients, message }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = tlsConnect({ host, port, servername: host });
    socket.setEncoding("utf8");
    socket.setTimeout(30000);

    let buffer = "";
    let settled = false;
    const waiters = [];

    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.end();
      if (err) rejectPromise(err);
      else resolvePromise();
    };

    socket.on("timeout", () => finish(new Error("SMTP connection timed out")));
    socket.on("error", (err) => finish(new Error(`SMTP connection error: ${err.message}`)));

    socket.on("data", (chunk) => {
      buffer += chunk;
      // A reply is complete when the last line is "NNN " (space, not hyphen).
      let idx;
      while ((idx = buffer.indexOf("\r\n")) !== -1 || buffer.includes("\n")) {
        const lines = buffer.split(/\r?\n/);
        // Find the terminating line of the current reply.
        let end = -1;
        for (let i = 0; i < lines.length; i += 1) {
          if (/^\d{3} /.test(lines[i])) {
            end = i;
            break;
          }
          if (!/^\d{3}-/.test(lines[i]) && lines[i] !== "") {
            // Malformed line — treat as terminator to avoid hanging.
            end = i;
            break;
          }
        }
        if (end === -1) return; // reply not complete yet
        const replyLines = lines.slice(0, end + 1);
        buffer = lines.slice(end + 1).join("\n");
        const code = parseInt(replyLines[end].slice(0, 3), 10);
        const waiter = waiters.shift();
        if (waiter) waiter({ code, text: replyLines.join(" ") });
        if (waiters.length === 0 && buffer.trim() === "") break;
      }
    });

    const readReply = () => new Promise((res) => waiters.push(res));
    const send = (line) => socket.write(`${line}\r\n`);
    const step = async (line, expected, label, secret = false) => {
      if (line !== null) send(line);
      const reply = await readReply();
      if (!expected.includes(reply.code)) {
        const detail = secret ? `(response ${reply.code})` : reply.text;
        throw new Error(`SMTP ${label} failed: ${detail}`);
      }
      return reply;
    };

    (async () => {
      await step(null, [220], "greeting");
      const ehlo = await step(`EHLO ${sanitizeHeaderValue(hostname()) || "localhost"}`, [250], "EHLO");
      const authPlainSupported = /AUTH[^\r\n]*\bPLAIN\b/i.test(ehlo.text);
      const authLoginSupported = /AUTH[^\r\n]*\bLOGIN\b/i.test(ehlo.text);
      if (authLoginSupported || !authPlainSupported) {
        await step("AUTH LOGIN", [334], "AUTH LOGIN", true);
        await step(Buffer.from(user, "utf8").toString("base64"), [334], "AUTH username", true);
        await step(Buffer.from(pass, "utf8").toString("base64"), [235], "AUTH password", true);
      } else {
        const token = Buffer.from(`\u0000${user}\u0000${pass}`, "utf8").toString("base64");
        await step(`AUTH PLAIN ${token}`, [235], "AUTH PLAIN", true);
      }
      await step(`MAIL FROM:<${from}>`, [250], "MAIL FROM");
      for (const rcpt of recipients) {
        await step(`RCPT TO:<${rcpt}>`, [250, 251], "RCPT TO");
      }
      await step("DATA", [354], "DATA");
      socket.write(message);
      await step(".", [250], "message delivery");
      send("QUIT");
      finish();
    })().catch((err) => finish(err));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRunFlag = args.includes("--dry-run");
  const payloadPath = args.find((a) => !a.startsWith("--"));

  const { payload, origin } = loadPayload(payloadPath);
  const errors = validatePayload(payload);
  if (errors.length > 0) {
    fail(1, `invalid payload from ${origin}:\n  - ${errors.join("\n  - ")}`);
  }

  const channel = payload.channel ?? "both";
  const dryRun = dryRunFlag || payload.dryRun === true;
  const connections = readJson(resolve(ROOT, "connections.json"), "connections registry");
  const recipients = resolveRecipients(channel, connections);
  const subject = sanitizeHeaderValue(payload.subject);

  if (dryRun) {
    console.log("DRY RUN — no SMTP connection will be made.");
    console.log(`  Channel:    ${channel}`);
    console.log(`  Recipients: ${recipients.map(redact).join(", ")}`);
    console.log(`  Subject:    ${subject}`);
    console.log(`  Task type:  ${payload.taskType ?? "copilot-task"}`);
    console.log(`  Source:     ${payload.source ?? "(none)"}`);
    return;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    fail(2, "missing SMTP configuration. Required env vars: SMTP_HOST, SMTP_USER, SMTP_PASS (optional: SMTP_PORT, SMTP_FROM).");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(2, "SMTP_PORT must be a valid port number");
  }
  const from = sanitizeAddress(process.env.SMTP_FROM || user, "SMTP_FROM/SMTP_USER", 2);

  const message = buildMessage({
    from,
    recipients,
    subject,
    body: payload.body,
    taskType: payload.taskType ?? "copilot-task",
    source: payload.source,
    metadata: payload.metadata,
  });

  try {
    await sendSmtp({ host, port, user, pass, from, recipients, message });
  } catch (err) {
    fail(3, err.message);
  }
  console.log(`Sent task email to ${recipients.length} recipient(s) [${recipients.map(redact).join(", ")}] via ${host}:${port}.`);
}

main().catch((err) => fail(3, err.message));
