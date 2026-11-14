import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Category, Connection, Order, Product, State } from "../model.ts";

export interface Field { key: string; label: string; secret?: boolean; placeholder?: string; help?: string; optional?: boolean; multiline?: boolean }
export interface ToolSpec {
  name: string; description: string; input_schema: any;
  /** null = read-only (always allowed). Otherwise the action goes through the business's rules for this category. */
  category: Category | null;
  amountUsd?: (input: any, ctx: Ctx) => number;
  summary?: (input: any, ctx: Ctx) => string;
}
export interface Ctx { conn: Connection; secrets: Record<string, string>; state: State }
export interface ExecResult { text: string; patch?: (s: State) => void }
export interface ConnectorDef {
  type: string; label: string; blurb: string; group: "Store" | "Payments" | "Shipping" | "Messaging" | "Universal";
  fields: Field[]; oauth?: "shopify";
  docsUrl?: string;
  /** Validate credentials; may return info to show and tools to cache (MCP). */
  connect(ctx: Ctx): Promise<{ info?: Record<string, string>; tools?: Connection["tools"] }>;
  tools(conn: Connection): ToolSpec[];
  execute(ctx: Ctx, tool: string, input: any): Promise<ExecResult>;
  sync?(ctx: Ctx): Promise<{ orders?: Order[]; products?: Product[] }>;
}

// ---------- HTTP with a test hook and SSRF protection ----------
export type FakeFetch = (url: string, init: RequestInit) => Promise<{ status: number; body: any; headers?: Record<string, string> }>;
let fake: FakeFetch | null = null;
export const setFakeFetch = (f: FakeFetch | null) => { fake = f; };

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function http(url: string, init: RequestInit & { json?: any; form?: Record<string, any>; userUrl?: boolean; timeoutMs?: number } = {}) {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) { headers.set("content-type", "application/json"); body = JSON.stringify(init.json); }
  if (init.form) { headers.set("content-type", "application/x-www-form-urlencoded"); body = formEncode(init.form); }
  const req: RequestInit = { ...init, headers, body };
  if (fake) {
    const r = await fake(url, { ...req, headers: Object.fromEntries(headers.entries()) as any });
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return finish(url, r.status, text, new Headers(r.headers ?? {}));
  }
  if (init.userUrl) await assertPublicUrl(url);
  const res = await fetch(url, { ...req, redirect: init.userUrl ? "manual" : "follow", signal: AbortSignal.timeout(init.timeoutMs ?? 45_000) });
  return finish(url, res.status, await res.text(), res.headers);
}

function finish(url: string, status: number, text: string, headers: Headers) {
  let json: any = undefined; try { json = text ? JSON.parse(text) : undefined; } catch { /* not json */ }
  if (status >= 400) {
    const msg = json?.error?.message ?? json?.errors?.[0]?.message ?? json?.message ?? json?.detail ?? (typeof json?.errors === "string" ? json.errors : "") ?? "";
    throw new HttpError(status, `${new URL(url).host} returned ${status}${msg ? `: ${String(msg).slice(0, 300)}` : ""}`);
  }
  return { status, text, json, headers };
}

export function formEncode(obj: Record<string, any>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") parts.push(formEncode(v, key)); else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join("&");
}

/** Customer-supplied URLs must be public HTTPS hosts, never our own network. */
export async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  const allowHttp = process.env.ALLOW_HTTP_CONNECTORS === "1";
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) throw new Error("Only https:// URLs are allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new Error("That address is not allowed");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const { address } of addrs) if (isPrivate(address)) throw new Error("That address points to a private network");
}
function isPrivate(ip: string) {
  if (ip.includes(":")) return ip === "::1" || /^f[cd]|^fe80|^::ffff:(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// ---------- schema helpers ----------
export const obj = (props: Record<string, any>, required: string[] = []) => ({ type: "object", properties: props, required });
export const str = (description: string, extra: any = {}) => ({ type: "string", description, ...extra });
export const num = (description: string) => ({ type: "number", description });
export const bool = (description: string) => ({ type: "boolean", description });
export const clip = (s: string, n = 12000) => (s.length > n ? s.slice(0, n) + `\n…(${s.length - n} more characters)` : s);
export const money = (n: number, c = "USD") => `${n.toFixed(2)} ${c}`;
