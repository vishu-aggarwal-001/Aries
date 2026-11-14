import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomBytes } from "node:crypto";
import { bus, type Repo } from "./db.ts";
import {
  BOARD, CATEGORIES, MODEL_LIST, State, addComment, agentByRef, ceoOf, createTask, fire, hire, log, newId, now, resolveApproval,
  updateTask, upsertOrders, upsertProducts, commerceTriggers, Order,
} from "./model.ts";
import { TEMPLATES, foundState } from "./templates.ts";
import { catalog, boundTools, type Connections } from "./connectors/index.ts";
import { normShop, SHOPIFY_SCOPES } from "./connectors/shopify.ts";
import { http } from "./connectors/base.ts";
import type { Engine } from "./engine/engine.ts";
import { issueToken, login, signup, verifyShopifyHmac, verifyStripeSig, verifyToken } from "./auth.ts";
import { PLANS, TRIAL_DAYS, billingInfo, planOf } from "./plans.ts";

type Vars = { Variables: { uid: string; bid: string; role: string } };
export interface Deps { repo: Repo; conns: Connections; engine: Engine; publicUrl?: string }

const bad = (msg: string, status = 400) => { const e: any = new Error(msg); e.status = status; return e; };

export function buildApp({ repo, conns, engine, publicUrl = process.env.PUBLIC_URL ?? "http://localhost:8787" }: Deps) {
  const db = repo.db;
  const app = new Hono<Vars>();

  app.onError((err: any, c) => c.json({ error: err.message ?? "Something went wrong" }, err.status ?? (err.name === "HttpError" ? 502 : 400)));
  app.get("/api/health", c => c.json({ ok: true }));

  // ---------------- public ----------------
  app.post("/api/auth/signup", async c => {
    const b = await c.req.json(); const u = await signup(db, b.email, b.password, b.name);
    return c.json({ token: await issueToken(u), user: u });
  });
  app.post("/api/auth/login", async c => {
    const b = await c.req.json(); const u = await login(db, b.email, b.password);
    return c.json({ token: await issueToken(u), user: u });
  });
  app.get("/api/catalog", c => c.json({
    templates: TEMPLATES.map(t => ({ key: t.key, label: t.label, blurb: t.blurb, goalHint: t.goalHint, team: [t.ceo, ...t.team].map(x => ({ name: x.name, title: x.title, emoji: x.emoji })), suggests: t.suggests })),
    connectors: catalog(), plans: PLANS.map(({ stripePrice: _p, ...p }) => p), categories: CATEGORIES, models: MODEL_LIST,
  }));

  // ---------------- auth wall ----------------
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/") || c.req.path === "/api/catalog" || c.req.path === "/api/stripe/webhook" || c.req.path.startsWith("/api/oauth/")) return next();
    const h = c.req.header("authorization") ?? ""; const qt = c.req.query("token");
    const uid = await verifyToken(h.startsWith("Bearer ") ? h.slice(7) : qt ?? "");
    if (!uid) throw bad("Please sign in", 401);
    c.set("uid", uid); return next();
  });

  app.get("/api/me", async c => {
    const uid = c.get("uid");
    const u = (await db.query("SELECT id, email, name FROM users WHERE id=$1", [uid])).rows[0];
    const biz = (await db.query("SELECT b.id, b.state->>'name' AS name, b.state->>'kind' AS kind, (b.state->>'running')::boolean AS running, b.plan, m.role FROM members m JOIN businesses b ON b.id=m.business_id WHERE m.user_id=$1 ORDER BY b.created_at", [uid])).rows;
    return c.json({ user: u, businesses: biz });
  });

  // Account deletion (required by app stores and privacy law). Businesses the user solely owns go with it.
  app.delete("/api/me", async c => {
    const uid = c.get("uid");
    const owned = (await db.query("SELECT business_id FROM members WHERE user_id=$1 AND role='owner'", [uid])).rows as { business_id: string }[];
    for (const { business_id } of owned) {
      const others = (await db.query("SELECT 1 FROM members WHERE business_id=$1 AND user_id<>$2 AND role='owner'", [business_id, uid])).rows.length;
      if (others) continue;
      await repo.mutate(business_id, s => { s.running = false; }).catch(() => {});
      for (const t of ["secrets", "members", "oauth_states"]) await db.query(`DELETE FROM ${t} WHERE business_id=$1`, [business_id]);
      await db.query("DELETE FROM businesses WHERE id=$1", [business_id]);
    }
    await db.query("DELETE FROM members WHERE user_id=$1", [uid]);
    await db.query("DELETE FROM users WHERE id=$1", [uid]);
    return c.json({ ok: true });
  });

  app.post("/api/businesses", async c => {
    const uid = c.get("uid"); const b = await c.req.json();
    if (!String(b.name ?? "").trim() || !String(b.goal ?? "").trim()) throw bad("Name and goal are required");
    const owned = (await db.query("SELECT b.plan FROM members m JOIN businesses b ON b.id=m.business_id WHERE m.user_id=$1 AND m.role='owner'", [uid])).rows as { plan: string }[];
    const best = Math.max(1, ...owned.map(r => planOf(r.plan).businesses));
    if (owned.length >= best) throw bad(`Your plan allows ${best} business${best > 1 ? "es" : ""}. Upgrade to add more.`, 402);
    const id = newId();
    const state = foundState(b.name, b.goal, b.template ?? "custom", Number(b.budget) || 50, b.notes ?? "");
    await repo.create(id, state, "trial", now() + TRIAL_DAYS * 864e5);
    await db.query("INSERT INTO members (user_id, business_id, role) VALUES ($1,$2,'owner')", [uid, id]);
    return c.json({ id });
  });

  // ---------------- per-business ----------------
  const B = new Hono<Vars>();
  B.use("*", async (c, next) => {
    const bid = c.req.param("bid")!; const uid = c.get("uid");
    const m = (await db.query("SELECT role FROM members WHERE user_id=$1 AND business_id=$2", [uid, bid])).rows[0];
    if (!m) throw bad("Not found", 404);
    c.set("bid", bid); c.set("role", m.role); return next();
  });
  const mut = (c: any, fn: (s: State) => any) => repo.mutate(c.get("bid"), fn).then(r => r.result);

  B.get("/", async c => {
    const row = (await repo.get(c.get("bid")))!;
    return c.json({ id: row.id, version: row.version, state: row.state, billing: billingInfo(row), live: engine.liveAgents(row.id), role: c.get("role"),
      tools: boundTools(row.state).map(t => ({ name: t.apiName, connection: t.conn.id, tool: t.spec.name, category: t.spec.category })) });
  });

  B.get("/events", c => streamSSE(c, async stream => {
    const bid = c.get("bid"); let alive = true;
    const on = (v: number) => { void stream.writeSSE({ event: "change", data: String(v) }); };
    bus.on(bid, on);
    stream.onAbort(() => { alive = false; bus.off(bid, on); });
    while (alive) { await stream.writeSSE({ event: "ping", data: JSON.stringify({ live: engine.liveAgents(bid) }) }); await stream.sleep(5000); }
  }));

  B.post("/running", async c => {
    const { running } = await c.req.json();
    if (running) { const row = (await repo.get(c.get("bid")))!; const bill = billingInfo(row); if (!bill.active) throw bad(bill.reason + ". Choose a plan to continue.", 402); }
    await mut(c, s => { s.running = !!running; log(s, BOARD, running ? "started the crew" : "paused the crew"); });
    if (running) void engine.tickBusiness(c.get("bid"));
    return c.json({ ok: true });
  });

  B.patch("/settings", async c => {
    const b = await c.req.json();
    await mut(c, s => {
      if (b.name) s.name = String(b.name).slice(0, 120); if (b.goal) s.goal = String(b.goal).slice(0, 2000);
      if (b.policies) for (const k of CATEGORIES.map(x => x.key)) if (b.policies[k]) {
        const p = b.policies[k]; s.policies[k] = { mode: ["auto", "ask", "never"].includes(p.mode) ? p.mode : s.policies[k].mode, autoLimitUsd: Math.max(0, Number(p.autoLimitUsd ?? s.policies[k].autoLimitUsd) || 0) };
      }
      if (b.settings) {
        if (b.settings.lowStock != null) s.settings.lowStock = Math.max(0, Number(b.settings.lowStock) || 0);
        if (b.settings.autoOrderTasks != null) s.settings.autoOrderTasks = !!b.settings.autoOrderTasks;
        if (b.settings.monthlyAgentBudgetUsd != null) s.settings.monthlyAgentBudgetUsd = Math.max(1, Number(b.settings.monthlyAgentBudgetUsd) || 1);
      }
      log(s, BOARD, "updated business settings");
    });
    return c.json({ ok: true });
  });

  // tasks
  B.post("/tasks", async c => {
    const b = await c.req.json(); if (!String(b.title ?? "").trim()) throw bad("Title is required");
    const t = await mut(c, s => createTask(s, { title: b.title, description: b.description, assigneeId: b.assigneeId ?? null, parentId: b.parentId ?? null, priority: b.priority ?? "medium", orderId: b.orderId ?? null }));
    return c.json(t);
  });
  B.patch("/tasks/:tid", async c => {
    const b = await c.req.json();
    await mut(c, s => updateTask(s, c.req.param("tid"), BOARD, { status: b.status, assigneeId: b.assigneeId, priority: b.priority, title: b.title, description: b.description }));
    return c.json({ ok: true });
  });
  B.post("/tasks/:tid/comments", async c => {
    const { body } = await c.req.json(); await mut(c, s => addComment(s, c.req.param("tid"), BOARD, String(body ?? ""))); return c.json({ ok: true });
  });
  B.post("/share", async c => {
    const b = await c.req.json(); const text = String(b.text ?? "").trim(); if (!text) throw bad("Nothing to share");
    const t = await mut(c, s => {
      const who = agentByRef(s, b.assignee) ?? (/order|ship|deliver|refund|return|where is|tracking|complain/i.test(text) ? s.agents.find(a => /support|guest|success/i.test(a.title)) : undefined) ?? ceoOf(s);
      return createTask(s, { title: String(b.title ?? text.split("\n")[0]).slice(0, 90), description: `Shared by the owner:\n\n${text}`, assigneeId: who?.id ?? null, priority: b.priority ?? "high" });
    });
    return c.json(t);
  });

  // approvals
  B.post("/approvals/:aid", async c => {
    const { approve, note } = await c.req.json(); const aid = c.req.param("aid");
    const ap = (await repo.get(c.get("bid")))!.state.approvals.find(a => a.id === aid);
    if (!ap || ap.status !== "pending") throw bad("Already decided", 409);
    if (ap.type === "action") await conns.decide(c.get("bid"), aid, !!approve, String(note ?? ""));
    else await mut(c, s => resolveApproval(s, aid, !!approve, String(note ?? "")));
    return c.json({ ok: true });
  });

  // agents
  B.post("/agents", async c => {
    const b = await c.req.json(); const row = (await repo.get(c.get("bid")))!;
    const limit = planOf(row.plan).agents; if (row.state.agents.length >= limit) throw bad(`Your plan allows ${limit} agents. Upgrade for more.`, 402);
    const a = await mut(c, s => hire(s, sanitizeAgent(b), BOARD)); return c.json(a);
  });
  B.patch("/agents/:id", async c => {
    const b = sanitizeAgent(await c.req.json(), true);
    await mut(c, s => { const a = s.agents.find(x => x.id === c.req.param("id")); if (a) { Object.assign(a, b); if (b.budgetUsd != null && a.budgetUsd > a.spentUsd && b.paused === undefined) a.paused = false; } });
    return c.json({ ok: true });
  });
  B.delete("/agents/:id", async c => { await mut(c, s => fire(s, c.req.param("id"))); return c.json({ ok: true }); });
  B.post("/agents/:id/run", async c => {
    const bid = c.get("bid"); const row = (await repo.get(bid))!; const bill = billingInfo(row);
    if (!bill.active) throw bad(bill.reason + ". Choose a plan to continue.", 402);
    void engine.heartbeat(bid, c.req.param("id"), "manual");
    return c.json({ ok: true });
  });

  // routines
  B.post("/routines", async c => {
    const b = await c.req.json();
    const r = await mut(c, s => { const r = { id: newId(), title: String(b.title), description: String(b.description ?? ""), assigneeId: b.assigneeId, everyHours: Math.max(1, Number(b.everyHours) || 24), lastRun: now(), enabled: true }; s.routines.push(r); return r; });
    return c.json(r);
  });
  B.patch("/routines/:id", async c => { const b = await c.req.json(); await mut(c, s => { const r = s.routines.find(x => x.id === c.req.param("id")); if (r) Object.assign(r, pick(b, ["title", "description", "assigneeId", "everyHours", "enabled"])); }); return c.json({ ok: true }); });
  B.delete("/routines/:id", async c => { await mut(c, s => { s.routines = s.routines.filter(x => x.id !== c.req.param("id")); }); return c.json({ ok: true }); });

  // connections
  B.post("/connections", async c => {
    const b = await c.req.json(); const conn = await conns.add(c.get("bid"), b.type, b.label ?? "", b.values ?? {}); return c.json(conn);
  });
  B.delete("/connections/:cid", async c => { await conns.remove(c.get("bid"), c.req.param("cid")); return c.json({ ok: true }); });
  B.post("/connections/:cid/refresh", async c => { await conns.refresh(c.get("bid"), c.req.param("cid")); return c.json({ ok: true }); });
  B.post("/tools/:name", async c => {
    const b = await c.req.json(); const text = await conns.invoke(c.get("bid"), BOARD, c.req.param("name"), b.input ?? {}, b.taskId ?? null); return c.json({ text });
  });
  B.get("/oauth/shopify", async c => {
    const key = process.env.SHOPIFY_API_KEY; if (!key) throw bad("Shopify sign-in isn't configured on this server. Use an access token instead.");
    const shop = normShop(c.req.query("shop") ?? ""); const state = randomBytes(16).toString("hex");
    await db.query("INSERT INTO oauth_states (state, business_id, provider, data, created_at) VALUES ($1,$2,'shopify',$3,$4)", [state, c.get("bid"), JSON.stringify({ shop }), now()]);
    const url = `https://${shop}/admin/oauth/authorize?client_id=${key}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(publicUrl + "/api/oauth/shopify/callback")}&state=${state}`;
    return c.json({ url });
  });

  // commerce
  B.post("/orders", async c => {
    const b = await c.req.json();
    const o: Order = {
      id: newId(), connectionId: null, extId: newId(), number: String(b.number || "M-" + Math.floor(1000 + Math.random() * 9000)), createdAt: now(),
      customer: { name: String(b.customerName ?? ""), email: String(b.customerEmail ?? "") }, shipTo: b.shipTo?.line1 ? b.shipTo : null,
      items: (b.items ?? []).filter((i: any) => i.title).map((i: any) => ({ title: String(i.title), qty: Number(i.qty) || 1, sku: String(i.sku ?? "") })),
      total: Number(b.total) || 0, currency: String(b.currency ?? "USD"), paid: b.paid !== false, stage: b.paid === false ? "new" : "to_ship",
    };
    await mut(c, s => { upsertOrders(s, null, [o]); log(s, BOARD, `added order ${o.number}`); commerceTriggers(s); });
    return c.json(o);
  });
  B.patch("/orders/:oid", async c => {
    const b = await c.req.json();
    await mut(c, s => { const o = s.orders.find(x => x.id === c.req.param("oid")); if (!o) return; if (b.stage) o.stage = b.stage; if (b.note != null) o.note = String(b.note); if (b.tracking) o.tracking = b.tracking; log(s, BOARD, `updated order ${o.number}`); });
    return c.json({ ok: true });
  });
  B.post("/products", async c => {
    const b = await c.req.json();
    await mut(c, s => { upsertProducts(s, null, [{ id: newId(), connectionId: null, extId: newId(), title: String(b.title), sku: String(b.sku ?? ""), price: Number(b.price) || 0, currency: String(b.currency ?? "USD"), inventory: b.inventory === "" || b.inventory == null ? null : Number(b.inventory), status: "active", updatedAt: now() }]); commerceTriggers(s); });
    return c.json({ ok: true });
  });
  B.patch("/products/:pid", async c => {
    const b = await c.req.json();
    await mut(c, s => { const p = s.products.find(x => x.id === c.req.param("pid") && !x.connectionId); if (!p) throw bad("Only manual products can be edited here; ask an agent to change store products."); Object.assign(p, pick(b, ["title", "sku", "price", "inventory", "status"])); commerceTriggers(s); });
    return c.json({ ok: true });
  });

  // team members
  B.post("/members", async c => {
    if (c.get("role") !== "owner") throw bad("Only the owner can invite", 403);
    const { email } = await c.req.json();
    const u = (await db.query("SELECT id FROM users WHERE email=$1", [String(email).trim().toLowerCase()])).rows[0];
    if (!u) throw bad("They need to create a Aries account first");
    await db.query("INSERT INTO members (user_id, business_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [u.id, c.get("bid")]);
    return c.json({ ok: true });
  });

  // billing (Aries's own Stripe account)
  B.post("/billing/checkout", async c => {
    const { plan } = await c.req.json(); const p = planOf(plan);
    if (!p.stripePrice || !process.env.STRIPE_SECRET_KEY) throw bad("Billing isn't configured on this server yet");
    const row = (await repo.get(c.get("bid")))!; const user = (await db.query("SELECT email FROM users WHERE id=$1", [c.get("uid")])).rows[0];
    const r = await http("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      form: {
        mode: "subscription", line_items: { 0: { price: p.stripePrice, quantity: 1 } }, client_reference_id: row.id,
        ...(row.stripe_customer ? { customer: row.stripe_customer } : { customer_email: user.email }),
        metadata: { business_id: row.id, plan: p.key }, subscription_data: { metadata: { business_id: row.id, plan: p.key } },
        success_url: `${publicUrl}/b/${row.id}/billing?ok=1`, cancel_url: `${publicUrl}/b/${row.id}/billing`,
      },
    });
    return c.json({ url: r.json.url });
  });
  B.post("/billing/portal", async c => {
    const row = (await repo.get(c.get("bid")))!;
    if (!row.stripe_customer || !process.env.STRIPE_SECRET_KEY) throw bad("No subscription yet");
    const r = await http("https://api.stripe.com/v1/billing_portal/sessions", { method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, form: { customer: row.stripe_customer, return_url: `${publicUrl}/b/${row.id}/billing` } });
    return c.json({ url: r.json.url });
  });

  B.get("/export", async c => {
    const row = (await repo.get(c.get("bid")))!;
    return c.json({ exportedAt: now(), state: { ...row.state, connections: row.state.connections.map(x => ({ ...x, note: "credentials not exported" })) } });
  });

  app.route("/api/b/:bid", B);

  // ---------------- webhooks / oauth callbacks ----------------
  app.post("/api/stripe/webhook", async c => {
    const raw = await c.req.text(); const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !verifyStripeSig(raw, c.req.header("stripe-signature"), secret)) return c.json({ error: "bad signature" }, 400);
    await applyStripeEvent(repo, JSON.parse(raw));
    return c.json({ received: true });
  });

  app.get("/api/oauth/shopify/callback", async c => {
    const q = c.req.query() as Record<string, string>;
    if (!process.env.SHOPIFY_API_SECRET || !verifyShopifyHmac(q, process.env.SHOPIFY_API_SECRET)) return c.text("Invalid Shopify signature", 400);
    const st = (await db.query("DELETE FROM oauth_states WHERE state=$1 RETURNING business_id, data, created_at", [q.state])).rows[0];
    if (!st || now() - st.created_at > 15 * 60_000) return c.text("This sign-in link expired. Start again from Aries.", 400);
    const shop = normShop(q.shop); if (shop !== JSON.parse(st.data).shop) return c.text("Shop mismatch", 400);
    const tok = await http(`https://${shop}/admin/oauth/access_token`, { method: "POST", json: { client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, code: q.code } });
    await conns.add(st.business_id, "shopify", "", { shop }, { accessToken: tok.json.access_token });
    return c.redirect(`${publicUrl}/b/${st.business_id}/connections?connected=shopify`);
  });

  return app;
}

