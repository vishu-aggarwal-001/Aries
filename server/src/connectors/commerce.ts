// WooCommerce, Stripe and Shippo.
import { ConnectorDef, Ctx, http, obj, str, num, bool, clip } from "./base.ts";
import { orderByRef, productByRef, type Order, type OrderStage, type Product } from "../model.ts";

// ======================= WooCommerce =======================
const wooBase = (ctx: Ctx) => {
  const site = (ctx.conn.info.site ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(site)) throw new Error("Site URL must start with https://");
  return `${site}/wp-json/wc/v3`;
};
const wooAuth = (ctx: Ctx) => ({ Authorization: "Basic " + Buffer.from(`${ctx.conn.info.consumerKey}:${ctx.secrets.consumerSecret}`).toString("base64") });
const woo = (ctx: Ctx, path: string, init: any = {}) => http(wooBase(ctx) + path, { ...init, headers: wooAuth(ctx), userUrl: true });

export function mapWooOrder(o: any): Order {
  const st: string = o.status;
  const stage: OrderStage = st === "completed" ? "shipped" : ["cancelled", "refunded", "failed"].includes(st) ? "cancelled" : st === "processing" ? "to_ship" : "new";
  const s = o.shipping ?? {}; const b = o.billing ?? {};
  const name = `${s.first_name || b.first_name || ""} ${s.last_name || b.last_name || ""}`.trim();
  return {
    id: "", connectionId: null, extId: String(o.id), number: "#" + (o.number ?? o.id), createdAt: Date.parse((o.date_created_gmt ?? o.date_created) + "Z"),
    customer: { name, email: b.email ?? "" },
    shipTo: s.address_1 ? { name, line1: s.address_1, line2: s.address_2 ?? "", city: s.city ?? "", state: s.state ?? "", zip: s.postcode ?? "", country: s.country ?? "", phone: s.phone || b.phone || "" } : null,
    items: (o.line_items ?? []).map((l: any) => ({ title: l.name, qty: l.quantity, sku: l.sku ?? "" })),
    total: Number(o.total ?? 0), currency: o.currency ?? "USD", paid: !!o.date_paid || st === "processing" || st === "completed", stage,
  };
}

