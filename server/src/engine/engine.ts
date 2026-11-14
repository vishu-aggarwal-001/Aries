import type { Repo } from "../db.ts";
import { Agent, ACTIONABLE, Run, State, createTask, log, newId, now, requestApproval, spentOf } from "../model.ts";
import type { Connections } from "../connectors/index.ts";
import { ClaudeError, cost, send } from "./claude.ts";
import { systemPrompt, wakePrompt } from "./prompts.ts";
import { EndHeartbeat, Env, execTool, toolDefinitions } from "./tools.ts";
import { PERIOD_MS, billingInfo } from "../plans.ts";

export interface EngineOpts { tickMs?: number; maxConcurrent?: number; perBusiness?: number; maxTurns?: number; syncEveryMs?: number; webSearch?: boolean }

export class Engine {
  private busy = new Set<string>();
  private perBiz = new Map<string, number>();
  private lastSync = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  readonly o: Required<EngineOpts>;

  constructor(private repo: Repo, private conns: Connections, opts: EngineOpts = {}) {
    this.o = {
      tickMs: 15_000, maxConcurrent: Number(process.env.MAX_CONCURRENT_RUNS ?? 8), perBusiness: 2, maxTurns: 16,
      syncEveryMs: 10 * 60_000, webSearch: process.env.WEB_SEARCH === "1", ...opts,
    };
  }

  start() { this.timer ??= setInterval(() => void this.tick(), this.o.tickMs); }
  stop() { clearInterval(this.timer); this.timer = undefined; }
  isBusy = (bid: string, agentId: string) => this.busy.has(`${bid}:${agentId}`);
  liveAgents = (bid: string) => [...this.busy].filter(k => k.startsWith(bid + ":")).map(k => k.split(":")[1]);

  async tick() {
    if (this.ticking) return; this.ticking = true;
    try { for (const bid of await this.repo.running()) await this.tickBusiness(bid).catch(e => console.error("tick", bid, e)); }
    finally { this.ticking = false; }
  }

  async tickBusiness(bid: string) {
    let row = await this.repo.get(bid); if (!row) return;
    if (now() - row.period_start > PERIOD_MS) {
      await this.repo.db.query("UPDATE businesses SET usage_usd=0, period_start=$1 WHERE id=$2", [now(), bid]);
      row = (await this.repo.get(bid))!;
    }
    const bill = billingInfo(row);
    if (!bill.active) {
      await this.repo.mutate(bid, s => { s.running = false; log(s, "system", `paused the crew: ${bill.reason}`); });
      return;
    }
    const s = row.state;
    if (spentOf(s) >= s.settings.monthlyAgentBudgetUsd) {
      await this.repo.mutate(bid, d => { d.running = false; log(d, "system", `paused the crew: the owner's spending cap of $${s.settings.monthlyAgentBudgetUsd} was reached`); });
      return;
    }
    // routines
    const due = s.routines.filter(r => r.enabled && now() - r.lastRun >= r.everyHours * 3_600_000 && s.agents.some(a => a.id === r.assigneeId));
    if (due.length) await this.repo.mutate(bid, d => {
      for (const r of due) {
        const x = d.routines.find(y => y.id === r.id)!; x.lastRun = now();
        createTask(d, { title: r.title, description: r.description + `\n\n(Routine: ${r.title})`, assigneeId: r.assigneeId, createdBy: "system" });
      }
    });
    // connector sync
    for (const c of s.connections) {
      const k = `${bid}:${c.id}`;
      if (now() - (this.lastSync.get(k) ?? c.lastSync) >= this.o.syncEveryMs) { this.lastSync.set(k, now()); void this.conns.sync(bid, c.id).catch(() => {}); }
    }
    // agents
    const fresh = (await this.repo.get(bid))!.state;
    for (const a of this.pick(bid, fresh)) {
      if (this.busy.size >= this.o.maxConcurrent || (this.perBiz.get(bid) ?? 0) >= this.o.perBusiness) break;
      void this.heartbeat(bid, a.id, a.wake ? "wake" : "scheduled").catch(e => console.error("heartbeat", e));
    }
  }

  private pick(bid: string, s: State): Agent[] {
    const t = now(); const out: Agent[] = []; const over: Agent[] = [];
    for (const a of s.agents) {
      if (a.paused || this.isBusy(bid, a.id)) continue;
      if (a.spentUsd >= a.budgetUsd) { over.push(a); continue; }
      const hasWork = s.tasks.some(x => x.assigneeId === a.id && ACTIONABLE.has(x.status));
      if (a.wake || (hasWork && t - a.lastHeartbeat >= a.heartbeatMin * 60_000)) out.push(a);
    }
    if (over.length) void this.repo.mutate(bid, d => {
      for (const o of over) {
        const a = d.agents.find(x => x.id === o.id); if (!a || a.paused) continue;
        a.paused = true;
        if (!d.approvals.some(x => x.type === "budget" && x.agentId === a.id && x.status === "pending"))
          requestApproval(d, { type: "budget", title: `${a.name} hit their budget`, body: `${a.name} has used $${a.spentUsd.toFixed(2)} of $${a.budgetUsd.toFixed(2)} and is paused. Approve to add more (type an amount in the note; default $5).`, requestedBy: a.id, agentId: a.id });
      }
    });
    return out.sort((a, b) => Number(b.wake) - Number(a.wake) || a.lastHeartbeat - b.lastHeartbeat);
  }

