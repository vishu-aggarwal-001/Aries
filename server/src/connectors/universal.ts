// Email, webhooks (Zapier/Make/n8n), any MCP server, any REST API.
import { ConnectorDef, Ctx, http, obj, str, clip, assertPublicUrl } from "./base.ts";
import { orderByRef } from "../model.ts";

// ======================= Email via Resend =======================
export const email: ConnectorDef = {
  type: "email", label: "Email (Resend)", group: "Messaging",
  blurb: "Send customer emails from your own domain. Every send follows your messaging rules.",
  docsUrl: "https://resend.com/docs/dashboard/domains/introduction",
  fields: [
    { key: "apiKey", label: "Resend API key", secret: true, placeholder: "re_…" },
    { key: "from", label: "From", placeholder: "Acme Support <support@acme.com>", help: "Must be on a domain you verified in Resend" },
    { key: "replyTo", label: "Reply-to", optional: true, placeholder: "you@acme.com" },
  ],
  async connect(ctx) {
    if (!/^re_/.test(ctx.secrets.apiKey ?? "")) throw new Error("That doesn't look like a Resend key (starts with re_)");
    if (!/@/.test(ctx.conn.info.from ?? "")) throw new Error("Enter a From address");
    return { info: {} };
  },
  tools: () => [{
    name: "send_email", category: "customer_message", description: "Email a customer. Plain text. Sign off as the business, never as an AI agent unless asked.",
    input_schema: obj({ to: str("Recipient email, or an order number to email that order's customer"), subject: str("Subject"), body: str("Plain-text body") }, ["to", "subject", "body"]),
    summary: (i, ctx) => `Email ${resolveTo(ctx, i.to)}: "${i.subject}"\n\n${String(i.body).slice(0, 1200)}`,
  }],
  async execute(ctx, tool, i) {
    const to = resolveTo(ctx, i.to);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error(`No valid email for "${i.to}"`);
    const r = await http("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${ctx.secrets.apiKey}` },
      json: { from: ctx.conn.info.from, to: [to], subject: i.subject, text: i.body, ...(ctx.conn.info.replyTo ? { reply_to: ctx.conn.info.replyTo } : {}) },
    });
    return { text: `Email sent to ${to} (id ${r.json?.id ?? "?"}).` };
  },
};
function resolveTo(ctx: Ctx, to: string) {
  if (String(to).includes("@")) return String(to).trim();
  return orderByRef(ctx.state, to)?.customer.email ?? String(to);
}

// ======================= Webhook (Zapier, Make, n8n, Pipedream…) =======================
export const webhook: ConnectorDef = {
  type: "webhook", label: "Zapier / Make / webhook", group: "Universal",
  blurb: "Reach 8,000+ apps. Agents send named events to your Zap or scenario, which does the rest.",
  docsUrl: "https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks",
  fields: [
    { key: "url", label: "Webhook URL", secret: true, placeholder: "https://hooks.zapier.com/hooks/catch/…" },
    { key: "events", label: "What can agents trigger?", multiline: true, placeholder: "add_to_crm: add a lead to HubSpot\nsend_sms: text a customer (to, message)\npost_slack: post to #orders", help: "One event per line: name, then what it does and which fields it needs." },
  ],
  async connect(ctx) { await assertPublicUrlLenient(ctx.secrets.url); return { info: {} }; },
  tools: (conn) => [{
    name: "send_event", category: "external_write",
    description: "Trigger an automation in the business's other apps. Available events:\n" + (conn.info.events || "(none described; ask the board)"),
    input_schema: obj({ event: str("Event name from the list"), data: { type: "object", description: "Fields the event needs", additionalProperties: true } }, ["event", "data"]),
    summary: i => `Trigger "${i.event}" with ${JSON.stringify(i.data).slice(0, 600)}`,
  }],
  async execute(ctx, _tool, i) {
    const r = await http(ctx.secrets.url, { method: "POST", userUrl: true, json: { event: i.event, data: i.data, business: ctx.state.name, sent_at: new Date().toISOString() } });
    return { text: `Event "${i.event}" delivered (${r.status}). ${clip(r.text ?? "", 500)}` };
  },
};
async function assertPublicUrlLenient(url?: string) {
  if (!url) throw new Error("Enter the webhook URL");
  try { await assertPublicUrl(url); } catch (e: any) { if (/private|not allowed|https/.test(e.message)) throw e; /* DNS hiccups are OK at setup */ }
}

// ======================= MCP (Model Context Protocol) =======================
const MCP_VERSION = "2025-06-18";
export async function mcpCall(url: string, token: string | undefined, headerName: string | undefined, method: string, params: any) {
  const base: Record<string, string> = { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": MCP_VERSION };
  if (token) base[headerName || "Authorization"] = (headerName && headerName !== "Authorization") ? token : `Bearer ${token}`;
  const rpc = async (body: any, session?: string) => {
    const r = await http(url, { method: "POST", userUrl: true, headers: { ...base, ...(session ? { "Mcp-Session-Id": session } : {}) }, json: body });
    return { msg: parseRpc(r.text), session: r.headers.get("mcp-session-id") ?? session };
  };
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: "Aries", version: "1.0" } } });
  if (init.msg?.error) throw new Error("MCP initialize failed: " + init.msg.error.message);
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, init.session).catch(() => {});
  const res = await rpc({ jsonrpc: "2.0", id: 2, method, params }, init.session);
  if (res.msg?.error) throw new Error("MCP error: " + res.msg.error.message);
  return res.msg?.result;
}
/** Responses may be plain JSON or a server-sent event stream. */
export function parseRpc(text: string): any {
  const t = (text ?? "").trim(); if (!t) return undefined;
  if (t.startsWith("{")) return JSON.parse(t);
  const datas = t.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).filter(Boolean);
  for (let k = datas.length - 1; k >= 0; k--) { try { const m = JSON.parse(datas[k]); if (m.id !== undefined || m.result || m.error) return m; } catch { /* keep looking */ } }
  return undefined;
}

