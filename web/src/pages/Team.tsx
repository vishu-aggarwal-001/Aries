import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { act, ago, agentOf, modelLabel, money, nameOf, OPEN, useCatalog } from "../api.ts";
import { Avatar, Empty, Field, Markdown, Meter, Modal, Pill, Section, useBusy } from "../ui.tsx";
import { NewTask, TaskCard } from "./Work.tsx";

export function Team({ b }: { b: any }) {
  const s = b.state; const [hiring, setHiring] = useState(false);
  const rows: [any, number][] = [];
  const walk = (parent: string | null, d: number) => s.agents.filter((a: any) => (a.reportsTo ?? null) === parent || (parent === null && a.reportsTo && !agentOf(s, a.reportsTo)))
    .forEach((a: any) => { if (!rows.some(r => r[0].id === a.id)) { rows.push([a, d]); walk(a.id, d + 1); } });
  walk(null, 0);
  return (
    <div>
      <h1>Your crew</h1>
      <p className="muted">{s.agents.length} agents · {s.agents.filter((a: any) => a.paused).length} paused</p>
      <div className="stack" style={{ marginTop: 14 }}>
        {rows.map(([a, d]) => (
          <div key={a.id} className={"org" + (d ? " indent" : "")} style={{ marginLeft: d * 24 }}>
            <AgentCard s={s} a={a} bid={b.id} live={b.live?.includes(a.id)} />
          </div>
        ))}
      </div>
      <button className="btn fab" onClick={() => setHiring(true)}>＋ Hire</button>
      {hiring && <HireModal b={b} onClose={() => setHiring(false)} />}
    </div>
  );
}

function AgentCard({ s, a, bid, live }: any) {
  const open = s.tasks.filter((t: any) => t.assigneeId === a.id && OPEN.includes(t.status)).length;
  return (
    <Link to={`/b/${bid}/agent/${a.id}`} className="card click" style={{ display: "block", color: "inherit" }}>
      <div className="row">
        <Avatar a={a} size={40} live={live} />
        <div className="grow">
          <div className="row"><b>{a.name}</b>{live ? <Pill color="var(--molten)">working</Pill> : a.paused ? <Pill color="var(--muted)">paused</Pill> : a.wake ? <Pill color="var(--brass)">woken</Pill> : null}</div>
          <div className="small muted">{a.title} · {modelLabel(a.model)}</div>
        </div>
        <div style={{ textAlign: "right" }} className="small"><b>{money(a.spentUsd)}</b><div className="muted">{open} open</div></div>
      </div>
      <div style={{ marginTop: 8 }}><Meter frac={a.spentUsd / Math.max(0.01, a.budgetUsd)} color={a.spentUsd >= a.budgetUsd ? "var(--red)" : "var(--brass)"} /></div>
    </Link>
  );
}

