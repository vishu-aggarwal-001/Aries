import { useState } from "react";
import { act, ago, nameOf, useCatalog } from "../api.ts";
import { Field, Loading, Modal, Section, Switch, useBusy } from "../ui.tsx";

export function Rules({ b }: { b: any }) {
  const s = b.state; const cat = useCatalog(); const [busy, run] = useBusy(); const [routine, setRoutine] = useState(false);
  const [goal, setGoal] = useState(s.goal); const [cap, setCap] = useState(String(s.settings.monthlyAgentBudgetUsd)); const [low, setLow] = useState(String(s.settings.lowStock));
  if (!cat) return <Loading />;
  const setPolicy = (k: string, p: any) => run(() => act(b.id, "PATCH", "/settings", { policies: { [k]: { ...s.policies[k], ...p } } }));
  return (
    <div>
      <h1>Rules</h1>
      <p className="muted">What your crew may do on its own, and what needs your OK. Lookups are always allowed.</p>
      <Section title="Real-world actions" />
      <div className="stack">{cat.categories.map((c: any) => {
        const p = s.policies[c.key];
        return (
          <div key={c.key} className="card">
            <div className="row"><div className="grow"><b>{c.label}</b><div className="small muted">{c.help}</div></div></div>
            <div className="chips" style={{ marginTop: 10 }}>
              {[["auto", "Do it"], ["ask", "Ask me"], ["never", "Never"]].map(([m, l]) => <button key={m} className={"chip" + (p.mode === m ? " on" : "")} disabled={busy} onClick={() => setPolicy(c.key, { mode: m })}>{l}</button>)}
            </div>
            {p.mode === "auto" && ["spend", "refund", "payment_link"].includes(c.key) && (
              <div className="row small" style={{ marginTop: 8 }}>
                <span className="grow muted">Automatically up to</span>
                <input className="input" style={{ width: 110 }} inputMode="decimal" defaultValue={p.autoLimitUsd} onBlur={e => setPolicy(c.key, { autoLimitUsd: Number(e.target.value) || 0 })} aria-label="Limit in USD" />
                <span className="muted">USD each</span>
              </div>
            )}
          </div>
        );
      })}</div>

      <Section title="The business" />
      <div className="card stack">
        <Field label="Goal"><textarea className="input" value={goal} onChange={e => setGoal(e.target.value)} /></Field>
        <div className="grid g2">
          <Field label="Monthly crew cap (USD)"><input className="input" inputMode="decimal" value={cap} onChange={e => setCap(e.target.value)} /></Field>
          <Field label="Low stock at or below"><input className="input" inputMode="numeric" value={low} onChange={e => setLow(e.target.value)} /></Field>
        </div>
        <div className="row"><span className="grow small">Turn new paid orders into fulfillment tasks</span><Switch on={s.settings.autoOrderTasks} onChange={v => run(() => act(b.id, "PATCH", "/settings", { settings: { autoOrderTasks: v } }))} /></div>
        <button className="btn" disabled={busy} onClick={() => run(() => act(b.id, "PATCH", "/settings", { goal, settings: { monthlyAgentBudgetUsd: Number(cap), lowStock: Number(low) } }), "Saved")}>Save</button>
      </div>

      <Section title="Routines" action={<button className="btn ghost sm" onClick={() => setRoutine(true)}>＋ Add</button>} />
      <div className="stack">{s.routines.map((r: any) => (
        <div key={r.id} className="card row">
          <div className="grow"><b>{r.title}</b><div className="small muted">{nameOf(s, r.assigneeId)} · every {r.everyHours % 24 === 0 ? `${r.everyHours / 24} day${r.everyHours > 24 ? "s" : ""}` : `${r.everyHours}h`} · last {ago(r.lastRun)}</div></div>
          <Switch on={r.enabled} onChange={v => run(() => act(b.id, "PATCH", `/routines/${r.id}`, { enabled: v }))} />
          <button className="btn ghost sm" onClick={() => run(() => act(b.id, "DELETE", `/routines/${r.id}`))}>✕</button>
        </div>
      ))}</div>
      {routine && <RoutineModal b={b} onClose={() => setRoutine(false)} />}
    </div>
  );
}

function RoutineModal({ b, onClose }: any) {
  const s = b.state; const [busy, run] = useBusy();
  const [f, setF] = useState({ title: "", description: "", assigneeId: s.agents[0]?.id, everyHours: "168" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="New routine" onClose={onClose}>
      <Field label="Title"><input className="input" value={f.title} onChange={set("title")} placeholder="Weekly sales report" /></Field>
      <Field label="What to do each time"><textarea className="input" value={f.description} onChange={set("description")} /></Field>
      <div className="grid g2">
        <Field label="Who"><select className="input" value={f.assigneeId} onChange={set("assigneeId")}>{s.agents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="How often"><select className="input" value={f.everyHours} onChange={set("everyHours")}>{[["6", "Every 6 hours"], ["24", "Daily"], ["72", "Every 3 days"], ["168", "Weekly"], ["720", "Monthly"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      </div>
      <button className="btn block" disabled={busy || !f.title} onClick={() => run(async () => { await act(b.id, "POST", "/routines", f); onClose(); }, "Routine added")}>Create</button>
    </Modal>
  );
}
