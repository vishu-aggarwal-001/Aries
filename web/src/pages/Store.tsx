import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { act, ago, money, statusColor, statusLabel } from "../api.ts";
import { Empty, Field, Modal, Pill, Section, useBusy, toast } from "../ui.tsx";
import { ActionRow, NewTask, TaskCard } from "./Work.tsx";

const STAGES = ["new", "to_ship", "shipped", "delivered", "cancelled"];
const toolFor = (b: any, tool: string, connectionId?: string | null) => b.tools.find((t: any) => t.tool === tool && (!connectionId || t.connection === connectionId))?.name;

export function Store({ b }: { b: any }) {
  const s = b.state; const bid = b.id;
  const [tab, setTab] = useState<"orders" | "products" | "customers">("orders");
  const [stage, setStage] = useState("open"); const [q, setQ] = useState("");
  const [adding, setAdding] = useState<null | "order" | "product">(null);
  const match = (x: string) => !q || x.toLowerCase().includes(q.toLowerCase());
  const orders = s.orders.filter((o: any) => (stage === "open" ? ["new", "to_ship"].includes(o.stage) : stage === "all" || o.stage === stage) && match(`${o.number} ${o.customer.name} ${o.customer.email} ${o.items.map((i: any) => i.title).join(" ")}`));
  const customers = Object.values(s.orders.reduce((m: any, o: any) => {
    const k = (o.customer.email || o.customer.name || "unknown").toLowerCase();
    m[k] ??= { name: o.customer.name, email: o.customer.email, n: 0, total: 0, last: 0, currency: o.currency };
    m[k].n++; if (o.paid && o.stage !== "cancelled") m[k].total += o.total; m[k].last = Math.max(m[k].last, o.createdAt); return m;
  }, {})).filter((c: any) => match(`${c.name} ${c.email}`)).sort((a: any, c: any) => c.total - a.total) as any[];
  return (
    <div>
      <div className="row"><h1 className="grow">Store</h1>
        <button className="btn quiet sm" onClick={() => setAdding(tab === "products" ? "product" : "order")}>＋ {tab === "products" ? "Product" : "Order"}</button>
      </div>
      <p className="muted small">{s.connections.filter((c: any) => ["shopify", "woocommerce"].includes(c.type)).map((c: any) => `${c.label} · synced ${ago(c.lastSync)}`).join(" · ") || <>No store connected. <Link to={`/b/${bid}/connections`}>Connect one</Link> or add orders by hand.</>}</p>
      <div className="chips" style={{ margin: "12px 0" }}>
        {(["orders", "products", "customers"] as const).map(t => <button key={t} className={"chip" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      <input className="input" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      {tab === "orders" && <>
        <div className="chips" style={{ marginBottom: 10 }}>
          {["open", ...STAGES, "all"].map(x => <button key={x} className={"chip" + (stage === x ? " on" : "")} onClick={() => setStage(x)}>{x === "open" ? "Needs action" : x === "all" ? "All" : statusLabel(x)} {s.orders.filter((o: any) => x === "open" ? ["new", "to_ship"].includes(o.stage) : x === "all" || o.stage === x).length}</button>)}
        </div>
        <div className="stack">{orders.length ? orders.slice(0, 100).map((o: any) => (
          <Link key={o.id} to={`/b/${bid}/order/${o.id}`} className="card click" style={{ display: "block", color: "inherit" }}>
            <div className="row"><b>{o.number}</b><Pill color={statusColor(o.stage)}>{statusLabel(o.stage)}</Pill>{!o.paid && <Pill color="var(--red)">unpaid</Pill>}<span className="grow" /><b>{money(o.total, o.currency)}</b></div>
            <div className="small" style={{ marginTop: 4 }}>{o.customer.name || o.customer.email || "Customer"} · <span className="muted">{ago(o.createdAt)}</span></div>
            <div className="small muted ellipsis">{o.items.map((i: any) => `${i.qty}× ${i.title}`).join(", ")}</div>
          </Link>
        )) : <Empty>No orders here.</Empty>}</div>
      </>}
      {tab === "products" && <div className="stack">{s.products.filter((p: any) => match(`${p.title} ${p.sku}`)).map((p: any) => {
        const low = p.inventory != null && p.inventory <= s.settings.lowStock;
        return (
          <div key={p.id} className={"card row" + (low ? " hot" : "")}>
            <div className="grow"><div className="bold">{p.title}</div><div className="small muted">{p.sku || "no SKU"} · {s.connections.find((c: any) => c.id === p.connectionId)?.label ?? "manual"} · {p.status}</div></div>
            <div style={{ textAlign: "right" }}><div className="bold">{money(p.price, p.currency)}</div><div className={"small" + (low ? "" : " muted")}>{p.inventory == null ? "untracked" : `${p.inventory} in stock`}</div></div>
          </div>
        );
      })}{!s.products.length && <Empty>No products yet.</Empty>}</div>}
      {tab === "customers" && <div className="stack">{customers.map((c: any) => (
        <div key={c.email + c.name} className="card row">
          <div className="grow"><div className="bold">{c.name || c.email}</div><div className="small muted">{c.email} · {c.n} order{c.n > 1 ? "s" : ""} · last {ago(c.last)}</div></div>
          <b>{money(c.total, c.currency)}</b>
        </div>
      ))}{!customers.length && <Empty>Customers appear as orders come in.</Empty>}</div>}
      {adding === "order" && <NewOrder bid={bid} onClose={() => setAdding(null)} />}
      {adding === "product" && <NewProduct bid={bid} onClose={() => setAdding(null)} />}
    </div>
  );
}

function NewOrder({ bid, onClose }: { bid: string; onClose: () => void }) {
  const [busy, run] = useBusy();
  const [f, setF] = useState<any>({ customerName: "", customerEmail: "", item: "", qty: "1", total: "", currency: "USD", line1: "", city: "", state: "", zip: "", country: "US", paid: true });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <Modal title="Add an order" onClose={onClose}>
      <p className="small muted">For phone, in-person or marketplace orders that aren't synced. Paid orders become a fulfillment task.</p>
      <div className="grid g2"><Field label="Customer name"><input className="input" value={f.customerName} onChange={set("customerName")} /></Field><Field label="Email"><input className="input" value={f.customerEmail} onChange={set("customerEmail")} /></Field></div>
      <div className="grid g2"><Field label="Item"><input className="input" value={f.item} onChange={set("item")} /></Field><Field label="Qty"><input className="input" inputMode="numeric" value={f.qty} onChange={set("qty")} /></Field></div>
      <div className="grid g2"><Field label="Total"><input className="input" inputMode="decimal" value={f.total} onChange={set("total")} /></Field><Field label="Currency"><input className="input" value={f.currency} onChange={set("currency")} /></Field></div>
      <Field label="Ship to (street)"><input className="input" value={f.line1} onChange={set("line1")} /></Field>
      <div className="grid g2"><Field label="City"><input className="input" value={f.city} onChange={set("city")} /></Field><Field label="State / region"><input className="input" value={f.state} onChange={set("state")} /></Field></div>
      <div className="grid g2"><Field label="Postal code"><input className="input" value={f.zip} onChange={set("zip")} /></Field><Field label="Country"><input className="input" value={f.country} onChange={set("country")} /></Field></div>
      <label className="row small"><input type="checkbox" checked={f.paid} onChange={set("paid")} /> Paid</label>
      <button className="btn block" disabled={busy || !f.item} onClick={() => run(async () => {
        await act(bid, "POST", "/orders", { customerName: f.customerName, customerEmail: f.customerEmail, items: [{ title: f.item, qty: f.qty }], total: f.total, currency: f.currency, paid: f.paid,
          shipTo: f.line1 ? { name: f.customerName, line1: f.line1, city: f.city, state: f.state, zip: f.zip, country: f.country } : null });
        onClose();
      }, "Order added")}>Add order</button>
    </Modal>
  );
}

function NewProduct({ bid, onClose }: { bid: string; onClose: () => void }) {
  const [busy, run] = useBusy(); const [f, setF] = useState({ title: "", sku: "", price: "", inventory: "", currency: "USD" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Add a product" onClose={onClose}>
      <Field label="Name"><input className="input" value={f.title} onChange={set("title")} /></Field>
      <div className="grid g2"><Field label="SKU"><input className="input" value={f.sku} onChange={set("sku")} /></Field><Field label="Price"><input className="input" inputMode="decimal" value={f.price} onChange={set("price")} /></Field></div>
      <Field label="Stock on hand" help="Leave empty if you don't track stock"><input className="input" inputMode="numeric" value={f.inventory} onChange={set("inventory")} /></Field>
      <button className="btn block" disabled={busy || !f.title} onClick={() => run(async () => { await act(bid, "POST", "/products", f); onClose(); }, "Product added")}>Add product</button>
    </Modal>
  );
}

export function OrderPage({ b }: { b: any }) {
  const { oid } = useParams(); const s = b.state; const bid = b.id; const [busy, run] = useBusy();
  const o = s.orders.find((x: any) => x.id === oid);
  const [rates, setRates] = useState<any[] | null>(null); const [task, setTask] = useState(false);
  const [fulfil, setFulfil] = useState(false); const [mail, setMail] = useState(false);
  if (!o) return <Empty>Order not found.</Empty>;
  const conn = s.connections.find((c: any) => c.id === o.connectionId);
  const rateTool = toolFor(b, "get_rates"); const buyTool = toolFor(b, "buy_label");
  const fulfilTool = conn ? toolFor(b, conn.type === "shopify" ? "fulfill_order" : "complete_order", conn.id) : null;
  const mailTool = toolFor(b, "send_email");
  const tool = (name: string, input: any) => act(bid, "POST", `/tools/${name}`, { input }).then(r => r.text as string);
  const tasks = s.tasks.filter((t: any) => t.orderId === o.id);
  const actions = s.actions.filter((a: any) => JSON.stringify(a.input ?? {}).includes(o.number));
  return (
    <div>
      <div className="row small muted"><Link to={`/b/${bid}/store`}>← Store</Link><span className="grow" />{conn?.label ?? "Manual order"} · {ago(o.createdAt)}</div>
      <div className="row" style={{ margin: "10px 0" }}><h1 className="grow">{o.number}</h1><b style={{ fontSize: 20 }}>{money(o.total, o.currency)}</b></div>
      <div className="row wrap">
        <Pill color={statusColor(o.stage)}>{statusLabel(o.stage)}</Pill>{!o.paid && <Pill color="var(--red)">unpaid</Pill>}
        <span className="grow" />
        <select className="input" style={{ width: "auto" }} value={o.stage} onChange={e => run(() => act(bid, "PATCH", `/orders/${o.id}`, { stage: e.target.value }))} aria-label="Stage">{STAGES.map(x => <option key={x} value={x}>{statusLabel(x)}</option>)}</select>
      </div>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <div className="card"><div className="tiny muted">CUSTOMER</div><div className="bold">{o.customer.name || "—"}</div><div className="small">{o.customer.email}</div></div>
        <div className="card"><div className="tiny muted">SHIP TO</div>{o.shipTo ? <div className="small">{o.shipTo.name}<br />{o.shipTo.line1}{o.shipTo.line2 ? `, ${o.shipTo.line2}` : ""}<br />{o.shipTo.city}, {o.shipTo.state} {o.shipTo.zip} {o.shipTo.country}</div> : <div className="small muted">No address</div>}</div>
      </div>
      <div className="card" style={{ marginTop: 10 }}>{o.items.map((i: any, k: number) => <div key={k} className="row small"><span className="grow">{i.qty}× {i.title}</span><span className="muted">{i.sku}</span></div>)}</div>
      {o.tracking && <div className="card" style={{ marginTop: 10 }}><div className="tiny muted">TRACKING</div><div className="row small"><b>{o.tracking.carrier} {o.tracking.number}</b><span className="grow" />{o.tracking.url && <a href={o.tracking.url} target="_blank" rel="noreferrer">Track</a>}{o.tracking.labelUrl && <a href={o.tracking.labelUrl} target="_blank" rel="noreferrer">Label PDF</a>}</div></div>}

      <Section title="Do something" />
      <div className="row wrap">
        <button className="btn" onClick={() => setTask(true)}>Ask the crew to handle it</button>
        {rateTool && o.shipTo && <button className="btn quiet" disabled={busy} onClick={() => run(async () => {
          const text = await tool(rateTool, { order: o.number });
          const parsed = text.split("\n").map(l => l.trim().split(/\s{2,}/)).filter(p => p.length >= 3 && /^[\w-]+$/.test(p[0]));
          if (!parsed.length) toast(text.slice(0, 200)); setRates(parsed);
        })}>Get shipping rates</button>}
        {fulfilTool && o.stage !== "shipped" && <button className="btn quiet" onClick={() => setFulfil(true)}>Mark fulfilled</button>}
        {mailTool && o.customer.email && <button className="btn quiet" onClick={() => setMail(true)}>Email customer</button>}
      </div>
      {rates && <div className="stack" style={{ marginTop: 10 }}>{rates.map(r => (
        <div key={r[0]} className="card row"><div className="grow"><b>{r[1]}</b> <span className="small">{r[2]}</span> <span className="small muted">{r[3] ?? ""}</span></div>
          <button className="btn sm" disabled={busy} onClick={() => run(async () => { const t = await tool(buyTool, { rate_id: r[0], order: o.number }); setRates(null); toast(t.split("\n")[0]); })}>Buy label</button></div>
      ))}</div>}

      {tasks.length > 0 && <><Section title="Crew work on this order" /><div className="stack">{tasks.map((t: any) => <TaskCard key={t.id} s={s} t={t} bid={bid} />)}</div></>}
      {actions.length > 0 && <><Section title="Actions" /><div className="stack">{actions.map((a: any) => <ActionRow key={a.id} s={s} a={a} />)}</div></>}
      {o.note && <><Section title="Notes" /><div className="card small" style={{ whiteSpace: "pre-wrap" }}>{o.note}</div></>}

      {task && <NewTask b={b} order={o} assignee={s.agents.find((a: any) => /ops|operat|fulfil|ship/i.test(a.title))?.id} onClose={() => setTask(false)} />}
      {fulfil && <FulfilModal onClose={() => setFulfil(false)} initial={o.tracking} onSave={(f: any) => run(async () => { const t = await tool(fulfilTool, { order: o.number, tracking_number: f.number, carrier: f.carrier, tracking_url: f.url || undefined }); setFulfil(false); toast(t); })} busy={busy} />}
      {mail && <MailModal o={o} busy={busy} onClose={() => setMail(false)} onSend={(f: any) => run(async () => { const t = await tool(mailTool, { to: o.customer.email, subject: f.subject, body: f.body }); setMail(false); toast(t); })} />}
    </div>
  );
}

function FulfilModal({ initial, onSave, onClose, busy }: any) {
  const [f, setF] = useState({ carrier: initial?.carrier ?? "", number: initial?.number ?? "", url: initial?.url ?? "" });
  return <Modal title="Mark fulfilled" onClose={onClose}>
    <div className="grid g2"><Field label="Carrier"><input className="input" value={f.carrier} onChange={e => setF({ ...f, carrier: e.target.value })} /></Field><Field label="Tracking number"><input className="input" value={f.number} onChange={e => setF({ ...f, number: e.target.value })} /></Field></div>
    <Field label="Tracking URL (optional)"><input className="input" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} /></Field>
    <button className="btn block" disabled={busy || !f.number || !f.carrier} onClick={() => onSave(f)}>Fulfill in store</button>
  </Modal>;
}
function MailModal({ o, onSend, onClose, busy }: any) {
  const [f, setF] = useState({ subject: `Your order ${o.number}`, body: `Hi ${o.customer.name?.split(" ")[0] || "there"},\n\n` });
  return <Modal title={`Email ${o.customer.email}`} onClose={onClose}>
    <Field label="Subject"><input className="input" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></Field>
    <Field label="Message"><textarea className="input" style={{ minHeight: 160 }} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></Field>
    <button className="btn block" disabled={busy || !f.body.trim()} onClick={() => onSend(f)}>Send</button>
  </Modal>;
}
