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
import { Start } from "./components/Start";
import { Docs } from "./components/Docs";
import { ChatBubble } from "./components/ChatBubble";
import { Shell, Alert, toast, type Crumb } from "./components/Shell";
import { Library } from "./components/Library";
import { AppDetail } from "./components/AppDetail";
import { NewAppDialog, NameDialog } from "./components/NewAppDialog";
import { Icon } from "./components/icons";
import { AUTH_PAGES, legacyRoute, linkClick, routePath, titleFor, useRoute, type Page, type Route } from "./router";

/** a plan picked on the landing page before signing up: after sign-in, Plans starts its checkout */
export const PENDING_PLAN_KEY = "adlab.pendingPlan";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [apps, setApps] = useState<AppT[]>([]);
  const [activeApp, setActiveApp] = useState<AppT | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  // which app `concepts` belong to (so a stale concept id in the URL can be told apart from "loading")
  const [loadedAppId, setLoadedAppId] = useState<string | null>(null);
  const [appsLoaded, setAppsLoaded] = useState(false);
  // which dialog is open (new app / concept / workspace, rename)
  const [dialog, setDialog] = useState<null | "newApp" | "newConcept" | "renameApp" | "renameConcept" | "newWorkspace">(null);
  // the open creative's name, for the breadcrumb (reported by Workspace)
  const [creativeName, setCreativeName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
  // the current workspace requires 2FA and this account has none: only Settings (to turn it on) is usable
  const twoFactorGate = !!workspace?.require2fa && !!user && !user.twoFactor;

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

  // a new screen starts at the top (the window keeps its scroll position otherwise)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, route.appId, route.conceptId, route.tab]);

  // signed in on an auth URL (reload of /login, back button): go home
  useEffect(() => {
    if (user && AUTH_PAGES.includes(page)) navigate({ page: "app" }, { replace: true });
  }, [user, page, navigate]);

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
          if (window.location.pathname === "/") navigate({ page: "login" }, { replace: true });
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
    let gated = false;
    try {
      const r = await me();
      setWorkspace(r.workspace);
      setUser(r.user);
      gated = !!r.workspace?.require2fa && !r.user.twoFactor;
    } catch {
      /* keep going with what we have */
    }
    listWorkspaces().then(setWorkspaces).catch(() => {});
    if (gated) {
      // the workspace requires 2FA this account doesn't have: its data stays locked until it's on
      setApps([]);
      setAppsLoaded(true);
      return;
    }
    refreshUnread();
    listApps()
      .then(setApps)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setAppsLoaded(true));
    getBillingStatus().then(setStatus).catch(() => {});
  }

  function refreshUnread() {
    supportUnread()
      .then((r) => setUnread(r.count))
      .catch(() => {});
  }

  /** switch to another workspace, or (`__new` + a name) create one and switch to it */
  async function pickWorkspace(value: string, newName?: string) {
    try {
      if (value === "__new") {
        const name = newName?.trim();
        if (!name) return;
        await createWorkspace(name);
      } else if (value !== workspace?.id) {
        await switchWorkspace(value);
      } else return;
      navigate({ page: "app" }); // the old workspace's app/concept ids mean nothing here
      await refreshWorkspace();
    } catch (e) {
      if (value === "__new") throw e; // the dialog shows it
      setErr((e as Error).message);
    }
  }

  /** throws on failure (the dialog shows the message) */
  async function renameAppTo(a: AppT, name: string) {
    const updated = await renameApp(a.id, name);
    setApps((xs) => xs.map((x) => (x.id === a.id ? { ...x, name: updated.name } : x)));
    setActiveApp((cur) => (cur && cur.id === a.id ? { ...cur, name: updated.name } : cur));
    toast("App renamed");
  }
  /** throws on failure (inline editors stay open and the page shows the error; the dialog shows it itself) */
  async function renameConceptTo(c: Concept, name: string) {
    const updated = await renameConcept(c.id, name);
    setConcepts((xs) => xs.map((x) => (x.id === c.id ? { ...x, name: updated.name } : x)));
    toast("Concept renamed");
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
  /** throws on failure (the dialog shows the message) */
  async function addApp(name: string, platform: string) {
    const a = await createApp(name, platform);
    setApps((xs) => [{ ...a, conceptCount: 0 }, ...xs]);
    setDialog(null);
    toast(`Created ${a.name}`);
    navigate({ page: "app", appId: a.id });
  }

  /** throws on failure (the dialog shows the message) */
  async function addConcept(name: string) {
    if (!activeApp) return;
    const c = await createConcept(activeApp.id, name);
    setConcepts((xs) => [c, ...xs]);
    setApps((xs) => xs.map((x) => (x.id === activeApp.id ? { ...x, conceptCount: (x.conceptCount ?? 0) + 1 } : x)));
    setDialog(null);
    toast(`Created ${c.name}`);
    navigate({ page: "app", appId: activeApp.id, conceptId: c.id });
  }

  function logout() {
    setToken(null);
    setUser(null);
    setApps([]);
    setActiveApp(null);
    setConcepts([]);
    setLoadedAppId(null);
    setAppsLoaded(false);
    navigate({ page: "app" }, { replace: true });
    document.title = "Factorial AdLab — one build, every ad network";
  }

  if (checking) return null;
  if (!user) {
    // "/" is the landing page; /login /signup /forgot are the auth screens; any other path (a shared
    // /apps/… link) shows sign-in and stays put, so signing in lands right there
    const onLanding = page === "app" && !route.appId && !resetToken;
    if (onLanding) {
      return <Landing onGetStarted={() => navigate({ page: "signup" })} onSignIn={() => navigate({ page: "login" })} />;
    }
    const mode = resetToken ? "reset" : page === "signup" || page === "forgot" ? page : "login";
    return (
      <AuthScreen
        key={mode}
        mode={mode}
        notice={notice}
        onMode={(m) => navigate({ page: m === "reset" ? "login" : m })}
        resetToken={resetToken ?? undefined}
        onResetDone={() => {
          setResetToken(null);
          navigate({ page: "login" }, { replace: true });
        }}
        onAuth={(u) => {
          if (AUTH_PAGES.includes(page)) {
            let pending: string | null = null;
            try {
              pending = sessionStorage.getItem(PENDING_PLAN_KEY);
            } catch {
              /* storage blocked */
            }
            navigate({ page: pending ? "plans" : "app" }, { replace: true });
          }
          setUser(u);
        }}
        onBack={() => navigate({ page: "app" })}
      />
    );
  }

  // ── signed in: the dashboard shell ──
  const appLoading = !!route.appId && (activeApp?.id !== route.appId || loadedAppId !== route.appId);
  const crumbs = crumbsFor(route, activeApp, activeConcept, creativeName);

  let body: ReactNode;
  if (twoFactorGate && page !== "settings") {
    body = (
      <div className="sh-gate">
        <div className="sh-lib-empty-ico">
          <Icon.Shield />
        </div>
        <h1>{workspace?.name} requires two-factor authentication</h1>
        <p>
          An admin made 2FA required for everyone in this workspace. Turn it on for your account to continue; it takes a minute with any
          authenticator app. You can also switch to another workspace from the account menu.
        </p>
        <a {...nav({ page: "settings" })} className="sh-btn sh-btn-primary">
          <Icon.Shield /> Set up two-factor authentication
        </a>
      </div>
    );
  } else if (page === "start") {
    body = <Start go={(r) => navigate(r)} onDataChanged={() => listApps().then(setApps).catch(() => {})} canEdit={canEdit} />;
  } else if (page === "plans") {
    body = <Plans status={status} onChanged={setStatus} email={user.email} />;
  } else if (page === "settings") {
    body = <Settings user={user} status={status} onWorkspaceChanged={() => void refreshWorkspace()} />;
  } else if (page === "analytics") {
    body = <Analytics />;
  } else if (page === "preloader") {
    body = <Preloader />;
  } else if (page === "docs") {
    body = <Docs go={(r) => navigate(r)} />;
  } else if (page === "support") {
    body = (
      <Support
        initialThreadId={route.threadId ?? null}
        onUnreadChange={refreshUnread}
        onOpenThread={(id) => navigate({ page: "support", threadId: id ?? undefined })}
      />
    );
  } else if (page === "admin" && user.isAdmin) {
    body = (
      <Admin
        tab={route.tab ?? null}
        threadId={route.threadId ?? null}
        onNavigate={(tab, threadId) => navigate({ page: "admin", tab, threadId: threadId ?? undefined })}
        me={user.email}
      />
    );
  } else if (page === "domain") {
    body = <Domain />;
  } else if (!route.appId) {
    body = <Library apps={apps} loaded={appsLoaded} canEdit={canEdit} nav={nav} onNewApp={() => setDialog("newApp")} />;
  } else if (appLoading || !activeApp || (route.conceptId && !activeConcept)) {
    body = (
      <div className="sh-loading">
        <span className="sh-spin dark" />
      </div>
    );
  } else if (activeConcept) {
    const back = nav({ page: "app", appId: activeApp.id });
    body = (
      <>
        <div className="sh-page-head">
          <div style={{ minWidth: 0 }}>
            <a {...back} className="sh-crumb-back">
              ← {activeApp.name}
            </a>
            <h1 className="sh-page-title">
              <span className="t">{activeConcept.name}</span>
            </h1>
            <p className="sh-page-sub">Upload a build, preview it in a phone frame, then export it to the networks you pick.</p>
          </div>
          {canEdit && (
            <div className="sh-head-actions">
              <button type="button" className="sh-btn sh-btn-ghost" onClick={() => setDialog("renameConcept")}>
                <Icon.Pencil /> Rename
              </button>
            </div>
          )}
        </div>
        <Workspace
          key={activeConcept.id}
          conceptId={activeConcept.id}
          creativeId={route.creativeId ?? null}
          onCreativeChange={(creativeId, replace) =>
            navigate({ page: "app", appId: route.appId, conceptId: activeConcept.id, creativeId: creativeId ?? undefined }, { replace })
          }
          onActiveName={setCreativeName}
          networks={networks}
          readOnly={!canEdit}
          onExported={() => getBillingStatus().then(setStatus).catch(() => {})}
        />
      </>
    );
  } else {
    body = (
      <AppDetail
        app={activeApp}
        concepts={concepts}
        canEdit={canEdit}
        nav={nav}
        onRename={() => setDialog("renameApp")}
        onNewConcept={() => setDialog("newConcept")}
        onRenameConcept={async (c, name) => {
          try {
            await renameConceptTo(c, name);
          } catch (e) {
            setErr((e as Error).message);
            throw e;
          }
        }}
      />
    );
  }

  return (
    <Shell
      page={page}
      nav={nav}
      user={user}
      workspace={workspace}
      workspaces={workspaces}
      status={status}
      unread={unread}
      crumbs={crumbs}
      onPickWorkspace={(id) => void pickWorkspace(id)}
      onNewWorkspace={() => setDialog("newWorkspace")}
      onLogout={logout}
    >
      {notice && (
        <Alert kind="ok" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {user.emailVerified === false && (
        <Alert
          kind="warn"
          action={
            <button type="button" className="sh-alert-btn" onClick={() => void resendVerify()}>
              Resend email
            </button>
          }
        >
          Please verify your email address: check your inbox for the link.
        </Alert>
      )}
      {err && (
        <Alert kind="err" onDismiss={() => setErr(null)}>
          {err}
        </Alert>
      )}

      {body}

      {dialog === "newApp" && <NewAppDialog onClose={() => setDialog(null)} onCreate={addApp} />}
      {dialog === "newConcept" && activeApp && (
        <NameDialog
          title="New concept"
          sub={`One ad idea for ${activeApp.name}. You upload its builds next.`}
          label="Concept name"
          placeholder="e.g. Fail-to-win level"
          submitLabel="Create concept"
          onClose={() => setDialog(null)}
          onSubmit={addConcept}
        />
      )}
      {dialog === "renameApp" && activeApp && (
        <NameDialog
          title="Rename app"
          label="App name"
          initial={activeApp.name}
          submitLabel="Save"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await renameAppTo(activeApp, name);
            setDialog(null);
          }}
        />
      )}
      {dialog === "renameConcept" && activeConcept && (
        <NameDialog
          title="Rename concept"
          label="Concept name"
          initial={activeConcept.name}
          submitLabel="Save"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await renameConceptTo(activeConcept, name);
            setDialog(null);
          }}
        />
      )}
      {dialog === "newWorkspace" && (
        <NameDialog
          title="New workspace"
          sub="A separate set of apps, members and billing. You can switch between workspaces from the account menu."
          label="Workspace name"
          placeholder="e.g. Studio North"
          submitLabel="Create workspace"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await pickWorkspace("__new", name);
            setDialog(null);
            toast(`Switched to ${name}`);
          }}
        />
      )}

      <ChatBubble signedIn onOpenSupport={() => navigate({ page: "support" })} />
    </Shell>
  );
}

