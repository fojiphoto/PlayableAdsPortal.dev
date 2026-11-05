import { useCallback, useEffect, useState, type MouseEvent } from "react";

/**
 * Tiny dependency-free router: every dashboard screen has a real URL, so reload, back/forward,
 * bookmarks and shared links land where you were.
 *
 *   /                                              apps (nothing selected)
 *   /apps/:appId[/concepts/:conceptId[/creatives/:creativeId]]
 *   /plans  /settings  /analytics  /preloader  /domain
 *   /support[/:threadId]
 *   /admin[/:tab]   /admin/support/:threadId
 */
export type Page = "app" | "plans" | "settings" | "analytics" | "preloader" | "domain" | "support" | "admin";

export interface Route {
  page: Page;
  appId?: string;
  conceptId?: string;
  creativeId?: string;
  threadId?: string;
  tab?: string;
}

const SIMPLE: Page[] = ["plans", "settings", "analytics", "preloader", "domain"];
const seg = /^[A-Za-z0-9_-]{1,80}$/; // ids are UUIDs; anything else isn't a route

export function parseRoute(pathname: string): Route | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.some((p) => !seg.test(p))) return null;
  const [a, b, c, d, e, f, g] = parts;
  if (!a) return { page: "app" };
  if (SIMPLE.includes(a as Page) && !b) return { page: a as Page };
  if (a === "apps" && b) {
    if (!c) return { page: "app", appId: b };
    if (c === "concepts" && d) {
      if (!e) return { page: "app", appId: b, conceptId: d };
      if (e === "creatives" && f && !g) return { page: "app", appId: b, conceptId: d, creativeId: f };
    }
    return null;
  }
  if (a === "support") return c ? null : { page: "support", threadId: b };
  if (a === "admin") {
    if (b === "support" && c && !d) return { page: "admin", tab: "support", threadId: c };
    return c ? null : { page: "admin", tab: b };
  }
  return null;
}

export function routePath(r: Route): string {
  const e = encodeURIComponent;
  switch (r.page) {
    case "app":
      if (!r.appId) return "/";
      if (!r.conceptId) return `/apps/${e(r.appId)}`;
      return `/apps/${e(r.appId)}/concepts/${e(r.conceptId)}${r.creativeId ? `/creatives/${e(r.creativeId)}` : ""}`;
    case "support":
      return r.threadId ? `/support/${e(r.threadId)}` : "/support";
    case "admin":
      if (r.tab === "support" && r.threadId) return `/admin/support/${e(r.threadId)}`;
      return r.tab && r.tab !== "overview" ? `/admin/${e(r.tab)}` : "/admin";
    default:
      return `/${r.page}`;
  }
}

/**
 * Old email / Stripe links used query strings (`?support=<id>`, `?admin=<tab>&thread=<id>`). Map them
 * onto paths. Returns null when the URL has none of them.
 */
export function legacyRoute(search: string): Route | null {
  const q = new URLSearchParams(search);
  const support = q.get("support");
  const admin = q.get("admin");
  if (support && seg.test(support)) return { page: "support", threadId: support };
  if (admin && seg.test(admin)) {
    const thread = q.get("thread");
    return { page: "admin", tab: admin, threadId: thread && seg.test(thread) ? thread : undefined };
  }
  return null;
}

const TITLES: Record<Page, string> = {
  app: "Studio",
  plans: "Plans",
  settings: "Settings",
  analytics: "Analytics",
  preloader: "Preloader kits",
  domain: "Domain",
  support: "Support",
  admin: "Admin",
};
export const titleFor = (r: Route) => `${TITLES[r.page]} · Factorial AdLab`;

function current(): Route {
  return parseRoute(window.location.pathname) ?? { page: "app" };
}

/** The current route, plus `navigate` (push, or replace for redirects/corrections). */
export function useRoute(): [Route, (r: Route, opts?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<Route>(current);

  useEffect(() => {
    const onPop = () => setRoute(current());
    window.addEventListener("popstate", onPop);
    // an unknown path is corrected to the home screen (without adding a history entry)
    if (!parseRoute(window.location.pathname)) window.history.replaceState(null, "", "/" + window.location.search);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((r: Route, opts: { replace?: boolean } = {}) => {
    const path = routePath(r);
    const same = path === window.location.pathname;
    if (opts.replace || same) window.history.replaceState(null, "", path + (same ? window.location.search : ""));
    else window.history.pushState(null, "", path);
    setRoute(parseRoute(path) ?? { page: "app" });
  }, []);

  return [route, navigate];
}

/**
 * onClick for an <a href> that should navigate in-app on a plain click but keep the browser's own
 * behaviour for ctrl/cmd/shift/middle clicks (open in a new tab, copy link…).
 */
export function linkClick(go: () => void) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go();
  };
}
