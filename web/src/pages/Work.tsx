import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { act, ago, agentOf, nameOf, OPEN, prioColor, STATUSES, statusColor, statusLabel } from "../api.ts";
import { Avatar, Empty, Field, Markdown, Modal, Pill, Section, useBusy } from "../ui.tsx";

export function TaskCard({ s, t, bid }: { s: any; t: any; bid: string }) {
  const nc = s.comments.filter((c: any) => c.taskId === t.id).length; const nd = s.docs.filter((d: any) => d.taskId === t.id).length;
  return (
    <Link to={`/b/${bid}/task/${t.id}`} className="card click" style={{ display: "block", color: "inherit" }}>
      <div className="row small">
        <span className="muted bold">#{t.number}</span><Pill color={statusColor(t.status)}>{statusLabel(t.status)}</Pill>
        {t.priority !== "medium" && <Pill color={prioColor(t.priority)}>{t.priority}</Pill>}
        {t.orderId && <Pill color="var(--brass)">order</Pill>}
        <span className="grow" />{nd > 0 && <span className="muted">📄{nd}</span>}{nc > 0 && <span className="muted">💬{nc}</span>}
      </div>
      <div className="bold clamp2" style={{ margin: "6px 0" }}>{t.title}</div>
      <div className="row small muted"><Avatar a={agentOf(s, t.assigneeId)} size={22} /><span className="grow">{nameOf(s, t.assigneeId)}</span><span>{ago(t.updatedAt)}</span></div>
    </Link>
  );
}

