import type { Repo } from "../db.ts";
import {
  Agent, MODEL_LIST, State, STATUSES, addComment, agentByRef, createTask, nameOf, newId, orderByRef, requestApproval,
  taskByRef, updateTask, writeDoc, OPEN, now,
} from "../model.ts";
import { boundTools, describeConnections, type Connections } from "../connectors/index.ts";
import { obj, str, num } from "../connectors/base.ts";
import { taskLine } from "./prompts.ts";

export class EndHeartbeat extends Error { constructor(public summary: string) { super("end"); } }

const PRIO = ["low", "medium", "high", "urgent"];
const STAGES = ["new", "to_ship", "shipped", "delivered", "cancelled"];

export const INTERNAL_TOOLS = [
  { name: "list_tasks", description: "List tasks. Filter by status and/or assignee name ('me').", input_schema: obj({ status: str("Status", { enum: [...STATUSES] }), assignee: str("Agent name or 'me'") }) },
  { name: "get_task", description: "Full task details: description, comments, subtasks, documents, linked order.", input_schema: obj({ task: str("Task number like 12") }, ["task"]) },
  {
    name: "update_task", description: "Change a task's status, assignee or priority, optionally with a progress comment.",
    input_schema: obj({ task: str("Task number"), status: str("New status", { enum: [...STATUSES] }), assignee: str("Agent name"), priority: str("Priority", { enum: PRIO }), comment: str("Comment explaining the change") }, ["task"]),
  },
  { name: "add_comment", description: "Comment on a task. @Name notifies a colleague.", input_schema: obj({ task: str("Task number"), body: str("Markdown") }, ["task", "body"]) },
  {
    name: "create_task", description: "Create a task (usually delegating to a report). The assignee is woken automatically.",
    input_schema: obj({ title: str("Short imperative title"), description: str("What done looks like"), assignee: str("Agent name (default yourself)"), parent: str("Parent task number"), priority: str("Priority", { enum: PRIO }), order: str("Related order number") }, ["title", "description"]),
  },
  { name: "write_document", description: "Save a finished deliverable (markdown) on a task. Same key again = new version.", input_schema: obj({ task: str("Task number"), key: str("Short slug"), title: str("Title"), content: str("Full markdown") }, ["task", "key", "title", "content"]) },
  { name: "read_document", description: "Read a document by key or title.", input_schema: obj({ ref: str("Key or title") }, ["ref"]) },
  { name: "submit_for_review", description: "Put a task in review and ask the owner to approve the deliverable.", input_schema: obj({ task: str("Task number"), summary: str("What to check") }, ["task", "summary"]) },
  { name: "ask_board", description: "Ask the owner a blocking question; the task becomes blocked until they answer.", input_schema: obj({ task: str("Task number"), question: str("Specific question, with options") }, ["question"]) },
  {
    name: "request_hire", description: "Propose a new AI teammate. The owner approves.",
    input_schema: obj({ name: str("First name"), title: str("Job title"), role: str("Responsibilities"), instructions: str("Working instructions"), reason: str("Why now"), model: str("Model", { enum: MODEL_LIST }), budget_usd: num("Budget USD"), emoji: str("One emoji") }, ["name", "title", "role", "reason"]),
  },
  { name: "list_connections", description: "Which apps are connected and their status.", input_schema: obj({}) },
  { name: "list_orders", description: "Orders across all connected stores and manual orders, newest first.", input_schema: obj({ stage: str("Filter", { enum: STAGES }), search: str("Customer name, email, item or order number") }) },
  { name: "get_order", description: "One order: items, address, totals, tracking, notes, related tasks.", input_schema: obj({ order: str("Order number") }, ["order"]) },
  {
    name: "set_order_stage", description: "Update Aries's record of an order (for manual orders, or bookkeeping after you did the real action through an app). Does not change the external store.",
    input_schema: obj({ order: str("Order number"), stage: str("Stage", { enum: STAGES }), carrier: str("Carrier"), tracking_number: str("Tracking number"), note: str("Internal note") }, ["order"]),
  },
  { name: "list_products", description: "Products and stock levels.", input_schema: obj({ low_stock_only: { type: "boolean" }, search: str("Search text") }) },
  { name: "end_heartbeat", description: "Finish with a one-paragraph summary of what you did and what's next.", input_schema: obj({ summary: str("Summary for the owner") }, ["summary"]) },
];

