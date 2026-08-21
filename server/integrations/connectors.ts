import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Connectors registry service.
 *
 * Reads the repository-root `connections.json` (the GalyVverse hub registry)
 * and exposes runtime state for every integration and channel: which exist,
 * whether each is configured (env-presence checks only — values are NEVER
 * read into responses), and how they route. This is the runtime surface that
 * "connects all skills and integrations to VV-API".
 */

type RegistryChannel = {
  envVar?: string;
  secret?: string;
  description?: string;
  routing?: string[];
};

type RegistryIntegration = {
  id: string;
  kind?: string;
  description?: string;
  credentialGated?: boolean;
  triggers?: string[];
  channelRouting?: Record<string, string>;
};

type ConnectionsRegistry = {
  repository?: { owner?: string; name?: string; role?: string };
  channels?: Record<string, RegistryChannel>;
  integrations?: RegistryIntegration[];
};

export type ConnectorStatus = {
  id: string;
  kind: string;
  description: string;
  configured: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  triggers: string[];
  channelRouting: Record<string, string>;
};

export type ChannelStatus = {
  id: string;
  envVar: string | null;
  configured: boolean;
  routing: string[];
};

export type ConnectorsState = {
  repository: { owner: string; name: string; role: string };
  channels: ChannelStatus[];
  integrations: ConnectorStatus[];
};

/** Env vars each integration needs to be considered "configured" at runtime. */
const REQUIRED_ENV_BY_INTEGRATION: Record<string, string[]> = {
  "github-repo-hub": ["HUB_GITHUB_TOKEN"],
  copilot: ["HUB_GITHUB_TOKEN"],
  manus: ["MANUS_API_KEY"],
  "anchor-browser": ["JWT_SECRET"],
  firecrawl: ["FIRECRAWL_API_KEY"],
  "vv-api": ["MANUS_API_KEY", "HUB_GITHUB_TOKEN"],
};

const EMAIL_CHANNEL_ENV = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];

function envPresent(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

let cachedRegistry: ConnectionsRegistry | null = null;

export function loadConnectionsRegistry(): ConnectionsRegistry {
  if (cachedRegistry) return cachedRegistry;
  try {
    const raw = readFileSync(join(process.cwd(), "connections.json"), "utf8");
    cachedRegistry = JSON.parse(raw) as ConnectionsRegistry;
  } catch (error) {
    console.warn(
      "[Connectors] Failed to load connections.json; using empty registry:",
      error instanceof Error ? error.message : error,
    );
    cachedRegistry = {};
  }
  return cachedRegistry;
}

/** Test hook: clears the in-process registry cache. */
export function resetConnectionsRegistryCache() {
  cachedRegistry = null;
}

export function getConnectorsState(): ConnectorsState {
  const registry = loadConnectionsRegistry();
  const channels: ChannelStatus[] = Object.entries(registry.channels ?? {}).map(([id, channel]) => {
    const envVar = channel.envVar ?? null;
    const required = envVar ? [envVar, ...EMAIL_CHANNEL_ENV] : EMAIL_CHANNEL_ENV;
    return {
      id,
      envVar,
      configured: required.every(envPresent),
      routing: channel.routing ?? [],
    };
  });
  const integrations: ConnectorStatus[] = (registry.integrations ?? []).map(integration => {
    const requiredEnv = REQUIRED_ENV_BY_INTEGRATION[integration.id] ?? [];
    const missingEnv = requiredEnv.filter(name => !envPresent(name));
    // Integrations with no credential requirements are considered configured.
    return {
      id: integration.id,
      kind: integration.kind ?? "integration",
      description: integration.description ?? "",
      configured: missingEnv.length === 0,
      requiredEnv,
      missingEnv,
      triggers: integration.triggers ?? [],
      channelRouting: integration.channelRouting ?? {},
    };
  });
  return {
    repository: {
      owner: registry.repository?.owner ?? "GalyVverse",
      name: registry.repository?.name ?? "Twin-Flame",
      role: registry.repository?.role ?? "",
    },
    channels,
    integrations,
  };
}