export const mcp: ConnectorDef = {
  type: "mcp", label: "MCP server", group: "Universal",
  blurb: "Plug in any app that offers an MCP server (Square, PayPal, HubSpot, Notion, Linear, your own…). Its tools become your crew's tools.",
  docsUrl: "https://modelcontextprotocol.io/",
  fields: [
    { key: "url", label: "Server URL", placeholder: "https://mcp.example.com/mcp" },
    { key: "token", label: "Access token", secret: true, optional: true, help: "If the server needs one. Sent as a Bearer token." },
    { key: "headerName", label: "Auth header", optional: true, placeholder: "Authorization" },
    { key: "trustReads", label: "Treat tools without a read-only hint as reads? (yes/no)", optional: true, placeholder: "no" },
  ],
  async connect(ctx) {
    const res = await mcpCall(ctx.conn.info.url, ctx.secrets.token, ctx.conn.info.headerName, "tools/list", {});
    const tools = (res?.tools ?? []).slice(0, 60).map((t: any) => ({
      name: String(t.name), description: String(t.description ?? "").slice(0, 900), input_schema: t.inputSchema ?? { type: "object", properties: {} },
      readOnly: !!t.annotations?.readOnlyHint,
    }));
    if (!tools.length) throw new Error("The server listed no tools");
    return { info: { toolCount: String(tools.length) }, tools };
  },
  tools: (conn) => (conn.tools ?? []).map(t => ({
    name: t.name, description: t.description, input_schema: t.input_schema,
    category: t.readOnly || /^y/i.test(conn.info.trustReads ?? "") && /^(get|list|search|read|find|fetch|query)/i.test(t.name) ? null : "external_write",
    summary: (i: any) => `${conn.label}: ${t.name} ${JSON.stringify(i).slice(0, 600)}`,
  })),
  async execute(ctx, tool, i) {
    const res = await mcpCall(ctx.conn.info.url, ctx.secrets.token, ctx.conn.info.headerName, "tools/call", { name: tool, arguments: i ?? {} });
    const text = (res?.content ?? []).map((c: any) => c.type === "text" ? c.text : c.type === "resource" ? (c.resource?.text ?? c.resource?.uri) : `[${c.type}]`).join("\n");
    if (res?.isError) throw new Error(clip(text || "Tool failed", 2000));
    return { text: clip(text || JSON.stringify(res?.structuredContent ?? res ?? {})) };
  },
};

// ======================= Any REST API =======================
export const api: ConnectorDef = {
  type: "api", label: "Any REST API", group: "Universal",
  blurb: "Point your crew at any HTTP API (booking system, POS, CRM, ERP). Reads are free; writes follow your rules.",
  fields: [
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.example.com/v1" },
    { key: "authHeader", label: "Auth header name", optional: true, placeholder: "Authorization" },
    { key: "authValue", label: "Auth header value", secret: true, optional: true, placeholder: "Bearer sk_…" },
    { key: "docs", label: "How the API works", multiline: true, placeholder: "GET /bookings?date=YYYY-MM-DD lists bookings\nPOST /bookings {name, time, party} creates one", help: "Paste the endpoints your crew should use. The more specific, the better." },
  ],
  async connect(ctx) { await assertPublicUrlLenient(ctx.conn.info.baseUrl); return { info: {} }; },
  tools: (conn) => [
    { name: "get", category: null, description: `GET a path on ${conn.label}. API notes:\n${conn.info.docs ?? ""}`, input_schema: obj({ path: str("Path starting with /, may include ?query") }, ["path"]) },
    {
      name: "send", category: "external_write", description: `POST/PUT/PATCH/DELETE on ${conn.label}.`,
      input_schema: obj({ method: str("HTTP method", { enum: ["POST", "PUT", "PATCH", "DELETE"] }), path: str("Path starting with /"), body: { type: "object", additionalProperties: true, description: "JSON body" } }, ["method", "path"]),
      summary: i => `${i.method} ${conn.info.baseUrl}${i.path} ${i.body ? JSON.stringify(i.body).slice(0, 500) : ""}`,
    },
  ],
  async execute(ctx, tool, i) {
    const base = String(ctx.conn.info.baseUrl).replace(/\/+$/, "");
    const path = String(i.path ?? "/"); if (!path.startsWith("/") || path.includes("..") || /^\/\//.test(path)) throw new Error("Path must start with / and stay on the API");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (ctx.secrets.authValue) headers[ctx.conn.info.authHeader || "Authorization"] = ctx.secrets.authValue;
    const r = await http(base + path, { method: tool === "get" ? "GET" : i.method, headers, userUrl: true, ...(tool === "send" && i.body ? { json: i.body } : {}) });
    return { text: `${r.status}\n${clip(r.text ?? "")}` };
  },
};
