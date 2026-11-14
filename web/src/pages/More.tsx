import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { act, ago, agentOf, auth, money, nameOf, req, useCatalog, useMe } from "../api.ts";
import { Avatar, Logo, Empty, Field, Loading, Markdown, Pill, Section, toast, useBusy } from "../ui.tsx";
import { ActionRow } from "./Work.tsx";
import { RunRow } from "./Team.tsx";

export function More({ b }: { b: any }) {
  const items = [
    ["connections", "⇄", "Connections", `${b.state.connections.length} apps connected`], ["rules", "⚖", "Rules & routines", "What the crew may do on its own"],
    ["ledger", "≣", "Ledger", "Every real-world action, with results"], ["docs", "❏", "Deliverables", `${b.state.docs.length} documents`],
    ["activity", "◷", "Activity & check-ins", "Everything that happened"], ["billing", "◈", "Plan & billing", b.billing.label],
  ];
  return (
    <div>
      <h1>More</h1>
      <div className="stack" style={{ marginTop: 14 }}>
        {items.map(([to, ico, t, sub]) => <Link key={to} to={`/b/${b.id}/${to}`} className="card click row" style={{ color: "inherit" }}><span style={{ fontSize: 20, width: 28, color: "var(--molten)" }}>{ico}</span><div className="grow"><b>{t}</b><div className="small muted">{sub}</div></div>›</Link>)}
        <Invite b={b} />
        <button className="btn ghost block" onClick={() => req("GET", `/api/b/${b.id}/export`).then(d => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: "application/json" })); a.download = `${b.state.name}.aries.json`; a.click(); })}>Export business data</button>
        <button className="btn ghost block" onClick={() => { auth.set(""); location.href = "/login"; }}>Sign out</button>
        <button className="btn danger block" onClick={async () => {
          if (!confirm("Delete your Aries account? Businesses you own alone, their crews, data and connections are permanently deleted.")) return;
          if (prompt('Type DELETE to confirm') !== "DELETE") return;
          await req("DELETE", "/api/me"); auth.set(""); location.href = "/signup";
        }}>Delete account</button>
      </div>
    </div>
  );
}

function Invite({ b }: { b: any }) {
  const [email, setEmail] = useState(""); const [busy, run] = useBusy();
  if (b.role !== "owner") return null;
  return (
    <div className="card stack">
      <b>Invite a teammate</b><div className="small muted">They can approve requests and direct the crew. They need a Aries account.</div>
      <div className="row"><input className="input grow" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@business.com" /><button className="btn" disabled={busy || !email} onClick={() => run(async () => { await act(b.id, "POST", "/members", { email }); setEmail(""); }, "Added")}>Add</button></div>
    </div>
  );
}

export function Ledger({ b }: { b: any }) {
  const s = b.state; const [f, setF] = useState("all");
  const list = s.actions.filter((a: any) => f === "all" || a.status === f).reverse();
  const spent = s.actions.filter((a: any) => a.status === "done" && a.amountUsd > 0).reduce((x: number, a: any) => x + a.amountUsd, 0);
  return (
    <div>
      <h1>Ledger</h1>
      <p className="muted">Every action your crew took (or tried to take) in the outside world. {spent > 0 && `${money(spent)} spent through the crew.`}</p>
      <div className="chips" style={{ margin: "12px 0" }}>{["all", "done", "pending", "failed", "rejected", "blocked"].map(x => <button key={x} className={"chip" + (f === x ? " on" : "")} onClick={() => setF(x)}>{x}</button>)}</div>
      <div className="stack">{list.length ? list.map((a: any) => <ActionRow key={a.id} s={s} a={a} />) : <Empty>Nothing yet.</Empty>}</div>
    </div>
  );
}

export function Docs({ b }: { b: any }) {
  const s = b.state; const [q, setQ] = useState("");
  const list = s.docs.filter((d: any) => !q || `${d.title} ${d.body}`.toLowerCase().includes(q.toLowerCase())).sort((a: any, c: any) => c.updatedAt - a.updatedAt);
  return (
    <div>
      <h1>Deliverables</h1>
      <input className="input" style={{ margin: "12px 0" }} placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
      <div className="stack">{list.length ? list.map((d: any) => (
        <Link key={d.id} to={`/b/${b.id}/doc/${d.id}`} className="card click row" style={{ color: "inherit" }}><Avatar a={agentOf(s, d.authorId)} size={30} /><div className="grow"><b>{d.title}</b><div className="small muted">{nameOf(s, d.authorId)} · v{d.version} · {ago(d.updatedAt)}</div></div></Link>
      )) : <Empty>Your crew saves their work here.</Empty>}</div>
    </div>
  );
}

