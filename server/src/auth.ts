import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.ts";
import { newId } from "./model.ts";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-only-jwt-secret-change-me");

export interface User { id: string; email: string; name: string }

export async function signup(db: Db, email: string, password: string, name: string): Promise<User> {
  email = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email");
  if (String(password ?? "").length < 8) throw new Error("Password must be at least 8 characters");
  const exists = await db.query("SELECT 1 FROM users WHERE email=$1", [email]);
  if (exists.rows.length) throw new Error("An account with that email already exists");
  const u: User = { id: newId(), email, name: String(name ?? "").trim().slice(0, 80) };
  await db.query("INSERT INTO users (id, email, pw, name, created_at) VALUES ($1,$2,$3,$4,$5)", [u.id, u.email, await bcrypt.hash(password, 10), u.name, Date.now()]);
  return u;
}

export async function login(db: Db, email: string, password: string): Promise<User> {
  const r = await db.query("SELECT id, email, name, pw FROM users WHERE email=$1", [String(email ?? "").trim().toLowerCase()]);
  const row = r.rows[0];
  if (!row || !(await bcrypt.compare(String(password ?? ""), row.pw))) throw new Error("Wrong email or password");
  return { id: row.id, email: row.email, name: row.name };
}

export const issueToken = (u: User) => new SignJWT({ sub: u.id, email: u.email }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(SECRET);
export async function verifyToken(token: string): Promise<string | null> {
  try { return (await jwtVerify(token, SECRET)).payload.sub ?? null; } catch { return null; }
}

/** Stripe webhook signature check (t=…,v1=…). */
export function verifyStripeSig(raw: string, header: string | undefined, secret: string, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=") as [string, string]));
  const t = Number(parts.t); if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const sigs = header.split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  return sigs.some(s => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/** Shopify OAuth callback HMAC check. */
export function verifyShopifyHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, signature: _s, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join("&");
  const expected = createHmac("sha256", secret).update(msg).digest("hex");
  return hmac.length === expected.length && timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
}
