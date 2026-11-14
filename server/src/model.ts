// Aries business state. One JSON document per business, mutated only through the pure functions below.
import { randomBytes } from "node:crypto";

export const newId = () => randomBytes(5).toString("hex");
export const now = () => Date.now();
export const BOARD = "board";

export const STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof STATUSES)[number];
export const OPEN = new Set<string>(["backlog", "todo", "in_progress", "in_review", "blocked"]);
export const ACTIONABLE = new Set<string>(["todo", "in_progress"]);

export const MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" } as const;
export const MODEL_LIST: string[] = Object.values(MODELS);

export interface Agent {
  id: string; name: string; title: string; role: string; reportsTo: string | null; model: string;
  instructions: string; budgetUsd: number; spentUsd: number; heartbeatMin: number; paused: boolean;
  lastHeartbeat: number; wake: boolean; wakeReason: string; emoji: string; hue: number;
  runs: number; tasksDone: number; createdAt: number;
}
export interface Task {
  id: string; number: number; title: string; description: string; status: TaskStatus; priority: string;
  assigneeId: string | null; parentId: string | null; createdBy: string; createdAt: number; updatedAt: number;
  orderId?: string | null;
}
export interface Comment { id: string; taskId: string; authorId: string; body: string; createdAt: number }
export interface Doc { id: string; taskId: string | null; key: string; title: string; body: string; authorId: string; version: number; updatedAt: number }
export interface Approval {
  id: string; type: "hire" | "review" | "question" | "budget" | "action"; title: string; body: string; requestedBy: string;
  taskId?: string | null; hire?: Agent | null; agentId?: string | null; actionId?: string | null;
  status: "pending" | "approved" | "rejected"; response: string; createdAt: number; resolvedAt: number;
}
export interface Routine { id: string; title: string; description: string; assigneeId: string; everyHours: number; lastRun: number; enabled: boolean }
export interface RunEvent { kind: string; text: string; ts: number }
export interface Run {
  id: string; agentId: string; reason: string; startedAt: number; endedAt: number; status: "running" | "ok" | "error";
  costUsd: number; inTok: number; outTok: number; summary: string; events: RunEvent[];
}
export interface Activity { id: string; actor: string; text: string; taskId?: string | null; ts: number }

// ---- commerce + connections ----
export interface Address { name: string; line1: string; line2?: string; city: string; state: string; zip: string; country: string; phone?: string; email?: string }
export interface Product {
  id: string; connectionId: string | null; extId: string; title: string; sku: string; price: number; currency: string;
  inventory: number | null; status: string; url?: string; variantId?: string; updatedAt: number;
}
export type OrderStage = "new" | "to_ship" | "shipped" | "delivered" | "cancelled";
export interface Order {
  id: string; connectionId: string | null; extId: string; number: string; createdAt: number;
  customer: { name: string; email: string }; shipTo: Address | null;
  items: { title: string; qty: number; sku: string }[]; total: number; currency: string; paid: boolean;
  stage: OrderStage; tracking?: { carrier: string; number: string; url?: string; labelUrl?: string } | null; note?: string;
}
export interface Connection {
  id: string; type: string; label: string; status: "connected" | "error"; error?: string; lastSync: number;
  info: Record<string, string>; tools?: { name: string; description: string; input_schema: any; readOnly: boolean }[];
  createdAt: number;
}
export type Category = "customer_message" | "spend" | "refund" | "store_update" | "external_write" | "payment_link";
export const CATEGORIES: { key: Category; label: string; help: string }[] = [
  { key: "customer_message", label: "Message customers", help: "Emails and replies sent to customers" },
  { key: "spend", label: "Spend money", help: "Shipping labels and other purchases" },
  { key: "refund", label: "Refunds", help: "Money sent back to customers" },
  { key: "store_update", label: "Change the store", help: "Prices, product copy, fulfilling orders" },
  { key: "payment_link", label: "Payment links", help: "Creating links customers can pay with" },
  { key: "external_write", label: "Other apps", help: "Writes through MCP servers, APIs and webhooks" },
];
export interface Policy { mode: "auto" | "ask" | "never"; autoLimitUsd: number }
export interface Action {
  id: string; connectionId: string; tool: string; category: Category; summary: string; input: any; amountUsd: number;
  status: "pending" | "running" | "done" | "failed" | "rejected" | "blocked"; result: string;
  requestedBy: string; taskId?: string | null; createdAt: number; finishedAt: number;
}