export async function applyStripeEvent(repo: Repo, ev: any) {
  const o = ev?.data?.object ?? {};
  const bid = o.metadata?.business_id ?? o.client_reference_id; if (!bid) return;
  const priceId = o.items?.data?.[0]?.price?.id;
  const plan = PLANS.find(p => p.stripePrice && p.stripePrice === priceId)?.key ?? o.metadata?.plan;
  switch (ev.type) {
    case "checkout.session.completed":
      await repo.db.query("UPDATE businesses SET plan=$1, plan_until=NULL, stripe_customer=$2, stripe_sub=$3, usage_usd=0, period_start=$4 WHERE id=$5", [plan ?? "starter", o.customer, o.subscription, now(), bid]);
      break;
    case "customer.subscription.updated":
      if (["active", "trialing"].includes(o.status)) await repo.db.query("UPDATE businesses SET plan=COALESCE($1, plan), plan_until=NULL WHERE id=$2", [plan ?? null, bid]);
      else if (["canceled", "unpaid", "incomplete_expired"].includes(o.status)) await repo.db.query("UPDATE businesses SET plan_until=$1 WHERE id=$2", [now(), bid]);
      break;
    case "customer.subscription.deleted":
      await repo.db.query("UPDATE businesses SET plan_until=$1 WHERE id=$2", [now(), bid]);
      break;
  }
}

function pick(o: any, keys: string[]) { const r: any = {}; for (const k of keys) if (o?.[k] !== undefined) r[k] = o[k]; return r; }
function sanitizeAgent(b: any, partial = false): any {
  const a: any = pick(b, ["name", "title", "role", "instructions", "reportsTo", "model", "budgetUsd", "heartbeatMin", "paused", "emoji"]);
  if (a.model && !MODEL_LIST.includes(a.model)) delete a.model;
  if (a.budgetUsd != null) a.budgetUsd = Math.max(0, Number(a.budgetUsd) || 0);
  if (a.heartbeatMin != null) a.heartbeatMin = Math.max(5, Number(a.heartbeatMin) || 45);
  if (!partial && (!a.name || !a.title)) throw bad("Name and title are required");
  return a;
}
