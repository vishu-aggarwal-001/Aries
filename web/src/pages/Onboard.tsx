import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { auth, reloadMe, req, useCatalog } from "../api.ts";
import { Logo, Sky, Field, Loading, useBusy } from "../ui.tsx";

export function NewBusiness() {
  const cat = useCatalog(); const nav = useNavigate(); const [busy, run] = useBusy();
  const [step, setStep] = useState(0); const [tpl, setTpl] = useState("store");
  const [f, setF] = useState({ name: "", goal: "", notes: "", budget: "40" });
  if (!auth.token) return <Navigate to="/login?next=/new" replace />;
  if (!cat) return <Loading />;
  const t = cat.templates.find((x: any) => x.key === tpl);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="auth">
      <div className="box stack" style={{ maxWidth: 560 }}>
        <div className="brand"><Logo />Aries</div>
        {step === 0 ? <>
          <h1>What kind of business?</h1>
          <p className="muted">We'll start you with the right crew. You can hire, fire and retrain anyone later.</p>
          {cat.templates.map((x: any) => (
            <button key={x.key} className={"tpl" + (x.key === tpl ? " on" : "")} onClick={() => setTpl(x.key)}>
              <div className="bold">{x.label}</div>
              <div className="small muted">{x.blurb}</div>
              <div className="small" style={{ marginTop: 6 }}>{x.team.map((m: any) => m.title).join(", ")}</div>
            </button>
          ))}
          <button className="btn block" onClick={() => { if (!f.goal) setF({ ...f, goal: t.goalHint }); setStep(1); }}>Next</button>
        </> : <>
          <h1>Tell your crew about the business</h1>
          <Field label="Business name"><input className="input" value={f.name} onChange={set("name")} placeholder="Reed & Co" /></Field>
          <Field label="The goal" help="Be specific about outcomes. Your CEO agent turns this into a plan."><textarea className="input" value={f.goal} onChange={set("goal")} /></Field>
          <Field label="Anything they should know?" help="What you sell, your customers, tone of voice, shipping promise, return policy…"><textarea className="input" value={f.notes} onChange={set("notes")} placeholder="We sell handmade woodwind accessories to students and pros. Ship in 2 days. Friendly, short emails." /></Field>
          <Field label="Monthly spending cap for the crew (USD)" help="Your own safety limit on AI work. The crew pauses if it's reached."><input className="input" inputMode="decimal" value={f.budget} onChange={set("budget")} /></Field>
          <button className="btn block" disabled={busy || !f.name.trim() || !f.goal.trim()} onClick={() => run(async () => {
            const r = await req("POST", "/api/businesses", { ...f, template: tpl }); await reloadMe();
            try { localStorage.setItem("aries.last", r.id); } catch { /* */ }
            nav(`/b/${r.id}/connections?welcome=1`);
          })}>{busy ? "Setting up…" : `Hire the ${t.label.toLowerCase()} crew`}</button>
          <button className="btn ghost block" onClick={() => setStep(0)}>Back</button>
        </>}
      </div>
    </div>
  );
}
