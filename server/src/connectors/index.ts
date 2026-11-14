import type { Repo } from "../db.ts";
import {
  BOARD, Connection, State, agentOf, addComment, commerceTriggers, log, newId, now, requestApproval, taskOf, upsertOrders, upsertProducts, wake,
} from "../model.ts";
import type { ConnectorDef, Ctx, ToolSpec } from "./base.ts";
import { shopify } from "./shopify.ts";
import { woocommerce, stripe, shippo } from "./commerce.ts";
import { email, webhook, mcp, api } from "./universal.ts";

export const CONNECTORS: ConnectorDef[] = [shopify, woocommerce, stripe, shippo, email, webhook, mcp, api];
export const defOf = (type: string) => CONNECTORS.find(c => c.type === type);

/** The catalog as clients see it. */
export const catalog = () => CONNECTORS.map(c => ({ type: c.type, label: c.label, blurb: c.blurb, group: c.group, fields: c.fields, oauth: c.oauth ?? null, docsUrl: c.docsUrl ?? null }));

export interface BoundTool { apiName: string; conn: Connection; def: ConnectorDef; spec: ToolSpec }

const slugOf = (s: State, c: Connection) => {
  const same = s.connections.filter(x => x.type === c.type);
  const n = same.findIndex(x => x.id === c.id);
  return (c.type + (n > 0 ? n + 1 : "")).replace(/[^a-zA-Z0-9]/g, "");
};

