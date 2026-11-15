# Running, deploying and configuring Aries

## Local demo (no keys needed)
```bash
cd web && npm install && npx vite build
cd ../server && npm install && npm run demo
# open http://localhost:8787 — sign in with demo@aries.app / demo-password
```
The demo fakes a Shopify store (22 orders of clarinet accessories), Shippo and email, and scripts the agents with a fake Claude, so every screen can be clicked through for free.

## Dev
- Server with reload: `cd server && npm run dev` (tsx watch). Without `DATABASE_URL` it uses embedded PGlite in `./data`.
- Web dev server: `cd web && npm run dev` (Vite). Production build: `npm run build` (typechecks, then builds to `web/dist`, which the server serves).
- Typecheck server: `cd server && npm run typecheck`.
- Missing `JWT_SECRET` / `SECRET_KEY` prints a warning and uses insecure dev defaults; missing `ANTHROPIC_API_KEY` means agents can't run.

## Production
1. `cp .env.example .env` and fill it in.
2. `npm start` in `server/`, or `docker compose up` (app on port 8787 + Postgres 16), or deploy the Dockerfile to Fly.io / Render / Railway with managed Postgres and daily backups.
3. HTTPS only. Health check: `GET /api/health`.

## Environment variables
| Variable | Required | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | The owner's (Vishu's) key; every customer's agents run on it. |
| `JWT_SECRET` | yes | Signs login sessions. |
| `SECRET_KEY` | yes | Encrypts customers' connection credentials. **Never change after launch** or stored credentials can't be decrypted. |
| `PUBLIC_URL` | yes | Where the app is served, e.g. `https://app.yourdomain.com`. |
| `DATABASE_URL` | yes in prod | `postgres://…`, or a folder path for embedded Postgres in dev. `PGSSL=off` disables SSL (compose sets it). |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | to sell plans | Vishu's Stripe account. Webhook endpoint: `$PUBLIC_URL/api/stripe/webhook`. |
| `STRIPE_PRICE_STARTER/GROWTH/SCALE` | to sell plans | Stripe price IDs for each plan. |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_API_VERSION` | for one-click Shopify | Shopify Partner app. Redirect URL `$PUBLIC_URL/api/oauth/shopify/callback`. Version default `2026-07`. |
| `MAX_CONCURRENT_RUNS` | no (8) | Agent check-ins running at once across all customers. |
| `WEB_SEARCH` | no (0) | `1` lets agents search the web (billed per search, max 3 per turn). |
| `PRICES` | no | JSON override of $/million tokens, e.g. `{"claude-sonnet-5-5":[2,10]}`. |
| `ANTHROPIC_BASE_URL` | no | Alternate API endpoint. |
| `ALLOW_HTTP_CONNECTORS` | no | `1` allows plain http:// connector URLs (testing only). |
| `PORT`, `WEB_DIST` | no | Port (8787) and built web folder. |

## Plans (server/src/plans.ts)
| Plan | Price/mo | AI credit/mo (Aries's cost cap) | Agents | Businesses |
|---|---|---|---|---|
| Free trial (14 days) | $0 | $3 | 4 | 1 |
| Starter | $49 | $15 | 5 | 1 |
| Growth | $149 | $55 | 12 | 2 |
| Scale | $399 | $170 | 40 | 5 |
A business is inactive when its trial/subscription has lapsed or the month's AI credit is used up; the crew pauses. Periods are 30 days. Checkout and the customer portal go through Stripe (`/billing/checkout`, `/billing/portal`). Model prices used for metering are in `server/src/engine/claude.ts` (`RATES`).

## Scaling notes
Before many customers: move agent runs to a separate worker process, and split big businesses' data out of the single JSON document into tables. Engine defaults: ticks every 15 s, 2 concurrent runs per business, 16 turns per heartbeat.
