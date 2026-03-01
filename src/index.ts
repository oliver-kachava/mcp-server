import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  getServerIds,
  isValidServerId,
  KEEPALIVE_INTERVAL_MS,
  PORT,
} from "./config.js";
import { apiKeyMiddleware } from "./auth.js";
import { healthHandler } from "./health.js";
import { getBridge } from "./bridge.js";
import { logger } from "./logger.js";

const app = express();

app.use(express.json({ type: ["application/json"] }));
app.use((req, _res, next) => {
  (req as Request & { requestId: string }).requestId = randomUUID();
  next();
});

app.get("/health", healthHandler);

app.use(apiKeyMiddleware);

app.post("/mcp/:server", async (req: Request, res: Response) => {
  const serverId = req.params.server;
  const requestId = (req as Request & { requestId: string }).requestId;

  if (!isValidServerId(serverId)) {
    logger.warn({ requestId, server: serverId }, "Invalid MCP server id");
    res.status(400).json({ error: "Invalid server", server: serverId });
    return;
  }

  const body = req.body;
  if (body === undefined || body === null) {
    res.status(400).json({ error: "Missing request body" });
    return;
  }

  const acceptSSE =
    req.headers.accept?.toLowerCase().includes("text/event-stream") ?? false;

  const bridge = getBridge(serverId);

  try {
    if (acceptSSE) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      await bridge.request(body, true, res);
    } else {
      const payload = await bridge.request(body, false);
      res.setHeader("Content-Type", "application/json");
      res.status(200).send(payload);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("timeout");
    logger.error(
      { err, requestId, server: serverId },
      "MCP bridge request failed"
    );
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? "Gateway Timeout" : "Internal Server Error",
      message,
    });
  }
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "MCP gateway listening");
  warmUp();
  startKeepAlive();
});

async function warmUp(): Promise<void> {
  const ids = getServerIds();
  for (const serverId of ids) {
    try {
      const bridge = getBridge(serverId);
      bridge.getChild();
      const initReq = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "initialize" as const,
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mcp-gateway", version: "1.0.0" },
        },
      };
      await bridge.request(initReq, false);
      const initializedReq = {
        jsonrpc: "2.0" as const,
        method: "notifications/initialized" as const,
      };
      bridge.getChild().stdin?.write(JSON.stringify(initializedReq) + "\n");
      logger.info({ server: serverId }, "MCP server warmed up");
    } catch (err) {
      logger.warn({ err, server: serverId }, "MCP warm-up failed (non-fatal)");
    }
  }
}

function startKeepAlive(): void {
  setInterval(() => {
    const ids = getServerIds();
    for (const serverId of ids) {
      getBridge(serverId)
        .request(
          {
            jsonrpc: "2.0",
            id: "keepalive",
            method: "tools/list",
          },
          false
        )
        .catch((err) => {
          logger.debug({ err, server: serverId }, "Keep-alive request failed");
        });
    }
  }, KEEPALIVE_INTERVAL_MS);
  logger.info(
    { intervalMs: KEEPALIVE_INTERVAL_MS },
    "Keep-alive interval started"
  );
}

process.on("SIGTERM", () => {
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