export interface BizSettings { lowStock: number; autoOrderTasks: boolean; monthlyAgentBudgetUsd: number }

export interface State {
  name: string; goal: string; kind: string; running: boolean; createdAt: number; nextTaskNo: number;
  agents: Agent[]; tasks: Task[]; comments: Comment[]; docs: Doc[]; approvals: Approval[]; routines: Routine[];
  runs: Run[]; activity: Activity[];
  connections: Connection[]; products: Product[]; orders: Order[]; actions: Action[];
  policies: Record<Category, Policy>; settings: BizSettings; seen: { orders: string[]; lowStock: string[] };
}

export const DEFAULT_POLICIES: Record<Category, Policy> = {
  customer_message: { mode: "ask", autoLimitUsd: 0 },
  spend: { mode: "ask", autoLimitUsd: 0 },
  refund: { mode: "ask", autoLimitUsd: 0 },
  store_update: { mode: "ask", autoLimitUsd: 0 },
  payment_link: { mode: "auto", autoLimitUsd: 500 },
  external_write: { mode: "ask", autoLimitUsd: 0 },
};

export function emptyState(name: string, goal: string, kind: string): State {
  return {
    name, goal, kind, running: false, createdAt: now(), nextTaskNo: 1,
    agents: [], tasks: [], comments: [], docs: [], approvals: [], routines: [], runs: [], activity: [],
    connections: [], products: [], orders: [], actions: [],
    policies: structuredClone(DEFAULT_POLICIES), settings: { lowStock: 3, autoOrderTasks: true, monthlyAgentBudgetUsd: 50 },
    seen: { orders: [], lowStock: [] },
  };
}

