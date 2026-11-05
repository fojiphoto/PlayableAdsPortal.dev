import { useEffect, useState, type ReactNode } from "react";
import { getToken, setToken, me, getNetworks, listApps, createApp, getApp, createConcept, getBillingStatus } from "./api";
import { renameApp, renameConcept, verifyEmail, resendVerification } from "./api";
import { listWorkspaces, switchWorkspace, createWorkspace, getInvite, acceptInvite, supportUnread } from "./api";
import { Support } from "./components/Support";
import { Admin } from "./components/Admin";
import type { App as AppT, AuthUser, Concept, Network, PlanStatus, WorkspaceRef, WorkspaceListItem } from "./types";
import { AuthScreen } from "./components/AuthScreen";
import { Workspace } from "./components/Workspace";
import { Landing } from "./Landing";
import { Plans } from "./components/Plans";
import { Settings } from "./components/Settings";
import { Analytics } from "./components/Analytics";
import { Preloader } from "./components/Preloader";
import { Domain } from "./components/Domain";
import { legacyRoute, linkClick, routePath, titleFor, useRoute, type Route } from "./router";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [apps, setApps] = useState<AppT[]>([]);
  const [activeApp, setActiveApp] = useState<AppT | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  // which app `concepts` belong to (so a stale concept id in the URL can be told apart from "loading")
  const [loadedAppId, setLoadedAppId] = useState<string | null>(null);
  const [newApp, setNewApp] = useState("");
  const [newConcept, setNewConcept] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // a signed-out visit to a deep link (e.g. a shared /apps/… URL) goes straight to sign-in, then back there
  const [view, setView] = useState<"landing" | "auth">(() => (window.location.pathname !== "/" ? "auth" : "landing"));
  const [status, setStatus] = useState<PlanStatus | null>(null);
  // the screen comes from the URL (see router.ts): reload, back/forward and shared links work
  const [route, navigate] = useRoute();
  const page = route.page;
  /** props for an <a> that navigates in-app (and still opens in a new tab on ctrl/middle click) */
  const nav = (r: Route) => ({ href: routePath(r), onClick: linkClick(() => navigate(r)) });
  const activeConcept = concepts.find((c) => c.id === route.conceptId) ?? null;
  const [unread, setUnread] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceRef | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const canEdit = !workspace || workspace.role !== "viewer";

  useEffect(() => {
    // deep links from emails / Stripe: ?reset=<token>, ?verify=<token>, ?billing=success|cancel
    const q = new URLSearchParams(window.location.search);
    const reset = q.get("reset");
    const verify = q.get("verify");
    const billing = q.get("billing");
    const invite = q.get("invite");
    // older emails link to ?support=<id> / ?admin=<tab>&thread=<id>: redirect them to their paths
    const legacy = legacyRoute(window.location.search);
    if (legacy) navigate(legacy, { replace: true });
    if (reset || verify || billing || invite) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (invite) setInviteToken(invite);
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
        .then((r) => {
          setUser(r.user);
          setWorkspace(r.workspace);
        })
        .catch(() => setToken(null))
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  // Keyed on the user's id, not the object: refreshWorkspace itself calls setUser with a fresh object,
  // so depending on `user` re-ran this forever (an endless /api/me + /api/apps loop that also kept
  // clearing the selected app).
  useEffect(() => {
    if (user) void refreshWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // invite link: signed out → tell the auth screen who to sign in as; signed in → accept
  useEffect(() => {
    if (!inviteToken || checking) return;
    if (!user) {
      getInvite(inviteToken)
        .then((i) => {
          setNotice(i.expired ? "That invitation has expired — ask for a new one." : i.accepted ? "That invitation was already used." : `Sign in or sign up as ${i.email} to join ${i.org}.`);
          setView("auth");
        })
        .catch((e) => setNotice((e as Error).message));
      return;
    }
    const token = inviteToken;
    setInviteToken(null);
    acceptInvite(token)
      .then((r) => {
        setNotice(`You joined ${r.workspace.name} as ${r.workspace.role}.`);
        navigate({ page: "app" });
        return refreshWorkspace();
      })
      .catch((e) => setNotice((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken, user, checking]);

  // the app (and its concepts) named in the URL; anything not in this workspace falls back to home
  useEffect(() => {
    if (!user) return;
    const id = route.appId;
    if (!id) {
      setActiveApp(null);
      setConcepts([]);
      setLoadedAppId(null);
      return;
    }
    let live = true;
    getApp(id)
      .then((full) => {
        if (!live) return;
        setActiveApp(full);
        setConcepts(full.concepts);
        setLoadedAppId(id);
      })
      .catch(() => {
        if (!live) return;
        navigate({ page: "app" }, { replace: true });
        setErr("That app isn't in your current workspace (switch workspace, or ask for access).");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.appId, workspace?.id, user?.id]);

  // a concept id that isn't in the loaded app (deleted, or a mistyped link) → back to the app
  useEffect(() => {
    if (!route.conceptId || !route.appId || loadedAppId !== route.appId) return;
    if (!concepts.some((c) => c.id === route.conceptId)) {
      navigate({ page: "app", appId: route.appId }, { replace: true });
      setErr("That concept doesn't exist any more.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.conceptId, route.appId, loadedAppId, concepts]);

  // /admin is only a screen for platform admins
  useEffect(() => {
    if (user && page === "admin" && !user.isAdmin) navigate({ page: "app" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page]);

  // tab title follows the screen
  useEffect(() => {
    if (!user) return;
    document.title =
      page === "app" && activeApp ? `${activeConcept ? `${activeConcept.name} · ` : ""}${activeApp.name} · Factorial AdLab` : titleFor(route);
  }, [user, route, page, activeApp, activeConcept]);

  /** Re-read everything that depends on the current workspace (the selection lives in the URL). */
  async function refreshWorkspace() {
    try {
      const r = await me();
      setWorkspace(r.workspace);
      setUser(r.user);
    } catch {
      /* keep going with what we have */
    }
    listWorkspaces().then(setWorkspaces).catch(() => {});
    refreshUnread();
    listApps().then(setApps).catch((e) => setErr((e as Error).message));
    getBillingStatus().then(setStatus).catch(() => {});
  }

  function refreshUnread() {
    supportUnread()
      .then((r) => setUnread(r.count))
      .catch(() => {});
  }

  async function pickWorkspace(value: string) {
    try {
      if (value === "__new") {
        const name = window.prompt("Name the new workspace")?.trim();
        if (!name) return;
        await createWorkspace(name);
      } else if (value !== workspace?.id) {
        await switchWorkspace(value);
      } else return;
      navigate({ page: "app" }); // the old workspace's app/concept ids mean nothing here
      await refreshWorkspace();
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
      navigate({ page: "app", appId: a.id });
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
      navigate({ page: "app", appId: activeApp.id, conceptId: c.id });
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
    setLoadedAppId(null);
    navigate({ page: "app" }, { replace: true });
    document.title = "Factorial AdLab — one build, every ad network";
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
          <a {...nav({ page: "app" })} className="flex shrink-0 items-center gap-2">
            <img src="/logo.png" alt="Factorial" className="h-7 w-7 rounded-lg object-contain" />
            <span className="whitespace-nowrap font-semibold text-slate-100">Factorial AdLab</span>
            <span className="rounded bg-[#123f2d] px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">Packager</span>
          </a>
          <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-slate-400">
            {status && (
              <a
                {...nav({ page: "plans" })}
                className={`rounded-lg border px-3 py-1.5 ${page === "plans" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-200 hover:border-[#7cb342]"}`}
              >
                {status.planName}
                {status.limit != null && <span className="text-slate-400"> · {status.used}/{status.limit}</span>}
              </a>
            )}
            <a
              {...nav({ page: "analytics" })}
              className={`rounded-lg border px-3 py-1.5 ${page === "analytics" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Analytics
            </a>
            <a
              {...nav({ page: "preloader" })}
              className={`rounded-lg border px-3 py-1.5 ${page === "preloader" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Preloader
            </a>
            <a
              {...nav({ page: "domain" })}
              className={`rounded-lg border px-3 py-1.5 ${page === "domain" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Domain
            </a>
            <a
              {...nav({ page: "support" })}
              className={`relative rounded-lg border px-3 py-1.5 ${page === "support" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Support
              {unread > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">{unread}</span>}
            </a>
            {user.isAdmin && (
              <a
                {...nav({ page: "admin" })}
                className={`rounded-lg border px-3 py-1.5 ${page === "admin" ? "border-amber-500 text-amber-200" : "border-amber-700/50 text-amber-300 hover:border-amber-500"}`}
              >
                Admin
              </a>
            )}
            <a
              {...nav({ page: "settings" })}
              className={`rounded-lg border px-3 py-1.5 ${page === "settings" ? "border-amber-500 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
            >
              Settings
            </a>
            {workspace && (
              <select
                value={workspace.id}
                onChange={(e) => void pickWorkspace(e.target.value)}
                title={`Workspace · you are ${workspace.role}`}
                className="max-w-[180px] rounded-lg border border-[#1b5540] bg-[#0a3a28] px-2 py-1.5 text-slate-200 outline-none focus:border-amber-500"
              >
                {(workspaces.length ? workspaces : [{ id: workspace.id, name: workspace.name, role: workspace.role }]).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.role}
                  </option>
                ))}
                <option value="__new">＋ New workspace…</option>
              </select>
            )}
            <span className="hidden max-w-[200px] truncate xl:inline" title={user.email}>{user.email}</span>
            <button onClick={logout} className="rounded-lg border border-[#1f6b4a] px-3 py-1.5 text-slate-300 hover:border-[#7cb342]">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {page === "plans" ? (
        <main className="min-w-0 flex-1 p-6">
          <Plans status={status} onChanged={setStatus} email={user.email} />
        </main>
      ) : page === "settings" ? (
        <main className="min-w-0 flex-1 p-6">
          <Settings user={user} status={status} onWorkspaceChanged={() => void refreshWorkspace()} />
        </main>
      ) : page === "analytics" ? (
        <main className="min-w-0 flex-1 p-6">
          <Analytics />
        </main>
      ) : page === "preloader" ? (
        <main className="min-w-0 flex-1 p-6">
          <Preloader />
        </main>
      ) : page === "support" ? (
        <main className="min-w-0 flex-1 p-6">
          <Support initialThreadId={route.threadId ?? null} onUnreadChange={refreshUnread} onOpenThread={(id) => navigate({ page: "support", threadId: id ?? undefined })} />
        </main>
      ) : page === "admin" && user.isAdmin ? (
        <main className="min-w-0 flex-1 p-6">
          <Admin
            tab={route.tab ?? null}
            threadId={route.threadId ?? null}
            onNavigate={(tab, threadId) => navigate({ page: "admin", tab, threadId: threadId ?? undefined })}
            me={user.email}
          />
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
                <a
                  {...nav({ page: "app", appId: a.id })}
                  className={`flex min-w-0 flex-1 items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm ${
                    activeApp?.id === a.id ? "bg-amber-500/10 text-amber-200" : "text-slate-300 hover:bg-[#123f2d]/60"
                  }`}
                >
                  <span className="truncate">{a.name}</span>
                  {a.conceptCount ? <span className="text-xs text-slate-400">{a.conceptCount}</span> : null}
                </a>
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
          {canEdit ? (
            <CreateRow value={newApp} onChange={setNewApp} onAdd={addApp} placeholder="New app…" />
          ) : (
            <div className="px-1 text-[11px] text-slate-500">View-only · {workspace?.name}</div>
          )}

          {activeApp && (
            <div className="mt-6">
              <SectionLabel>Concepts · {activeApp.name}</SectionLabel>
              <div className="mb-2 grid gap-1">
                {concepts.map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <a
                      {...nav({ page: "app", appId: activeApp.id, conceptId: c.id })}
                      className={`block min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-left text-sm ${
                        activeConcept?.id === c.id ? "bg-amber-500/10 text-amber-200" : "text-slate-300 hover:bg-[#123f2d]/60"
                      }`}
                    >
                      {c.name}
                    </a>
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
              {canEdit && <CreateRow value={newConcept} onChange={setNewConcept} onAdd={addConcept} placeholder="New concept…" />}
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
              creativeId={route.creativeId ?? null}
              onCreativeChange={(creativeId, replace) =>
                navigate({ page: "app", appId: route.appId, conceptId: activeConcept.id, creativeId: creativeId ?? undefined }, { replace })
              }
              networks={networks}
              readOnly={!canEdit}
              onExported={() => getBillingStatus().then(setStatus).catch(() => {})}
            />
          ) : (
            <div className="flex h-full min-h-[50vh] items-center justify-center text-center text-slate-400">
              {apps.length === 0
                ? canEdit
                  ? "Create your first app on the left to get started."
                  : "This workspace has no apps yet."
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
