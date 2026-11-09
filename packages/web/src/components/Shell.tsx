import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { AuthUser, PlanStatus, WorkspaceListItem, WorkspaceRef } from "../types";
import type { Page, Route } from "../router";
import { Sidebar } from "./Sidebar";
import { Icon } from "./icons";
import "../shell.css";

type LinkProps = { href: string; onClick: (e: MouseEvent) => void };

/** One breadcrumb after the workspace name; the last one is the current page. */
export interface Crumb {
  label: string;
  to?: Route;
  /** hidden on narrow screens (keeps the trail short on phones) */
  hideOnMobile?: boolean;
}

// ── toast ────────────────────────────────────────────────
const TOAST_EVENT = "adlab:toast";
/** Show a short confirmation at the bottom of the screen (auto-hides after 3.2 s). Works from anywhere. */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: message }));
}
function Toaster() {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setMsg((m) => ({ text, n: (m?.n ?? 0) + 1 }));
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 3200);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => {
      window.removeEventListener(TOAST_EVENT, on);
      clearTimeout(t);
    };
  }, []);
  if (!msg) return null;
  return (
    <div key={msg.n} className="sh-toast" role="status" aria-live="polite">
      <Icon.CheckCircle />
      {msg.text}
    </div>
  );
}

export function initials(email: string) {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._+-]+/).filter(Boolean);
  const s = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : local.slice(0, 2);
  return (s || "?").toUpperCase();
}
const roleLabel = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

// ── account chip + menu ─────────────────────────────────
function AccountMenu({
  user,
  workspace,
  workspaces,
  nav,
  onPickWorkspace,
  onNewWorkspace,
  onLogout,
}: {
  user: AuthUser;
  workspace: WorkspaceRef | null;
  workspaces: WorkspaceListItem[];
  nav: (r: Route) => LinkProps;
  onPickWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: globalThis.MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const spaces: { id: string; name: string; role: string }[] = workspaces.length
    ? workspaces
    : workspace
      ? [{ id: workspace.id, name: workspace.name, role: workspace.role }]
      : [];
  const settings = nav({ page: "settings" });

  return (
    <div className="sh-acct" ref={root}>
      <button type="button" className="sh-acct-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={user.email}>
        <span className="sh-avatar">{initials(user.email)}</span>
        <span className="sh-acct-name">{user.email}</span>
        <Icon.ChevronDown className="sh-acct-caret" />
      </button>
      {open && (
        <div className="sh-acct-menu" role="menu">
          <div className="sh-acct-head">
            <span className="sh-avatar lg">{initials(user.email)}</span>
            <div className="sh-acct-head-meta">
              <div className="sh-acct-head-name" title={user.email}>
                {user.email}
              </div>
              {workspace && (
                <div className="sh-acct-head-role">
                  {workspace.name} · {roleLabel(workspace.role)}
                </div>
              )}
            </div>
          </div>
          {workspace && (
            <div className="sh-acct-spaces">
              <div className="sh-acct-spaces-h">Workspaces</div>
              {spaces.map((w) => {
                const cur = w.id === workspace.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={cur}
                    className={`sh-acct-item${cur ? " is-current" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      if (!cur) onPickWorkspace(w.id);
                    }}
                  >
                    <span className="sh-acct-space-dot" />
                    <span className="sh-acct-space-name">{w.name}</span>
                    <span className="sh-acct-space-role">{w.role}</span>
                  </button>
                );
              })}
              <button
                type="button"
                role="menuitem"
                className="sh-acct-item sh-acct-new"
                onClick={() => {
                  setOpen(false);
                  onNewWorkspace();
                }}
              >
                <Icon.Plus />
                New workspace…
              </button>
            </div>
          )}
          <a
            role="menuitem"
            className="sh-acct-item"
            href={settings.href}
            onClick={(e) => {
              setOpen(false);
              settings.onClick(e);
            }}
          >
            <Icon.User />
            Account &amp; Settings
          </a>
          <button
            type="button"
            role="menuitem"
            className="sh-acct-item danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <Icon.Logout />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

// ── the shell ────────────────────────────────────────────
export function Shell({
  page,
  nav,
  user,
  workspace,
  workspaces,
  status,
  unread,
  crumbs,
  onPickWorkspace,
  onNewWorkspace,
  onLogout,
  children,
}: {
  page: Page;
  nav: (r: Route) => LinkProps;
  user: AuthUser;
  workspace: WorkspaceRef | null;
  workspaces: WorkspaceListItem[];
  status: PlanStatus | null;
  unread: number;
  crumbs: Crumb[];
  onPickWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [drawer]);

  const plans = nav({ page: "plans" });
  const home = nav({ page: "app" });
  const last = crumbs.length - 1;

  return (
    <div className={`sh-app${drawer ? " drawer-open" : ""}`}>
      <Sidebar page={page} nav={nav} unread={unread} isAdmin={!!user.isAdmin} onNavigate={() => setDrawer(false)} />
      <div className="sh-drawer-veil" onClick={() => setDrawer(false)} aria-hidden="true" />
      <main className="sh-main">
        <header className="sh-topbar">
          <button type="button" className="sh-menu-btn" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
            <Icon.Menu />
          </button>
          <nav className="sh-crumbs" aria-label="Breadcrumb">
            {workspace && (
              <>
                <a href={home.href} onClick={home.onClick} className="sh-crumb-link sh-crumb-hide-m">
                  {workspace.name}
                </a>
                <Icon.Chevron className="sh-crumb-hide-m" />
              </>
            )}
            {crumbs.map((c, i) => {
              const hide = c.hideOnMobile && i !== last ? " sh-crumb-hide-m" : "";
              if (i === last)
                return (
                  <span key={i} className="cur" aria-current="page" title={c.label}>
                    {c.label}
                  </span>
                );
              const l = c.to ? nav(c.to) : null;
              return (
                <Fragment key={i}>
                  {l ? (
                    <a href={l.href} onClick={l.onClick} className={`sh-crumb-link${hide}`} title={c.label}>
                      {c.label}
                    </a>
                  ) : (
                    <span className={`sh-crumb-plain${hide}`}>{c.label}</span>
                  )}
                  <Icon.Chevron className={hide.trim() || undefined} />
                </Fragment>
              );
            })}
          </nav>
          <div className="sh-topbar-right">
            {status && (
              <a href={plans.href} onClick={plans.onClick} className={`sh-plan-chip${page === "plans" ? " on" : ""}`} title="Your plan and export usage">
                <Icon.Tag />
                <b>{status.planName}</b>
                {status.limit != null && (
                  <span className="use">
                    · {status.used}/{status.limit}
                  </span>
                )}
              </a>
            )}
            <AccountMenu
              user={user}
              workspace={workspace}
              workspaces={workspaces}
              nav={nav}
              onPickWorkspace={onPickWorkspace}
              onNewWorkspace={onNewWorkspace}
              onLogout={onLogout}
            />
          </div>
        </header>
        <div className="sh-content">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}

/** Light alert strip (notice / warning / error) with an optional action and dismiss. */
export function Alert({
  kind,
  children,
  action,
  onDismiss,
}: {
  kind: "ok" | "warn" | "err";
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`sh-alert ${kind}`} role={kind === "err" ? "alert" : "status"}>
      {kind === "ok" ? <Icon.CheckCircle /> : kind === "warn" ? <Icon.Mail /> : <Icon.Alert />}
      <span className="sh-alert-text">{children}</span>
      {action}
      {onDismiss && (
        <button type="button" className="sh-alert-x" onClick={onDismiss} aria-label="Dismiss">
          <Icon.X />
        </button>
      )}
    </div>
  );
}