  /** One heartbeat: a tool-use loop against Claude. Safe to call directly ("Run now"). */
  async heartbeat(bid: string, agentId: string, reason: string): Promise<Run | undefined> {
    const key = `${bid}:${agentId}`;
    if (this.busy.has(key)) return;
    this.busy.add(key); this.perBiz.set(bid, (this.perBiz.get(bid) ?? 0) + 1);
    const runId = newId();
    let wakeReason = "";
    try {
      const { state: s0, result: me } = await this.repo.mutate(bid, s => {
        const a = s.agents.find(x => x.id === agentId); if (!a) return undefined;
        wakeReason = a.wakeReason;
        a.wake = false; a.wakeReason = ""; a.lastHeartbeat = now(); a.runs++;
        s.runs.push({ id: runId, agentId, reason: reason === "wake" ? (wakeReason || "Woken") : reason[0].toUpperCase() + reason.slice(1), startedAt: now(), endedAt: 0, status: "running", costUsd: 0, inTok: 0, outTok: 0, summary: "", events: [] });
        return { ...a };
      });
      if (!me) return;
      const env: Env = { repo: this.repo, conns: this.conns, bid, agentId };
      const system = systemPrompt(s0, me);
      const tools = toolDefinitions(s0, this.o.webSearch);
      const messages: any[] = [{ role: "user", content: wakePrompt(s0, me, wakeReason) }];
      let spent = 0, inTok = 0, outTok = 0, summary = "", status: Run["status"] = "ok";
      let pending: { kind: string; text: string; ts: number }[] = [];
      const ev = (kind: string, text: string) => pending.push({ kind, text: String(text).slice(0, 4000), ts: now() });
      const flush = async (extra?: (s: State) => void) => {
        const evs = pending; pending = [];
        await this.repo.mutate(bid, s => {
          const r = s.runs.find(x => x.id === runId); if (r) { r.events.push(...evs); r.costUsd = spent; r.inTok = inTok; r.outTok = outTok; }
          extra?.(s);
        });
      };
      try {
        for (let turn = 1; turn <= this.o.maxTurns; turn++) {
          const reply = await send(me.model, system, messages, tools);
          const c = cost(me.model, reply.usage);
          spent += c; inTok += reply.usage.input + reply.usage.cacheRead + reply.usage.cacheWrite; outTok += reply.usage.output;
          await this.repo.addUsage(bid, c);
          messages.push({ role: "assistant", content: reply.content });
          const results: any[] = [];
          for (const b of reply.content) {
            if (b.type === "text" && b.text?.trim()) ev("think", b.text);
            else if (b.type === "server_tool_use") ev("search", "🔎 " + (b.input?.query ?? "web search"));
            else if (b.type === "tool_use") {
              ev("tool", `${b.name} ${compact(b.input)}`);
              let out: string, isErr = false;
              try { out = await execTool(env, b.name, b.input ?? {}); }
              catch (e: any) { if (e instanceof EndHeartbeat) { summary = e.summary; out = "Heartbeat ended."; } else { isErr = true; out = "Error: " + (e.message ?? String(e)); } }
              ev(isErr ? "error" : "result", out);
              results.push({ type: "tool_result", tool_use_id: b.id, content: out.slice(0, 30000), ...(isErr ? { is_error: true } : {}) });
            }
          }
          await flush(s => { const a = s.agents.find(x => x.id === agentId); if (a) a.spentUsd += c; });
          if (summary) break;
          const a = (await this.repo.get(bid))?.state.agents.find(x => x.id === agentId);
          if (!a || a.spentUsd >= a.budgetUsd) { ev("error", "Budget reached; stopping."); break; }
          if (!results.length) break;
          if (turn === this.o.maxTurns - 1) results.push({ type: "text", text: "Turn limit almost reached: save progress and call end_heartbeat now." });
          messages.push({ role: "user", content: results });
        }
        if (!summary) summary = "Heartbeat ended.";
      } catch (e: any) {
        status = "error"; summary = e.message ?? String(e); ev("error", summary);
        if (e instanceof ClaudeError && (e.status === 429 || e.status >= 500)) await this.repo.mutate(bid, s => { const a = s.agents.find(x => x.id === agentId); if (a) { a.wake = true; a.wakeReason = wakeReason; } });
      }
      await flush(s => {
        const r = s.runs.find(x => x.id === runId); if (r) { r.endedAt = now(); r.status = status; r.summary = summary; }
        if (status === "ok") log(s, agentId, "heartbeat: " + summary.slice(0, 300));
      });
      return (await this.repo.get(bid))?.state.runs.find(r => r.id === runId);
    } finally {
      this.busy.delete(key); this.perBiz.set(bid, Math.max(0, (this.perBiz.get(bid) ?? 1) - 1));
    }
  }
}

const compact = (o: any) => Object.entries(o ?? {}).map(([k, v]) => { const s = typeof v === "string" ? v : JSON.stringify(v); return `${k}=${s.length > 80 ? s.slice(0, 80) + "…" : s}`; }).join(" ");
