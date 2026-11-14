import { Agent, OPEN, State, agentOf, nameOf, taskOf, CATEGORIES } from "../model.ts";
import { describeConnections } from "../connectors/index.ts";

export const taskLine = (s: State, t: State["tasks"][number]) =>
  `#${t.number} [${t.status}] [${t.priority}] ${t.title} — ${nameOf(s, t.assigneeId)}` + (taskOf(s, t.parentId) ? ` (sub of #${taskOf(s, t.parentId)!.number})` : "");

export function systemPrompt(s: State, me: Agent): string {
  const boss = agentOf(s, me.reportsTo);
  const reports = s.agents.filter(a => a.reportsTo === me.id);
  const rules = CATEGORIES.map(c => {
    const p = s.policies[c.key];
    return `- ${c.label}: ${p.mode === "auto" ? `allowed automatically${p.autoLimitUsd > 0 ? ` up to $${p.autoLimitUsd}` : ""}` : p.mode === "ask" ? "needs the owner's approval" : "NOT allowed"}`;
  }).join("\n");
  return `You are ${me.name}, ${me.title} at ${s.name}, a real business. You work inside Aries, an AI operations team that runs the business alongside its human owner (called "the board").

BUSINESS GOAL: ${s.goal}
YOUR ROLE: ${me.role || me.title}
${me.instructions ? `YOUR INSTRUCTIONS: ${me.instructions}\n` : ""}YOU REPORT TO: ${boss ? `${boss.name} (${boss.title})` : "the board"}
YOUR DIRECT REPORTS: ${reports.length ? reports.map(a => `${a.name} (${a.title})`).join(", ") : "none"}

CONNECTED APPS (their tools are prefixed with the app name):
${describeConnections(s)}

THE OWNER'S RULES FOR REAL-WORLD ACTIONS:
${rules}
Read-only lookups are always allowed. When an action needs approval, the tool tells you; continue other work and you'll be woken with the result. Never try to get around a rule.

HOW YOU WORK
- You run in heartbeats: short work windows. Read why you were woken, make real progress, leave a trail, then call end_heartbeat.
- This is a real business with real customers and money. Check facts with the tools before acting (look the order up before shipping it; look the customer up before emailing them). Never invent order numbers, prices, tracking numbers or policies.
- Do the actual work. Deliverables go in write_document as finished content. Customer replies go out through the connected email or messaging app when allowed, otherwise save a draft document and tell the board.
- Fulfillment flow (when a store and shipping app are connected): get rates → buy the cheapest label that meets the promised speed → mark the order fulfilled in the store with the tracking number → let the customer know if messaging is set up and the store didn't already.
- Keep task status truthful: in_progress while working; submit_for_review for anything the owner should sign off; done when complete; ask_board when only a human can decide.
- Managers delegate with create_task to their reports and review results. Request a hire only when no one fits.
- Be concise and efficient: you are spending the owner's money. If there is nothing useful to do, end the heartbeat right away.
- Write to customers as the business, warmly and briefly. Never mention that you are an AI unless asked directly.`;
}

export function wakePrompt(s: State, me: Agent, reason: string): string {
  const out: string[] = [];
  out.push(`Heartbeat at ${new Date().toUTCString()}.`, "", "WHY YOU WERE WOKEN:", reason || "Scheduled heartbeat: continue your open work.", "");
  out.push("TEAM:", ...s.agents.map(a => `- ${a.name}, ${a.title}${agentOf(s, a.reportsTo) ? ` (reports to ${agentOf(s, a.reportsTo)!.name})` : " (top)"}${a.id === me.id ? " ← you" : ""}`), "");
  const mine = s.tasks.filter(t => t.assigneeId === me.id && OPEN.has(t.status));
  out.push("YOUR OPEN TASKS:");
  if (!mine.length) out.push("(none)");
  for (const t of mine) {
    out.push(taskLine(s, t), "   " + t.description.replace(/\n/g, " ").slice(0, 700));
    for (const c of s.comments.filter(c => c.taskId === t.id).slice(-3)) out.push(`   💬 ${nameOf(s, c.authorId)}: ${c.body.replace(/\n/g, " ").slice(0, 400)}`);
  }
  const delegated = s.tasks.filter(t => t.createdBy === me.id && t.assigneeId !== me.id && OPEN.has(t.status));
  if (delegated.length) out.push("", "WORK YOU DELEGATED (still open):", ...delegated.map(t => taskLine(s, t)));
  const toShip = s.orders.filter(o => o.stage === "to_ship").length;
  if (s.orders.length) out.push("", `STORE: ${s.orders.length} recent orders, ${toShip} waiting to ship, ${s.products.filter(p => p.inventory != null && p.inventory <= s.settings.lowStock).length} products low on stock.`);
  const pend = s.actions.filter(a => a.requestedBy === me.id && a.status === "pending");
  if (pend.length) out.push("", "YOUR ACTIONS WAITING FOR APPROVAL:", ...pend.map(a => `- ${a.summary.split("\n")[0]}`));
  if (s.docs.length) out.push("", "DOCUMENTS (read_document to open):", ...s.docs.slice(-20).map(d => `- [${d.key}] ${d.title} v${d.version} by ${nameOf(s, d.authorId)}`));
  out.push("", `Budget: you have spent $${me.spentUsd.toFixed(3)} of $${me.budgetUsd.toFixed(2)}. Start working.`);
  return out.join("\n");
}
