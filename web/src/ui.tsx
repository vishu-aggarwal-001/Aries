import { ReactNode, useEffect, useState } from "react";

/** Monogram in the agent's own color. A spinning ice ring means they're working right now. */
export function Avatar({ a, size = 36, live }: { a?: any; size?: number; live?: boolean }) {
  const h = a?.hue ?? 230;
  const letter = a?.name ? a.name[0].toUpperCase() : "You"[0];
  return (
    <div className={"avatar" + (live ? " live" : "")} aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.46, background: a ? `radial-gradient(circle at 35% 30%, hsl(${h} 85% 82%), hsl(${h} 60% 62%))` : "var(--deep2)", color: a ? "#0b1a2e" : "var(--dim)" }}>
      {a ? letter : "·"}
    </div>
  );
}

// ---------- brand + icons ----------
export const Logo = ({ size = 26 }: { size?: number }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
    <path d="M16 27V15M16 15c0-5-2.6-8-6.2-8S5 9.6 5 12.4s2.2 4.4 4.4 3.4M16 15c0-5 2.6-8 6.2-8S27 9.6 27 12.4s-2.2 4.4-4.4 3.4" />
  </svg>
);
const P: Record<string, string> = {
  pulse: "M12 3l2.1 5.4L20 9.6l-4.6 3.6L17 19l-5-3.1L7 19l1.6-5.8L4 9.6l5.9-1.2z",
  work: "M9 6h11M9 12h11M9 18h11M4.5 6l1 1 2-2M4.5 12l1 1 2-2M4.5 18l1 1 2-2",
  store: "M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8zM9 8V6.5a3 3 0 0 1 6 0V8",
  crew: "M5 17l5-7 4 3 5-8M5 17m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M10 10m-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0M14 13m-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0M19 5m-1.9 0a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0",
  inbox: "M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h4.5l1 2h5l1-2H20",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  connections: "M8 8a4 4 0 0 1 0 8M16 8a4 4 0 0 0 0 8M3 12h5M16 12h5",
  rules: "M12 4v16M6 20h12M5 8h14M5 8l-2.5 5a2.5 2 0 0 0 5 0zM19 8l-2.5 5a2.5 2 0 0 0 5 0z",
  ledger: "M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21zM10 8h4M10 12h4",
  docs: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  billing: "M3 7h18v10H3zM3 11h18M7 15h3",
  out: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
};
export const Icon = ({ name, size }: { name: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={P[name] ?? P.pulse} />
  </svg>
);

// ---------- the sky: your crew as the Aries constellation ----------
// Real-ish star positions of Aries (Hamal brightest), then extra points for bigger crews.
const SPOTS: [number, number][] = [[64, 18], [80, 25], [91, 35], [44, 13], [26, 26], [10, 38], [52, 40], [32, 48], [74, 46], [92, 11], [12, 11], [60, 53]];
const DUST: [number, number, number][] = Array.from({ length: 70 }, (_, i) => [((i * 37.3) % 100), ((i * 23.7 + (i % 7) * 9) % 58), 0.08 + ((i * 13) % 10) / 60]);

export function Sky({ agents, live = [], waiting = [], onPick, height = 58, labels = true }: {
  agents: any[]; live?: string[]; waiting?: string[]; onPick?: (a: any) => void; height?: number; labels?: boolean;
}) {
  // CEO on Hamal; then reports breadth-first so managers sit near their teams.
  const order: any[] = []; const q = agents.filter(a => !a.reportsTo || !agents.some(x => x.id === a.reportsTo));
  while (q.length) { const a = q.shift(); if (order.includes(a)) continue; order.push(a); q.push(...agents.filter(x => x.reportsTo === a.id)); }
  const pos = new Map(order.map((a, i) => [a.id, SPOTS[i] ?? [10 + ((i * 29) % 80), 8 + ((i * 17) % 44)]]));
  return (
    <svg viewBox={`0 0 100 ${height}`} role="img" aria-label="Your crew as a constellation">
      <defs>
        <radialGradient id="halo"><stop offset="0" stopColor="#7fd8ff" stopOpacity=".55" /><stop offset="1" stopColor="#7fd8ff" stopOpacity="0" /></radialGradient>
        <radialGradient id="haloIce"><stop offset="0" stopColor="#00c2ff" stopOpacity=".9" /><stop offset="1" stopColor="#00c2ff" stopOpacity="0" /></radialGradient>
        <radialGradient id="haloGold"><stop offset="0" stopColor="#f0a020" stopOpacity=".95" /><stop offset="1" stopColor="#f0a020" stopOpacity="0" /></radialGradient>
      </defs>
      {DUST.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#3a8fd8" opacity={0.12 + (i % 5) / 18} />)}
      {order.filter(a => pos.has(a.reportsTo)).map(a => {
        const [x1, y1] = pos.get(a.reportsTo)!; const [x2, y2] = pos.get(a.id)!;
        return <line key={"l" + a.id} className={"sky-line" + (live.includes(a.id) || live.includes(a.reportsTo) ? " live" : "")} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {order.map((a, i) => {
        const [x, y] = pos.get(a.id)!; const top = i === 0; const r = top ? 1.25 : 0.9;
        const cls = "star" + (live.includes(a.id) ? " live" : waiting.includes(a.id) ? " wait" : "") + (a.paused ? " paused" : "");
        const below = y < 40; const anchor = x > 82 ? "end" : x < 16 ? "start" : "middle"; const tx = x > 82 ? x + 1.4 : x < 16 ? x - 1.4 : x;
        return (
          <g key={a.id} className={cls} tabIndex={0} role="button" aria-label={`${a.name}, ${a.title}`}
            onClick={() => onPick?.(a)} onKeyDown={e => (e.key === "Enter" || e.key === " ") && onPick?.(a)}>
            <circle className="halo" cx={x} cy={y} r={r * 4.2} />
            <circle className="core" cx={x} cy={y} r={r} />
            {labels && <>
              <text x={tx} y={below ? y + r + 3.6 : y - r - 3.6} textAnchor={anchor}>{a.name}</text>
              <text className="role" x={tx} y={below ? y + r + 6.2 : y - r - 1.2} textAnchor={anchor}>{a.title.length > 22 ? a.title.slice(0, 21) + "…" : a.title}</text>
            </>}
          </g>
        );
      })}
    </svg>
  );
}
export const Pill = ({ children, color }: { children: ReactNode; color: string }) =>
  <span className="pill" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}>{children}</span>;
export const Meter = ({ frac, color }: { frac: number; color?: string }) =>
  <div className="meter"><div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: color }} /></div>;
export const Switch = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) =>
  <button type="button" role="switch" aria-checked={on} aria-label={label} className={"switch" + (on ? " on" : "")} onClick={() => onChange(!on)} />;
export const Section = ({ title, action }: { title: string; action?: ReactNode }) => <div className="section"><span>{title}</span>{action}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Loading = () => <div className="empty">Loading…</div>;

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="f"><span>{label}</span>{children}{help && <div className="help">{help}</div>}</label>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal stack" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="row"><h2 className="grow">{title}</h2><button className="btn quiet sm" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

let pushToast: (m: string) => void = () => {};
export const toast = (m: string) => pushToast(m);
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { let t: any; pushToast = m => { setMsg(m); clearTimeout(t); t = setTimeout(() => setMsg(null), 3500); }; }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

/** Run an async action with error toasts and a busy flag. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); } catch (e: any) { toast(e.message ?? "Something went wrong"); } finally { setBusy(false); }
  };
  return [busy, run] as const;
}

// ---------- safe tiny markdown (no HTML injection) ----------
function inline(s: string, k = 0): ReactNode[] {
  const out: ReactNode[] = []; const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+|@\w+|#\d+)/g;
  let i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > i) out.push(s.slice(i, m.index));
    const t = m[0]; const key = `${k}-${m.index}`;
    if (t.startsWith("**")) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("*")) out.push(<em key={key}>{t.slice(1, -1)}</em>);
    else if (t.startsWith("[")) { const [, txt, url] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!; out.push(<a key={key} href={url} target="_blank" rel="noreferrer noopener">{txt}</a>); }
    else if (t.startsWith("http")) out.push(<a key={key} href={t} target="_blank" rel="noreferrer noopener">{t.length > 48 ? t.slice(0, 45) + "…" : t}</a>);
    else out.push(<span key={key} className="ref">{t}</span>);
    i = m.index + t.length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}
export function Markdown({ text }: { text: string }) {
  const lines = (text ?? "").split("\n"); const out: ReactNode[] = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim().startsWith("```")) { const buf: string[] = []; i++; while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]); i++; out.push(<pre key={i}>{buf.join("\n")}</pre>); continue; }
    if (/^\s*[-*•] /.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*[-*•] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•] /, "")); out.push(<ul key={i}>{items.map((x, j) => <li key={j}>{inline(x, j)}</li>)}</ul>); continue; }
    if (/^\s*\d+[.)] /.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*\d+[.)] /.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)] /, "")); out.push(<ol key={i}>{items.map((x, j) => <li key={j}>{inline(x, j)}</li>)}</ol>); continue; }
    if (l.startsWith("|")) { const rows: string[][] = []; while (i < lines.length && lines[i].startsWith("|")) { const r = lines[i++].split("|").slice(1, -1).map(c => c.trim()); if (!r.every(c => /^:?-+:?$/.test(c))) rows.push(r); } out.push(<table key={i}><tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => j === 0 ? <th key={k}>{inline(c)}</th> : <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table>); continue; }
    if (l.startsWith("### ")) out.push(<h3 key={i}>{inline(l.slice(4))}</h3>);
    else if (l.startsWith("## ")) out.push(<h2 key={i}>{inline(l.slice(3))}</h2>);
    else if (l.startsWith("# ")) out.push(<h1 key={i}>{inline(l.slice(2))}</h1>);
    else if (l.startsWith("> ")) out.push(<blockquote key={i}>{inline(l.slice(2))}</blockquote>);
    else if (/^-{3,}$/.test(l.trim())) out.push(<hr key={i} style={{ border: 0, borderTop: "1px solid var(--line)" }} />);
    else if (l.trim()) out.push(<p key={i}>{inline(l)}</p>);
    i++;
  }
  return <div className="md">{out}</div>;
}