const PAGE_CRUMB: Partial<Record<Page, string>> = {
  start: "Setup",
  plans: "Plans",
  settings: "Settings",
  analytics: "Analytics",
  preloader: "Customize Preloader",
  domain: "Domain",
  docs: "Docs",
  support: "Support",
  admin: "Admin",
};

/** Breadcrumb after the workspace name: Playable Ads › App › Concept › Creative, or the page's name. */
function crumbsFor(route: Route, app: AppT | null, concept: Concept | null, creativeName: string | null): Crumb[] {
  if (route.page === "app") {
    const out: Crumb[] = [{ label: "Playable Ads", to: { page: "app" }, hideOnMobile: true }];
    if (!route.appId) return out;
    out.push({ label: app?.id === route.appId ? app.name : "…", to: { page: "app", appId: route.appId }, hideOnMobile: !!route.conceptId });
    if (route.conceptId) {
      out.push({ label: concept?.name ?? "…", to: { page: "app", appId: route.appId, conceptId: route.conceptId } });
      if (creativeName && route.creativeId) out.push({ label: creativeName });
    }
    return out;
  }
  const label = PAGE_CRUMB[route.page] ?? titleFor(route).split(" · ")[0]!;
  if (route.page === "support" && route.threadId) return [{ label, to: { page: "support" } }, { label: "Conversation" }];
  if (route.page === "admin" && route.tab && route.tab !== "overview")
    return [{ label, to: { page: "admin" } }, { label: route.tab.charAt(0).toUpperCase() + route.tab.slice(1) }];
  return [{ label }];
}
