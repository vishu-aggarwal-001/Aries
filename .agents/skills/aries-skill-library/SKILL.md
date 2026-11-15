---
name: aries-skill-library
description: "Router for the Aries skill library (Vishu Aggarwal's AI-crew-for-businesses app): running, using, managing, building, testing and releasing Aries, and acting as any Aries crew agent. Use for any Aries task."
---

# Aries skill library

Aries (github.com/vishu-aggarwal-001/Aries, public) is an AI operations crew for any business, built by Vishu Aggarwal and sold as a subscription. Owners set a goal and connect their apps (Shopify, WooCommerce, Stripe, Shippo, email, webhooks, any MCP server or REST API); a crew of Claude agents does the work, and every real-world action follows the owner's rules (do it / ask me / never, with $ limits). Stack: Node 22 + TypeScript + Hono + Postgres server, React 19 + Vite web app (PWA), Kotlin WebView Android app.

## Step 1: pick the right reference, then read it in full
Open the matching file in this skill's `references/` folder. Several can apply to one task; read all that fit before answering. Prefer the most specific one.

| File | Use when |
|---|---|
| 01-overview.md | What Aries is, repo layout, architecture, core ideas (business JSON state, secrets, heartbeats, the gate, approvals, models) |
| 02-run-and-deploy.md | Run the demo, dev setup, Docker/hosting, every environment variable, plans and pricing, scaling notes |
| 03-owner-guide.md | Using Aries as a business owner: templates and crews, screens, rules and defaults, settings, members |
| 04-crew-roles.md | Every AI agent's job guide (Ada CEO, Otto Ops, June Support, Max Marketing, Mira Merch, Sol Sales, Linus CTO, Sage, Quill, Echo) and the rules all agents follow |
| 05-agent-runtime.md | Engine scheduler, wake triggers, system/wake prompts, internal tools, the gate, customizing agents |
| 06-connectors.md | Built-in connectors and their tools, security/SSRF rules, how to add a new connector |
| 07-api-reference.md | Every HTTP route |
| 08-testing.md | Running tests, what's covered, fake fetch/fake Claude, writing a new test |
| 09-android-and-web.md | Web app structure and PWA, Android build, signing, Play rules |
| 10-launch.md | Launch checklist (legal, keys, hosting, Play, pricing) and how to release a new version |

If the person shares the repo (zip, link or files), treat it as the source of truth over these notes, since the code may have changed. Read code before suggesting edits to it; give complete, drop-in code with the file path.

## Step 2: match the request
- **"How do I run / host / deploy / set up keys?"** → 02 (+ 10 for launch).
- **"How do I use it / what does this screen or rule do?"** → 03.
- **"Act as / improve / write instructions for an agent"** → 04, and 05 for how agents actually run.
- **"Why didn't my agent do X / it's stuck / an action is waiting"** → 05 (wake triggers, gate, budget, billing credit, paused, turn limit), then 03 Rules.
- **"Add an integration / connect app X"** → 06.
- **"Add a feature / change the code"** → 01 for where things live, then the matching file; add tests per 08.
- **"Is it ready to sell / launch / release a new version / publish to Play"** → 10 and 09.

## Ground rules
- Agents act on real businesses with real money and customers. Never suggest weakening the gate, skipping approvals, or letting agents see credentials.
- Never put API keys, `SECRET_KEY`, `JWT_SECRET` or customer data into chats, docs, commits or logs. `SECRET_KEY` must never change after launch.
- Customer-supplied URLs must go through `assertPublicUrl` (SSRF protection).
- Before anything irreversible or external (deploying, publishing to Play, charging customers, sending email, changing a live store), say what will happen and get the person's OK.
- Legal and pricing points are checklists, not legal or financial advice.
- Keep answers practical: exact commands, file paths, and finished code.
