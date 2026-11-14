import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { act, ago, agentOf, money, nameOf, OPEN } from "../api.ts";
import { Avatar, Markdown, Meter, Section, Sky, useBusy } from "../ui.tsx";

export function Pulse({ b }: { b: any }) {
  const s = b.state; const bid = b.id; const nav = useNavigate(); const [busy, run] = useBusy();
  const [order, setOrder] = useState("");
  const day = 864e5; const today = new Date(); today.setHours(0, 0, 0, 0);
  const paid = s.orders.filter((o: any) => o.paid && o.stage !== "cancelled");
  const cur = paid[0]?.currency ?? "USD";
  const rev7 = paid.filter((o: any) => o.createdAt >= today.getTime() - 6 * day).reduce((a: number, o: any) => a + o.total, 0);
  const bars = Array.from({ length: 14 }, (_, i) => { const start = today.getTime() - (13 - i) * day; return paid.filter((o: any) => o.createdAt >= start && o.createdAt < start + day).reduce((a: number, o: any) => a + o.total, 0); });
  const maxBar = Math.max(1, ...bars);
  const toShip = s.orders.filter((o: any) => o.stage === "to_ship").length;
  const pending = s.approvals.filter((a: any) => a.status === "pending");
  const low = s.products.filter((p: any) => p.inventory != null && p.inventory <= s.settings.lowStock).length;
  const liveRuns = s.runs.filter((r: any) => r.status === "running");
  const ceo = s.agents.find((a: any) => !a.reportsTo);
  const brief = [...s.docs].reverse().find((d: any) => d.key === "daily-brief");
  const broken = s.connections.filter((c: any) => c.status === "error");

  const liveIds: string[] = b.live?.length ? b.live : liveRuns.map((r: any) => r.agentId);
  const waitingIds: string[] = [...new Set<string>(pending.map((a: any) => a.requestedBy))];
  const firstLive = agentOf(s, liveIds[0]);
  const liveTask = firstLive && s.tasks.filter((t: any) => t.assigneeId === firstLive.id && t.status !== "done").sort((a: any, c: any) => c.updatedAt - a.updatedAt)[0];

  return (
    <div>
      <div className="sky-wrap">
        <Sky agents={s.agents} live={liveIds} waiting={waitingIds} onPick={a => nav(`/b/${bid}/agent/${a.id}`)} />
      </div>
      <p className="headline">
        {firstLive ? <><span className="l">{firstLive.name}</span> is on {liveTask ? `#${liveTask.number}` : "a check-in"}{liveIds.length > 1 ? ` with ${liveIds.length - 1} more at work` : ""}. </>
          : s.running ? "Your crew is on duty. " : "Your crew is off duty. "}
        {pending.length ? <><Link to={`/b/${bid}/inbox`} className="w">{pending.length === 1 ? "One thing waits" : `${pending.length} things wait`} on you.</Link></>
          : toShip ? `${toShip} order${toShip > 1 ? "s" : ""} to ship.` : "Nothing needs you."}
      </p>
      <p className="muted small clamp2" style={{ maxWidth: "62ch", margin: 0 }}>Goal: {s.goal}</p>

      {!s.connections.length && (
        <Link to={`/b/${bid}/connections`} className="card click hot" style={{ display: "block", color: "inherit", marginTop: 16 }}>
          <b>Connect your business</b>
          <div className="small muted">Plug in your store, payments, shipping and email so the crew can do real work. It takes two minutes.</div>
        </Link>
      )}
      {broken.map((c: any) => <div key={c.id} className="card" style={{ borderColor: "var(--red)", marginTop: 12 }}><b>{c.label} needs attention.</b> <span className="small muted">{c.error}</span> <Link to={`/b/${bid}/connections`}>Fix it</Link></div>)}

      <div className="strip">
        <Link to={`/b/${bid}/store`}><b>{money(rev7, cur)}</b><span>Revenue this week</span></Link>
        <Link to={`/b/${bid}/store`} className={toShip ? "hot" : ""}><b>{toShip}</b><span>To ship</span></Link>
        <Link to={`/b/${bid}/inbox`} className={pending.length ? "hot" : ""}><b>{pending.length}</b><span>Waiting on you</span></Link>
        <Link to={`/b/${bid}/work`}><b>{s.tasks.filter((t: any) => OPEN.includes(t.status)).length}</b><span>Open tasks{low ? `, ${low} low stock` : ""}</span></Link>
      </div>

      {paid.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row small muted"><span className="grow">Revenue, last 14 days</span><span>{money(bars.reduce((a, x) => a + x, 0), cur)}</span></div>
          <div className="bars" style={{ marginTop: 10 }} aria-label="Daily revenue chart">
            {bars.map((v, i) => <div key={i} className={v ? "" : "zero"} title={money(v, cur)} style={{ height: `${(v / maxBar) * 100}%` }} />)}
          </div>
        </div>
      )}

      <Section title="Give the crew an order" />
      <form className="row" onSubmit={e => { e.preventDefault(); if (!order.trim()) return; void run(async () => {
        await act(bid, "POST", "/tasks", { title: order.trim().split("\n")[0].slice(0, 90), description: order.trim(), assigneeId: ceo?.id, priority: "high" });
        if (!s.running && b.billing.active) await act(bid, "POST", "/running", { running: true });
        setOrder("");
      }, "Sent to " + (ceo?.name ?? "the CEO")); }}>
        <input className="input grow" value={order} onChange={e => setOrder(e.target.value)} placeholder={`e.g. "Run a 15% off weekend sale on accessories"`} />
        <button className="btn" disabled={busy || !order.trim()}>Send</button>
      </form>

      {liveRuns.length > 0 && <>
        <Section title="Working right now" />
        <div className="stack">{liveRuns.map((r: any) => {
          const last = r.events[r.events.length - 1];
          return (
            <Link key={r.id} to={`/b/${bid}/run/${r.id}`} className="card click row" style={{ color: "inherit" }}>
              <Avatar a={agentOf(s, r.agentId)} size={32} live />
              <div className="grow"><div className="bold">{nameOf(s, r.agentId)}</div><div className="small muted ellipsis">{last ? (last.kind === "tool" ? "⚙ " : "") + last.text : "Thinking…"}</div></div>
              <div className="pulse on" />
            </Link>
          );
        })}</div>
      </>}

      {pending.length > 0 && <>
        <Section title="Needs your decision" action={<Link to={`/b/${bid}/inbox`} className="small">All {pending.length}</Link>} />
        <div className="stack">{pending.slice(0, 3).map((a: any) => (
          <div key={a.id} className="card row">
            <Avatar a={agentOf(s, a.requestedBy)} size={30} />
            <div className="grow"><div className="bold clamp2">{a.title}</div><div className="small muted">{nameOf(s, a.requestedBy)} · {ago(a.createdAt)}</div></div>
            {a.type !== "question" && <button className="btn sm" disabled={busy} onClick={() => run(() => act(bid, "POST", `/approvals/${a.id}`, { approve: true }))}>Approve</button>}
            <button className="btn ghost sm" onClick={() => nav(`/b/${bid}/inbox`)}>Open</button>
          </div>
        ))}</div>
      </>}

      {brief && <>
        <Section title={`Daily brief · ${ago(brief.updatedAt)}`} />
        <div className="card"><Markdown text={brief.body.slice(0, 1800)} /></div>
      </>}

      <Section title="Spend this month" />
      <div className="card">
        <div className="row small"><span className="grow muted">AI credit ({b.billing.label})</span><span>{money(b.billing.usageUsd)} of {money(b.billing.creditUsd)}</span></div>
        <div style={{ margin: "8px 0 12px" }}><Meter frac={b.billing.usageUsd / Math.max(0.01, b.billing.creditUsd)} /></div>
        <div className="row small"><span className="grow muted">Your crew cap</span><span>{money(s.agents.reduce((a: number, x: any) => a + x.spentUsd, 0))} of {money(s.settings.monthlyAgentBudgetUsd)}</span></div>
      </div>

      <Section title="Activity" action={<Link to={`/b/${bid}/activity`} className="small">All</Link>} />
      {s.activity.slice(-10).reverse().map((a: any) => (
        <div key={a.id} className="row" style={{ padding: "6px 0", alignItems: "flex-start" }}>
          {a.actor === "board" || a.actor === "system" ? <div className="avatar" style={{ width: 26, height: 26, fontSize: 13, borderColor: "var(--line)" }}>{a.actor === "board" ? "👤" : "⚙"}</div> : <Avatar a={agentOf(s, a.actor)} size={26} />}
          <div className="grow small">
            <b>{nameOf(s, a.actor)}</b> {a.taskId ? <Link to={`/b/${bid}/task/${a.taskId}`} style={{ color: "inherit" }}>{a.text}</Link> : a.text}
            <div className="tiny muted">{ago(a.ts)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
