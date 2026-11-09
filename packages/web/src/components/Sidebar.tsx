import type { MouseEvent, ReactNode } from "react";
import type { Page, Route } from "../router";
import { Icon } from "./icons";
import pkg from "../../package.json";

type LinkProps = { href: string; onClick: (e: MouseEvent) => void };

interface Item {
  page: Page;
  label: string;
  icon: ReactNode;
  badge?: number;
}

/** Dark left rail: brand, the main pages, then our extra pages (Domain, Support, Admin). */
export function Sidebar({
  page,
  nav,
  unread,
  isAdmin,
  onNavigate,
}: {
  page: Page;
  nav: (r: Route) => LinkProps;
  unread: number;
  isAdmin: boolean;
  /** called after any link is followed (closes the mobile drawer) */
  onNavigate: () => void;
}) {
  const main: Item[] = [
    { page: "app", label: "Playable Ads", icon: <Icon.Layers /> },
    { page: "analytics", label: "Analytics", icon: <Icon.Chart /> },
    { page: "preloader", label: "Customize Preloader", icon: <Icon.Image /> },
    { page: "start", label: "Setup", icon: <Icon.Download /> },
    { page: "plans", label: "Plans", icon: <Icon.Tag /> },
    { page: "docs", label: "Docs", icon: <Icon.File /> },
    { page: "settings", label: "Settings", icon: <Icon.Settings /> },
  ];
  const extra: Item[] = [
    { page: "domain", label: "Domain", icon: <Icon.Globe /> },
    { page: "support", label: "Support", icon: <Icon.Chat />, badge: unread },
    ...(isAdmin ? [{ page: "admin" as Page, label: "Admin", icon: <Icon.Shield /> }] : []),
  ];

  const link = (it: Item) => {
    const l = nav({ page: it.page });
    const active = page === it.page;
    return (
      <a
        key={it.page}
        href={l.href}
        onClick={(e) => {
          l.onClick(e);
          onNavigate();
        }}
        className={`sh-nav-item${active ? " active" : ""}`}
        aria-current={active ? "page" : undefined}
      >
        {it.icon}
        <span>{it.label}</span>
        {!!it.badge && (
          <span className="sh-nav-badge" aria-label={`${it.badge} unread`}>
            {it.badge > 99 ? "99+" : it.badge}
          </span>
        )}
      </a>
    );
  };

  const home = nav({ page: "app" });
  return (
    <aside className="sh-sidebar" aria-label="Main navigation">
      <a
        href={home.href}
        onClick={(e) => {
          home.onClick(e);
          onNavigate();
        }}
        className="sh-brand"
      >
        <span className="sh-brand-mark">
          <img src="/art/logo.webp" alt="" />
        </span>
        <span>
          <div className="sh-brand-name">
            Factorial <em>AdLab</em>
          </div>
          <div className="sh-brand-sub">Playable Ads</div>
        </span>
      </a>
      <nav className="sh-nav">
        {main.map(link)}
        <div className="sh-nav-sep" role="separator" />
        {extra.map(link)}
      </nav>
      <div className="sh-sidebar-foot">
        <div className="sh-side-ver">v{pkg.version}</div>
      </div>
    </aside>
  );
}
