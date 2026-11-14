import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth, reloadMe, req } from "../api.ts";
import { Logo, Sky, Field, useBusy } from "../ui.tsx";

const DEMO = [{ id: "a", name: "", title: "", reportsTo: null }, { id: "b", name: "", title: "", reportsTo: "a" }, { id: "c", name: "", title: "", reportsTo: "a" }, { id: "d", name: "", title: "", reportsTo: "a" }, { id: "e", name: "", title: "", reportsTo: "d" }, { id: "f", name: "", title: "", reportsTo: "e" }];

function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const nav = useNavigate(); const [busy, run] = useBusy();
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = (e: any) => { e.preventDefault(); void run(async () => {
    const r = await req("POST", `/api/auth/${mode}`, f); auth.set(r.token); await reloadMe();
    const next = new URLSearchParams(location.search).get("next"); nav(next && next.startsWith("/") ? next : "/");
  }); };
  return (
    <div className="auth">
      <div className="sky"><Sky labels={false} height={58} agents={DEMO} live={["c"]} waiting={["b"]} /></div>
      <form className="box stack" onSubmit={submit}>
        <div className="brand"><Logo />Aries</div>
        <h1 style={{ fontSize: "clamp(36px, 9vw, 52px)" }}>{mode === "login" ? "Welcome back." : "A crew that runs the shop while you sleep."}</h1>
        <p className="muted">{mode === "login" ? "Sign in to check on your business." : "AI teammates ship orders, answer customers and chase your goals around the clock. You make the big calls from your phone."}</p>
        {mode === "signup" && <Field label="Your name"><input className="input" value={f.name} onChange={set("name")} autoComplete="name" /></Field>}
        <Field label="Email"><input className="input" type="email" required value={f.email} onChange={set("email")} autoComplete="email" /></Field>
        <Field label="Password" help={mode === "signup" ? "At least 8 characters" : undefined}><input className="input" type="password" required minLength={8} value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} /></Field>
        <button className="btn block" disabled={busy}>{busy ? "…" : mode === "login" ? "Sign in" : "Start 14-day free trial"}</button>
        <p className="small muted" style={{ textAlign: "center" }}>
          {mode === "login" ? <>New here? <Link to="/signup">Create an account</Link></> : <>Have an account? <Link to="/login">Sign in</Link></>}
        </p>
      </form>
    </div>
  );
}
export const Login = () => <AuthForm mode="login" />;
export const Signup = () => <AuthForm mode="signup" />;