// ---------- lookups ----------
export const agentOf = (s: State, id?: string | null) => s.agents.find(a => a.id === id);
export const taskOf = (s: State, id?: string | null) => s.tasks.find(t => t.id === id);
export const ceoOf = (s: State) => s.agents.find(a => !a.reportsTo) ?? s.agents[0];
export function taskByRef(s: State, ref?: string | null): Task | undefined {
  if (!ref) return undefined;
  const r = String(ref).trim().replace(/^#/, "").replace(/^t-/i, "");
  return s.tasks.find(t => t.id === ref) ?? s.tasks.find(t => String(t.number) === r);
}
export function agentByRef(s: State, ref?: string | null): Agent | undefined {
  if (!ref) return undefined;
  const r = String(ref).trim().replace(/^@/, "");
  return s.agents.find(a => a.id === r) ?? s.agents.find(a => a.name.toLowerCase() === r.toLowerCase())
    ?? s.agents.find(a => a.title.toLowerCase() === r.toLowerCase());
}
export function orderByRef(s: State, ref?: string | null): Order | undefined {
  if (!ref) return undefined;
  const r = String(ref).trim().replace(/^#/, "");
  return s.orders.find(o => o.id === r || o.extId === r || o.number.replace(/^#/, "") === r);
}
export function productByRef(s: State, ref?: string | null): Product | undefined {
  if (!ref) return undefined;
  const r = String(ref).trim().toLowerCase();
  return s.products.find(p => p.id === ref || p.extId === ref || p.sku.toLowerCase() === r)
    ?? s.products.find(p => p.title.toLowerCase() === r) ?? s.products.find(p => p.title.toLowerCase().includes(r));
}
export const nameOf = (s: State, actor?: string | null) =>
  actor == null ? "Unassigned" : actor === BOARD ? "You" : actor === "system" ? "Aries" : agentOf(s, actor)?.name ?? "Former agent";
export const spentOf = (s: State) => s.agents.reduce((a, b) => a + b.spentUsd, 0);

// ---------- mutations (pure: mutate the draft passed in) ----------
export function log(s: State, actor: string, text: string, taskId?: string | null) {
  s.activity.push({ id: newId(), actor, text, taskId: taskId ?? null, ts: now() });
  if (s.activity.length > 600) s.activity.splice(0, s.activity.length - 600);
}

export function wake(s: State, agentId: string | null | undefined, reason: string, except?: string | null) {
  if (!agentId || agentId === except || agentId === BOARD) return;
  const a = agentOf(s, agentId); if (!a) return;
  a.wake = true; a.wakeReason = (a.wakeReason + "\n• " + reason).trim().slice(-1800);
}

export function createTask(s: State, p: {
  title: string; description?: string; assigneeId?: string | null; parentId?: string | null; priority?: string;
  createdBy?: string; status?: TaskStatus; orderId?: string | null;
}): Task {
  const t: Task = {
    id: newId(), number: s.nextTaskNo++, title: p.title.trim().slice(0, 200), description: (p.description ?? "").trim(),
    status: p.status ?? (p.assigneeId ? "todo" : "backlog"), priority: p.priority ?? "medium",
    assigneeId: p.assigneeId ?? null, parentId: p.parentId ?? null, createdBy: p.createdBy ?? BOARD,
    createdAt: now(), updatedAt: now(), orderId: p.orderId ?? null,
  };
  s.tasks.push(t);
  log(s, t.createdBy, `created #${t.number} ${t.title}` + (t.assigneeId ? ` → ${nameOf(s, t.assigneeId)}` : ""), t.id);
  wake(s, t.assigneeId, `New task #${t.number} assigned to you: ${t.title}`, t.createdBy);
  return t;
}

export function updateTask(s: State, taskId: string, actor: string, p: {
  status?: string; assigneeId?: string | null; priority?: string; title?: string; description?: string;
}) {
  const t = taskOf(s, taskId); if (!t) return;
  const old = { ...t };
  if (p.status && (STATUSES as readonly string[]).includes(p.status)) t.status = p.status as TaskStatus;
  if (p.assigneeId !== undefined) t.assigneeId = p.assigneeId;
  if (p.priority) t.priority = p.priority;
  if (p.title) t.title = p.title.slice(0, 200);
  if (p.description !== undefined) t.description = p.description;
  t.updatedAt = now();
  if (t.status !== old.status) {
    log(s, actor, `moved #${t.number} to ${t.status.replace("_", " ")}`, t.id);
    if (t.status === "done") {
      const a = agentOf(s, t.assigneeId); if (a) a.tasksDone++;
      const parent = taskOf(s, t.parentId);
      if (parent) wake(s, parent.assigneeId, `Subtask #${t.number} "${t.title}" of your task #${parent.number} is done`, actor);
      wake(s, t.createdBy, `Task #${t.number} "${t.title}" you created is done`, actor);
    }
    if (t.status === "todo" && ["blocked", "in_review", "backlog"].includes(old.status)) wake(s, t.assigneeId, `Task #${t.number} is back in To-do`, actor);
  }
  if (t.assigneeId !== old.assigneeId) {
    log(s, actor, `assigned #${t.number} to ${nameOf(s, t.assigneeId)}`, t.id);
    wake(s, t.assigneeId, `Task #${t.number} "${t.title}" was assigned to you`, actor);
    if (t.status === "backlog" && t.assigneeId) t.status = "todo";
  }
}

export function addComment(s: State, taskId: string, actor: string, body: string) {
  const t = taskOf(s, taskId); if (!t || !body.trim()) return;
  s.comments.push({ id: newId(), taskId, authorId: actor, body: body.trim(), createdAt: now() });
  log(s, actor, `commented on #${t.number}`, taskId);
  const snippet = body.trim().slice(0, 240);
  wake(s, t.assigneeId, `${nameOf(s, actor)} commented on #${t.number}: ${snippet}`, actor);
  for (const a of s.agents) if (body.toLowerCase().includes("@" + a.name.toLowerCase())) wake(s, a.id, `${nameOf(s, actor)} mentioned you on #${t.number}: ${snippet}`, actor);
  if (actor === BOARD && t.status === "blocked") { t.status = "todo"; t.updatedAt = now(); }
}

export function writeDoc(s: State, taskId: string | null, key: string, title: string, body: string, actor: string) {
  const d = s.docs.find(x => x.key === key && x.taskId === taskId);
  if (d) Object.assign(d, { title, body, authorId: actor, version: d.version + 1, updatedAt: now() });
  else s.docs.push({ id: newId(), taskId, key, title, body, authorId: actor, version: 1, updatedAt: now() });
  log(s, actor, `${d ? "revised" : "wrote"} document "${title}"`, taskId);
}

export function requestApproval(s: State, a: Omit<Approval, "id" | "status" | "response" | "createdAt" | "resolvedAt">): Approval {
  const ap: Approval = { ...a, id: newId(), status: "pending", response: "", createdAt: now(), resolvedAt: 0 };
  s.approvals.push(ap);
  log(s, a.requestedBy, `requested approval: ${a.title}`, a.taskId);
  return ap;
}

export function hire(s: State, a: Partial<Agent> & { name: string; title: string }, by: string): Agent {
  const agent: Agent = {
    id: newId(), role: "", reportsTo: ceoOf(s)?.id ?? null, model: MODELS.haiku, instructions: "", budgetUsd: 5, heartbeatMin: 45,
    paused: false, emoji: "🤖", hue: (s.agents.length * 71 + 20) % 360, ...a,
    spentUsd: 0, runs: 0, tasksDone: 0, lastHeartbeat: 0, wake: true,
    wakeReason: "You were just hired. Check your tasks and introduce yourself.", createdAt: now(),
  } as Agent;
  s.agents.push(agent);
  log(s, by, `hired ${agent.name} (${agent.title})`);
  return agent;
}

export function fire(s: State, id: string) {
  const a = agentOf(s, id); if (!a) return;
  s.agents = s.agents.filter(x => x.id !== id);
  for (const x of s.agents) if (x.reportsTo === id) x.reportsTo = a.reportsTo;
  for (const t of s.tasks) if (t.assigneeId === id && OPEN.has(t.status)) { t.assigneeId = a.reportsTo; t.status = "todo"; }
  log(s, BOARD, `let ${a.name} go; open work moved to ${nameOf(s, a.reportsTo)}`);
}

/** Resolve a non-action approval. Action approvals are executed by the gate (needs network), see gate.ts. */
export function resolveApproval(s: State, approvalId: string, approve: boolean, note = ""): Approval | undefined {
  const a = s.approvals.find(x => x.id === approvalId && x.status === "pending"); if (!a) return;
  a.status = approve ? "approved" : "rejected"; a.response = note; a.resolvedAt = now();
  log(s, BOARD, (approve ? "approved " : "rejected ") + a.title, a.taskId);
  const verdict = approve ? "APPROVED" : "REJECTED";
  const withNote = note ? ` Board note: ${note}` : "";
  switch (a.type) {
    case "hire":
      if (approve && a.hire) hire(s, { ...a.hire, reportsTo: a.hire.reportsTo ?? a.requestedBy }, a.requestedBy);
      wake(s, a.requestedBy, `The board ${verdict} your hire request "${a.hire?.name}".${withNote}`);
      break;
    case "review":
      if (a.taskId) {
        updateTask(s, a.taskId, BOARD, { status: approve ? "done" : "todo" });
        if (note || !approve) addComment(s, a.taskId, BOARD, `Review ${verdict}.${withNote}`);
      }
      break;
    case "question": {
      const answer = note || (approve ? "Yes, go ahead." : "No.");
      if (a.taskId) {
        addComment(s, a.taskId, BOARD, `Answer to "${a.body.slice(0, 140)}": ${answer}`);
        const t = taskOf(s, a.taskId); if (t?.status === "blocked") updateTask(s, t.id, BOARD, { status: "todo" });
      }
      wake(s, a.requestedBy, `The board answered your question "${a.body.slice(0, 140)}": ${answer}`);
      break;
    }
    case "budget": {
      const ag = agentOf(s, a.agentId);
      if (approve && ag) { const extra = Number(note) || 5; ag.budgetUsd += extra; ag.paused = false; log(s, BOARD, `raised ${ag.name}'s budget by $${extra.toFixed(2)}`); }
      break;
    }
  }
  return a;
}

export function upsertOrders(s: State, connectionId: string | null, incoming: Order[]) {
  for (const o of incoming) {
    const ex = s.orders.find(x => x.connectionId === connectionId && x.extId === o.extId);
    if (ex) Object.assign(ex, { ...o, id: ex.id, stage: mergeStage(ex.stage, o.stage), tracking: o.tracking ?? ex.tracking, note: ex.note });
    else s.orders.push({ ...o, id: o.id || newId(), connectionId });
  }
  s.orders.sort((a, b) => b.createdAt - a.createdAt);
  if (s.orders.length > 500) s.orders.length = 500;
}
const STAGE_RANK: Record<OrderStage, number> = { new: 0, to_ship: 1, shipped: 2, delivered: 3, cancelled: 4 };
const mergeStage = (a: OrderStage, b: OrderStage) => (STAGE_RANK[b] >= STAGE_RANK[a] ? b : a);

export function upsertProducts(s: State, connectionId: string | null, incoming: Product[]) {
  for (const p of incoming) {
    const ex = s.products.find(x => x.connectionId === connectionId && x.extId === p.extId);
    if (ex) Object.assign(ex, { ...p, id: ex.id }); else s.products.push({ ...p, id: p.id || newId(), connectionId });
  }
}

/** Who on the team handles orders? Prefer an ops/fulfillment title, else the CEO. */
export function opsAgent(s: State): Agent | undefined {
  return s.agents.find(a => /ops|operat|fulfil|ship|logistic/i.test(a.title)) ?? ceoOf(s);
}
export function merchAgent(s: State): Agent | undefined {
  return s.agents.find(a => /merch|inventory|product|buyer|purchas/i.test(a.title)) ?? opsAgent(s);
}

/** Turn fresh commerce data into work: new paid orders and low stock become tasks. */
export function commerceTriggers(s: State) {
  if (!s.settings.autoOrderTasks) return;
  for (const o of s.orders) {
    if (s.seen.orders.includes(o.id)) continue;
    s.seen.orders.push(o.id);
    if (o.paid && (o.stage === "new" || o.stage === "to_ship") && now() - o.createdAt < 14 * 864e5) {
      if (o.stage === "new") o.stage = "to_ship";
      const who = opsAgent(s);
      createTask(s, {
        title: `Fulfill order ${o.number} for ${o.customer.name || "customer"}`,
        description: `Order ${o.number}: ${o.items.map(i => `${i.qty}× ${i.title}`).join(", ")} — ${o.total.toFixed(2)} ${o.currency}.\n` +
          `Get it shipped: check rates, buy the label (subject to the business's spending rules), mark it fulfilled with tracking, and let the customer know if messaging is set up.`,
        assigneeId: who?.id ?? null, priority: "high", createdBy: "system", orderId: o.id,
      });
    }
  }
  if (s.seen.orders.length > 2000) s.seen.orders.splice(0, s.seen.orders.length - 2000);
  for (const p of s.products) {
    const low = p.inventory != null && p.inventory <= s.settings.lowStock && p.status !== "archived";
    const flagged = s.seen.lowStock.includes(p.id);
    if (low && !flagged) {
      s.seen.lowStock.push(p.id);
      createTask(s, {
        title: `Low stock: ${p.title} (${p.inventory} left)`,
        description: `${p.title}${p.sku ? ` (SKU ${p.sku})` : ""} is down to ${p.inventory}. Decide whether to restock, pause promotion, or adjust the listing. Ask the board before spending money.`,
        assigneeId: merchAgent(s)?.id ?? null, priority: "medium", createdBy: "system",
      });
    } else if (!low && flagged) s.seen.lowStock = s.seen.lowStock.filter(x => x !== p.id);
  }
}

/** What clients see: never includes secrets (secrets are stored outside the state document). */
export function publicState(s: State) { return s; }