export const woocommerce: ConnectorDef = {
  type: "woocommerce", label: "WooCommerce", group: "Store",
  blurb: "WordPress stores. Orders, products, stock and order completion.",
  docsUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
  fields: [
    { key: "site", label: "Store URL", placeholder: "https://shop.example.com" },
    { key: "consumerKey", label: "Consumer key", placeholder: "ck_…", help: "WooCommerce → Settings → Advanced → REST API → Add key (Read/Write)" },
    { key: "consumerSecret", label: "Consumer secret", secret: true, placeholder: "cs_…" },
  ],
  async connect(ctx) { await woo(ctx, "/system_status"); return { info: {} }; },
  async sync(ctx) {
    const [orders, products] = await Promise.all([woo(ctx, "/orders?per_page=50"), woo(ctx, "/products?per_page=100")]);
    const cur = orders.json?.[0]?.currency ?? ctx.conn.info.currency ?? "USD";
    return {
      orders: (orders.json ?? []).map(mapWooOrder),
      products: (products.json ?? []).map((p: any): Product => ({
        id: "", connectionId: null, extId: String(p.id), title: p.name, sku: p.sku ?? "", price: Number(p.price || 0), currency: cur,
        inventory: p.manage_stock ? p.stock_quantity : null, status: p.status, url: p.permalink, updatedAt: Date.now(),
      })),
    };
  },
  tools: () => [
    { name: "get_order", category: null, description: "Live details of a WooCommerce order.", input_schema: obj({ order: str("Order number") }, ["order"]) },
    {
      name: "complete_order", category: "store_update", description: "Mark a WooCommerce order completed and add a customer-visible note with tracking.",
      input_schema: obj({ order: str("Order number"), carrier: str("Carrier"), tracking_number: str("Tracking number"), tracking_url: str("Tracking URL") }, ["order"]),
      summary: i => `Complete WooCommerce order ${i.order}` + (i.tracking_number ? ` (${i.carrier} ${i.tracking_number})` : ""),
    },
    {
      name: "update_product", category: "store_update", description: "Change a WooCommerce product's name, price, stock or description.",
      input_schema: obj({ product: str("Product name or SKU"), name: str("New name"), price: num("New regular price"), stock: num("New stock quantity"), description: str("New description (HTML allowed)") }, ["product"]),
      summary: i => `Update WooCommerce product "${i.product}"` + (i.price != null ? ` price → ${i.price}` : "") + (i.stock != null ? ` stock → ${i.stock}` : ""),
    },
  ],
  async execute(ctx, tool, i) {
    if (tool === "get_order") {
      const o = orderByRef(ctx.state, i.order); if (!o || o.connectionId !== ctx.conn.id) throw new Error(`No WooCommerce order "${i.order}"`);
      const r = await woo(ctx, `/orders/${o.extId}`);
      return { text: clip(JSON.stringify(mapWooOrder(r.json), null, 1) + `\nCustomer note: ${r.json.customer_note || "-"}`) };
    }
    if (tool === "complete_order") {
      const o = orderByRef(ctx.state, i.order); if (!o || o.connectionId !== ctx.conn.id) throw new Error(`No WooCommerce order "${i.order}"`);
      if (i.tracking_number) await woo(ctx, `/orders/${o.extId}/notes`, { method: "POST", json: { note: `Shipped with ${i.carrier ?? "carrier"}: ${i.tracking_number}${i.tracking_url ? ` (${i.tracking_url})` : ""}`, customer_note: true } });
      await woo(ctx, `/orders/${o.extId}`, { method: "PUT", json: { status: "completed" } });
      return {
        text: `Order ${o.number} completed.`,
        patch: s => { const x = s.orders.find(y => y.id === o.id); if (x) { x.stage = "shipped"; if (i.tracking_number) x.tracking = { ...(x.tracking ?? {}), carrier: i.carrier ?? "", number: i.tracking_number, url: i.tracking_url }; } },
      };
    }
    if (tool === "update_product") {
      const p = productByRef(ctx.state, i.product); if (!p || p.connectionId !== ctx.conn.id) throw new Error(`No WooCommerce product "${i.product}"`);
      const body: any = {};
      if (i.name) body.name = i.name; if (i.price != null) body.regular_price = String(i.price);
      if (i.stock != null) { body.manage_stock = true; body.stock_quantity = Math.round(i.stock); }
      if (i.description) body.description = i.description;
      await woo(ctx, `/products/${p.extId}`, { method: "PUT", json: body });
      return { text: `Updated ${p.title}.`, patch: s => { const x = s.products.find(y => y.id === p.id); if (x) { if (i.price != null) x.price = Number(i.price); if (i.stock != null) x.inventory = Math.round(i.stock); if (i.name) x.title = i.name; } } };
    }
    throw new Error("Unknown tool " + tool);
  },
};

// ======================= Stripe (the business's own account) =======================
const stripeApi = (ctx: Ctx, path: string, init: any = {}) =>
  http("https://api.stripe.com/v1" + path, { ...init, headers: { Authorization: `Bearer ${ctx.secrets.secretKey}`, "Stripe-Version": "2024-06-20" } });
const cents = (x: number) => Math.round(Number(x) * 100);

