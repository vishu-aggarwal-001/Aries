// Local demo: boots Aries with a simulated store, shipping app and scripted agents.
// No real API keys needed. Run: npm run demo   → http://localhost:8787  (demo@aries.app / demo-password)
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { openDb, Repo } from "../src/db.ts";
import { Connections } from "../src/connectors/index.ts";
import { Engine } from "../src/engine/engine.ts";
import { buildApp } from "../src/api.ts";
import { setFakeFetch } from "../src/connectors/base.ts";
import { setFakeClaude } from "../src/engine/claude.ts";
import { signup } from "../src/auth.ts";
import { foundState } from "../src/templates.ts";
import { writeDoc, addComment, BOARD } from "../src/model.ts";

const day = 864e5;
const people = [["Jane Doe", "Lafayette", "IN"], ["Omar Ali", "Austin", "TX"], ["Mei Chen", "Seattle", "WA"], ["Luca Rossi", "Boston", "MA"], ["Ava Brooks", "Denver", "CO"], ["Sam Park", "Chicago", "IL"], ["Nia Okafor", "Atlanta", "GA"]];
const items = [["Walnut Reed Case", "RC-1", 29], ["Cork Grease", "CG", 6], ["Silk Swab", "SW-2", 14], ["Ligature Pro", "LP-9", 48]];
const orders = Array.from({ length: 22 }, (_, i) => {
  const p = people[i % people.length]; const it = items[i % items.length]; const qty = 1 + (i % 3 === 0 ? 1 : 0);
  const fulfilled = i > 3;
  return {
    id: `gid://shopify/Order/${100 + i}`, name: `#${1040 - i}`, createdAt: new Date(Date.now() - i * 0.62 * day).toISOString(), cancelledAt: null,
    displayFinancialStatus: "PAID", displayFulfillmentStatus: fulfilled ? "FULFILLED" : "UNFULFILLED", email: `${p[0].split(" ")[0].toLowerCase()}@example.com`, note: null,
    totalPriceSet: { shopMoney: { amount: String((+it[2] * qty + 5).toFixed(2)), currencyCode: "USD" } }, customer: { displayName: p[0], email: `${p[0].split(" ")[0].toLowerCase()}@example.com` },
    shippingAddress: { name: p[0], address1: `${12 + i} Oak St`, address2: "", city: p[1], provinceCode: p[2], zip: "47901", countryCodeV2: "US", phone: "" },
    lineItems: { nodes: [{ title: it[0], quantity: qty, sku: it[1] }] }, fulfillments: fulfilled ? [{ trackingInfo: [{ company: "USPS", number: `94001${i}88`, url: null }] }] : [],
  };
});
setFakeFetch(async (url, init: any) => {
  const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : {};
  if (url.includes("myshopify.com")) {
    const q: string = body.query ?? "";
    if (q.includes("shop {")) return { status: 200, body: { data: { shop: { name: "Reed & Co", currencyCode: "USD", myshopifyDomain: "reed-co.myshopify.com" } } } };
    if (q.includes("orders(first: 50")) return { status: 200, body: { data: { orders: { nodes: orders }, products: { nodes: items.map(([t, sku, price], k) => ({ id: `gid://shopify/Product/${k}`, title: t, status: "ACTIVE", onlineStoreUrl: null, totalInventory: [2, 40, 18, 7][k], variants: { nodes: [{ id: `v${k}`, sku, price: String(price) }] } })) } } } };
    if (q.includes("fulfillmentOrders")) return { status: 200, body: { data: { order: { fulfillmentOrders: { nodes: [{ id: "fo1", status: "OPEN" }] } } } } };
    if (q.includes("fulfillmentCreate")) return { status: 200, body: { data: { fulfillmentCreate: { fulfillment: { id: "f" }, userErrors: [] } } } };
  }
  if (url.includes("goshippo.com/carrier_accounts")) return { status: 200, body: { results: [] } };
  if (url.includes("goshippo.com/shipments")) return { status: 200, body: { rates: [
    { object_id: "rate_usps_ga", amount: "6.85", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" }, estimated_days: 4 },
    { object_id: "rate_ups_2d", amount: "21.40", currency: "USD", provider: "UPS", servicelevel: { name: "2nd Day Air" }, estimated_days: 2 }] } };
  if (url.includes("goshippo.com/transactions")) return { status: 200, body: { status: "SUCCESS", tracking_number: "9400 1118 9922 3344", label_url: "https://example.com/label.pdf", tracking_url_provider: "https://tools.usps.com" } };
  if (url.includes("api.resend.com")) return { status: 200, body: { id: "em_1" } };
  return { status: 404, body: { error: { message: "demo: no route" } } };
});

const use = (id: string, name: string, input: any) => ({ type: "tool_use", id, name, input });
const R = (...c: any[]) => ({ stop_reason: "tool_use", content: c, usage: { input_tokens: 2400, output_tokens: 420, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } });
let script: any[] = [];
setFakeClaude(() => script.shift() ?? R(use("e", "end_heartbeat", { summary: "Nothing else to do right now." })));

const db = await openDb("memory"); const repo = new Repo(db); const conns = new Connections(repo);
const engine = new Engine(repo, conns, { tickMs: 1e9 });
const app = buildApp({ repo, conns, engine, publicUrl: "http://localhost:8787" });
const user = await signup(db, "demo@aries.app", "demo-password", "Pat");
const bid = "demo";
const st = foundState("Reed & Co", "Ship every order within 24 hours, answer customers the same day, and grow monthly revenue 20%", "store", 60, "Handmade woodwind accessories.");
await repo.create(bid, st, "growth", null);
await db.query("INSERT INTO members (user_id, business_id, role) VALUES ($1,$2,'owner')", [user.id, bid]);
await conns.add(bid, "shopify", "", { shop: "reed-co", accessToken: "x" });
await conns.add(bid, "shippo", "", { apiKey: "shippo_live_x", fromName: "Reed & Co", fromStreet: "2 Elm", fromCity: "Lafayette", fromState: "IN", fromZip: "47901", fromCountry: "US" });
await conns.add(bid, "email", "", { apiKey: "re_x", from: "Reed & Co <hello@reedco.shop>" });
await repo.mutate(bid, s => { s.policies.spend = { mode: "auto", autoLimitUsd: 10 }; s.policies.store_update = { mode: "auto", autoLimitUsd: 0 }; });

let s = (await repo.get(bid))!.state;
const ceo = s.agents[0], ops = s.agents[1], support = s.agents[2], mkt = s.agents[3];
// CEO writes the plan
script = [R({ type: "text", text: "Reviewing the business and setting priorities." }, use("1", "list_connections", {}), use("2", "list_orders", { stage: "to_ship" })),
  R(use("3", "write_document", { task: "1", key: "plan", title: "Operating plan: Q4", content: "# Operating plan\n\n## Priorities\n1. **Ship in 24h**: Otto owns fulfillment; cheapest label that meets the promise.\n2. **Same-day replies**: June answers every customer email by 5pm.\n3. **+20% revenue**: Max runs a holiday bundle (Reed Case + Swab) from Nov 20.\n4. **Never stock out**: Mira restocks anything under 5 units.\n\n## Measures\n| Metric | Now | Target |\n|---|---|---|\n| Ship time | 2.1 days | < 1 day |\n| Reply time | 9h | < 4h |" })),
  R(use("4", "create_task", { title: "Plan the holiday bundle launch", description: "Reed Case + Silk Swab bundle at $39. Draft the listing copy and a 3-email sequence.", assignee: "Max", parent: "1", priority: "high" }), use("5", "submit_for_review", { task: "1", summary: "Four priorities with owners and targets." })),
  R(use("6", "end_heartbeat", { summary: "Wrote the Q4 operating plan, delegated the holiday bundle to Max, and sent the plan for review." }))];
await engine.heartbeat(bid, ceo.id, "wake");
// Ops ships the newest order
s = (await repo.get(bid))!.state;
const first = s.orders.find(o => o.stage === "to_ship")!;
script = [R({ type: "text", text: `Shipping ${first.number} first, it's the oldest.` }, use("a", "shippo__get_rates", { order: first.number })),
  R(use("b", "shippo__buy_label", { rate_id: "rate_usps_ga", order: first.number })),
  R(use("c", "shopify__fulfill_order", { order: first.number, tracking_number: "9400 1118 9922 3344", carrier: "USPS" })),
  R(use("d", "end_heartbeat", { summary: `Shipped ${first.number} via USPS Ground Advantage ($6.85). Three more orders queued for my next check-in.` }))];
await engine.heartbeat(bid, ops.id, "wake");
// Support wants to email a customer (needs approval)
script = [R(use("s1", "email__send_email", { to: s.orders[2].number, subject: `Your Reed & Co order ${s.orders[2].number}`, body: `Hi ${s.orders[2].customer.name.split(" ")[0]},\n\nThanks so much for your order! It's being packed today and you'll get tracking within 24 hours.\n\nWarmly,\nJune at Reed & Co` })),
  R(use("s2", "end_heartbeat", { summary: "Drafted a shipping update for a customer; waiting for approval to send." }))];
await engine.heartbeat(bid, support.id, "manual");
await repo.mutate(bid, d => {
  const t = d.tasks.find(x => x.title.startsWith("Plan the holiday"))!;
  addComment(d, t.id, BOARD, "Love it. Can we also offer free shipping over $50?");
  addComment(d, t.id, mkt.id, "Yes! I'll add a free-shipping banner and mention it in email #2. Draft coming this afternoon.");
  t.status = "in_progress";
  writeDoc(d, t.id, "bundle-copy", "Holiday bundle: listing copy", "# The Practice Kit\n\n**Walnut Reed Case + Silk Swab, $39** (save $4)\n\nEverything a reed player reaches for daily, in one gift-ready box.\n\n- Hand-finished walnut case holds 4 reeds\n- Lint-free silk swab sized for clarinet and sax\n- Ships in 24 hours", mkt.id);
  d.running = true;
});
setFakeClaude(() => R(use("e", "end_heartbeat", { summary: "Checked in; nothing new." })));

const dist = resolve(new URL("../../web/dist", import.meta.url).pathname);
if (existsSync(dist)) {
  const index = readFileSync(resolve(dist, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: relative(process.cwd(), dist) || "." }));
  app.get("*", c => (c.req.path.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.html(index)));
}
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });
console.log("Demo ready: http://localhost:8787  (demo@aries.app / demo-password)");