export function DocPage({ b }: { b: any }) {
  const { did } = useParams(); const s = b.state; const d = s.docs.find((x: any) => x.id === did);
  if (!d) return <Empty>Document not found.</Empty>;
  const t = s.tasks.find((x: any) => x.id === d.taskId);
  return (
    <div>
      <div className="row"><Link to={`/b/${b.id}/docs`} className="small grow">← Deliverables</Link>
        <button className="btn quiet sm" onClick={() => navigator.clipboard?.writeText(d.body).then(() => toast("Copied"))}>Copy</button>
        {"share" in navigator && <button className="btn quiet sm" onClick={() => (navigator as any).share({ title: d.title, text: d.body }).catch(() => {})}>Share</button>}
      </div>
      <h1 style={{ margin: "12px 0 6px" }}>{d.title}</h1>
      <p className="small muted">{nameOf(s, d.authorId)} · version {d.version} · {ago(d.updatedAt)}{t && <> · on <Link to={`/b/${b.id}/task/${t.id}`}>#{t.number}</Link></>}</p>
      <div className="card"><Markdown text={d.body} /></div>
    </div>
  );
}

export function ActivityPage({ b }: { b: any }) {
  const s = b.state; const [tab, setTab] = useState<"activity" | "runs">("activity");
  return (
    <div>
      <h1>Activity</h1>
      <div className="chips" style={{ margin: "12px 0" }}><button className={"chip" + (tab === "activity" ? " on" : "")} onClick={() => setTab("activity")}>Everything</button><button className={"chip" + (tab === "runs" ? " on" : "")} onClick={() => setTab("runs")}>Check-ins</button></div>
      {tab === "runs" ? s.runs.slice().reverse().map((r: any) => <RunRow key={r.id} s={s} r={r} bid={b.id} showAgent />)
        : s.activity.slice().reverse().map((a: any) => <div key={a.id} className="small" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}><b>{nameOf(s, a.actor)}</b> {a.taskId ? <Link to={`/b/${b.id}/task/${a.taskId}`} style={{ color: "inherit" }}>{a.text}</Link> : a.text} <span className="muted">· {ago(a.ts)}</span></div>)}
    </div>
  );
}

export function Billing({ b }: { b: any }) {
  const cat = useCatalog(); const [busy, run] = useBusy();
  if (!cat) return <Loading />;
  const bill = b.billing; const ok = new URLSearchParams(location.search).get("ok");
  return (
    <div>
      <h1>Plan & billing</h1>
      {ok && <div className="card hot" style={{ margin: "12px 0" }}>Thanks! Your plan is being activated; this page updates in a moment.</div>}
      <div className="card" style={{ margin: "12px 0" }}>
        <div className="row"><b className="grow">{bill.label}</b>{bill.active ? <Pill color="var(--green)">active</Pill> : <Pill color="var(--red)">{bill.reason}</Pill>}</div>
        <div className="small muted" style={{ marginTop: 6 }}>AI credit used this period: {money(bill.usageUsd)} of {money(bill.creditUsd)} · renews {new Date(bill.periodEnds).toLocaleDateString()}</div>
        {bill.plan !== "trial" && <button className="btn quiet sm" style={{ marginTop: 10 }} disabled={busy} onClick={() => run(async () => { const r = await act(b.id, "POST", "/billing/portal"); location.href = r.url; })}>Manage subscription</button>}
      </div>
      {/* Google Play: no external purchase flows inside the Android app. Plans are managed on the web. */}
      {navigator.userAgent.includes("AriesAndroid") ? <div className="card small muted">Plans are managed on the Aries website from your computer.</div> :
      <div className="stack">{cat.plans.filter((p: any) => p.key !== "trial").map((p: any) => (
        <div key={p.key} className={"card" + (p.key === bill.plan ? " hot" : "")}>
          <div className="row"><h2 className="grow">{p.label}</h2><b style={{ fontSize: 20 }}>${p.priceUsd}<span className="small muted">/mo</span></b></div>
          <div className="small muted">{p.blurb}</div>
          <ul className="small" style={{ margin: "8px 0", paddingLeft: 18 }}><li>Up to {p.agents} crew members</li><li>{p.businesses} business{p.businesses > 1 ? "es" : ""}</li><li>All connections, rules and routines</li><li>Includes a generous monthly AI allowance</li></ul>
          {p.key !== bill.plan && <button className="btn block" disabled={busy} onClick={() => run(async () => { const r = await act(b.id, "POST", "/billing/checkout", { plan: p.key }); location.href = r.url; })}>Choose {p.label}</button>}
        </div>
      ))}</div>}
    </div>
  );
}

/** Android / PWA share target: turn shared text into a task. */
export function Share() {
  const me = useMe(); const nav = useNavigate(); const [busy, run] = useBusy();
  const p = new URLSearchParams(location.search);
  const [text, setText] = useState([p.get("title"), p.get("text"), p.get("url")].filter(Boolean).join("\n"));
  const [bid, setBid] = useState<string>("");
  if (!auth.token) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!me.data) return <Loading />;
  const target = bid || me.data.businesses[0]?.id;
  if (!target) return <Navigate to="/new" replace />;
  return (
    <div className="auth"><div className="box stack">
      <div className="brand"><Logo />Aries</div>
      <h1>Hand this to your crew</h1>
      <p className="muted small">A customer message, a supplier email, an idea… Aries routes it to the right person.</p>
      {me.data.businesses.length > 1 && <Field label="Business"><select className="input" value={target} onChange={e => setBid(e.target.value)}>{me.data.businesses.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
      <textarea className="input" style={{ minHeight: 180 }} value={text} onChange={e => setText(e.target.value)} />
      <button className="btn block" disabled={busy || !text.trim()} onClick={() => run(async () => { const t = await req("POST", `/api/b/${target}/share`, { text }); nav(`/b/${target}/task/${t.id}`); }, "Sent to the crew")}>Send to crew</button>
    </div></div>
  );
}
