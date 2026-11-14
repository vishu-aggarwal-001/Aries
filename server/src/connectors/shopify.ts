import { ConnectorDef, Ctx, http, obj, str, num, bool, clip } from "./base.ts";
import { orderByRef, productByRef, type Order, type OrderStage, type Product } from "../model.ts";

export const SHOPIFY_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-07";
export const SHOPIFY_SCOPES = "read_products,write_products,read_orders,write_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_customers";

export function normShop(s: string) {
  const v = s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const shop = v.includes(".") ? v : `${v}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error("Enter your store's myshopify.com address, e.g. my-shop.myshopify.com");
  return shop;
}

async function gql(ctx: Ctx, query: string, variables: any = {}) {
  const shop = normShop(ctx.conn.info.shop ?? "");
  const r = await http(`https://${shop}/admin/api/${SHOPIFY_VERSION}/graphql.json`, {
    method: "POST", headers: { "X-Shopify-Access-Token": ctx.secrets.accessToken ?? "" }, json: { query, variables },
  });
  if (r.json?.errors?.length) throw new Error("Shopify: " + r.json.errors.map((e: any) => e.message).join("; "));
  return r.json.data;
}
const userErrors = (x: any) => { if (x?.userErrors?.length) throw new Error("Shopify: " + x.userErrors.map((e: any) => e.message).join("; ")); };

const ORDER_FIELDS = `id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus email note
  totalPriceSet { shopMoney { amount currencyCode } } customer { displayName email }
  shippingAddress { name address1 address2 city provinceCode zip countryCodeV2 phone }
  lineItems(first: 30) { nodes { title quantity sku } }
  fulfillments(first: 3) { trackingInfo(first: 1) { company number url } }`;

export function mapOrder(n: any): Order {
  const paid = ["PAID", "PARTIALLY_REFUNDED"].includes(n.displayFinancialStatus);
  let stage: OrderStage = paid ? "to_ship" : "new";
  if (n.displayFulfillmentStatus === "FULFILLED") stage = "shipped";
  if (n.cancelledAt) stage = "cancelled";
  const t = n.fulfillments?.[0]?.trackingInfo?.[0];
  const a = n.shippingAddress;
  return {
    id: "", connectionId: null, extId: n.id, number: n.name, createdAt: Date.parse(n.createdAt),
    customer: { name: n.customer?.displayName ?? a?.name ?? "", email: n.email ?? n.customer?.email ?? "" },
    shipTo: a ? { name: a.name ?? "", line1: a.address1 ?? "", line2: a.address2 ?? "", city: a.city ?? "", state: a.provinceCode ?? "", zip: a.zip ?? "", country: a.countryCodeV2 ?? "", phone: a.phone ?? "" } : null,
    items: (n.lineItems?.nodes ?? []).map((l: any) => ({ title: l.title, qty: l.quantity, sku: l.sku ?? "" })),
    total: Number(n.totalPriceSet?.shopMoney?.amount ?? 0), currency: n.totalPriceSet?.shopMoney?.currencyCode ?? "USD",
    paid, stage, tracking: t ? { carrier: t.company ?? "", number: t.number ?? "", url: t.url ?? "" } : null,
  };
}

export function mapProduct(n: any, currency: string): Product {
  const v = n.variants?.nodes?.[0];
  return {
    id: "", connectionId: null, extId: n.id, title: n.title, sku: v?.sku ?? "", price: Number(v?.price ?? 0), currency,
    inventory: n.totalInventory ?? null, status: String(n.status ?? "").toLowerCase(), url: n.onlineStoreUrl ?? "", variantId: v?.id, updatedAt: Date.now(),
  };
}

const findOrder = (ctx: Ctx, ref: string) => {
  const o = orderByRef(ctx.state, ref);
  if (!o || o.connectionId !== ctx.conn.id) throw new Error(`No Shopify order "${ref}". Use list_orders.`);
  return o;
};

