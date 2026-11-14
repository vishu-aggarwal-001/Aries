import { useState } from "react";
import { act, ago, req, useCatalog } from "../api.ts";
import { Empty, Field, Loading, Modal, Pill, Section, useBusy } from "../ui.tsx";

const TILE: any = { shopify: ["S", "#95bf47"], woocommerce: ["W", "#9b6fd6"], stripe: ["S", "#7a73ff"], shippo: ["Sh", "#3fb6e8"], email: ["@", "#f3b53f"], webhook: ["Z", "#ff7a4d"], mcp: ["M", "#8fb4ff"], api: ["{ }", "#c3a6ff"] };
const Tile = ({ type }: { type: string }) => { const [t, c] = TILE[type] ?? ["?", "#8d90b3"]; return <span aria-hidden style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", flex: "none", fontWeight: 800, fontStretch: "80%", fontSize: 15, color: c, background: `color-mix(in srgb, ${c} 14%, #0d0f1e)`, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)` }}>{t}</span>; };

export function Connections({ b }: { b: any }) {
  const s = b.state; const cat = useCatalog(); const [setup, setSetup] = useState<any>(null); const [busy, run] = useBusy();
  if (!cat) return <Loading />;
  const welcome = new URLSearchParams(location.search).get("welcome");
  const suggests = cat.templates.find((t: any) => t.key === s.kind)?.suggests ?? [];
  const groups = ["Store", "Payments", "Shipping", "Messaging", "Universal"];
  return (
    <div>
      <h1>Connections</h1>
      <p className="muted">{welcome ? "Your crew is hired. Connect the apps your business runs on so they can do real work." : "The apps your crew can use. Credentials are encrypted and never shown to agents."}</p>
      {s.connections.length > 0 && <>
        <Section title="Connected" />
        <div className="stack">{s.connections.map((c: any) => {
          const d = cat.connectors.find((x: any) => x.type === c.type);
          return (
            <div key={c.id} className="card">
              <div className="row">
                <Tile type={c.type} />
                <div className="grow"><div className="bold">{c.label}</div><div className="small muted">{d?.label}{c.info.shopName ? ` · ${c.info.shopName}` : ""}{c.info.mode === "test" ? " · test mode" : ""}{c.tools ? ` · ${c.tools.length} tools` : ""}{c.lastSync ? ` · synced ${ago(c.lastSync)}` : ""}</div></div>
                <Pill color={c.status === "connected" ? "var(--green)" : "var(--red)"}>{c.status}</Pill>
              </div>
              {c.error && <div className="small" style={{ color: "var(--red)", marginTop: 6 }}>{c.error}</div>}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn quiet sm" disabled={busy} onClick={() => run(() => act(b.id, "POST", `/connections/${c.id}/refresh`), "Refreshed")}>Test & sync</button>
                <button className="btn ghost sm" disabled={busy} onClick={() => { if (confirm(`Disconnect ${c.label}?`)) void run(() => act(b.id, "DELETE", `/connections/${c.id}`), "Disconnected"); }}>Disconnect</button>
              </div>
            </div>
          );
        })}</div>
      </>}
      {groups.map(g => (
        <div key={g}>
          <Section title={g === "Universal" ? "Connect anything else" : g} />
          <div className="stack">{cat.connectors.filter((c: any) => c.group === g).map((c: any) => (
            <button key={c.type} className="card click row" style={{ width: "100%", textAlign: "left" }} onClick={() => setSetup(c)}>
              <Tile type={c.type} />
              <div className="grow"><div className="row"><b>{c.label}</b>{suggests.includes(c.type) && <Pill color="var(--brass)">suggested</Pill>}</div><div className="small muted">{c.blurb}</div></div>
              <span className="muted">＋</span>
            </button>
          ))}</div>
        </div>
      ))}
      <p className="small muted" style={{ marginTop: 18 }}>Don't see your app? Most tools offer an MCP server, a REST API, or a Zapier/Make integration. Those three options cover almost anything.</p>
      {setup && <Setup b={b} c={setup} onClose={() => setSetup(null)} />}
    </div>
  );
}

function Setup({ b, c, onClose }: { b: any; c: any; onClose: () => void }) {
  const [busy, run] = useBusy(); const [label, setLabel] = useState(""); const [v, setV] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(!c.oauth);
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const connect = () => run(async () => { await act(b.id, "POST", "/connections", { type: c.type, label, values: v }); onClose(); }, `${c.label} connected`);
  const oauth = () => run(async () => { const r = await req("GET", `/api/b/${b.id}/oauth/shopify?shop=${encodeURIComponent(v.shop ?? "")}`); location.href = r.url; });
  return (
    <Modal title={`Connect ${c.label}`} onClose={onClose}>
      <p className="small muted">{c.blurb}{c.docsUrl && <> <a href={c.docsUrl} target="_blank" rel="noreferrer">Where do I find these?</a></>}</p>
      {c.oauth && !manual ? <>
        <Field label="Store address"><input className="input" placeholder="my-shop.myshopify.com" value={v.shop ?? ""} onChange={set("shop")} /></Field>
        <button className="btn block" disabled={busy || !v.shop} onClick={oauth}>Continue to Shopify</button>
        <button className="btn ghost block" onClick={() => setManual(true)}>I have an access token instead</button>
      </> : <>
        <Field label="Name (optional)"><input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder={c.label} /></Field>
        {c.fields.map((f: any) => (
          <Field key={f.key} label={f.label + (f.optional ? " (optional)" : "")} help={f.help}>
            {f.multiline ? <textarea className="input" value={v[f.key] ?? ""} onChange={set(f.key)} placeholder={f.placeholder} />
              : <input className="input" type={f.secret ? "password" : "text"} autoComplete="off" value={v[f.key] ?? ""} onChange={set(f.key)} placeholder={f.placeholder} />}
          </Field>
        ))}
        <button className="btn block" disabled={busy} onClick={connect}>{busy ? "Checking…" : "Connect"}</button>
      </>}
      <p className="tiny muted">Reads are always allowed. Anything that sends messages, spends or refunds money, or changes your store follows your <a href={`/b/${b.id}/rules`}>Rules</a>.</p>
    </Modal>
  );
}
export { Empty };
