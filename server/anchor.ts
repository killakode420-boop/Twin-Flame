import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as db from "./db";

const ANCHOR_API = "https://api.anchorbrowser.io";
const PROVIDER = "anchor_browser";

type AnchorChallenge = {
  token: string;
  challenge: { prompt: string };
};

type AnchorAccess = {
  api_key: string;
  project_id?: string;
  auth?: { identity_token_required?: boolean };
};

function encryptionKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Application encryption secret is unavailable.");
  return createHash("sha256").update(secret).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decrypt(value: string) {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Stored provider credential is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

function tokenize(expression: string) {
  const tokens = expression.match(/\d+|[()+\-*/]/g) ?? [];
  if (tokens.join("").length !== expression.replace(/\s/g, "").length) throw new Error("Anchor challenge contains unsupported characters.");
  return tokens;
}

function evaluateIntegerExpression(expression: string) {
  const tokens = tokenize(expression);
  let index = 0;
  const peek = () => tokens[index];
  const consume = () => tokens[index++];
  const factor = (): number => {
    const token = consume();
    if (token === "(") {
      const value = expressionParser();
      if (consume() !== ")") throw new Error("Anchor challenge has unmatched parentheses.");
      return value;
    }
    if (token === "-") return -factor();
    if (!token || !/^\d+$/.test(token)) throw new Error("Anchor challenge has an invalid arithmetic token.");
    return Number(token);
  };
  const term = (): number => {
    let value = factor();
    while (peek() === "*" || peek() === "/") {
      const operator = consume();
      const next = factor();
      if (operator === "*") value *= next;
      else {
        if (!next || value % next !== 0) throw new Error("Anchor challenge does not resolve to an integer.");
        value /= next;
      }
    }
    return value;
  };
  const expressionParser = (): number => {
    let value = term();
    while (peek() === "+" || peek() === "-") value = consume() === "+" ? value + term() : value - term();
    return value;
  };
  const value = expressionParser();
  if (index !== tokens.length || !Number.isSafeInteger(value)) throw new Error("Anchor challenge answer is not a safe integer.");
  return value;
}

export function solveAnchorChallenge(prompt: string) {
  const candidates = prompt.match(/[\d\s()+\-*/]{3,}/g) ?? [];
  const expression = candidates.map(item => item.trim()).sort((a, b) => b.length - a.length)[0];
  if (!expression) throw new Error("VV could not identify the required integer expression in the Anchor challenge.");
  return evaluateIntegerExpression(expression);
}

async function anchorFetch<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${ANCHOR_API}${path}`, init);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Anchor Browser request failed with status ${response.status}.`);
  return payload as T;
}

export async function connectAnchorAgent(userId: number, identityToken?: string, identityProvider?: string) {
  await anchorFetch("/v1/agent-access");
  const challenge = await anchorFetch<AnchorChallenge>("/v1/agent-access/challenge");
  const answer = solveAnchorChallenge(challenge.challenge.prompt);
  const access = await anchorFetch<AnchorAccess>("/v1/agent-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: challenge.token, answer, ...(identityToken ? { identity_token: identityToken, ...(identityProvider ? { identity_provider: identityProvider } : {}) } : {}) }),
  });
  if (!access.api_key) throw new Error("Anchor Browser did not return an API key.");
  await db.upsertIntegration({ userId, provider: PROVIDER, apiKeyCiphertext: encrypt(access.api_key), identityTokenCiphertext: identityToken ? encrypt(identityToken) : undefined, providerProjectId: access.project_id });
  return { connected: true, projectId: access.project_id ?? null, identityRequired: access.auth?.identity_token_required ?? false };
}

export async function getAnchorStatus(userId: number) {
  const integration = await db.getIntegration(userId, PROVIDER);
  return { connected: Boolean(integration), projectId: integration?.providerProjectId ?? null };
}

export async function startAnchorSession(userId: number) {
  const integration = await db.getIntegration(userId, PROVIDER);
  if (!integration) throw new Error("Connect Anchor Browser before starting a session.");
  const apiKey = decrypt(integration.apiKeyCiphertext);
  const identityToken = integration.identityTokenCiphertext ? decrypt(integration.identityTokenCiphertext) : undefined;
  const payload = await anchorFetch<{ data: { id: string; live_view_url?: string; cdp_url?: string } }>("/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "anchor-api-key": apiKey, ...(identityToken ? { "anchor-identity-token": identityToken } : {}) },
    body: "{}",
  });
  return { id: payload.data.id, liveViewUrl: payload.data.live_view_url ?? null };
}
