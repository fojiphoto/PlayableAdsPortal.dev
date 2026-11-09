import { useEffect, useMemo, useRef, useState } from "react";
import {
  createKit,
  deleteKit,
  duplicateKit,
  getKits,
  listKitTemplates,
  previewKitHtml,
  setAppKit,
  setConceptKit,
  setDefaultKit,
  updateKit,
} from "../api";
import type { Kit, KitDraft, KitsState, PreloaderTemplate } from "../types";
import { Icon } from "./icons";
import { Loading, Msg, PageHead } from "./pageKit";

const MAX_LOGO = 512 * 1024;
const NONE = "none";

const blankDraft = (n: number): KitDraft => ({
  name: n ? `Kit ${n + 1}` : "Brand kit",
  template: "classic",
  bg: "#0b1220",
  accent: null,
  text: "",
  showPercent: false,
});
const draftOf = (k: Kit): KitDraft => ({
  name: k.name,
  template: k.template,
  bg: k.bg,
  accent: k.accent,
  text: k.text ?? "",
  showPercent: k.showPercent,
});

/** Debounced server-rendered preview HTML for a draft (exactly what exports inject). */
function usePreviewHtml(draft: KitDraft | null, kitId: string | null, progress?: number, delay = 300): string | null {
  const [html, setHtml] = useState<string | null>(null);
  const key = JSON.stringify([draft, kitId, progress]);
  useEffect(() => {
    if (!draft) return setHtml(null);
    let live = true;
    const t = setTimeout(() => {
      previewKitHtml(draft, { kitId, progress })
        .then((h) => live && setHtml(h))
        .catch(() => {});
    }, delay);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return html;
}

/** A phone-shaped, sandboxed frame for preview HTML, scaled down to `scale`. */
function Phone({ html, scale = 1, title }: { html: string | null; scale?: number; title: string }) {
  const w = 270;
  const h = 480;
  const compact = scale < 0.5;
  const b = compact ? 3 : 8;
  return (
    <div
      className={`pg-phone ${compact ? "rounded-lg" : "rounded-[1.6rem]"}`}
      style={{ width: w * scale + 2 * b, height: h * scale + 2 * b, borderWidth: b }}
    >
      {html ? (
        <iframe
          title={title}
          sandbox="allow-scripts"
          srcDoc={html}
          className="pointer-events-none origin-top-left border-0"
          style={{ width: w, height: h, transform: `scale(${scale})` }}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-ink-700" />
      )}
    </div>
  );
}

/** Preloader kits: a template library per workspace, a server-rendered preview, and where each kit applies. */
export function Preloader() {
  const [state, setState] = useState<KitsState | null>(null);
  const [templates, setTemplates] = useState<PreloaderTemplate[]>([]);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<KitDraft | null>(null);
  const [shownLogo, setShownLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(select?: string | null) {
    try {
      const s = await getKits();
      setState(s);
      const pick = select !== undefined ? select : (selected ?? s.defaultKitId ?? s.kits[0]?.id ?? null);
      const k = s.kits.find((x) => x.id === pick);
      if (k) openKit(k);
      else if (pick !== "new") {
        setSelected(null);
        setDraft(null);
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  useEffect(() => {
    listKitTemplates().then(setTemplates).catch(() => {});
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openKit(k: Kit) {
    setSelected(k.id);
    setDraft(draftOf(k));
    setShownLogo(k.logoDataUri);
    setMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  }
  function newKit() {
    setSelected("new");
    setDraft(blankDraft(state?.kits.length ?? 0));
    setShownLogo(null);
    setMsg(null);
  }

  const savedId = selected && selected !== "new" ? selected : null;
  const canEdit = !!state?.canEdit;
  const tpl = templates.find((t) => t.id === draft?.template);
  const set = (p: Partial<KitDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  function pickLogo(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_LOGO) {
      setMsg({ ok: false, text: "That image is over 512 KB. Every export inlines it, so use a smaller one." });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const uri = String(r.result);
      setShownLogo(uri);
      set({ logoDataUri: uri });
    };
    r.readAsDataURL(f);
  }
  function clearLogo() {
    setShownLogo(null);
    set({ logoDataUri: null });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const k = savedId ? await updateKit(savedId, draft) : await createKit(draft);
      await load(k.id);
      setMsg({ ok: true, text: "Saved. Applies to your next exports." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function act(fn: () => Promise<unknown>, after?: string | null, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      await load(typeof r === "string" ? r : after); // an action that returns an id selects it
      if (ok) setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // the main preview animates; gallery thumbnails freeze the bar at 62 % and refresh less eagerly
  const previewHtml = usePreviewHtml(draft, savedId);
  const galleryBase = useMemo(() => (draft ? { ...draft, name: "x" } : null), [draft]);

  const isDefault = !!savedId && state?.defaultKitId === savedId;

  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? id;
  const atLimit = !!state && state.kits.length >= state.limit;

  return (
    <div>
      <PageHead
        icon={<Icon.Image />}
        title="Customize Preloader"
        sub="The loading screen shown over your playables while they load. Pick a template, brand it, then choose which apps and concepts use it."
        actions={
          canEdit && (
            <button onClick={newKit} disabled={atLimit} className="pg-btn pg-btn-primary" title={atLimit ? `Up to ${state?.limit} kits` : undefined}>
              <Icon.Plus />
              New kit
            </button>
          )
        }
      />

      {state && !canEdit && (
        <Msg kind="ok">Only workspace admins can edit kits. {state.canAssign ? "You can still choose which kit each app and concept uses below." : ""}</Msg>
      )}

      <div className="pg-stack">
        {/* kit library */}
        <section className="pg-card">
          <div className="pg-card-head">
            <h2 className="pg-h">Your preloaders</h2>
            {state && (
              <span className="pg-count">
                {state.kits.length} of {state.limit}
              </span>
            )}
          </div>
          {!state ? (
            <Loading />
          ) : state.kits.length === 0 && selected !== "new" ? (
            <p className="pg-p" style={{ margin: 0 }}>
              No preloaders yet. {canEdit ? "Create one to brand your exports." : "Ask an admin to create one."}
            </p>
          ) : (
            <ul className="pre-grid">
              {state.kits.map((k) => (
                <li key={k.id}>
                  <button onClick={() => openKit(k)} className={`pre-card${selected === k.id ? " on" : ""}`} aria-pressed={selected === k.id}>
                    <KitThumb bg={k.bg} logo={k.logoDataUri} cover={templates.find((t) => t.id === k.template)?.imageRole === "background"} />
                    {state.defaultKitId === k.id && <span className="pre-badge">DEFAULT</span>}
                    <span className="pre-meta">
                      <span className="pre-name">{k.name}</span>
                      <span className="pre-size">
                        {templateName(k.template)}
                        {k.usedBy ? ` · used ${k.usedBy}×` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {selected === "new" && draft && (
                <li>
                  <div className="pre-card on" style={{ cursor: "default" }}>
                    <KitThumb bg={draft.bg} logo={shownLogo} cover={tpl?.imageRole === "background"} />
                    <span className="pre-badge">NEW</span>
                    <span className="pre-meta">
                      <span className="pre-name">{draft.name || "New kit"}</span>
                      <span className="pre-size">Not saved yet</span>
                    </span>
                  </div>
                </li>
              )}
              {canEdit && selected !== "new" && (
                <li>
                  <button onClick={newKit} disabled={atLimit} className="pre-card pre-new" style={{ minHeight: 150, height: "100%" }}>
                    <span className="grid place-items-center gap-1.5">
                      <Icon.Plus />
                      New kit
                    </span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </section>

        <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_auto]">
          {/* editor */}
          {draft ? (
            <section className="pg-card grid content-start gap-5">
              <div className="pg-card-head" style={{ marginBottom: 0 }}>
                <h2 className="pg-h">{savedId ? "Edit preloader" : "New preloader"}</h2>
                {isDefault && <span className="pg-tag brand">Workspace default</span>}
              </div>

              <label className="pg-field">
                <span className="pg-label">Name</span>
                <input className="pg-input" value={draft.name} maxLength={60} placeholder="Summer sale splash" disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} />
              </label>

              <div className="pg-field">
                <span className="pg-label">Template</span>
                <div className="flex flex-wrap gap-2">
                  {templates.map((t) => (
                    <TemplateThumb key={t.id} t={t} base={galleryBase} kitId={savedId} active={draft.template === t.id} disabled={!canEdit} onPick={() => set({ template: t.id })} />
                  ))}
                </div>
                {tpl && (
                  <p className="pg-hint" style={{ marginTop: 2 }}>
                    {tpl.description}
                  </p>
                )}
              </div>

              <div className="pg-field">
                <span className="pg-label">{tpl?.imageRole === "background" ? "Splash image (fills the screen)" : "Logo"}</span>
                <div className="flex flex-wrap items-center gap-3">
                  {shownLogo ? (
                    <img src={shownLogo} alt="Current image" className="h-[42px] w-[42px] rounded-[9px] border border-line-strong bg-canvas object-contain" />
                  ) : (
                    <span className="flex h-[42px] w-[42px] items-center justify-center rounded-[9px] border border-dashed border-line-strong text-[11px] text-text-3">none</span>
                  )}
                  <label className={`pre-file-btn${!canEdit ? " disabled" : ""}`}>
                    <Icon.Upload />
                    <span>{shownLogo ? "Replace image" : "Upload image"}</span>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                      disabled={!canEdit}
                      onChange={(e) => pickLogo(e.target.files?.[0])}
                      className="sr-only"
                    />
                  </label>
                  {shownLogo && canEdit && (
                    <button onClick={clearLogo} className="pg-link danger text-[13px]">
                      Remove image
                    </button>
                  )}
                </div>
                <p className="pg-hint" style={{ marginTop: 2 }}>
                  PNG, JPG, GIF, WebP or SVG · up to 512 KB. It is inlined into every export, so smaller is better.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ColorField label="Background" value={draft.bg} fallback="#0b1220" disabled={!canEdit} onChange={(v) => set({ bg: v })} />
                <ColorField label="Accent (bar, spinner)" value={draft.accent} fallback="#ffffff" auto disabled={!canEdit} onChange={(v) => set({ accent: v })} />
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="pg-field">
                  <span className="pg-label">
                    Tagline <span className="font-normal text-text-3">(optional)</span>
                  </span>
                  <input className="pg-input" value={draft.text} maxLength={60} placeholder="Loading…" disabled={!canEdit} onChange={(e) => set({ text: e.target.value })} />
                </label>
                <label className="pg-checkrow pb-3">
                  <input type="checkbox" className="pg-check" checked={draft.showPercent} disabled={!canEdit} onChange={(e) => set({ showPercent: e.target.checked })} />
                  Show percentage
                </label>
              </div>

              {msg && <Msg kind={msg.ok ? "success" : "err"}>{msg.text}</Msg>}

              {canEdit && (
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <button onClick={() => void save()} disabled={busy || !draft.name.trim()} className="pg-btn pg-btn-primary">
                    {busy ? "Saving…" : savedId ? "Save kit" : "Create kit"}
                  </button>
                  {savedId && (
                    <>
                      <button
                        onClick={() =>
                          void act(
                            () => setDefaultKit(isDefault ? null : savedId),
                            savedId,
                            isDefault ? "No workspace default now. Exports get a preloader only where an app or concept picks one." : "Now the workspace default.",
                          )
                        }
                        disabled={busy}
                        className="pg-btn pg-btn-ghost"
                      >
                        {isDefault ? "Unset default" : "Make default"}
                      </button>
                      <button onClick={() => void act(async () => (await duplicateKit(savedId)).id)} disabled={busy} className="pg-link muted text-[14px]">
                        Duplicate
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${draft.name}"? Apps and concepts using it fall back to the workspace default.`)) void act(() => deleteKit(savedId), null, "Kit deleted.");
                        }}
                        disabled={busy}
                        className="pg-link danger ml-auto inline-flex items-center gap-1.5 text-[14px]"
                      >
                        <Icon.Trash width={15} height={15} />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          ) : (
            <div className="pg-empty self-start">
              {msg ? <Msg kind={msg.ok ? "success" : "err"}>{msg.text}</Msg> : canEdit ? "Pick a kit above, or create a new one." : "Pick a kit to see it."}
            </div>
          )}

          {/* live preview */}
          <section className="pg-card flex flex-col items-center gap-3 self-start" style={{ padding: "18px 22px 22px" }}>
            <span className="pg-label">Preview (as exported)</span>
            <Phone html={draft ? previewHtml : null} title="preloader preview" />
          </section>
        </div>

        {state && <Assignments state={state} onChanged={() => void load(selected)} />}
      </div>
    </div>
  );
}

/** A kit's card thumbnail: its background colour with its logo (or splash image). */
function KitThumb({ bg, logo, cover }: { bg: string | null; logo: string | null | undefined; cover?: boolean }) {
  return (
    <span className={`pre-thumb${cover ? " cover" : ""}`} style={bg ? { background: bg } : undefined}>
      {logo ? <img src={logo} alt="" /> : <span className="pre-thumb-ph">No image</span>}
    </span>
  );
}

function TemplateThumb({
  t,
  base,
  kitId,
  active,
  disabled,
  onPick,
}: {
  t: PreloaderTemplate;
  base: KitDraft | null;
  kitId: string | null;
  active: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const draft = useMemo(() => (base ? { ...base, template: t.id, showPercent: true } : null), [base, t.id]);
  const html = usePreviewHtml(draft, kitId, 0.62, 600);
  return (
    <button onClick={onPick} disabled={disabled} title={t.description} aria-pressed={active} className={`pre-tpl${active ? " on" : ""}`}>
      <Phone html={html} scale={0.28} title={`${t.name} template`} />
      <span>{t.name}</span>
    </button>
  );
}

function ColorField({
  label: text,
  value,
  fallback,
  auto,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  fallback: string;
  auto?: boolean;
  disabled: boolean;
  onChange: (v: string | null) => void;
}) {
  const [raw, setRaw] = useState(value ?? "");
  useEffect(() => setRaw(value ?? ""), [value]);
  return (
    <div className="pg-field">
      <span className="pg-label">{text}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value ?? fallback} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="pre-swatch" aria-label={`${text} colour`} />
        <input
          value={raw}
          disabled={disabled}
          placeholder={auto ? "auto" : fallback}
          aria-label={`${text} hex value`}
          onChange={(e) => {
            setRaw(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value);
            else if (e.target.value === "") onChange(null);
          }}
          className="pg-input mono w-32"
        />
        {auto && value && !disabled && (
          <button onClick={() => onChange(null)} className="pg-link muted text-[13px]">
            auto
          </button>
        )}
      </div>
    </div>
  );
}

/** Where each kit applies: workspace default, then per-app and per-concept overrides. */
function Assignments({ state, onChanged }: { state: KitsState; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const nameOf = (id: string | null) => (id === NONE ? "no preloader" : (state.kits.find((k) => k.id === id)?.name ?? "no preloader"));
  const workspaceLabel = state.defaultKitId ? nameOf(state.defaultKitId) : "no preloader";

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const { apps, concepts } = state.assignments;
  return (
    <section className="pg-card">
      <h2 className="pg-h" style={{ marginBottom: 4 }}>
        Where kits apply
      </h2>
      <p className="pg-hint" style={{ margin: "0 0 16px" }}>
        A concept uses its own kit if set, otherwise its app's, otherwise the workspace default. Re-export a playable to pick up a change.
      </p>
      {err && <Msg kind="err">{err}</Msg>}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] bg-canvas px-3.5 py-3 text-[14px]">
        <span className="w-40 font-semibold text-text">Workspace default</span>
        <KitSelect kits={state.kits} value={state.defaultKitId} inheritLabel={null} disabled={!state.canEdit} onChange={(v) => void run(() => setDefaultKit(v === NONE ? null : v))} />
      </div>

      {apps.length === 0 ? (
        <p className="pg-p" style={{ margin: 0 }}>
          No apps in this workspace yet.
        </p>
      ) : (
        <div className="grid gap-2.5">
          {apps.map((a) => {
            const appEffective = a.kitId ? nameOf(a.kitId) : workspaceLabel;
            return (
              <div key={a.id} className="rounded-[10px] border border-line px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px]">
                  <span className="w-40 truncate font-medium text-text" title={a.name}>
                    {a.name}
                  </span>
                  <KitSelect kits={state.kits} value={a.kitId} inheritLabel={`Workspace default (${workspaceLabel})`} disabled={!state.canAssign} onChange={(v) => void run(() => setAppKit(a.id, v))} />
                </div>
                {concepts
                  .filter((c) => c.appId === a.id)
                  .map((c) => (
                    <div key={c.id} className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-4 text-[14px]">
                      <span className="w-36 truncate text-text-2" title={c.name}>
                        ↳ {c.name}
                      </span>
                      <KitSelect kits={state.kits} value={c.kitId} inheritLabel={`App (${appEffective})`} disabled={!state.canAssign} onChange={(v) => void run(() => setConceptKit(c.id, v))} />
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function KitSelect({
  kits,
  value,
  inheritLabel,
  disabled,
  onChange,
}: {
  kits: Kit[];
  value: string | null;
  /** null = no "inherit" option (the workspace default itself) */
  inheritLabel: string | null;
  disabled: boolean;
  onChange: (v: string | null) => void;
}) {
  const v = value ?? (inheritLabel ? "" : NONE);
  return (
    <select value={v} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} className="pg-input sm w-full sm:w-auto sm:min-w-[240px]">
      {inheritLabel && <option value="">Inherit: {inheritLabel}</option>}
      {kits.map((k) => (
        <option key={k.id} value={k.id}>
          {k.name}
        </option>
      ))}
      <option value={NONE}>No preloader</option>
    </select>
  );
}
