# Aries

An AI operations crew for any business. Owners describe the goal, connect the apps the business runs on,
and a team of Claude agents (CEO, operations, support, marketing, merchandising…) does the work:
ships orders, answers customers, updates listings, writes plans and reports. Anything that spends money,
messages a customer or changes the store follows the owner's rules (do it / ask me / never, with $ limits).

Inspired by the open-source Paperclip project (MIT, github.com/paperclipai/paperclip).

## What's in here

| Folder | What it is |
|---|---|
| `server/` | Node + TypeScript API, the 24/7 agent engine, connectors, billing. Postgres (or embedded Postgres for dev). |
| `web/` | React web app, mobile-first. Served by the server. Installable as a PWA with a share target. |
| `android/` | Android app: native shell around the web app with "Send to Aries" in the share sheet. |

## Run it locally (no keys needed)

```bash
cd web && npm install && npx vite build
cd ../server && npm install && npm run demo
# open http://localhost:8787  — sign in with demo@aries.app / demo-password
```
The demo simulates a Shopify store, Shippo and email, and scripts the agents, so you can click through everything.

For real use: copy `.env.example` to `.env`, fill it in, then `npm start` (or `docker compose up`).

## Tests

```bash
cd server && npm test     # end-to-end: accounts, tenancy, Shopify sync, ship-with-approval, rules, MCP, SSRF, billing
```

## How it works

- **Businesses** are stored as one JSON document each, changed through pure functions in `server/src/model.ts`
  with optimistic locking. Connection credentials live in a separate table, AES-256-GCM encrypted, and never reach clients or agents.
- **Agents** wake on a schedule or when something happens (new order, comment, approval, subtask done). Each
  check-in is a Claude tool-use loop (`server/src/engine/engine.ts`) with internal tools (tasks, documents, orders,
  hiring) plus every tool of every connected app.
- **The gate** (`server/src/connectors/index.ts`) sits between agents and the outside world. Read-only tools run
  immediately; writes are recorded in the ledger and either run (auto, under the $ limit), wait in the owner's
  inbox, or are blocked.
- **Connectors**: Shopify (OAuth or token), WooCommerce, Stripe, Shippo, email (Resend), Zapier/Make webhooks,
  any MCP server, any REST API. Add one by implementing `ConnectorDef` in `server/src/connectors/`.
- **Billing**: plans in `server/src/plans.ts` (price and monthly AI allowance), Stripe Checkout + webhook,
  per-business usage metering with a hard stop.

## Android

```bash
cd android && ./gradlew assembleRelease -PariesUrl=https://app.yourdomain.com
```
Without `-PariesUrl` the app asks for a server address on first launch (handy for testing).

## AI skill library

Skill files that teach any AI (Claude, ChatGPT, Gemini, Grok, Perplexity, Mistral, Copilot, Cursor, Codex and more) how to run, use, build and release Aries: see [`ai-skills/`](ai-skills/README.md).