export function toolDefinitions(s: State, webSearch: boolean) {
  const conn = boundTools(s).map(b => ({ name: b.apiName, description: `[${b.conn.label}${b.spec.category ? ` · needs rule: ${b.spec.category}` : " · read-only"}] ${b.spec.description}`.slice(0, 1024), input_schema: b.spec.input_schema }));
  return [...INTERNAL_TOOLS, ...conn, ...(webSearch ? [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] : [])];
}

export interface Env { repo: Repo; conns: Connections; bid: string; agentId: string; lastTaskId?: string | null }

export async function execTool(env: Env, name: string, input: any): Promise<string> {
  const { repo, bid } = env;
  if (name.includes("__")) return env.conns.invoke(bid, env.agentId, name, input ?? {}, env.lastTaskId);
  const s = (await repo.get(bid))!.state;
  const me = s.agents.find(a => a.id === env.agentId) as Agent;
  const task = () => {
    const t = taskByRef(s, input.task); if (!t) throw new Error(`Unknown task "${input.task}". Use list_tasks.`);
    env.lastTaskId = t.id; return t;
  };
  const who = (ref?: string) => (ref?.toLowerCase() === "me" ? me : agentByRef(s, ref));
  const m = (fn: (s: State) => any) => repo.mutate(bid, fn).then(r => r.result);

  switch (name) {
    case "list_tasks": {
      const wid = input.assignee ? who(input.assignee)?.id ?? "?" : undefined;
      const list = s.tasks.filter(t => (!input.status || t.status === input.status) && (!wid || t.assigneeId === wid) && (input.status || t.status !== "cancelled"))
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
      return list.length ? list.map(t => taskLine(s, t)).join("\n") : "No matching tasks.";
    }
    case "get_task": {
      const t = task(); const o = orderByRef(s, t.orderId ?? undefined) ?? s.orders.find(x => x.id === t.orderId);
      const lines = [taskLine(s, t), `Created by ${nameOf(s, t.createdBy)}`, "", t.description || "(no description)"];
      if (o) lines.push("", `Linked order ${o.number} (${o.stage}) — use get_order for details`);
      const subs = s.tasks.filter(x => x.parentId === t.id); if (subs.length) lines.push("", "Subtasks:", ...subs.map(x => "  " + taskLine(s, x)));
      const docs = s.docs.filter(d => d.taskId === t.id); if (docs.length) lines.push("", "Documents:", ...docs.map(d => `  [${d.key}] ${d.title} v${d.version}`));
      const cm = s.comments.filter(c => c.taskId === t.id).slice(-15); if (cm.length) lines.push("", "Comments:", ...cm.map(c => `- ${nameOf(s, c.authorId)}: ${c.body.slice(0, 1200)}`));
      return lines.join("\n");
    }
    case "update_task": {
      const t = task(); const a = input.assignee ? who(input.assignee) : undefined;
      if (input.assignee && !a) throw new Error(`No teammate named ${input.assignee}`);
      await m(d => { updateTask(d, t.id, me.id, { status: input.status, assigneeId: a ? a.id : undefined, priority: input.priority }); if (input.comment) addComment(d, t.id, me.id, input.comment); });
      return `Updated #${t.number}.`;
    }
    case "add_comment": { const t = task(); await m(d => addComment(d, t.id, me.id, input.body ?? "")); return `Commented on #${t.number}.`; }
    case "create_task": {
      const a = input.assignee ? who(input.assignee) : me;
      if (!a) throw new Error(`No teammate named ${input.assignee}. Team: ${s.agents.map(x => x.name).join(", ")}`);
      const parent = input.parent ? taskByRef(s, input.parent) : undefined; const o = input.order ? orderByRef(s, input.order) : undefined;
      const t = await m(d => createTask(d, { title: input.title ?? "Untitled", description: input.description ?? "", assigneeId: a.id, parentId: parent?.id, priority: input.priority, createdBy: me.id, orderId: o?.id }));
      return `Created #${t.number} for ${a.name}.`;
    }
    case "write_document": { const t = task(); await m(d => writeDoc(d, t.id, input.key ?? "doc", input.title ?? "Document", input.content ?? "", me.id)); return `Saved on #${t.number}.`; }
    case "read_document": {
      const r = String(input.ref ?? "").toLowerCase();
      const d = [...s.docs].reverse().find(x => x.key.toLowerCase() === r || x.title.toLowerCase() === r) ?? [...s.docs].reverse().find(x => x.title.toLowerCase().includes(r));
      return d ? `# ${d.title} (v${d.version}, by ${nameOf(s, d.authorId)})\n\n${d.body.slice(0, 20000)}` : `No document "${input.ref}". Documents: ${s.docs.map(x => x.title).join(", ")}`;
    }
    case "submit_for_review": {
      const t = task();
      await m(d => { updateTask(d, t.id, me.id, { status: "in_review" }); requestApproval(d, { type: "review", title: `Review #${t.number}: ${t.title}`, body: input.summary ?? "", requestedBy: me.id, taskId: t.id }); });
      return `Submitted #${t.number} for review. Don't keep working on it until the owner responds.`;
    }
    case "ask_board": {
      const t = input.task ? taskByRef(s, input.task) : undefined;
      await m(d => { if (t) updateTask(d, t.id, me.id, { status: "blocked" }); requestApproval(d, { type: "question", title: `${me.name} asks${t ? ` on #${t.number}` : ""}`, body: input.question ?? "", requestedBy: me.id, taskId: t?.id ?? null }); });
      return "Question sent to the owner. You'll be woken with the answer.";
    }
    case "request_hire": {
      const hire: Agent = {
        id: newId(), name: input.name, title: input.title, role: input.role ?? "", instructions: input.instructions ?? "", reportsTo: me.id,
        model: MODEL_LIST.includes(input.model) ? input.model : "claude-haiku-5-5", budgetUsd: Number(input.budget_usd) || 3, spentUsd: 0, heartbeatMin: 45,
        paused: false, lastHeartbeat: 0, wake: false, wakeReason: "", emoji: input.emoji ?? "🤖", hue: (s.agents.length * 71 + 20) % 360, runs: 0, tasksDone: 0, createdAt: now(),
      };
      await m(d => requestApproval(d, { type: "hire", title: `Hire ${hire.name}, ${hire.title}`, body: input.reason ?? "", requestedBy: me.id, hire }));
      return "Hire request sent to the owner.";
    }
    case "list_connections": return describeConnections(s);
    case "list_orders": {
      const q = String(input.search ?? "").toLowerCase();
      const list = s.orders.filter(o => (!input.stage || o.stage === input.stage) && (!q || `${o.number} ${o.customer.name} ${o.customer.email} ${o.items.map(i => i.title).join(" ")}`.toLowerCase().includes(q))).slice(0, 40);
      return list.length ? list.map(o => `${o.number} [${o.stage}] ${o.total.toFixed(2)} ${o.currency} ${o.paid ? "paid" : "UNPAID"} — ${o.customer.name} — ${o.items.map(i => `${i.qty}× ${i.title}`).join(", ")} — ${new Date(o.createdAt).toISOString().slice(0, 10)} — ${s.connections.find(c => c.id === o.connectionId)?.label ?? "manual"}`).join("\n") : "No matching orders.";
    }
    case "get_order": {
      const o = orderByRef(s, input.order); if (!o) throw new Error(`No order "${input.order}"`);
      const related = s.tasks.filter(t => t.orderId === o.id).map(t => taskLine(s, t));
      return JSON.stringify({ ...o, source: s.connections.find(c => c.id === o.connectionId)?.label ?? "manual", relatedTasks: related }, null, 1);
    }
    case "set_order_stage": {
      const o = orderByRef(s, input.order); if (!o) throw new Error(`No order "${input.order}"`);
      await m(d => {
        const x = d.orders.find(y => y.id === o.id)!;
        if (input.stage && STAGES.includes(input.stage)) x.stage = input.stage;
        if (input.tracking_number) x.tracking = { ...(x.tracking ?? {}), carrier: input.carrier ?? x.tracking?.carrier ?? "", number: input.tracking_number };
        if (input.note) x.note = ((x.note ? x.note + "\n" : "") + `${me.name}: ${input.note}`).slice(-2000);
      });
      return `Order ${o.number} updated in Aries.`;
    }
    case "list_products": {
      const q = String(input.search ?? "").toLowerCase();
      const list = s.products.filter(p => (!input.low_stock_only || (p.inventory != null && p.inventory <= s.settings.lowStock)) && (!q || `${p.title} ${p.sku}`.toLowerCase().includes(q))).slice(0, 60);
      return list.length ? list.map(p => `${p.title}${p.sku ? ` (${p.sku})` : ""} — ${p.price.toFixed(2)} ${p.currency} — stock ${p.inventory ?? "untracked"} — ${p.status}`).join("\n") : "No products.";
    }
    case "end_heartbeat": throw new EndHeartbeat(input.summary ?? "");
  }
  throw new Error("Unknown tool " + name);
}

export const openTaskCount = (s: State, id: string) => s.tasks.filter(t => t.assigneeId === id && OPEN.has(t.status)).length;
