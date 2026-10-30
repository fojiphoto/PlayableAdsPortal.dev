import { useEffect, useState, type ReactNode } from "react";
import { getToken, setToken, me, getNetworks, listApps, createApp, getApp, createConcept, getBillingStatus } from "./api";
import { renameApp, renameConcept, verifyEmail, resendVerification } from "./api";
import type { App as AppT, AuthUser, Concept, Network, PlanStatus } from "./types";
import { AuthScreen } from "./components/AuthScreen";
import { Workspace } from "./components/Workspace";
import { Landing } from "./Landing";
import { Plans } from "./components/Plans";
import { Settings } from "./components/Settings";
import { Analytics } from "./components/Analytics";
import { Preloader } from "./components/Preloader";
import { Domain } from "./components/Domain";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [apps, setApps] = useState<AppT[]>([]);
  const [activeApp, setActiveApp] = useState<AppT | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [activeConcept, setActiveConcept] = useState<Concept | null>(null);
  const [newApp, setNewApp] = useState("");
  const [newConcept, setNewConcept] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"landing" | "auth">("landing");
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [page, setPage] = useState<"app" | "plans" | "settings" | "analytics" | "preloader" | "domain">("app");
  const [notice, setNotice] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  useEffect(() => {
    // deep links from emails / Stripe: ?reset=<token>, ?verify=<token>, ?billing=success|cancel
    const q = new URLSearchParams(window.location.search);
    const reset = q.get("reset");
    const verify = q.get("verify");
    const billing = q.get("billing");
    if (reset || verify || billing) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (reset) {
      setResetToken(reset);
      setView("auth");
    }
    if (verify) {
      verifyEmail(verify)
        .then(() => {
          setNotice("Email verified ✓");
          setUser((u) => (u ? { ...u, emailVerified: true } : u));
        })
        .catch((e) => setNotice((e as Error).message));
    }
    if (billing === "success") setNotice("Payment received — your plan is updating.");
    if (billing === "cancel") setNotice("Checkout cancelled — no changes made.");

    getNetworks().then(setNetworks).catch(() => {});
    if (getToken()) {
      me()
        .then((r) => setUser(r.user))
        .catch(() => setToken(null))
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      listApps().then(setApps).catch((e) => setErr((e as Error).message));
      getBillingStatus().then(setStatus).catch(() => {});
    }
  }, [user]);

  async function openApp(a: AppT) {
    setActiveApp(a);
    setActiveConcept(null);
    try {
      const full = await getApp(a.id);
      setConcepts(full.concepts);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function renameAppUi(a: AppT) {
    const name = window.prompt("Rename app", a.name)?.trim();
    if (!name || name === a.name) return;
    try {
      const updated = await renameApp(a.id, name);
      setApps((xs) => xs.map((x) => (x.id === a.id ? { ...x, name: updated.name } : x)));
      setActiveApp((cur) => (cur && cur.id === a.id ? { ...cur, name: updated.name } : cur));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function renameConceptUi(c: Concept) {
    const name = window.prompt("Rename concept", c.name)?.trim();
    if (!name || name === c.name) return;
    try {
      const updated = await renameConcept(c.id, name);
      setConcepts((xs) => xs.map((x) => (x.id === c.id ? { ...x, name: updated.name } : x)));
      setActiveConcept((cur) => (cur && cur.id === c.id ? { ...cur, name: updated.name } : cur));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function resendVerify() {
    try {
      const r = await resendVerification();
      setNotice(r.verified ? "Your email is already verified." : "Verification email sent — check your inbox.");
      if (r.verified) setUser((u) => (u ? { ...u, emailVerified: true } : u));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function addApp() {
    const name = newApp.trim();
    if (!name) return;
    try {
      const a = await createApp(name);
      setNewApp("");
      setApps((xs) => [a, ...xs]);
      await openApp(a);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function addConcept() {
    if (!activeApp) return;
    const name = newConcept.trim();
    if (!name) return;
    try {
      const c = await createConcept(activeApp.id, name);
      setNewConcept("");
      setConcepts((xs) => [c, ...xs]);
      setActiveConcept(c);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    setApps([]);
    setActiveApp(null);
    setConcepts([]);
    setActiveConcept(null);
  }

  if (checking) return null;
  if (!user) {
    return view === "auth" ? (
      <AuthScreen
          resetToken={resetToken ?? undefined}
          onResetDone={() => setResetToken(null)} onAuth={setUser} onBack={() => setView("landing")} />
    ) : (
      <Landing onGetStarted={() => setView("auth")} onSignIn={() => setView("auth")} />
    );
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-[#1b5540]">
        <div className="flex items-center justify-between px-6 py-3">
          <button onClick={() => setPage("app")} className="flex items-center gap-2">
            <img src="/logo.png" alt="Factorial" className="h-7 w-7 rounded-lg object-contain" />
            <span className="font-semibold text-slate-100">Factorial AdLab</span>
            <span className="rounded bg-[#123f2d] px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">Packager</span>
          </button>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            {status && (
              <button
                onClick={() => setPage("plans")}
                className={`rounded-lg border px-3 py-1.5 ${page === "plans" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-200 hover:border-[#7cb342]"}`}
              >
                {status.planName}
                {status.limit != null && <span className="text-slate-400"> · {status.used}/{status.limit}</span>}
              </button>
            )}
            <button
              onClick={() => setPage("analytics")}
              className={`rounded-lg border px-3 py-1.5 ${page === "analytics" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Analytics
            </button>
            <button
              onClick={() => setPage("preloader")}
              className={`rounded-lg border px-3 py-1.5 ${page === "preloader" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Preloader
            </button>
            <button
              onClick={() => setPage("domain")}
              className={`rounded-lg border px-3 py-1.5 ${page === "domain" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Domain
            </button>
            <button
              onClick={() => setPage("settings")}
              className={`rounded-lg border px-3 py-1.5 ${page === "settings" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Settings
            </button>
            <span className="hidden sm:inline">{user.email}</span>
            <button onClick={logout} className="rounded-lg border border-[#1f6b4a] px-3 py-1.5 text-slate-300 hover:border-[#7cb342]">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {page === "plans" ? (
        <main className="min-w-0 flex-1 p-6">
          <Plans status={status} onChanged={setStatus} />
        </main>
      ) : page === "settings" ? (
        <main className="min-w-0 flex-1 p-6">
          <Settings user={user} status={status} />
        </main>
      ) : page === "analytics" ? (
        <main className="min-w-0 flex-1 p-6">
          <Analytics />
        </main>
      ) : page === "preloader" ? (
        <main className="min-w-0 flex-1 p-6">
          <Preloader />
        </main>
      ) : page === "domain" ? (
        <main className="min-w-0 flex-1 p-6">
          <Domain />
        </main>
      ) : (
      <div className="flex">
        {/* sidebar: apps + concepts */}
        <aside className="w-64 shrink-0 border-r border-[#1b5540] p-4">
          <SectionLabel>Apps</SectionLabel>
          <div className="mb-2 grid gap-1">
            {apps.map((a) => (
              <div key={a.id} className="flex items-center gap-1">
                <button
                  onClick={() => void openApp(a)}
                  className={`flex min-w-0 flex-1 items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm ${
                    activeApp?.id === a.id ? "bg-amber-500/10 text-amber-200" : "text-slate-300 hover:bg-[#123f2d]/60"
                  }`}
                >
                  <span className="truncate">{a.name}</span>
                  {a.conceptCount ? <span className="text-xs text-slate-400">{a.conceptCount}</span> : null}
                </button>
                {activeApp?.id === a.id && (
                  <button
                    title="Rename app"
                    onClick={() => void renameAppUi(a)}
                    className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-[#123f2d]/60 hover:text-amber-200"
                  >
                    ✎
                  </button>
                )}
              </div>
            ))}
          </div>
          <CreateRow value={newApp} onChange={setNewApp} onAdd={addApp} placeholder="New app…" />

          {activeApp && (
            <div className="mt-6">
              <SectionLabel>Concepts · {activeApp.name}</SectionLabel>
              <div className="mb-2 grid gap-1">
                {concepts.map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <button
                      onClick={() => setActiveConcept(c)}
                      className={`min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-left text-sm ${
                        activeConcept?.id === c.id ? "bg-amber-500/10 text-amber-200" : "text-slate-300 hover:bg-[#123f2d]/60"
                      }`}
                    >
                      {c.name}
                    </button>
                    {activeConcept?.id === c.id && (
                      <button
                        title="Rename concept"
                        onClick={() => void renameConceptUi(c)}
                        className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-[#123f2d]/60 hover:text-amber-200"
                      >
                        ✎
                      </button>
                    )}
                  </div>
                ))}
                {concepts.length === 0 && <div className="px-2.5 py-1 text-xs text-slate-400">No concepts yet</div>}
              </div>
              <CreateRow value={newConcept} onChange={setNewConcept} onAdd={addConcept} placeholder="New concept…" />
            </div>
          )}
        </aside>

        {/* main */}
        <main className="min-w-0 flex-1 p-6">
          {notice && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)} className="text-emerald-300 hover:text-white" aria-label="Dismiss">x</button>
            </div>
          )}
          {user && user.emailVerified === false && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
              <span>Please verify your email address - check your inbox for the link.</span>
              <button onClick={() => void resendVerify()} className="rounded-md border border-amber-400/50 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/20">
                Resend email
              </button>
            </div>
          )}
          {err && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{err}</div>}
          {activeConcept ? (
            <Workspace
              key={activeConcept.id}
              conceptId={activeConcept.id}
              networks={networks}
              onExported={() => getBillingStatus().then(setStatus).catch(() => {})}
            />
          ) : (
            <div className="flex h-full min-h-[50vh] items-center justify-center text-center text-slate-400">
              {apps.length === 0
                ? "Create your first app on the left to get started."
                : activeApp
                  ? "Pick or create a concept."
                  : "Pick an app on the left."}
            </div>
          )}
        </main>
      </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</div>;
}

function CreateRow({
  value,
  onChange,
  onAdd,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onAdd();
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md border border-[#1f6b4a] bg-[#0a3a28] px-2 py-1 text-sm text-slate-100 outline-none focus:border-amber-500"
      />
      <button onClick={onAdd} className="rounded-md bg-[#123f2d] px-2.5 text-slate-200 hover:bg-[#1a5a40]">
        +
      </button>
    </div>
  );
}
