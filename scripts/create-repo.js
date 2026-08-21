#!/usr/bin/env node
/**
 * GalyVverse repo hub — create-repo script.
 *
 * Reads a JSON repo-creation request (file path via argv, or inline JSON via
 * the REPO_REQUEST env var), validates it against the rules mirrored from
 * schemas/repo-request.schema.json, resolves the template registered in
 * hub.config.json, and creates + seeds a repository in the configured GitHub
 * organization via the REST API.
 *
 * Security:
 *  - Token is read ONLY from the HUB_GITHUB_TOKEN environment variable.
 *    It is never logged and never written to disk.
 *  - Repo name is validated against a strict pattern to prevent URL injection.
 *  - All dynamic URL path segments are encodeURIComponent-encoded.
 *
 * Usage:
 *   node scripts/create-repo.js requests/my-app.json
 *   node scripts/create-repo.js requests/my-app.json --dry-run
 *   REPO_REQUEST='{"name":"my-app"}' node scripts/create-repo.js
 *
 * Exit codes:
 *   0 success (or dry run / skipped)
 *   1 invalid request / configuration error
 *   2 missing token
 *   3 GitHub API error
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
const VISIBILITIES = new Set(["private", "public", "internal"]);

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

function loadRequest(argvPath) {
  if (argvPath) {
    return { request: readJson(resolve(ROOT, argvPath), "request file"), origin: argvPath };
  }
  if (process.env.REPO_REQUEST) {
    try {
      return { request: JSON.parse(process.env.REPO_REQUEST), origin: "REPO_REQUEST env var" };
    } catch (err) {
      fail(1, `REPO_REQUEST env var is not valid JSON: ${err.message}`);
    }
  }
  fail(1, "no request provided. Pass a JSON file path or set REPO_REQUEST.");
}

function validateRequest(req) {
  const errors = [];
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return ["request must be a JSON object"];
  }
  if (typeof req.name !== "string" || !NAME_PATTERN.test(req.name)) {
    errors.push(`"name" is required and must match ${NAME_PATTERN} (got ${JSON.stringify(req.name)})`);
  }
  if (req.description !== undefined && (typeof req.description !== "string" || req.description.length > 350)) {
    errors.push('"description" must be a string of at most 350 characters');
  }
  if (req.template !== undefined && typeof req.template !== "string") {
    errors.push('"template" must be a string');
  }
  if (req.visibility !== undefined && !VISIBILITIES.has(req.visibility)) {
    errors.push('"visibility" must be one of private, public, internal');
  }
  if (req.topics !== undefined) {
    if (!Array.isArray(req.topics) || req.topics.length > 20) {
      errors.push('"topics" must be an array of at most 20 items');
    } else {
      for (const t of req.topics) {
        if (typeof t !== "string" || !TOPIC_PATTERN.test(t)) {
          errors.push(`topic ${JSON.stringify(t)} must match ${TOPIC_PATTERN}`);
        }
      }
    }
  }
  if (req.dryRun !== undefined && typeof req.dryRun !== "boolean") {
    errors.push('"dryRun" must be a boolean');
  }
  return errors;
}

async function api(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "galyvverse-repo-hub",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function apiOrFail(method, url, token, body, action) {
  const res = await api(method, url, token, body);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Never echo headers/token; only status and response body.
    fail(3, `${action} failed: ${method} ${url} -> ${res.status} ${text.slice(0, 500)}`);
  }
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRunFlag = args.includes("--dry-run");
  const fileArg = args.find((a) => !a.startsWith("--"));

  const { request, origin } = loadRequest(fileArg);
  const errors = validateRequest(request);
  if (errors.length > 0) {
    fail(1, `invalid request (${origin}):\n  - ${errors.join("\n  - ")}`);
  }

  const config = readJson(resolve(ROOT, "hub.config.json"), "hub.config.json");
  const org = config.organization;
  const apiBase = config.apiBaseUrl || "https://api.github.com";
  const defaults = config.defaults || {};

  const templateId = request.template || defaults.template;
  const templatePath = (config.templates || {})[templateId];
  if (!templatePath) {
    fail(1, `template "${templateId}" is not registered in hub.config.json`);
  }
  const template = readJson(resolve(ROOT, templatePath), `template descriptor "${templateId}"`);
  const files = template.files || {};

  const name = request.name;
  const visibility = request.visibility || defaults.visibility || "private";
  const description = request.description || template.description || "";
  const topics = request.topics || [];
  const dryRun = dryRunFlag || request.dryRun === true;

  const repoUrl = `${apiBase}/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}`;

  console.log(`Request source: ${request.source || "unspecified"} (${origin})`);
  console.log(`Target: ${org}/${name} (visibility=${visibility}, template=${templateId})`);

  if (dryRun) {
    console.log("DRY RUN — no API calls will be made. Planned actions:");
    console.log(`  1. GET  ${repoUrl} (check existence)`);
    console.log(`  2. POST ${apiBase}/orgs/${encodeURIComponent(org)}/repos (create, auto_init=${defaults.auto_init !== false}, default_branch=${defaults.default_branch || "main"})`);
    if (topics.length > 0) {
      console.log(`  3. PUT  ${repoUrl}/topics (${topics.join(", ")})`);
    }
    for (const path of Object.keys(files)) {
      console.log(`  -  PUT  ${repoUrl}/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
    }
    console.log("Dry run complete.");
    return;
  }

  const token = process.env.HUB_GITHUB_TOKEN;
  if (!token) {
    fail(2, "HUB_GITHUB_TOKEN environment variable is not set. Configure the HUB_ORG_TOKEN secret (see docs/repo-hub.md). Never hardcode tokens.");
  }

  // 1. Check existence.
  const existing = await api("GET", repoUrl, token);
  if (existing.status === 200) {
    fail(3, `repository ${org}/${name} already exists — refusing to overwrite.`);
  }
  if (existing.status !== 404) {
    const text = await existing.text().catch(() => "");
    fail(3, `existence check failed: ${existing.status} ${text.slice(0, 500)}`);
  }

  // 2. Create the repository.
  await apiOrFail(
    "POST",
    `${apiBase}/orgs/${encodeURIComponent(org)}/repos`,
    token,
    {
      name,
      description,
      visibility,
      private: visibility !== "public",
      auto_init: defaults.auto_init !== false,
      has_issues: defaults.has_issues !== false,
      has_wiki: defaults.has_wiki === true,
      delete_branch_on_merge: defaults.delete_branch_on_merge !== false,
    },
    "repository creation"
  );
  console.log(`Created ${org}/${name}`);

  // 3. Apply topics.
  if (topics.length > 0) {
    await apiOrFail("PUT", `${repoUrl}/topics`, token, { names: topics }, "applying topics");
    console.log(`Applied topics: ${topics.join(", ")}`);
  }

  // 4. Seed template files.
  const branch = defaults.default_branch || "main";
  for (const [path, content] of Object.entries(files)) {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    await apiOrFail(
      "PUT",
      `${repoUrl}/contents/${encodedPath}`,
      token,
      {
        message: `chore: seed ${path} from template ${templateId}`,
        content: Buffer.from(String(content), "utf8").toString("base64"),
        branch,
      },
      `seeding file ${path}`
    );
    console.log(`Seeded ${path}`);
  }

  console.log(`Done: https://github.com/${org}/${name}`);
}

main().catch((err) => {
  fail(3, err && err.message ? err.message : String(err));
});
