import { useEffect, useSyncExternalStore } from "react";

const KEY = "aries.token";
export const auth = {
  get token() { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } },
  set(t: string) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* private mode */ } },
};

export async function req<T = any>(method: string, path: string, body?: any): Promise<T> {
  const r = await fetch(path, {
    method, headers: { "content-type": "application/json", ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith("/api/auth")) { auth.set(""); location.href = "/login"; }
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

// ---------- tiny cached stores ----------
type Entry = { data: any; error?: string; listeners: Set<() => void>; loading?: Promise<void>; es?: EventSource; refs: number };
const cache = new Map<string, Entry>();
const entry = (k: string) => { let e = cache.get(k); if (!e) { e = { data: undefined, listeners: new Set(), refs: 0 }; cache.set(k, e); } return e; };
const emit = (e: Entry) => e.listeners.forEach(l => l());

export async function load(key: string, path: string) {
  const e = entry(key);
  if (e.loading) return e.loading;
  e.loading = req("GET", path).then(d => { e.data = d; e.error = undefined; }).catch(err => { e.error = err.message; }).finally(() => { e.loading = undefined; emit(e); });
  return e.loading;
}

function useKey(key: string, path: string | null) {
  const e = entry(key);
  const snap = useSyncExternalStore(cb => { e.listeners.add(cb); return () => e.listeners.delete(cb); }, () => e.data);
  useEffect(() => { if (path && e.data === undefined) void load(key, path); }, [key, path]);
  return { data: snap, error: e.error, reload: () => path && load(key, path) };
}

export const useCatalog = () => useKey("catalog", "/api/catalog").data;
export const useMe = () => useKey("me", "/api/me");
export const reloadMe = () => load("me", "/api/me");

/** A business snapshot that stays live via server-sent events. */
export function useBiz(bid: string) {
  const key = "biz:" + bid; const path = `/api/b/${bid}`;
  const r = useKey(key, path);
  useEffect(() => {
    const e = entry(key); e.refs++;
    if (!e.es && auth.token) {
      let t: any;
      const es = new EventSource(`/api/b/${bid}/events?token=${encodeURIComponent(auth.token)}`);
      es.addEventListener("change", () => { clearTimeout(t); t = setTimeout(() => load(key, path), 150); });
      es.addEventListener("ping", (m: MessageEvent) => {
        try { const live = JSON.parse(m.data).live; if (e.data && JSON.stringify(live) !== JSON.stringify(e.data.live)) { e.data = { ...e.data, live }; emit(e); } } catch { /* ignore */ }
      });
      e.es = es;
    }
    return () => { e.refs--; if (e.refs <= 0 && e.es) { e.es.close(); e.es = undefined; } };
  }, [bid]);
  return r;
}

/** Call a business endpoint, then refresh the snapshot. */
export async function act(bid: string, method: string, sub: string, body?: any) {
  const r = await req(method, `/api/b/${bid}${sub}`, body);
  await load("biz:" + bid, `/api/b/${bid}`);
  return r;
}

// ---------- helpers ----------
export const money = (n: number, c = "USD") => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: n < 0.1 && n > 0 ? 3 : 2 }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
};
export function ago(ts: number) {
  if (!ts) return "never";
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export const nameOf = (s: any, id?: string | null) => id == null ? "Unassigned" : id === "board" ? "You" : id === "system" ? "Aries" : s.agents.find((a: any) => a.id === id)?.name ?? "Former agent";
export const agentOf = (s: any, id?: string | null) => s.agents.find((a: any) => a.id === id);
export const OPEN = ["backlog", "todo", "in_progress", "in_review", "blocked"];
export const STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
export const statusLabel = (s: string) => ({ in_progress: "In progress", in_review: "In review", to_ship: "To ship" } as any)[s] ?? s[0].toUpperCase() + s.slice(1);
export const statusColor = (s: string) => ({ todo: "var(--blue)", in_progress: "var(--molten)", in_review: "var(--violet)", blocked: "var(--red)", done: "var(--green)", new: "var(--blue)", to_ship: "var(--molten)", shipped: "var(--green)", delivered: "var(--green)", cancelled: "var(--muted)" } as any)[s] ?? "var(--muted)";
export const prioColor = (p: string) => ({ urgent: "var(--red)", high: "var(--molten)", low: "var(--muted)" } as any)[p] ?? "var(--brass)";
export const modelLabel = (m: string) => ({ "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5" } as any)[m] ?? m;
