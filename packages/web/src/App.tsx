import { useEffect, useState, type ReactNode } from "react";
import { getToken, setToken, me, getNetworks, listApps, createApp, getApp, createConcept, getBillingStatus } from "./api";
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

  useEffect(() => {
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
      <AuthScreen onAuth={setUser} onBack={() => setView("landing")} />
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
                {status.limit != null && <span className="text-slate-500"> · {status.used}/{status.limit}</span>}
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
              <button
                key={a.id}
                onClick={() => void openApp(a)}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm ${
                  activeApp?.id === a.id ? "bg-amber-500/10 text-amber-200" : "text-slate-300 hover:bg-[#123f2d]/60"
                }`}
              >
                <span className="truncate">{a.name}</span>
                {a.conceptCount ? <span className="text-xs text-slate-500">{a.conceptCount}</span> : null}
              </button>
            ))}
          </div>
          <CreateRow value={newApp} onChange={setNewApp} onAdd={addApp} placeholder="New app…" />

          {activeApp && (
            <div className="mt-6">
              <SectionLabel>Concepts · {activeApp.name}</SectionLabel>
              <div className="mb-2 grid gap-1">
                {concepts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveConcept(c)}
                    className={`rounded-md px-2.5 py-1.5 text-left text-sm ${
                      activeConcept?.id === c.id ? "bg-amber-500/10 text-amber-200" : "text-slate-300 hover:bg-[#123f2d]/60"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
                {concepts.length === 0 && <div className="px-2.5 py-1 text-xs text-slate-600">No concepts yet</div>}
              </div>
              <CreateRow value={newConcept} onChange={setNewConcept} onAdd={addConcept} placeholder="New concept…" />
            </div>
          )}
        </aside>

        {/* main */}
        <main className="min-w-0 flex-1 p-6">
          {err && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{err}</div>}
          {activeConcept ? (
            <Workspace
              key={activeConcept.id}
              conceptId={activeConcept.id}
              networks={networks}
              onExported={() => getBillingStatus().then(setStatus).catch(() => {})}
            />
          ) : (
            <div className="flex h-full min-h-[50vh] items-center justify-center text-center text-slate-500">
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
  return <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</div>;
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
