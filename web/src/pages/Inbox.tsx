import { useState } from "react";
import { Link } from "react-router-dom";
import { act, ago, agentOf, modelLabel, money, nameOf } from "../api.ts";
import { Avatar, Empty, Markdown, Pill, Section, useBusy } from "../ui.tsx";

const KIND: any = { hire: ["Hire", "var(--blue)"], review: ["Review", "var(--violet)"], question: ["Question", "var(--brass)"], budget: ["Budget", "var(--red)"], action: ["Action", "var(--molten)"] };

export function Inbox({ b }: { b: any }) {
  const s = b.state;
  const pending = s.approvals.filter((a: any) => a.status === "pending").reverse();
  const done = s.approvals.filter((a: any) => a.status !== "pending").reverse().slice(0, 40);
  return (
    <div>
      <h1>Inbox</h1>
      <p className="muted">{pending.length ? `${pending.length} waiting on you` : "Nothing needs you right now."}</p>
      <div className="stack" style={{ marginTop: 14 }}>{pending.map((a: any) => <ApprovalCard key={a.id} b={b} a={a} />)}</div>
      {done.length > 0 && <>
        <Section title="Decided" />
        {done.map((a: any) => (
          <div key={a.id} className="row small" style={{ padding: "6px 0" }}>
            <Pill color={a.status === "approved" ? "var(--green)" : "var(--red)"}>{a.status}</Pill><span className="grow ellipsis">{a.title}</span><span className="muted">{ago(a.resolvedAt)}</span>
          </div>
        ))}
      </>}
    </div>
  );
}

function ApprovalCard({ b, a }: { b: any; a: any }) {
  const s = b.state; const [note, setNote] = useState(""); const [busy, run] = useBusy();
  const [kind, color] = KIND[a.type] ?? ["Request", "var(--muted)"];
  const action = a.actionId ? s.actions.find((x: any) => x.id === a.actionId) : null;
  const decide = (approve: boolean) => run(() => act(b.id, "POST", `/approvals/${a.id}`, { approve, note }), approve ? "Approved" : "Declined");
  const placeholder = ({ question: "Your answer", budget: "Amount to add (default 5)", review: "Feedback (sent back if you request changes)", action: "Optional note to the crew" } as any)[a.type] ?? "Optional note";
  return (
    <div className="card stack">
      <div className="row"><Avatar a={agentOf(s, a.requestedBy)} size={30} /><div className="grow"><div className="bold">{nameOf(s, a.requestedBy)}</div><div className="tiny muted">{ago(a.createdAt)}</div></div><Pill color={color}>{kind}</Pill></div>
      <h2>{a.title}</h2>
      {a.type === "action" && action ? (
        <div className="card" style={{ background: "var(--surface2)" }}>
          <div className="small muted">{s.connections.find((c: any) => c.id === action.connectionId)?.label} · {action.category.replace("_", " ")}{action.amountUsd > 0 ? ` · ${money(action.amountUsd)}` : ""}</div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{action.summary}</div>
        </div>
      ) : a.body && <Markdown text={a.body} />}
      {a.hire && (
        <div className="card row" style={{ background: "var(--surface2)" }}>
          <Avatar a={a.hire} size={34} />
          <div className="grow"><b>{a.hire.name} · {a.hire.title}</b><div className="small muted">{modelLabel(a.hire.model)} · budget {money(a.hire.budgetUsd)}</div><div className="small">{a.hire.role}</div></div>
        </div>
      )}
      {a.type === "review" && s.docs.filter((d: any) => d.taskId === a.taskId).map((d: any) => <Link key={d.id} to={`/b/${b.id}/doc/${d.id}`} className="card click row" style={{ color: "inherit" }}>📄 <span className="grow bold">{d.title}</span><span className="small muted">v{d.version}</span></Link>)}
      {a.taskId && <Link to={`/b/${b.id}/task/${a.taskId}`} className="small">Open the task</Link>}
      <textarea className="input" style={{ minHeight: 44 }} value={note} onChange={e => setNote(e.target.value)} placeholder={placeholder} />
      <div className="grid g2">
        <button className="btn ghost" disabled={busy} onClick={() => decide(false)}>{({ review: "Request changes", question: "No" } as any)[a.type] ?? "Decline"}</button>
        <button className="btn" disabled={busy} onClick={() => decide(true)}>{({ review: "Approve", question: note ? "Send answer" : "Yes", hire: "Hire", budget: "Add budget", action: "Approve & do it" } as any)[a.type]}</button>
      </div>
    </div>
  );
}
