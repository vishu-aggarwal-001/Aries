import { EventEmitter } from "node:events";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { State } from "./model.ts";

export interface Db { query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number | null }> ; close(): Promise<void> }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, pw text NOT NULL, name text NOT NULL DEFAULT '', created_at double precision NOT NULL);
CREATE TABLE IF NOT EXISTS businesses (
  id text PRIMARY KEY, state jsonb NOT NULL, version integer NOT NULL DEFAULT 0,
  plan text NOT NULL DEFAULT 'trial', plan_until double precision, usage_usd double precision NOT NULL DEFAULT 0,
  period_start double precision NOT NULL, stripe_customer text, stripe_sub text, created_at double precision NOT NULL);
CREATE TABLE IF NOT EXISTS members (user_id text NOT NULL, business_id text NOT NULL, role text NOT NULL DEFAULT 'owner', PRIMARY KEY (user_id, business_id));
CREATE TABLE IF NOT EXISTS secrets (business_id text NOT NULL, connection_id text NOT NULL, data text NOT NULL, PRIMARY KEY (business_id, connection_id));
CREATE TABLE IF NOT EXISTS oauth_states (state text PRIMARY KEY, business_id text NOT NULL, provider text NOT NULL, data text NOT NULL DEFAULT '{}', created_at double precision NOT NULL);
`;

export async function openDb(url = process.env.DATABASE_URL): Promise<Db> {
  let db: Db;
  if (url && url.startsWith("postgres")) {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: url, ssl: process.env.PGSSL === "off" ? undefined : { rejectUnauthorized: false } });
    db = { query: (q, p) => pool.query(q, p) as any, close: () => pool.end() };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const lite = new PGlite(url && url !== "memory" ? url : undefined); // a folder path keeps data on disk
    db = { query: (q, p) => lite.query(q, p) as any, close: () => lite.close() };
  }
  for (const stmt of SCHEMA.split(";").map(x => x.trim()).filter(Boolean)) await db.query(stmt);
  return db;
}

// ---------- secrets: AES-256-GCM with a server key ----------
const KEY = createHash("sha256").update(process.env.SECRET_KEY ?? "dev-only-secret-change-me").digest();
export function seal(obj: unknown): string {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function open<T = any>(sealed: string): T {
  const b = Buffer.from(sealed, "base64"); const d = createDecipheriv("aes-256-gcm", KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
}

// ---------- business repository ----------
export const bus = new EventEmitter(); bus.setMaxListeners(0);

export interface BizRow { id: string; state: State; version: number; plan: string; plan_until: number | null; usage_usd: number; period_start: number; stripe_customer: string | null; stripe_sub: string | null }

export class Repo {
  constructor(public db: Db) {}

  async get(id: string): Promise<BizRow | undefined> {
    const r = await this.db.query<BizRow>("SELECT * FROM businesses WHERE id=$1", [id]);
    return r.rows[0];
  }

  async create(id: string, state: State, plan = "trial", planUntil: number | null = null) {
    await this.db.query("INSERT INTO businesses (id, state, version, plan, plan_until, period_start, created_at) VALUES ($1,$2,0,$3,$4,$5,$5)",
      [id, JSON.stringify(state), plan, planUntil, Date.now()]);
  }

  /** Optimistic-concurrency mutation. fn edits a draft copy; it may be re-run if another writer got there first. */
  async mutate<T>(id: string, fn: (s: State) => T): Promise<{ state: State; result: T }> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = await this.get(id); if (!row) throw new Error("Business not found");
      const draft: State = structuredClone(row.state);
      const result = fn(draft);
      trim(draft);
      const r = await this.db.query("UPDATE businesses SET state=$1, version=version+1 WHERE id=$2 AND version=$3", [JSON.stringify(draft), id, row.version]);
      if ((r.rowCount ?? (r as any).affectedRows ?? 0) > 0) {
        bus.emit(id, row.version + 1);
        return { state: draft, result };
      }
      await new Promise(res => setTimeout(res, 5 + Math.random() * 25 * (attempt + 1)));
    }
    throw new Error("Too much contention, try again");
  }

  async addUsage(id: string, usd: number) {
    await this.db.query("UPDATE businesses SET usage_usd = usage_usd + $1 WHERE id=$2", [usd, id]);
  }

  async running(): Promise<string[]> {
    return (await this.db.query<{ id: string }>("SELECT id FROM businesses WHERE (state->>'running')::boolean = true")).rows.map(r => r.id);
  }

  async setSecret(bid: string, cid: string, data: Record<string, string>) {
    await this.db.query("INSERT INTO secrets (business_id, connection_id, data) VALUES ($1,$2,$3) ON CONFLICT (business_id, connection_id) DO UPDATE SET data=EXCLUDED.data", [bid, cid, seal(data)]);
  }
  async getSecret(bid: string, cid: string): Promise<Record<string, string>> {
    const r = await this.db.query<{ data: string }>("SELECT data FROM secrets WHERE business_id=$1 AND connection_id=$2", [bid, cid]);
    return r.rows[0] ? open(r.rows[0].data) : {};
  }
  async deleteSecret(bid: string, cid: string) { await this.db.query("DELETE FROM secrets WHERE business_id=$1 AND connection_id=$2", [bid, cid]); }
}

function trim(s: State) {
  if (s.runs.length > 80) s.runs.splice(0, s.runs.length - 80);
  for (const r of s.runs) if (r.events.length > 150) r.events.splice(0, r.events.length - 150);
  if (s.actions.length > 400) s.actions.splice(0, s.actions.length - 400);
  if (s.comments.length > 3000) s.comments.splice(0, s.comments.length - 3000);
}