/** Every connector tool available to agents right now, with API-safe names like shopify__fulfill_order. */
export function boundTools(s: State): BoundTool[] {
  const out: BoundTool[] = [];
  for (const conn of s.connections.filter(c => c.status === "connected")) {
    const def = defOf(conn.type); if (!def) continue;
    for (const spec of def.tools(conn)) {
      const apiName = `${slugOf(s, conn)}__${spec.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      out.push({ apiName, conn, def, spec });
    }
  }
  return out;
}

export const describeConnections = (s: State) =>
  s.connections.length
    ? s.connections.map(c => `- ${c.label} (${defOf(c.type)?.label ?? c.type}) — ${c.status}${c.error ? `: ${c.error}` : ""}; tools prefixed ${slugOf(s, c)}__`).join("\n")
    : "(nothing connected yet)";

export class Connections {
  constructor(private repo: Repo) {}

  private async ctx(bid: string, connId: string): Promise<Ctx> {
    const row = await this.repo.get(bid); if (!row) throw new Error("Business not found");
    const conn = row.state.connections.find(c => c.id === connId); if (!conn) throw new Error("Connection not found");
    return { conn, secrets: await this.repo.getSecret(bid, connId), state: row.state };
  }

  async add(bid: string, type: string, label: string, values: Record<string, string>, presetSecrets: Record<string, string> = {}): Promise<Connection> {
    const def = defOf(type); if (!def) throw new Error("Unknown connector " + type);
    const info: Record<string, string> = {}; const secrets: Record<string, string> = { ...presetSecrets };
    for (const f of def.fields) {
      const v = (values[f.key] ?? "").trim();
      if (!v && !f.optional && !(f.secret && secrets[f.key])) throw new Error(`${f.label} is required`);
      if (v) (f.secret ? secrets : info)[f.key] = v;
    }
    const conn: Connection = { id: newId(), type, label: label.trim() || def.label, status: "connected", lastSync: 0, info, createdAt: now() };
    const row = await this.repo.get(bid); if (!row) throw new Error("Business not found");
    const res = await def.connect({ conn, secrets, state: row.state });
    Object.assign(conn.info, res.info ?? {}); if (res.tools) conn.tools = res.tools;
    await this.repo.setSecret(bid, conn.id, secrets);
    await this.repo.mutate(bid, s => {
      s.connections.push(conn); log(s, BOARD, `connected ${conn.label}`);
      for (const a of s.agents.filter(a => !a.reportsTo)) wake(s, a.id, `${conn.label} (${def.label}) was just connected. Its tools are now available to the team.`);
    });
    if (def.sync) await this.sync(bid, conn.id).catch(() => {});
    return conn;
  }

  async remove(bid: string, connId: string) {
    await this.repo.deleteSecret(bid, connId);
    await this.repo.mutate(bid, s => {
      const c = s.connections.find(x => x.id === connId); if (!c) return;
      s.connections = s.connections.filter(x => x.id !== connId);
      log(s, BOARD, `disconnected ${c.label}`);
    });
  }

  async refresh(bid: string, connId: string) {
    const ctx = await this.ctx(bid, connId); const def = defOf(ctx.conn.type)!;
    try {
      const res = await def.connect(ctx);
      await this.repo.mutate(bid, s => { const c = s.connections.find(x => x.id === connId); if (c) { Object.assign(c.info, res.info ?? {}); if (res.tools) c.tools = res.tools; c.status = "connected"; c.error = undefined; } });
    } catch (e: any) {
      await this.repo.mutate(bid, s => { const c = s.connections.find(x => x.id === connId); if (c) { c.status = "error"; c.error = e.message; } });
      throw e;
    }
    if (def.sync) await this.sync(bid, connId);
  }

  async sync(bid: string, connId: string) {
    const ctx = await this.ctx(bid, connId); const def = defOf(ctx.conn.type)!;
    if (!def.sync) return;
    try {
      const data = await def.sync(ctx);
      await this.repo.mutate(bid, s => {
        if (data.orders) upsertOrders(s, connId, data.orders.map(o => ({ ...o, connectionId: connId })));
        if (data.products) upsertProducts(s, connId, data.products.map(p => ({ ...p, connectionId: connId })));
        const c = s.connections.find(x => x.id === connId); if (c) { c.lastSync = now(); c.status = "connected"; c.error = undefined; }
        commerceTriggers(s);
      });
    } catch (e: any) {
      await this.repo.mutate(bid, s => { const c = s.connections.find(x => x.id === connId); if (c) { c.status = "error"; c.error = e.message; c.lastSync = now(); } });
      throw e;
    }
  }

  // ---------------- the gate ----------------

  /** An agent (or the board) calls a connector tool. Reads run now; writes follow the business's rules. */
  async invoke(bid: string, actor: string, apiName: string, input: any, taskId?: string | null): Promise<string> {
    const row = await this.repo.get(bid); if (!row) throw new Error("Business not found");
    const bound = boundTools(row.state).find(b => b.apiName === apiName);
    if (!bound) throw new Error(`Tool ${apiName} is not available (is the app still connected?)`);
    const ctx: Ctx = { conn: bound.conn, secrets: await this.repo.getSecret(bid, bound.conn.id), state: row.state };
    const { spec, def } = bound;
    if (!spec.category) return this.runNow(bid, ctx, def, spec.name, input);

    const policy = row.state.policies[spec.category];
    const amount = spec.amountUsd?.(input, ctx) ?? 0;
    const summary = spec.summary?.(input, ctx) ?? `${bound.conn.label}: ${spec.name}`;
    const action = {
      id: newId(), connectionId: bound.conn.id, tool: spec.name, category: spec.category, summary, input, amountUsd: amount < 1e8 ? amount : -1,
      status: "pending" as const, result: "", requestedBy: actor, taskId: taskId ?? null, createdAt: now(), finishedAt: 0,
    };
    const isBoard = actor === BOARD;
    if (!isBoard && policy.mode === "never") {
      await this.repo.mutate(bid, s => { s.actions.push({ ...action, status: "blocked", result: "Blocked by the business's rules", finishedAt: now() }); });
      return `Blocked: this business does not allow "${labelOf(spec.category)}" actions. Tell the board what you wanted to do and why, or find another way.`;
    }
    if (isBoard || (policy.mode === "auto" && amount >= 0 && amount <= policy.autoLimitUsd)) {
      await this.repo.mutate(bid, s => { s.actions.push({ ...action, status: "running" }); });
      return this.execute(bid, action.id);
    }
    await this.repo.mutate(bid, s => {
      s.actions.push(action);
      const ap = requestApproval(s, {
        type: "action", title: summary.split("\n")[0].slice(0, 160), requestedBy: actor, taskId: taskId ?? null, actionId: action.id,
        body: summary + (action.amountUsd > 0 ? `\n\nCost: about $${action.amountUsd.toFixed(2)}` : "") + `\n\nVia ${bound.conn.label}.`,
      });
      void ap;
    });
    return `Sent to the board for approval: "${summary.split("\n")[0]}". You'll be woken with the result. Carry on with other work meanwhile.`;
  }

  private async runNow(bid: string, ctx: Ctx, def: ConnectorDef, tool: string, input: any) {
    const res = await def.execute(ctx, tool, input);
    if (res.patch) await this.repo.mutate(bid, s => res.patch!(s));
    return res.text;
  }

  /** Execute a recorded action (after approval or auto-allow). Returns the result text. */
  async execute(bid: string, actionId: string): Promise<string> {
    const row = await this.repo.get(bid); if (!row) throw new Error("Business not found");
    const action = row.state.actions.find(a => a.id === actionId); if (!action) throw new Error("Action not found");
    const conn = row.state.connections.find(c => c.id === action.connectionId);
    const def = conn && defOf(conn.type);
    let text: string; let ok = true; let patch: ((s: State) => void) | undefined;
    try {
      if (!conn || !def) throw new Error("The app was disconnected");
      const res = await def.execute({ conn, secrets: await this.repo.getSecret(bid, conn.id), state: row.state }, action.tool, action.input);
      text = res.text; patch = res.patch;
    } catch (e: any) { ok = false; text = "Failed: " + (e.message ?? String(e)); }
    await this.repo.mutate(bid, s => {
      const a = s.actions.find(x => x.id === actionId); if (a) { a.status = ok ? "done" : "failed"; a.result = text.slice(0, 4000); a.finishedAt = now(); }
      if (ok && patch) patch(s);
      log(s, action.requestedBy, `${ok ? "did" : "failed to"}: ${action.summary.split("\n")[0].slice(0, 160)}`, action.taskId);
    });
    return text;
  }

  /** Board decision on an approval of type "action". */
  async decide(bid: string, approvalId: string, approve: boolean, note: string) {
    const { result: ap } = await this.repo.mutate(bid, s => {
      const a = s.approvals.find(x => x.id === approvalId && x.status === "pending" && x.type === "action"); if (!a) return undefined;
      a.status = approve ? "approved" : "rejected"; a.response = note; a.resolvedAt = now();
      const act = s.actions.find(x => x.id === a.actionId);
      if (act && !approve) { act.status = "rejected"; act.result = note || "Rejected by the board"; act.finishedAt = now(); }
      if (act && approve) act.status = "running";
      return { ...a };
    });
    if (!ap) return;
    const text = approve ? await this.execute(bid, ap.actionId!) : `The board rejected it.${note ? ` Note: ${note}` : ""}`;
    await this.repo.mutate(bid, s => {
      const msg = `Your request "${ap.title}" was ${approve ? "approved" : "rejected"}. Result: ${text.slice(0, 1200)}${approve && note ? `\nBoard note: ${note}` : ""}`;
      wake(s, ap.requestedBy, msg);
      if (ap.taskId && taskOf(s, ap.taskId) && agentOf(s, ap.requestedBy)) addComment(s, ap.taskId, "system", (approve ? "✅ " : "⛔ ") + msg.slice(0, 1500));
    });
  }
}

const labelOf = (c: string) => ({ customer_message: "message customers", spend: "spend money", refund: "refund", store_update: "change the store", payment_link: "payment link", external_write: "write to other apps" } as any)[c] ?? c;
