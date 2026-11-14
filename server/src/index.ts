import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { openDb, Repo } from "./db.ts";
import { Connections } from "./connectors/index.ts";
import { Engine } from "./engine/engine.ts";
import { buildApp } from "./api.ts";

for (const k of ["JWT_SECRET", "SECRET_KEY", "ANTHROPIC_API_KEY"]) if (!process.env[k]) console.warn(`⚠ ${k} is not set${k === "ANTHROPIC_API_KEY" ? " (agents can't run)" : " (using an insecure dev default)"}`);

const db = await openDb(process.env.DATABASE_URL ?? "./data");
const repo = new Repo(db);
const conns = new Connections(repo);
const engine = new Engine(repo, conns);
const app = buildApp({ repo, conns, engine });

// The web app (built into ../web/dist) is served from the same origin.
const dist = resolve(process.env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname);
if (existsSync(dist)) {
  const index = readFileSync(resolve(dist, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: relative(process.cwd(), dist) || "." }));
  app.get("*", c => (c.req.path.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.html(index)));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
engine.start();
console.log(`Aries running on http://localhost:${port}`);