export const stripe: ConnectorDef = {
  type: "stripe", label: "Stripe", group: "Payments",
  blurb: "See payments, create payment links and issue refunds (refunds follow your rules).",
  docsUrl: "https://docs.stripe.com/keys#create-restricted-api-secret-key",
  fields: [{ key: "secretKey", label: "Restricted API key", secret: true, placeholder: "rk_live_…", help: "Create a restricted key with read access to charges/balance and write access to payment links, prices and refunds." }],
  async connect(ctx) {
    const r = await stripeApi(ctx, "/balance");
    const av = r.json?.available?.[0];
    return { info: { currency: (av?.currency ?? "usd").toUpperCase(), mode: ctx.secrets.secretKey?.includes("_test_") ? "test" : "live" } };
  },
  tools: () => [
    { name: "recent_payments", category: null, description: "Recent successful and failed payments.", input_schema: obj({ limit: num("How many (max 50)") }) },
    { name: "balance", category: null, description: "Available and pending balance.", input_schema: obj({}) },
    {
      name: "create_payment_link", category: "payment_link", description: "Create a shareable checkout link for a one-off amount.",
      input_schema: obj({ name: str("What the customer pays for"), amount: num("Amount in major units, e.g. 49.99"), currency: str("Currency code, default the account's") }, ["name", "amount"]),
      amountUsd: i => Number(i.amount) || 0, summary: i => `Payment link: ${i.name} for ${i.amount} ${i.currency ?? ""}`.trim(),
    },
    {
      name: "refund", category: "refund", description: "Refund a payment fully or partly. Use the payment id from recent_payments.",
      input_schema: obj({ payment: str("Charge id (ch_…) or PaymentIntent id (pi_…)"), amount: num("Amount to refund; omit for full"), reason: str("Why") }, ["payment", "reason"]),
      amountUsd: i => (i.amount != null ? Number(i.amount) : 1e9), summary: i => `Refund ${i.amount != null ? i.amount : "full amount"} on ${i.payment} — ${i.reason}`,
    },
  ],
  async execute(ctx, tool, i) {
    switch (tool) {
      case "recent_payments": {
        const r = await stripeApi(ctx, `/charges?limit=${Math.min(50, Number(i.limit) || 20)}`);
        return { text: (r.json.data ?? []).map((c: any) => `${c.id} ${c.payment_intent ?? ""} ${(c.amount / 100).toFixed(2)} ${c.currency.toUpperCase()} ${c.status}${c.refunded ? " refunded" : ""} — ${c.billing_details?.email ?? c.receipt_email ?? ""} — ${new Date(c.created * 1000).toISOString().slice(0, 10)} ${c.description ?? ""}`).join("\n") || "No payments." };
      }
      case "balance": {
        const r = await stripeApi(ctx, "/balance");
        const f = (xs: any[]) => xs.map(x => `${(x.amount / 100).toFixed(2)} ${x.currency.toUpperCase()}`).join(", ");
        return { text: `Available: ${f(r.json.available)}; pending: ${f(r.json.pending)}` };
      }
      case "create_payment_link": {
        const currency = (i.currency ?? ctx.conn.info.currency ?? "usd").toLowerCase();
        const price = await stripeApi(ctx, "/prices", { method: "POST", form: { currency, unit_amount: cents(i.amount), product_data: { name: i.name } } });
        const link = await stripeApi(ctx, "/payment_links", { method: "POST", form: { line_items: { 0: { price: price.json.id, quantity: 1 } } } });
        return { text: `Payment link: ${link.json.url}` };
      }
      case "refund": {
        const form: any = { reason: "requested_by_customer", metadata: { note: String(i.reason).slice(0, 400) } };
        if (String(i.payment).startsWith("pi_")) form.payment_intent = i.payment; else form.charge = i.payment;
        if (i.amount != null) form.amount = cents(i.amount);
        const r = await stripeApi(ctx, "/refunds", { method: "POST", form });
        return { text: `Refund ${r.json.id} ${r.json.status}: ${(r.json.amount / 100).toFixed(2)} ${String(r.json.currency).toUpperCase()}` };
      }
    }
    throw new Error("Unknown tool " + tool);
  },
};

// ======================= Shippo (labels + tracking) =======================
const shippoApi = (ctx: Ctx, path: string, init: any = {}) =>
  http("https://api.goshippo.com" + path, { ...init, headers: { Authorization: `ShippoToken ${ctx.secrets.apiKey}` } });
/** Rates we have quoted, so a purchase can be priced against the business's spending limit. */
export const rateCache = new Map<string, { amount: number; currency: string; provider: string; service: string; orderId: string }>();

