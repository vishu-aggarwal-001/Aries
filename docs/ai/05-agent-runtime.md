# The agent runtime (engine, prompts, tools, gate)

## Scheduler (server/src/engine/engine.ts)
- `engine.start()` ticks every 15 s. An agent is due when it has a wake flag, or it has open work and `heartbeatMin` minutes passed since its last heartbeat.
- Limits: `MAX_CONCURRENT_RUNS` (default 8) overall, 2 per business, 16 turns per heartbeat. Near the limit the agent is told to save progress and call `end_heartbeat`.
- `heartbeat(bid, agentId, reason)` can be called directly ("Run now" → `POST /api/b/:bid/agents/:id/run`).
- Paused agents, inactive billing, and agents over budget don't run. Spend is metered per run from token usage × `RATES` and added to the agent's `spentUsd` and the business's monthly usage.

## Wake triggers
A task assigned or created for the agent, a comment on its task or an @mention, a subtask or delegated task finished, a task moved back to To-do, an approval/question/hire decided, a new app connected (wakes the top agent), new orders and low stock (when auto order tasks are on), a routine due, a shared customer message.

## Prompts (server/src/engine/prompts.ts)
- **System prompt**: who you are (name, title, business), the business goal, your role and instructions, who you report to and your reports, connected apps (tool prefixes), the owner's rules per category, and HOW YOU WORK rules: heartbeats, verify facts before acting, do real work, the fulfillment flow, truthful task status, delegate, be concise, write to customers warmly and don't say you're an AI unless asked. Cached with `cache_control: ephemeral`.
- **Wake prompt**: time, why you were woken, the team, your open tasks with the last 3 comments each, work you delegated, store summary (orders, to ship, low stock), your actions awaiting approval, the last 20 documents, your budget.

## Internal tools (server/src/engine/tools.ts)
`list_tasks`, `get_task`, `update_task`, `add_comment`, `create_task`, `write_document`, `read_document`, `submit_for_review`, `ask_board`, `request_hire`, `list_connections`, `list_orders`, `get_order`, `set_order_stage`, `list_products`, `end_heartbeat`, plus `web_search` when `WEB_SEARCH=1`.

Task statuses: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`. Order stages include `to_ship` and fulfilled stages.

## Connector tools
Every connected app's tools are exposed as `<slug>__<tool>` (e.g. `shopify__fulfill_order`, `shippo__buy_label`; a second Shopify would be `shopify2__…`). Names are cleaned to `[a-zA-Z0-9_-]` and max 64 chars.

## The gate (server/src/connectors/index.ts)
For each connector tool call:
1. `category: null` → read-only → runs now.
2. Otherwise look up the business policy for that category:
   - `never` → blocked, recorded in the ledger.
   - `auto` and amount ≤ `autoLimitUsd` → runs, recorded. (With a $0 limit, actions that cost nothing run and anything costing money waits.) Actions the owner triggers directly always run.
   - else → an `action` approval goes to the Inbox; the agent continues other work and is woken with the result after the owner decides.
3. Results can patch State (e.g. order marked fulfilled, tracking added).

## Customizing an agent's behavior
Edit `role` and `instructions` on the Crew screen (or `PATCH /api/b/:bid/agents/:id`). Changing default seats for new businesses: `server/src/templates.ts`. Changing rules every agent follows: `systemPrompt()` in `prompts.ts`. Adding an internal tool: add to `INTERNAL_TOOLS` in `tools.ts` and handle it in the tool executor, then cover it in tests.
