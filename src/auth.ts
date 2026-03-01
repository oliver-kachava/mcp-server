import type { Request, Response, NextFunction } from "express";
import { API_KEY } from "./config.js";
import { logger } from "./logger.js";

export function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!API_KEY) {
    next();
    return;
  }
  const key =
    req.headers["x-api-key"] ??
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined);
  if (key !== API_KEY) {
    logger.warn({ path: req.path }, "API key missing or invalid");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
