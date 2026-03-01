# MCP Gateway

Node.js gateway that exposes [downdetector-mcp](https://github.com/domdomegg/downdetector-mcp), [shopify-mcp](https://github.com/GeLi2001/shopify-mcp), and [playwright-mcp](https://github.com/microsoft/playwright-mcp) over HTTP for use on Digital Ocean App Platform.

## Features

- **API key protection**: Set `API_KEY` to require `X-API-Key` or `Authorization: Bearer` on all requests except `GET /health`.
- **Health**: `GET /health` returns `{ "status": "ok", "timestamp": "..." }`.
- **MCP endpoints**: `POST /mcp/downdetector`, `POST /mcp/shopify`, `POST /mcp/playwright` — send JSON-RPC body; respond with `application/json` or `text/event-stream` (SSE) per `Accept` header.
- **Warm-up**: On startup, spawns all three MCP servers and sends `initialize` + `initialized`.
- **Keep-alive**: Every 4 minutes sends `tools/list` to each server to reduce timeouts.

## Local

```bash
npm install
npm run build
npm start
```

Optional: `API_KEY`, `PORT` (default 8080), `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `MYSHOPIFY_DOMAIN` for shopify-mcp.

## Docker

```bash
docker build -t mcp-gateway .
docker run -p 8080:8080 -e PORT=8080 mcp-gateway
```

## Digital Ocean App Platform

Use `app.yaml` (set `github.repo` to your repo). Health check uses `GET /health` on port 8080.
