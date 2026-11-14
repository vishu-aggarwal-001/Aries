import { StrictMode, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import "./styles.css";
import { act, auth, useBiz, useMe } from "./api.ts";
import { Icon, Loading, Logo, Switch, Toaster, useBusy } from "./ui.tsx";
import { Login, Signup } from "./pages/Auth.tsx";
import { NewBusiness } from "./pages/Onboard.tsx";
import { Pulse } from "./pages/Pulse.tsx";
import { Work, TaskPage } from "./pages/Work.tsx";
import { Store, OrderPage } from "./pages/Store.tsx";
import { Team, AgentPage, RunPage } from "./pages/Team.tsx";
import { Inbox } from "./pages/Inbox.tsx";
import { Connections } from "./pages/Connections.tsx";
import { Rules } from "./pages/Rules.tsx";
import { More, Ledger, Docs, DocPage, ActivityPage, Billing, Share } from "./pages/More.tsx";

const TABS = [
  { to: "", label: "Pulse", ico: "pulse" }, { to: "work", label: "Work", ico: "work" }, { to: "store", label: "Store", ico: "store" },
  { to: "team", label: "Crew", ico: "crew" }, { to: "inbox", label: "Inbox", ico: "inbox" },
];
const SIDE_EXTRA = [
  { to: "connections", label: "Connections", ico: "connections" }, { to: "rules", label: "Rules", ico: "rules" }, { to: "ledger", label: "Ledger", ico: "ledger" },
  { to: "docs", label: "Deliverables", ico: "docs" }, { to: "billing", label: "Plan & billing", ico: "billing" },
];

function Shell({ children }: { children: (b: any) => ReactNode }) {
  const { bid = "" } = useParams(); const nav = useNavigate();
  const me = useMe(); const { data, error } = useBiz(bid);
  const [busy, run] = useBusy();
  if (error) return <div className="page"><p>{error}</p><a href="/">Go home</a></div>;
  if (!data) return <Loading />;
  const s = data.state; const pending = s.approvals.filter((a: any) => a.status === "pending").length;
  const link = (t: any, cls: string) => (
    <NavLink key={t.to} to={`/b/${bid}/${t.to}`} end={t.to === ""} className={({ isActive }) => cls + (isActive ? " on" : "")}>
      <Icon name={t.ico} /><span>{t.label}</span>{t.to === "inbox" && pending > 0 && <span className="badge">{pending}</span>}
    </NavLink>
  );
  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><Logo />Aries</div>
        {TABS.map(t => link(t, "nav"))}
        <div className="group">Set up</div>
        {SIDE_EXTRA.map(t => link(t, "nav"))}
        <div className="grow" />
        <a className="nav" href="#" onClick={e => { e.preventDefault(); auth.set(""); location.href = "/login"; }}><Icon name="out" />Sign out</a>
      </aside>
      <div className="main">
        <header className="top">
          <div className="grow">
            <select aria-label="Business" value={bid} onChange={e => e.target.value === "+" ? nav("/new") : nav(`/b/${e.target.value}`)}>
              {(me.data?.businesses ?? [{ id: bid, name: s.name }]).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="+">+ Add a business</option>
            </select>
          </div>
          <span className="status"><span className={"pulse" + (s.running ? " on" : "")} />{s.running ? (data.live?.length ? `${data.live.length} working` : "On duty") : "Off duty"}</span>
          <Switch label="Run the crew" on={s.running} onChange={v => { if (!busy) void run(() => act(bid, "POST", "/running", { running: v })); }} />
        </header>
        {!data.billing.active && (
          <div className="card hot" style={{ margin: "12px 16px 0" }}>
            <b>{data.billing.reason}.</b> <a href={`/b/${bid}/billing`}>Choose a plan</a> to keep your crew working.
          </div>
        )}
        <div className="page">{children(data)}</div>
        <nav className="tabbar">{[...TABS, { to: "more", label: "More", ico: "more" }].map(t => link(t, ""))}</nav>
      </div>
    </div>
  );
}

function Home() {
  const me = useMe();
  if (!auth.token) return <Navigate to="/login" replace />;
  if (!me.data) return <Loading />;
  if (!me.data.businesses.length) return <Navigate to="/new" replace />;
  const last = (() => { try { return localStorage.getItem("aries.last"); } catch { return null; } })();
  const b = me.data.businesses.find((x: any) => x.id === last) ?? me.data.businesses[0];
  return <Navigate to={`/b/${b.id}`} replace />;
}

const page = (P: any) => <Shell>{b => <P b={b} />}</Shell>;

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/new" element={<NewBusiness />} />
        <Route path="/share" element={<Share />} />
        <Route path="/b/:bid" element={page(Pulse)} />
        <Route path="/b/:bid/work" element={page(Work)} />
        <Route path="/b/:bid/task/:tid" element={page(TaskPage)} />
        <Route path="/b/:bid/store" element={page(Store)} />
        <Route path="/b/:bid/order/:oid" element={page(OrderPage)} />
        <Route path="/b/:bid/team" element={page(Team)} />
        <Route path="/b/:bid/agent/:aid" element={page(AgentPage)} />
        <Route path="/b/:bid/run/:rid" element={page(RunPage)} />
        <Route path="/b/:bid/inbox" element={page(Inbox)} />
        <Route path="/b/:bid/connections" element={page(Connections)} />
        <Route path="/b/:bid/rules" element={page(Rules)} />
        <Route path="/b/:bid/ledger" element={page(Ledger)} />
        <Route path="/b/:bid/docs" element={page(Docs)} />
        <Route path="/b/:bid/doc/:did" element={page(DocPage)} />
        <Route path="/b/:bid/activity" element={page(ActivityPage)} />
        <Route path="/b/:bid/billing" element={page(Billing)} />
        <Route path="/b/:bid/more" element={page(More)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
