import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { openDb, Repo, seal, open } from "../src/db.ts";
import { Connections } from "../src/connectors/index.ts";
import { Engine } from "../src/engine/engine.ts";
import { buildApp } from "../src/api.ts";
import { setFakeFetch, assertPublicUrl } from "../src/connectors/base.ts";
import { setFakeClaude } from "../src/engine/claude.ts";
import { parseRpc } from "../src/connectors/universal.ts";
import { verifyShopifyHmac } from "../src/auth.ts";

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.STRIPE_PRICE_GROWTH = "price_growth";

let repo: Repo, conns: Connections, engine: Engine, app: ReturnType<typeof buildApp>;
let token = "", bid = "";
const calls: { url: string; body: any }[] = [];

// ---------- fake outside world ----------
const shopifyOrder = (id: number, name: string, paid = true, fulfilled = false) => ({
  id: `gid://shopify/Order/${id}`, name, createdAt: new Date().toISOString(), cancelledAt: null,
  displayFinancialStatus: paid ? "PAID" : "PENDING", displayFulfillmentStatus: fulfilled ? "FULFILLED" : "UNFULFILLED",
  email: "jane@example.com", note: null, totalPriceSet: { shopMoney: { amount: "58.00", currencyCode: "USD" } },
  customer: { displayName: "Jane Doe", email: "jane@example.com" },
  shippingAddress: { name: "Jane Doe", address1: "1 Main St", address2: "", city: "Lafayette", provinceCode: "IN", zip: "47901", countryCodeV2: "US", phone: "" },
  lineItems: { nodes: [{ title: "Walnut Reed Case", quantity: 2, sku: "RC-1" }] }, fulfillments: [],
});
function world(url: string, init: any) {
  const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
  calls.push({ url, body });
  if (url.includes("myshopify.com/admin/api")) {
    const q: string = body.query;
    if (q.includes("shop {")) return { status: 200, body: { data: { shop: { name: "Reed & Co", currencyCode: "USD", myshopifyDomain: "reed-co.myshopify.com" } } } };
    if (q.includes("orders(first: 50")) return { status: 200, body: { data: {
      orders: { nodes: [shopifyOrder(1, "#1001"), shopifyOrder(2, "#1002", true, true), shopifyOrder(3, "#1003", false)] },
      products: { nodes: [
        { id: "gid://shopify/Product/9", title: "Walnut Reed Case", status: "ACTIVE", onlineStoreUrl: null, totalInventory: 2, variants: { nodes: [{ id: "gid://shopify/ProductVariant/91", sku: "RC-1", price: "29.00" }] } },
        { id: "gid://shopify/Product/8", title: "Cork Grease", status: "ACTIVE", onlineStoreUrl: null, totalInventory: 40, variants: { nodes: [{ id: "gid://shopify/ProductVariant/81", sku: "CG", price: "6.00" }] } },
      ] } } } };
    if (q.includes("fulfillmentOrders")) return { status: 200, body: { data: { order: { fulfillmentOrders: { nodes: [{ id: "gid://shopify/FulfillmentOrder/5", status: "OPEN" }] } } } } };
    if (q.includes("fulfillmentCreate")) return { status: 200, body: { data: { fulfillmentCreate: { fulfillment: { id: "f1", status: "SUCCESS" }, userErrors: [] } } } };
  }
  if (url.includes("goshippo.com/carrier_accounts")) return { status: 200, body: { results: [] } };
  if (url.includes("goshippo.com/shipments")) return { status: 200, body: { rates: [
    { object_id: "rate_cheap", amount: "7.10", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" }, estimated_days: 4 },
    { object_id: "rate_fast", amount: "24.00", currency: "USD", provider: "UPS", servicelevel: { name: "2nd Day Air" }, estimated_days: 2 },
  ] } };
  if (url.includes("goshippo.com/transactions")) return { status: 200, body: { status: "SUCCESS", tracking_number: "9400111", label_url: "https://labels/x.pdf", tracking_url_provider: "https://usps/9400111" } };
  if (url.includes("api.stripe.com/v1/balance")) return { status: 200, body: { available: [{ amount: 1000, currency: "usd" }], pending: [] } };
  if (url.startsWith("https://mcp.example.com")) {
    if (body.method === "initialize") return { status: 200, headers: { "mcp-session-id": "s1" }, body: `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } })}\n\n` };
    if (body.method === "notifications/initialized") return { status: 202, body: "" };
    if (body.method === "tools/list") return { status: 200, body: { jsonrpc: "2.0", id: 2, result: { tools: [
      { name: "list_bookings", description: "List bookings", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
      { name: "create_booking", description: "Create a booking", inputSchema: { type: "object", properties: { name: { type: "string" } } } },
    ] } } };
    if (body.method === "tools/call") return { status: 200, body: { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: `called ${body.params.name}` }] } } };
  }
  return { status: 404, body: { error: { message: "no route " + url } } };
}