export function HireModal({ b, edit, onClose }: { b: any; edit?: any; onClose: () => void }) {
  const s = b.state; const cat = useCatalog(); const [busy, run] = useBusy();
  const [f, setF] = useState<any>(edit ? { ...edit } : { name: "", title: "", role: "", instructions: "", model: "claude-haiku-5-5", budgetUsd: 5, heartbeatMin: 45, reportsTo: s.agents.find((a: any) => !a.reportsTo)?.id ?? "", emoji: "🤖" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={edit ? `Edit ${edit.name}` : "Hire an agent"} onClose={onClose}>
      <Field label="Name"><input className="input" value={f.name} onChange={set("name")} /></Field>
      <Field label="Job title"><input className="input" value={f.title} onChange={set("title")} placeholder="e.g. Wholesale Manager" /></Field>
      <Field label="Responsibilities"><textarea className="input" value={f.role} onChange={set("role")} /></Field>
      <Field label="How they should work" help="Tone, policies, things to never do. This becomes part of their instructions."><textarea className="input" value={f.instructions} onChange={set("instructions")} /></Field>
      <div className="grid g2">
        <Field label="Model" help="Haiku is cheapest; Opus is smartest"><select className="input" value={f.model} onChange={set("model")}>{(cat?.models ?? []).map((m: string) => <option key={m} value={m}>{modelLabel(m)}</option>)}</select></Field>
        <Field label="Reports to"><select className="input" value={f.reportsTo ?? ""} onChange={set("reportsTo")}><option value="">The owner (top)</option>{s.agents.filter((a: any) => a.id !== edit?.id).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Budget (USD)"><input className="input" inputMode="decimal" value={f.budgetUsd} onChange={set("budgetUsd")} /></Field>
        <Field label="Check in every (min)"><input className="input" inputMode="numeric" value={f.heartbeatMin} onChange={set("heartbeatMin")} /></Field>
      </div>
      <button className="btn block" disabled={busy || !f.name || !f.title} onClick={() => run(async () => {
        const body = { ...f, reportsTo: f.reportsTo || null, budgetUsd: Number(f.budgetUsd), heartbeatMin: Number(f.heartbeatMin) };
        if (edit) await act(b.id, "PATCH", `/agents/${edit.id}`, body); else await act(b.id, "POST", "/agents", body);
        onClose();
      }, edit ? "Saved" : `${f.name} joined the crew`)}>{edit ? "Save" : "Hire"}</button>
    </Modal>
  );
}

export function AgentPage({ b }: { b: any }) {
  const { aid } = useParams(); const s = b.state; const bid = b.id; const nav = useNavigate();
  const [busy, run] = useBusy(); const [edit, setEdit] = useState(false); const [assign, setAssign] = useState(false);
  const a = agentOf(s, aid); if (!a) return <Empty>This agent left the crew.</Empty>;
  const live = b.live?.includes(a.id);
  const tasks = s.tasks.filter((t: any) => t.assigneeId === a.id && OPEN.includes(t.status));
  const runs = s.runs.filter((r: any) => r.agentId === a.id).reverse();
  return (
    <div>
      <Link to={`/b/${bid}/team`} className="small">← Crew</Link>
      <div className="row" style={{ margin: "12px 0" }}>
        <Avatar a={a} size={64} />
        <div className="grow"><h1>{a.name}</h1><div className="muted">{a.title} · reports to {nameOf(s, a.reportsTo) === "Unassigned" ? "the owner" : nameOf(s, a.reportsTo)}</div></div>
      </div>
      {a.role && <p>{a.role}</p>}
      <div className="grid g4">
        <div className="card stat"><b>{money(a.spentUsd)}</b><span className="small muted">spent</span></div>
        <div className="card stat"><b>{money(a.budgetUsd)}</b><span className="small muted">budget</span></div>
        <div className="card stat"><b>{a.runs}</b><span className="small muted">check-ins</span></div>
        <div className="card stat"><b>{a.tasksDone}</b><span className="small muted">tasks done</span></div>
      </div>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy || live} onClick={() => run(() => act(bid, "POST", `/agents/${a.id}/run`), `${a.name} is on it`)}>{live ? "Working…" : "⚡ Run now"}</button>
        <button className="btn quiet" onClick={() => run(() => act(bid, "PATCH", `/agents/${a.id}`, { paused: !a.paused }))}>{a.paused ? "Resume" : "Pause"}</button>
        <button className="btn quiet" onClick={() => setAssign(true)}>Assign a task</button>
        <button className="btn quiet" onClick={() => setEdit(true)}>Edit</button>
        {a.reportsTo && <button className="btn danger" onClick={() => { if (confirm(`Let ${a.name} go? Their open work moves to their manager.`)) void run(async () => { await act(bid, "DELETE", `/agents/${a.id}`); nav(`/b/${bid}/team`); }); }}>Let go</button>}
      </div>
      <p className="small muted">{modelLabel(a.model)} · checks in every {a.heartbeatMin} min when there's work · last {ago(a.lastHeartbeat)}</p>
      {a.instructions && <><Section title="Instructions" /><div className="card small">{a.instructions}</div></>}
      <Section title={`Open work (${tasks.length})`} />
      <div className="stack">{tasks.map((t: any) => <TaskCard key={t.id} s={s} t={t} bid={bid} />)}</div>
      <Section title="Check-ins" />
      {runs.length ? runs.slice(0, 30).map((r: any) => <RunRow key={r.id} s={s} r={r} bid={bid} />) : <Empty>No check-ins yet.</Empty>}
      {edit && <HireModal b={b} edit={a} onClose={() => setEdit(false)} />}
      {assign && <NewTask b={b} assignee={a.id} onClose={() => setAssign(false)} />}
    </div>
  );
}

export function RunRow({ s, r, bid, showAgent }: any) {
  return (
    <Link to={`/b/${bid}/run/${r.id}`} className="row" style={{ color: "inherit", padding: "9px 0", alignItems: "flex-start", borderBottom: "1px solid var(--line)" }}>
      {showAgent && <Avatar a={agentOf(s, r.agentId)} size={28} />}
      <div className="grow">
        <div className="row small"><Pill color={r.status === "ok" ? "var(--green)" : r.status === "error" ? "var(--red)" : "var(--molten)"}>{r.status === "running" ? "working" : r.status}</Pill><span className="muted">{showAgent ? nameOf(s, r.agentId) + " · " : ""}{ago(r.startedAt)} · {money(r.costUsd)}</span></div>
        <div className="small clamp2" style={{ marginTop: 4 }}>{r.summary || r.reason}</div>
      </div>
    </Link>
  );
}

export function RunPage({ b }: { b: any }) {
  const { rid } = useParams(); const s = b.state; const r = s.runs.find((x: any) => x.id === rid);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (r?.status === "running") end.current?.scrollIntoView({ behavior: "smooth" }); }, [r?.events.length]);
  if (!r) return <Empty>Check-in not found.</Empty>;
  const icon: any = { think: ["●", "var(--text)"], tool: ["▸", "var(--gold)"], result: ["↳", "var(--faint)"], search: ["⌕", "var(--ice)"], error: ["!", "var(--red)"] };
  return (
    <div>
      <Link to={`/b/${b.id}/agent/${r.agentId}`} className="small">← {nameOf(s, r.agentId)}</Link>
      <h1 style={{ margin: "10px 0" }}>{nameOf(s, r.agentId)}'s check-in</h1>
      <div className="row small"><Pill color={r.status === "ok" ? "var(--green)" : r.status === "error" ? "var(--red)" : "var(--molten)"}>{r.status}</Pill><span className="muted">{money(r.costUsd)} · {Math.round(r.inTok / 1000)}k in / {Math.round(r.outTok / 1000)}k out · {ago(r.startedAt)}</span></div>
      <Section title="Why they woke up" /><div className="card small" style={{ whiteSpace: "pre-wrap" }}>{r.reason}</div>
      <Section title="What they did" />
      <div className="stack">{r.events.map((e: any, i: number) => (
        <div key={i} className="row" style={{ alignItems: "flex-start" }}>
          <span aria-hidden style={{ width: 20, flex: "none", textAlign: "center", fontWeight: 800, color: (icon[e.kind] ?? ["", ""])[1], fontSize: e.kind === "think" ? 9 : 15, lineHeight: "22px" }}>{(icon[e.kind] ?? ["•"])[0]}</span>
          {e.kind === "think" ? <div className="grow"><Markdown text={e.text} /></div>
            : <div className={"grow mono" + (e.kind === "result" ? " muted" : "")} style={{ color: e.kind === "tool" ? "var(--brass)" : e.kind === "error" ? "var(--red)" : undefined, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: e.kind === "result" ? 160 : undefined, overflow: "hidden" }}>{e.text}</div>}
        </div>
      ))}</div>
      {r.status === "running" ? <p className="row muted"><span className="pulse on" /> Working…</p> : r.summary && <><Section title="Summary" /><div className="card"><Markdown text={r.summary} /></div></>}
      <div ref={end} />
    </div>
  );
}
