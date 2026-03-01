import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Response } from "express";
import type { ServerId } from "./config.js";
import {
  MCP_SERVERS,
  REQUEST_TIMEOUT_MS,
} from "./config.js";
import { logger } from "./logger.js";

type Pending = {
  requestIds: Set<number | string>;
  responses: string[];
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  acceptSSE: boolean;
  res?: Response;
  timeoutId: ReturnType<typeof setTimeout>;
};

function extractRequestIds(body: unknown): Set<number | string> {
  const ids = new Set<number | string>();
  if (Array.isArray(body)) {
    for (const item of body) {
      if (item != null && typeof item === "object" && "id" in item) {
        ids.add((item as { id: number | string }).id);
      }
    }
  } else if (body != null && typeof body === "object" && "id" in body) {
    ids.add((body as { id: number | string }).id);
  }
  return ids;
}

function isResponse(obj: unknown): obj is { id?: number | string; result?: unknown; error?: unknown } {
  if (obj == null || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return "result" in o || "error" in o;
}

export class StdioBridge {
  private child: ChildProcess | null = null;
  private pending: Pending | null = null;
  private readLoopActive = false;
  private serverId: ServerId;
  private restartBackoffMs = 1000;
  private maxBackoffMs = 30_000;

  constructor(serverId: ServerId) {
    this.serverId = serverId;
  }

  private spawn(): ChildProcess {
    const config = MCP_SERVERS[this.serverId];
    const env = { ...process.env, ...config.env };
    const child = spawn(config.command, config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    child.on("error", (err) => {
      logger.error({ err, server: this.serverId }, "MCP child process error");
      this.scheduleRestart();
    });
    child.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        logger.warn({ code, signal, server: this.serverId }, "MCP child process exited");
      }
      this.child = null;
      if (this.pending) {
        this.pending.reject(new Error(`Process exited with code ${code}`));
        clearTimeout(this.pending.timeoutId);
        this.pending = null;
      }
      this.scheduleRestart();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logger.debug({ server: this.serverId, stderr: chunk.toString() }, "MCP stderr");
    });
    this.child = child;
    this.readLoopActive = true;
    this.startReadLoop();
    return child;
  }

  private scheduleRestart(): void {
    if (this.child) return;
    const delay = this.restartBackoffMs;
    this.restartBackoffMs = Math.min(this.restartBackoffMs * 2, this.maxBackoffMs);
    logger.info({ server: this.serverId, delayMs: delay }, "Scheduling MCP child restart");
    setTimeout(() => {
      this.restartBackoffMs = Math.max(1000, this.restartBackoffMs / 2);
      this.getChild();
    }, delay);
  }

  private startReadLoop(): void {
    if (!this.child?.stdout) return;
    const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!this.pending) return;
      try {
        const obj = JSON.parse(line) as unknown;
        if (isResponse(obj) && obj.id !== undefined && this.pending.requestIds.has(obj.id)) {
          this.pending.requestIds.delete(obj.id);
          this.pending.responses.push(line);
          if (this.pending.acceptSSE && this.pending.res) {
            this.pending.res.write(`data: ${line}\n\n`);
          }
          if (this.pending.requestIds.size === 0) {
            clearTimeout(this.pending.timeoutId);
            if (this.pending.acceptSSE && this.pending.res) {
              this.pending.res.end();
            } else {
              const payload =
                this.pending.responses.length === 1
                  ? this.pending.responses[0]!
                  : `[${this.pending.responses.join(",")}]`;
              this.pending.resolve(payload);
            }
            this.pending = null;
          }
        } else if (this.pending.acceptSSE && this.pending.res) {
          this.pending.res.write(`data: ${line}\n\n`);
        }
      } catch {
        const p = this.pending;
        if (p?.acceptSSE && p.res) {
          p.res.write(`data: ${line}\n\n`);
        }
      }
    });
    rl.on("close", () => {
      this.readLoopActive = false;
    });
  }

  getChild(): ChildProcess {
    if (!this.child) {
      this.spawn();
    }
    return this.child!;
  }

  async request(
    body: unknown,
    acceptSSE: boolean,
    res?: Response
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending === p) {
          this.pending = null;
          reject(new Error("Request timeout"));
        }
      }, REQUEST_TIMEOUT_MS);
      const requestIds = extractRequestIds(body);
      if (requestIds.size === 0) {
        clearTimeout(timeoutId);
        reject(new Error("Request body has no id"));
        return;
      }
      const p: Pending = {
        requestIds: new Set(requestIds),
        responses: [],
        resolve,
        reject,
        acceptSSE,
        res,
        timeoutId,
      };
      this.pending = p;
      const child = this.getChild();
      const line = typeof body === "string" ? body : JSON.stringify(body);
      child.stdin?.write(line + "\n", (err) => {
        if (err) {
          clearTimeout(timeoutId);
          this.pending = null;
          reject(err);
        }
      });
    });
  }
}

const bridges = new Map<ServerId, StdioBridge>();

export function getBridge(serverId: ServerId): StdioBridge {
  let b = bridges.get(serverId);
  if (!b) {
    b = new StdioBridge(serverId);
    bridges.set(serverId, b);
  }
  return b;
}

export function getOrSpawnChild(serverId: ServerId): ChildProcess {
  return getBridge(serverId).getChild();
}