// ---------- fake Claude: a script of replies ----------
let script: any[] = []; let claudeBodies: any[] = [];
const reply = (...blocks: any[]) => ({ stop_reason: blocks.some(b => b.type === "tool_use") ? "tool_use" : "end_turn", content: blocks, usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
const use = (id: string, name: string, input: any) => ({ type: "tool_use", id, name, input });

const req = async (method: string, path: string, body?: any) => {
  const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (r.status >= 400) throw Object.assign(new Error(j.error), { status: r.status }); return j;
};
const state = async () => (await req("GET", `/api/b/${bid}`)).state;

beforeAll(async () => {
  const db = await openDb("memory");
  repo = new Repo(db); conns = new Connections(repo); engine = new Engine(repo, conns, { tickMs: 1e9 });
  app = buildApp({ repo, conns, engine, publicUrl: "https://app.test" });
  setFakeFetch(async (url, init) => world(url, init));
  setFakeClaude(body => { claudeBodies.push(body); return script.shift() ?? reply(use("end", "end_heartbeat", { summary: "done" })); });
});
beforeEach(() => { calls.length = 0; claudeBodies = []; });

describe("Aries", () => {
  it("signs up, founds a store business with a crew and a daily brief", async () => {
    const r = await req("POST", "/api/auth/signup", { email: "Owner@Shop.com", password: "hunter2hunter2", name: "Pat" });
    token = r.token;
    await expect(req("POST", "/api/auth/login", { email: "owner@shop.com", password: "wrong-password" })).rejects.toThrow(/Wrong/);
    bid = (await req("POST", "/api/businesses", { name: "Reed & Co", goal: "Ship within 24h", template: "store", budget: 40 })).id;
    const s = await state();
    expect(s.agents.map((a: any) => a.title)).toEqual(["CEO", "Operations Manager", "Customer Support Lead", "Marketing Lead", "Merchandiser"]);
    expect(s.tasks[0].assigneeId).toBe(s.agents[0].id);
    expect(s.routines[0].title).toBe("Daily brief");
    const me = await req("GET", "/api/me");
    expect(me.businesses[0].name).toBe("Reed & Co");
    await expect(req("POST", "/api/businesses", { name: "Second", goal: "x" })).rejects.toThrow(/plan allows/);
  });

  it("other users cannot see the business", async () => {
    const other = await req("POST", "/api/auth/signup", { email: "spy@x.com", password: "password123", name: "Spy" });
    const mine = token; token = other.token;
    await expect(req("GET", `/api/b/${bid}`)).rejects.toThrow(/Not found/);
    token = mine;
  });

  it("connects Shopify, imports orders and products, and turns them into work", async () => {
    await req("POST", `/api/b/${bid}/connections`, { type: "shopify", values: { shop: "reed-co", accessToken: "shpat_x" } });
    const s = await state();
    expect(s.connections[0].info.shopName).toBe("Reed & Co");
    expect(JSON.stringify(s)).not.toContain("shpat_x"); // secrets never reach the client
    expect(s.orders.map((o: any) => [o.number, o.stage])).toEqual(expect.arrayContaining([["#1001", "to_ship"], ["#1002", "shipped"], ["#1003", "new"]]));
    const ops = s.agents.find((a: any) => a.title === "Operations Manager");
    const fulfil = s.tasks.find((t: any) => t.title.startsWith("Fulfill order #1001"));
    expect(fulfil.assigneeId).toBe(ops.id);
    expect(s.tasks.some((t: any) => t.title.startsWith("Fulfill order #1003"))).toBe(false); // unpaid
    expect(s.tasks.find((t: any) => t.title.startsWith("Low stock: Walnut Reed Case")).assigneeId).toBe(s.agents.find((a: any) => a.title === "Merchandiser").id);
    expect(ops.wake).toBe(true);
    // secrets are encrypted at rest
    const raw = (await repo.db.query("SELECT data FROM secrets")).rows[0].data;
    expect(raw).not.toContain("shpat_x"); expect(open(raw).accessToken).toBe("shpat_x"); expect(open(seal({ a: 1 })).a).toBe(1);
  });

  it("ops agent quotes rates, label purchase waits for approval, then ships end to end", async () => {
    await req("POST", `/api/b/${bid}/connections`, { type: "shippo", values: { apiKey: "shippo_test_x", fromName: "Reed & Co", fromStreet: "2 Elm", fromCity: "Lafayette", fromState: "IN", fromZip: "47901", fromCountry: "US" } });
    let s = await state(); const ops = s.agents.find((a: any) => a.title === "Operations Manager");
    script = [
      reply({ type: "text", text: "Shipping #1001." }, use("a", "list_orders", { stage: "to_ship" }), use("b", "shippo__get_rates", { order: "#1001" })),
      reply(use("c", "shippo__buy_label", { rate_id: "rate_cheap", order: "#1001" })),
      reply(use("d", "end_heartbeat", { summary: "Label requested for #1001." })),
    ];
    const run = await engine.heartbeat(bid, ops.id, "wake");
    expect(run!.status).toBe("ok");
    // tool list given to Claude includes connector tools with rule labels
    const toolNames = claudeBodies[0].tools.map((t: any) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["shopify__fulfill_order", "shippo__buy_label", "list_orders"]));
    expect(claudeBodies[0].system[0].text).toContain("Spend money: needs the owner's approval");
    const rateResult = claudeBodies[1].messages.at(-1).content.find((c: any) => c.tool_use_id === "b").content;
    expect(rateResult).toContain("rate_cheap  7.10 USD  USPS");
    s = await state();
    const ap = s.approvals.find((a: any) => a.type === "action" && a.status === "pending");
    expect(ap.title).toContain("Buy USPS Ground Advantage label for 7.10 USD");
    expect(calls.some(c => c.url.includes("/transactions"))).toBe(false); // nothing bought yet

    await req("POST", `/api/b/${bid}/approvals/${ap.id}`, { approve: true });
    s = await state();
    expect(calls.some(c => c.url.includes("/transactions"))).toBe(true);
    const order = s.orders.find((o: any) => o.number === "#1001");
    expect(order.tracking.number).toBe("9400111");
    expect(s.actions.find((a: any) => a.tool === "buy_label").status).toBe("done");
    const opsNow = s.agents.find((a: any) => a.id === ops.id);
    expect(opsNow.wakeReason).toContain("approved");

    // owner now trusts labels under $10: next purchase goes straight through
    await req("PATCH", `/api/b/${bid}/settings`, { policies: { spend: { mode: "auto", autoLimitUsd: 10 }, store_update: { mode: "auto", autoLimitUsd: 0 } } });
    script = [
      reply(use("e", "shippo__get_rates", { order: "#1001" })),
      reply(use("f", "shippo__buy_label", { rate_id: "rate_fast", order: "#1001" }), use("g", "shippo__buy_label", { rate_id: "rate_cheap", order: "#1001" })),
      reply(use("h", "shopify__fulfill_order", { order: "#1001", tracking_number: "9400111", carrier: "USPS" })),
      reply(use("i", "end_heartbeat", { summary: "Shipped #1001." })),
    ];
    calls.length = 0;
    await engine.heartbeat(bid, ops.id, "manual");
    s = await state();
    expect(s.approvals.some((a: any) => a.status === "pending" && a.title.includes("UPS 2nd Day Air"))).toBe(true); // $24 > $10 limit
    expect(s.actions.filter((a: any) => a.tool === "buy_label" && a.status === "done").length).toBe(2);
    const fulfil = calls.find(c => c.body?.query?.includes("fulfillmentCreate"));
    expect(fulfil!.body.variables.f.trackingInfo).toEqual({ company: "USPS", number: "9400111" });
    expect(s.orders.find((o: any) => o.number === "#1001").stage).toBe("shipped");
    expect(s.agents.find((a: any) => a.id === ops.id).spentUsd).toBeGreaterThan(0);
  });

  it("'never' rules block actions outright", async () => {
    await req("PATCH", `/api/b/${bid}/settings`, { policies: { spend: { mode: "never" } } });
    const s = await state(); const ops = s.agents.find((a: any) => a.title === "Operations Manager");
    script = [reply(use("x", "shippo__buy_label", { rate_id: "rate_cheap", order: "#1001" })), reply(use("y", "end_heartbeat", { summary: "blocked" }))];
    await engine.heartbeat(bid, ops.id, "manual");
    const res = claudeBodies[1].messages.at(-1).content[0].content;
    expect(res).toMatch(/Blocked/);
    expect((await state()).actions.at(-1).status).toBe("blocked");
  });

  it("works with any MCP server: reads run, writes need approval", async () => {
    await req("POST", `/api/b/${bid}/connections`, { type: "mcp", label: "Bookings", values: { url: "https://mcp.example.com/mcp", token: "t" } });
    const s = await state(); const ceo = s.agents[0];
    script = [reply(use("m1", "mcp__list_bookings", {}), use("m2", "mcp__create_booking", { name: "Sam" })), reply(use("m3", "end_heartbeat", { summary: "ok" }))];
    await engine.heartbeat(bid, ceo.id, "manual");
    const results = claudeBodies[1].messages.at(-1).content;
    expect(results[0].content).toBe("called list_bookings");
    expect(results[1].content).toMatch(/approval/);
    expect(parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n').result.ok).toBe(1);
  });

  it("refuses customer-supplied URLs that point inside our network", async () => {
    setFakeFetch(null);
    await expect(assertPublicUrl("https://127.0.0.1/x")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("https://10.0.0.5/x")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://example.com")).rejects.toThrow(/https/);
    await expect(assertPublicUrl("https://metadata.google.internal/")).rejects.toThrow(/not allowed/);
    setFakeFetch(async (url, init) => world(url, init));
  });

  it("verifies Stripe and Shopify signatures and upgrades the plan", async () => {
    const ev = JSON.stringify({ type: "checkout.session.completed", data: { object: { metadata: { business_id: bid, plan: "growth" }, customer: "cus_1", subscription: "sub_1" } } });
    const bad = await app.request("/api/stripe/webhook", { method: "POST", body: ev, headers: { "stripe-signature": "t=1,v1=00" } });
    expect(bad.status).toBe(400);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_test").update(`${t}.${ev}`).digest("hex");
    const ok = await app.request("/api/stripe/webhook", { method: "POST", body: ev, headers: { "stripe-signature": `t=${t},v1=${sig}` } });
    expect(ok.status).toBe(200);
    const b = await req("GET", `/api/b/${bid}`);
    expect(b.billing.plan).toBe("growth"); expect(b.billing.active).toBe(true);
    const q: Record<string, string> = { code: "c", shop: "reed-co.myshopify.com", state: "s", timestamp: "1" };
    const hmac = createHmac("sha256", "shh").update("code=c&shop=reed-co.myshopify.com&state=s&timestamp=1").digest("hex");
    expect(verifyShopifyHmac({ ...q, hmac }, "shh")).toBe(true);
    expect(verifyShopifyHmac({ ...q, hmac: hmac.replace(/.$/, "0") }, "shh")).toBe(false);
  });

  it("pauses the crew when the month's AI credit is used up", async () => {
    await req("POST", `/api/b/${bid}/running`, { running: true });
    await repo.db.query("UPDATE businesses SET usage_usd=999 WHERE id=$1", [bid]);
    await engine.tickBusiness(bid);
    const b = await req("GET", `/api/b/${bid}`);
    expect(b.state.running).toBe(false); expect(b.billing.reason).toMatch(/credit/);
    await expect(req("POST", `/api/b/${bid}/running`, { running: true })).rejects.toThrow(/credit/);
  });

  it("deleting an account removes the business, its secrets and the login", async () => {
    const u = await req("POST", "/api/auth/signup", { email: "gone@x.com", password: "password123", name: "Gone" });
    const mine = token; token = u.token;
    const id = (await req("POST", "/api/businesses", { name: "Temp", goal: "x", template: "custom" })).id;
    await repo.setSecret(id, "c1", { k: "v" });
    await req("DELETE", "/api/me");
    expect((await repo.db.query("SELECT 1 FROM businesses WHERE id=$1", [id])).rows.length).toBe(0);
    expect((await repo.db.query("SELECT 1 FROM secrets WHERE business_id=$1", [id])).rows.length).toBe(0);
    await expect(req("POST", "/api/auth/login", { email: "gone@x.com", password: "password123" })).rejects.toThrow(/Wrong/);
    token = mine;
  });

  it("share-to-Aries routes customer messages to support", async () => {
    const t = await req("POST", `/api/b/${bid}/share`, { text: "Hi, where is my order? Tracking hasn't moved." });
    const s = await state();
    expect(s.agents.find((a: any) => a.id === t.assigneeId).title).toBe("Customer Support Lead");
  });
});
