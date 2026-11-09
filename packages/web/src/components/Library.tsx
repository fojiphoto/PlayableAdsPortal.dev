import type { MouseEvent } from "react";
import type { App as AppT } from "../types";
import type { Route } from "../router";
import { Icon } from "./icons";

type LinkProps = { href: string; onClick: (e: MouseEvent) => void };

const TILE_COLORS = ["#6c25d8", "#e13ddc", "#0d9488", "#3b82f6", "#a26bea", "#f59e0b", "#37404f", "#ef4444"];

/** Stable color for an app's initial tile. */
export function tileColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TILE_COLORS[Math.abs(h) % TILE_COLORS.length]!;
}
export function appInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const s = words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "?").slice(0, 2);
  return s.toUpperCase();
}
export function AppTile({ app, size }: { app: Pick<AppT, "id" | "name">; size?: "lg" | "xl" }) {
  return (
    <span className={`sh-lib-ico${size ? ` ${size}` : ""}`} style={{ background: tileColor(app.id) }} aria-hidden="true">
      {appInitials(app.name)}
    </span>
  );
}

/** Which stores an app targets, from its free-form `platform` ("ios", "android", "both", "ios,android"…). */
export function platformsOf(platform: string | null | undefined) {
  const p = (platform ?? "").toLowerCase();
  const both = p === "both" || p === "all";
  return { ios: both || /ios|apple|iphone/.test(p), android: both || /android|google/.test(p) };
}
export function platformLabel(platform: string | null | undefined) {
  const { ios, android } = platformsOf(platform);
  return [ios && "iOS", android && "Android"].filter(Boolean).join(" · ");
}

/** "09 Nov" this year, "09 Nov 25" for older dates. */
export function shortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const o: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = "2-digit";
  return d.toLocaleDateString("en-GB", o);
}

export function Platforms({ platform }: { platform: string | null | undefined }) {
  const { ios, android } = platformsOf(platform);
  return (
    <span className="sh-lib-plat" title={platformLabel(platform) || "Platform not set"}>
      <span className={ios ? "" : "sh-plat-off"}>
        <Icon.Apple />
      </span>
      <span className={android ? "" : "sh-plat-off"}>
        <Icon.Android />
      </span>
    </span>
  );
}

/** Playable Ads home: every app in the workspace. */
export function Library({
  apps,
  loaded,
  canEdit,
  nav,
  onNewApp,
}: {
  apps: AppT[];
  loaded: boolean;
  canEdit: boolean;
  nav: (r: Route) => LinkProps;
  onNewApp: () => void;
}) {
  const start = nav({ page: "start" });
  const docs = nav({ page: "docs" });
  return (
    <>
      <div className="sh-page-head">
        <div>
          <h1 className="sh-page-title">Playable Ads</h1>
          <p className="sh-page-sub">Your apps and their ad concepts. Open one to upload a build, preview it and export it to every network.</p>
        </div>
        {canEdit && (
          <div className="sh-head-actions">
            <button type="button" className="sh-btn sh-btn-primary" onClick={onNewApp}>
              <Icon.Plus /> New app
            </button>
          </div>
        )}
      </div>

      {!loaded ? (
        <div className="sh-loading">
          <span className="sh-spin dark" />
        </div>
      ) : apps.length === 0 ? (
        <div className="sh-lib-empty">
          <div className="sh-lib-empty-ico">
            <Icon.Layers />
          </div>
          <h3>No apps yet</h3>
          <p>{canEdit ? "Create your first app, then add the playables you want to export." : "Nobody has added an app to this workspace yet."}</p>
          {canEdit && (
            <button type="button" className="sh-btn sh-btn-primary" onClick={onNewApp}>
              <Icon.Plus /> New app
            </button>
          )}
        </div>
      ) : (
        <div className="sh-lib-card">
          <div className="sh-lib-card-head">Apps · {apps.length}</div>
          <div className="sh-lib-table">
            <div className="sh-lib-row sh-lib-head">
              <span>App name</span>
              <span className="sh-hide-m">
                Platforms
              </span>
              <span className="sh-num sh-hide-m">
                Concepts
              </span>
              <span className="sh-num sh-hide-m">
                Exports
              </span>
              <span className="sh-num sh-hide-m">
                Created
              </span>
              <span aria-label="Open" />
            </div>
            {apps.map((a) => {
              const l = nav({ page: "app", appId: a.id });
              return (
                <a key={a.id} href={l.href} onClick={l.onClick} className="sh-lib-row sh-lib-app">
                  <span className="sh-lib-app-name">
                    <AppTile app={a} />
                    <span className="sh-lib-name-text" title={a.name}>
                      {a.name}
                    </span>
                  </span>
                  <span className="sh-hide-m">
                    <Platforms platform={a.platform} />
                  </span>
                  <span className="sh-num sh-hide-m">
                    {a.conceptCount ?? "—"}
                  </span>
                  <span className={`sh-num sh-hide-m${a.exportCount ? "" : " sh-dim"}`}>
                    {a.exportCount ?? "—"}
                  </span>
                  <span className="sh-num sh-dim sh-hide-m">
                    {shortDate(a.createdAt)}
                  </span>
                  <span className="sh-lib-actions">
                    <Icon.Chevron />
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {loaded && (
        <div className="sh-lib-card" style={{ marginTop: 18 }}>
          <div className="sh-lib-card-head">Getting started</div>
          <p className="sh-samples-sub">
            New here? Setup walks you through the Unity plugin and your first export; Docs covers builds, the install button and every network.
          </p>
          <div className="sh-samples-links">
            <a href={start.href} onClick={start.onClick} className="sh-btn sh-btn-ghost sh-btn-sm">
              <Icon.Download /> Setup
            </a>
            <a href={docs.href} onClick={docs.onClick} className="sh-btn sh-btn-ghost sh-btn-sm">
              <Icon.File /> Docs
            </a>
          </div>
        </div>
      )}
    </>
  );
}