export const shopify: ConnectorDef = {
  type: "shopify", label: "Shopify", group: "Store", oauth: "shopify",
  blurb: "Orders, products and fulfillment. Agents ship orders, update listings and keep stock in view.",
  docsUrl: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
  fields: [
    { key: "shop", label: "Store address", placeholder: "my-shop.myshopify.com" },
    { key: "accessToken", label: "Admin API access token", secret: true, optional: true, help: "Only if you created a custom app in Shopify. Otherwise use Connect with Shopify." },
  ],
  async connect(ctx) {
    const d = await gql(ctx, `{ shop { name currencyCode myshopifyDomain } }`);
    return { info: { shop: d.shop.myshopifyDomain, shopName: d.shop.name, currency: d.shop.currencyCode } };
  },
  async sync(ctx) {
    const cur = ctx.conn.info.currency ?? "USD";
    const d = await gql(ctx, `{
      orders(first: 50, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } }
      products(first: 100, sortKey: UPDATED_AT, reverse: true) { nodes { id title status onlineStoreUrl totalInventory variants(first: 1) { nodes { id sku price } } } }
    }`);
    return { orders: d.orders.nodes.map(mapOrder), products: d.products.nodes.map((p: any) => mapProduct(p, cur)) };
  },
  tools: () => [
    { name: "get_order", category: null, description: "Live details of a Shopify order (status, items, address, notes).", input_schema: obj({ order: str("Order number like #1001") }, ["order"]) },
    { name: "search_orders", category: null, description: "Search Shopify orders with Shopify's query syntax, e.g. 'fulfillment_status:unfulfilled' or 'email:jane@x.com'.", input_schema: obj({ query: str("Shopify search query") }, ["query"]) },
    {
      name: "fulfill_order", category: "store_update", description: "Mark a Shopify order fulfilled with tracking. Shopify emails the customer if notify is true.",
      input_schema: obj({ order: str("Order number"), tracking_number: str("Tracking number"), carrier: str("Carrier name, e.g. USPS"), tracking_url: str("Tracking URL (optional)"), notify: bool("Email the customer (default true)") }, ["order", "tracking_number", "carrier"]),
      summary: (i) => `Fulfill Shopify order ${i.order} (${i.carrier} ${i.tracking_number})`,
    },
    {
      name: "update_product", category: "store_update", description: "Change a Shopify product's title, description (HTML) or price.",
      input_schema: obj({ product: str("Product title or SKU"), title: str("New title"), description_html: str("New description HTML"), price: num("New price") }, ["product"]),
      summary: (i) => `Update Shopify product "${i.product}"` + (i.price != null ? ` price → ${i.price}` : "") + (i.title ? ` title → ${i.title}` : "") + (i.description_html ? " (new description)" : ""),
    },
    {
      name: "add_order_note", category: "store_update", description: "Replace the internal note on a Shopify order (staff-only).",
      input_schema: obj({ order: str("Order number"), note: str("Note text") }, ["order", "note"]), summary: (i) => `Set note on Shopify order ${i.order}`,
    },
  ],
  async execute(ctx, tool, i) {
    switch (tool) {
      case "get_order": {
        const o = findOrder(ctx, i.order);
        const d = await gql(ctx, `query($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id: o.extId });
        const m = mapOrder(d.order);
        return { text: clip(JSON.stringify({ ...m, note: d.order.note }, null, 1)), patch: s => { const x = s.orders.find(y => y.id === o.id); if (x) Object.assign(x, { ...m, id: x.id, connectionId: x.connectionId }); } };
      }
      case "search_orders": {
        const d = await gql(ctx, `query($q: String) { orders(first: 20, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } } }`, { q: i.query });
        const list = d.orders.nodes.map(mapOrder);
        return { text: list.length ? list.map((o: Order) => `${o.number} ${o.stage} ${o.total} ${o.currency} — ${o.customer.name} — ${o.items.map(x => `${x.qty}× ${x.title}`).join(", ")}`).join("\n") : "No matching orders." };
      }
      case "fulfill_order": {
        const o = findOrder(ctx, i.order);
        const d = await gql(ctx, `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status } } } }`, { id: o.extId });
        const open = d.order.fulfillmentOrders.nodes.filter((f: any) => ["OPEN", "IN_PROGRESS"].includes(f.status));
        if (!open.length) throw new Error(`Order ${o.number} has nothing left to fulfill.`);
        const r = await gql(ctx, `mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id status } userErrors { field message } } }`, {
          f: {
            lineItemsByFulfillmentOrder: open.map((f: any) => ({ fulfillmentOrderId: f.id })), notifyCustomer: i.notify !== false,
            trackingInfo: { company: i.carrier, number: i.tracking_number, ...(i.tracking_url ? { url: i.tracking_url } : {}) },
          },
        });
        userErrors(r.fulfillmentCreate);
        return {
          text: `Order ${o.number} fulfilled in Shopify with ${i.carrier} ${i.tracking_number}.`,
          patch: s => { const x = s.orders.find(y => y.id === o.id); if (x) { x.stage = "shipped"; x.tracking = { ...(x.tracking ?? {}), carrier: i.carrier, number: i.tracking_number, url: i.tracking_url ?? x.tracking?.url }; } },
        };
      }
      case "update_product": {
        const p = productByRef(ctx.state, i.product);
        if (!p || p.connectionId !== ctx.conn.id) throw new Error(`No Shopify product "${i.product}".`);
        if (i.title || i.description_html) {
          const r = await gql(ctx, `mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { id } userErrors { field message } } }`,
            { p: { id: p.extId, ...(i.title ? { title: i.title } : {}), ...(i.description_html ? { descriptionHtml: i.description_html } : {}) } });
          userErrors(r.productUpdate);
        }
        if (i.price != null && p.variantId) {
          const r = await gql(ctx, `mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $pid, variants: $v) { userErrors { field message } } }`,
            { pid: p.extId, v: [{ id: p.variantId, price: String(i.price) }] });
          userErrors(r.productVariantsBulkUpdate);
        }
        return { text: `Updated ${p.title} in Shopify.`, patch: s => { const x = s.products.find(y => y.id === p.id); if (x) { if (i.price != null) x.price = Number(i.price); if (i.title) x.title = i.title; } } };
      }
      case "add_order_note": {
        const o = findOrder(ctx, i.order);
        const r = await gql(ctx, `mutation($i: OrderInput!) { orderUpdate(input: $i) { order { id } userErrors { field message } } }`, { i: { id: o.extId, note: i.note } });
        userErrors(r.orderUpdate);
        return { text: `Note saved on ${o.number}.` };
      }
    }
    throw new Error("Unknown tool " + tool);
  },
};
