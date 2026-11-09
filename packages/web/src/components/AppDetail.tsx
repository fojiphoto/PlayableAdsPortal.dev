import { useState, type MouseEvent } from "react";
import type { App as AppT, Concept } from "../types";
import type { Route } from "../router";
import { Icon } from "./icons";
import { AppTile, Platforms, platformLabel, shortDate } from "./Library";

type LinkProps = { href: string; onClick: (e: MouseEvent) => void };

/** One app: its concepts (ad ideas), with rename and "New concept". */
export function AppDetail({
  app,
  concepts,
  canEdit,
  nav,
  onRename,
  onNewConcept,
  onRenameConcept,
}: {
  app: AppT;
  concepts: Concept[];
  canEdit: boolean;
  nav: (r: Route) => LinkProps;
  onRename: () => void;
  onNewConcept: () => void;
  /** resolve when saved; throw to keep the editor open */
  onRenameConcept: (c: Concept, name: string) => Promise<void>;
}) {
  const back = nav({ page: "app" });
  const plat = platformLabel(app.platform);
  return (
    <>
      <div className="sh-page-head">
        <div style={{ minWidth: 0 }}>
          <a href={back.href} onClick={back.onClick} className="sh-crumb-back">
            ← Playable Ads
          </a>
          <h1 className="sh-page-title">
            <AppTile app={app} size="lg" />
            <span className="t">{app.name}</span>
          </h1>
          <p className="sh-page-sub">
            {concepts.length} {concepts.length === 1 ? "concept" : "concepts"}
            {plat ? ` · ${plat}` : ""}
          </p>
        </div>
        {canEdit && (
          <div className="sh-head-actions">
            <button type="button" className="sh-btn sh-btn-ghost" onClick={onRename}>
              <Icon.Pencil /> Rename
            </button>
            <button type="button" className="sh-btn sh-btn-primary" onClick={onNewConcept}>
              <Icon.Plus /> New concept
            </button>
          </div>
        )}
      </div>

      {concepts.length === 0 ? (
        <div className="sh-lib-empty">
          <div className="sh-lib-empty-ico">
            <Icon.Upload />
          </div>
          <h3>No concepts yet</h3>
          <p>{canEdit ? "A concept is one ad idea for this app. Create one, then upload its builds." : "This app has no concepts yet."}</p>
          {canEdit && (
            <button type="button" className="sh-btn sh-btn-primary" onClick={onNewConcept}>
              <Icon.Plus /> New concept
            </button>
          )}
        </div>
      ) : (
        <div className="sh-lib-card">
          <div className="sh-lib-card-head">Concepts · {concepts.length}</div>
          <div className="sh-lib-table">
            <div className="sh-lib-row con sh-lib-head">
              <span>Concept</span>
              <span className="sh-hide-m">Platforms</span>
              <span className="sh-num sh-hide-m">Created</span>
              <span />
            </div>
            {concepts.map((c) => (
              <ConceptRow key={c.id} app={app} c={c} canEdit={canEdit} nav={nav} onRename={onRenameConcept} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ConceptRow({
  app,
  c,
  canEdit,
  nav,
  onRename,
}: {
  app: AppT;
  c: Concept;
  canEdit: boolean;
  nav: (r: Route) => LinkProps;
  onRename: (c: Concept, name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [busy, setBusy] = useState(false);
  const l = nav({ page: "app", appId: app.id, conceptId: c.id });

  async function save() {
    const v = name.trim();
    if (!v || v === c.name) return setEditing(false);
    setBusy(true);
    try {
      await onRename(c, v);
      setEditing(false);
    } catch {
      /* the error shows in the page banner; keep editing */
    } finally {
      setBusy(false);
    }
  }

  if (editing)
    return (
      <div className="sh-lib-row con sh-lib-app" style={{ cursor: "default" }}>
        <span className="sh-lib-app-name">
          <span className="sh-con-ico">
            <Icon.File />
          </span>
          <span className="sh-rename">
            <input
              className="sh-rename-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={200}
              disabled={busy}
              aria-label="Concept name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setName(c.name);
                  setEditing(false);
                }
              }}
            />
            <button type="button" className="sh-rename-ok" onClick={() => void save()} disabled={busy} aria-label="Save name" title="Save">
              {busy ? <span className="sh-spin dark" /> : <Icon.Check />}
            </button>
            <button
              type="button"
              className="sh-rename-cancel"
              onClick={() => {
                setName(c.name);
                setEditing(false);
              }}
              disabled={busy}
              aria-label="Cancel"
              title="Cancel"
            >
              <Icon.X />
            </button>
          </span>
        </span>
        <span className="sh-hide-m" />
        <span className="sh-num sh-dim sh-hide-m">{shortDate(c.createdAt)}</span>
        <span />
      </div>
    );

  return (
    // the whole row opens the concept; the name is the real link (keyboard, ctrl/middle click)
    <div
      className="sh-lib-row con sh-lib-app"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("a,button")) l.onClick(e);
      }}
    >
      <span className="sh-lib-app-name">
        <span className="sh-con-ico">
          <Icon.File />
        </span>
        <a href={l.href} onClick={l.onClick} className="sh-lib-name-text sh-row-link" title={c.name}>
          {c.name}
        </a>
      </span>
      <span className="sh-hide-m">
        <Platforms platform={app.platform} />
      </span>
      <span className="sh-num sh-dim sh-hide-m">{shortDate(c.createdAt)}</span>
      <span className="sh-lib-actions">
        {canEdit && (
          <button
            type="button"
            className="sh-icon-btn"
            title="Rename"
            aria-label={`Rename ${c.name}`}
            onClick={() => {
              setName(c.name);
              setEditing(true);
            }}
          >
            <Icon.Pencil />
          </button>
        )}
        <Icon.Chevron />
      </span>
    </div>
  );
}