export const shippo: ConnectorDef = {
  type: "shippo", label: "Shippo", group: "Shipping",
  blurb: "Compare carrier rates, buy labels (within your spending rules) and track packages.",
  docsUrl: "https://docs.goshippo.com/docs/guides_general/authentication/",
  fields: [
    { key: "apiKey", label: "API token", secret: true, placeholder: "shippo_live_…" },
    { key: "fromName", label: "Ship-from name" }, { key: "fromStreet", label: "Street" }, { key: "fromCity", label: "City" },
    { key: "fromState", label: "State / region" }, { key: "fromZip", label: "Postal code" }, { key: "fromCountry", label: "Country code", placeholder: "US" },
    { key: "fromPhone", label: "Phone", optional: true }, { key: "fromEmail", label: "Email", optional: true },
    { key: "parcel", label: "Default box (in, oz)", placeholder: "10x8x4, 16oz", optional: true },
  ],
  async connect(ctx) { await shippoApi(ctx, "/carrier_accounts?results=1"); return { info: { mode: ctx.secrets.apiKey?.includes("test") ? "test" : "live" } }; },
  tools: () => [
    {
      name: "get_rates", category: null, description: "Quote shipping rates for an order (cheapest first). Optionally give box size and weight.",
      input_schema: obj({ order: str("Order number"), length_in: num("Box length in inches"), width_in: num("Width"), height_in: num("Height"), weight_oz: num("Weight in ounces") }, ["order"]),
    },
    {
      name: "buy_label", category: "spend", description: "Buy a shipping label using a rate id from get_rates. Costs money.",
      input_schema: obj({ rate_id: str("Rate id from get_rates"), order: str("Order number") }, ["rate_id", "order"]),
      amountUsd: i => rateCache.get(i.rate_id)?.amount ?? 1e9,
      summary: i => { const r = rateCache.get(i.rate_id); return `Buy ${r ? `${r.provider} ${r.service} label for ${r.amount.toFixed(2)} ${r.currency}` : "shipping label"} for order ${i.order}`; },
    },
    { name: "track", category: null, description: "Tracking status for a package.", input_schema: obj({ carrier: str("Carrier token, e.g. usps, ups, fedex"), tracking_number: str("Tracking number") }, ["carrier", "tracking_number"]) },
  ],
  async execute(ctx, tool, i) {
    const info = ctx.conn.info;
    if (tool === "get_rates") {
      const o = orderByRef(ctx.state, i.order); if (!o) throw new Error(`No order "${i.order}"`);
      if (!o.shipTo) throw new Error(`Order ${o.number} has no shipping address.`);
      const dims = (info.parcel ?? "").match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)[^\d]*(\d+(?:\.\d+)?)?/i);
      const parcel = {
        length: String(i.length_in ?? dims?.[1] ?? 10), width: String(i.width_in ?? dims?.[2] ?? 8), height: String(i.height_in ?? dims?.[3] ?? 4),
        distance_unit: "in", weight: String(i.weight_oz ?? dims?.[4] ?? 16), mass_unit: "oz",
      };
      const r = await shippoApi(ctx, "/shipments/", {
        method: "POST", json: {
          async: false, parcels: [parcel],
          address_from: { name: info.fromName, street1: info.fromStreet, city: info.fromCity, state: info.fromState, zip: info.fromZip, country: info.fromCountry || "US", phone: info.fromPhone, email: info.fromEmail },
          address_to: { name: o.shipTo.name, street1: o.shipTo.line1, street2: o.shipTo.line2, city: o.shipTo.city, state: o.shipTo.state, zip: o.shipTo.zip, country: o.shipTo.country, phone: o.shipTo.phone, email: o.customer.email },
        },
      });
      const rates = (r.json.rates ?? []).map((x: any) => ({ id: x.object_id, amount: Number(x.amount), currency: x.currency, provider: x.provider, service: x.servicelevel?.name ?? "", days: x.estimated_days }))
        .sort((a: any, b: any) => a.amount - b.amount).slice(0, 8);
      for (const x of rates) rateCache.set(x.id, { amount: x.amount, currency: x.currency, provider: x.provider, service: x.service, orderId: o.id });
      if (!rates.length) return { text: `No rates. Shippo said: ${JSON.stringify(r.json.messages ?? []).slice(0, 500)}` };
      return { text: rates.map((x: any) => `${x.id}  ${x.amount.toFixed(2)} ${x.currency}  ${x.provider} ${x.service}  ~${x.days ?? "?"} days`).join("\n") };
    }
    if (tool === "buy_label") {
      const o = orderByRef(ctx.state, i.order); if (!o) throw new Error(`No order "${i.order}"`);
      const rate = rateCache.get(i.rate_id);
      const r = await shippoApi(ctx, "/transactions/", { method: "POST", json: { rate: i.rate_id, label_file_type: "PDF_4x6", async: false } });
      if (r.json.status !== "SUCCESS") throw new Error("Label failed: " + JSON.stringify(r.json.messages ?? r.json.status).slice(0, 400));
      const tracking = { carrier: rate?.provider ?? "", number: r.json.tracking_number, url: r.json.tracking_url_provider, labelUrl: r.json.label_url };
      return {
        text: `Label bought: ${tracking.carrier} ${tracking.number}. Label PDF: ${tracking.labelUrl}. Tracking: ${tracking.url}` +
          (o.connectionId ? `\nNow mark the order fulfilled in the store with this tracking number.` : ""),
        patch: s => { const x = s.orders.find(y => y.id === o.id); if (x) { x.tracking = tracking; if (!x.connectionId) x.stage = "shipped"; } },
      };
    }
    if (tool === "track") {
      const r = await shippoApi(ctx, `/tracks/${encodeURIComponent(i.carrier)}/${encodeURIComponent(i.tracking_number)}`);
      const st = r.json.tracking_status;
      return { text: `${st?.status ?? "UNKNOWN"}: ${st?.status_details ?? ""} (${st?.status_date ?? ""}) ETA ${r.json.eta ?? "?"}` };
    }
    throw new Error("Unknown tool " + tool);
  },
};
