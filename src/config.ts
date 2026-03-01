export const PORT = Number(process.env.PORT) || 8080;
export const API_KEY = process.env.API_KEY ?? "";
export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 60_000;
export const KEEPALIVE_INTERVAL_MS = Number(process.env.KEEPALIVE_INTERVAL_MS) || 4 * 60 * 1000; // 4 min

export type ServerId = "downdetector" | "shopify" | "playwright";

export const MCP_SERVERS: Record<
  ServerId,
  { command: string; args: string[]; env?: NodeJS.ProcessEnv }
> = {
  downdetector: {
    command: "npx",
    args: ["-y", "downdetector-mcp"],
  },
  shopify: {
    command: "npx",
    args: ["-y", "shopify-mcp"],
    env: process.env,
  },
  playwright: {
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    env: process.env,
  },
};

export function getServerIds(): ServerId[] {
  return Object.keys(MCP_SERVERS) as ServerId[];
}

export function isValidServerId(id: string): id is ServerId {
  return id in MCP_SERVERS;
}