export function Work({ b }: { b: any }) {
  const s = b.state; const [filter, setFilter] = useState("open"); const [who, setWho] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const count = (f: string) => s.tasks.filter((t: any) => f === "open" ? OPEN.includes(t.status) : f === "all" ? true : t.status === f).length;
  const list = s.tasks.filter((t: any) => (filter === "open" ? OPEN.includes(t.status) : filter === "all" || t.status === filter) && (!who || t.assigneeId === who))
    .sort((a: any, c: any) => ["urgent", "high", "medium", "low"].indexOf(a.priority) - ["urgent", "high", "medium", "low"].indexOf(c.priority) || c.updatedAt - a.updatedAt);
  return (
    <div>
      <h1>Work</h1>
      <p className="muted">{count("open")} open · {count("done")} done</p>
      <div className="chips" style={{ margin: "12px 0 8px" }}>
        {["open", "todo", "in_progress", "in_review", "blocked", "backlog", "done", "all"].map(f => (
          <button key={f} className={"chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>{f === "open" || f === "all" ? f[0].toUpperCase() + f.slice(1) : statusLabel(f)} {count(f)}</button>
        ))}
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={"chip" + (!who ? " on" : "")} onClick={() => setWho(null)}>Everyone</button>
        {s.agents.map((a: any) => <button key={a.id} className={"chip" + (who === a.id ? " on" : "")} onClick={() => setWho(who === a.id ? null : a.id)}>{a.name}</button>)}
      </div>
      <div className="stack">{list.length ? list.map((t: any) => <TaskCard key={t.id} s={s} t={t} bid={b.id} />) : <Empty>No tasks here.</Empty>}</div>
      <button className="btn fab" onClick={() => setCreating(true)}>＋ New task</button>
      {creating && <NewTask b={b} onClose={() => setCreating(false)} />}
    </div>
  );
}

export function NewTask({ b, parent, assignee, order, onClose }: { b: any; parent?: any; assignee?: string; order?: any; onClose: () => void }) {
  const s = b.state; const [busy, run] = useBusy();
  const [f, setF] = useState({ title: "", description: "", assigneeId: assignee ?? parent?.assigneeId ?? s.agents.find((a: any) => !a.reportsTo)?.id ?? "", priority: "medium" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={parent ? `Subtask of #${parent.number}` : order ? `Task for order ${order.number}` : "New task"} onClose={onClose}>
      <Field label="Title"><input className="input" value={f.title} onChange={set("title")} autoFocus /></Field>
      <Field label="What does done look like?"><textarea className="input" value={f.description} onChange={set("description")} /></Field>
      <div className="grid g2">
        <Field label="Assignee"><select className="input" value={f.assigneeId} onChange={set("assigneeId")}><option value="">Unassigned</option>{s.agents.map((a: any) => <option key={a.id} value={a.id}>{a.name} · {a.title}</option>)}</select></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={set("priority")}>{["urgent", "high", "medium", "low"].map(p => <option key={p}>{p}</option>)}</select></Field>
      </div>
      <button className="btn block" disabled={busy || !f.title.trim()} onClick={() => run(async () => { await act(b.id, "POST", "/tasks", { ...f, assigneeId: f.assigneeId || null, parentId: parent?.id, orderId: order?.id }); onClose(); }, "Task created")}>Create task</button>
    </Modal>
  );
}

export function TaskPage({ b }: { b: any }) {
  const { tid } = useParams(); const s = b.state; const bid = b.id;
  const t = s.tasks.find((x: any) => x.id === tid);
  const [reply, setReply] = useState(""); const [sub, setSub] = useState(false); const [busy, run] = useBusy();
  if (!t) return <Empty>This task no longer exists.</Empty>;
  const upd = (body: any) => run(() => act(bid, "PATCH", `/tasks/${t.id}`, body));
  const parent = s.tasks.find((x: any) => x.id === t.parentId); const order = s.orders.find((o: any) => o.id === t.orderId);
  const subs = s.tasks.filter((x: any) => x.parentId === t.id); const docs = s.docs.filter((d: any) => d.taskId === t.id);
  const comments = s.comments.filter((c: any) => c.taskId === t.id);
  const actions = s.actions.filter((a: any) => a.taskId === t.id);
  return (
    <div>
      <div className="row small muted"><Link to={`/b/${bid}/work`}>← Work</Link><span className="grow" />#{t.number} · created by {nameOf(s, t.createdBy)} {ago(t.createdAt)}</div>
      <h1 style={{ margin: "10px 0 14px" }}>{t.title}</h1>
      <div className="grid g2">
        <Field label="Status"><select className="input" value={t.status} onChange={e => upd({ status: e.target.value })}>{STATUSES.map(x => <option key={x} value={x}>{statusLabel(x)}</option>)}</select></Field>
        <Field label="Priority"><select className="input" value={t.priority} onChange={e => upd({ priority: e.target.value })}>{["urgent", "high", "medium", "low"].map(p => <option key={p}>{p}</option>)}</select></Field>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="grow"><Field label="Assignee"><select className="input" value={t.assigneeId ?? ""} onChange={e => upd({ assigneeId: e.target.value || null })}><option value="">Unassigned</option>{s.agents.map((a: any) => <option key={a.id} value={a.id}>{a.name} · {a.title}</option>)}</select></Field></div>
        {t.assigneeId && <button className="btn quiet" style={{ marginTop: 18 }} disabled={busy} onClick={() => run(() => act(bid, "POST", `/tasks/${t.id}/comments`, { body: "Nudge from the owner: please pick this up." }), "Nudged")}>Nudge</button>}
      </div>
      {parent && <p className="small">↳ Part of <Link to={`/b/${bid}/task/${parent.id}`}>#{parent.number} {parent.title}</Link></p>}
      {order && <p className="small">📦 Order <Link to={`/b/${bid}/order/${order.id}`}>{order.number}</Link> · {order.customer.name}</p>}
      {t.description && <div className="card" style={{ marginTop: 12 }}><Markdown text={t.description} /></div>}

      <Section title={`Subtasks (${subs.length})`} action={<button className="btn ghost sm" onClick={() => setSub(true)}>＋ Add</button>} />
      <div className="stack">{subs.map((x: any) => <TaskCard key={x.id} s={s} t={x} bid={bid} />)}</div>

      {docs.length > 0 && <><Section title="Deliverables" /><div className="stack">{docs.map((d: any) => <Link key={d.id} to={`/b/${bid}/doc/${d.id}`} className="card click row" style={{ color: "inherit" }}>📄<div className="grow"><div className="bold">{d.title}</div><div className="small muted">{nameOf(s, d.authorId)} · v{d.version} · {ago(d.updatedAt)}</div></div></Link>)}</div></>}
      {actions.length > 0 && <><Section title="Real-world actions" /><div className="stack">{actions.map((a: any) => <ActionRow key={a.id} s={s} a={a} />)}</div></>}

      <Section title="Discussion" />
      <div className="stack">
        {comments.length ? comments.map((c: any) => (
          <div key={c.id} className={"bubble" + (c.authorId === "board" ? " me" : "")}>
            <div className="tiny muted bold">{nameOf(s, c.authorId)} · {ago(c.createdAt)}</div><Markdown text={c.body} />
          </div>
        )) : <Empty>No comments yet. Anything you write wakes the assignee.</Empty>}
      </div>
      <form className="row" style={{ marginTop: 12 }} onSubmit={e => { e.preventDefault(); void run(async () => { await act(bid, "POST", `/tasks/${t.id}/comments`, { body: reply }); setReply(""); }); }}>
        <textarea className="input grow" style={{ minHeight: 44 }} value={reply} onChange={e => setReply(e.target.value)} placeholder="Comment, or @mention a crew member" />
        <button className="btn" disabled={busy || !reply.trim()}>Send</button>
      </form>
      {sub && <NewTask b={b} parent={t} onClose={() => setSub(false)} />}
    </div>
  );
}

export function ActionRow({ s, a }: { s: any; a: any }) {
  const color = ({ done: "var(--green)", failed: "var(--red)", rejected: "var(--red)", blocked: "var(--red)", pending: "var(--brass)", running: "var(--molten)" } as any)[a.status];
  return (
    <div className="card">
      <div className="row small"><Pill color={color}>{a.status}</Pill><span className="muted grow">{nameOf(s, a.requestedBy)} · {s.connections.find((c: any) => c.id === a.connectionId)?.label ?? "app"} · {ago(a.createdAt)}</span>{a.amountUsd > 0 && <b>${a.amountUsd.toFixed(2)}</b>}</div>
      <div className="small" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{a.summary.split("\n")[0]}</div>
      {a.result && <div className="small muted" style={{ marginTop: 4 }}><Markdown text={a.result.slice(0, 600)} /></div>}
    </div>
  );
}
