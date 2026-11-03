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

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400";
const input = "w-full rounded-lg border border-[#1f6b4a] bg-[#06281c] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500 disabled:opacity-60";
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
      className={`overflow-hidden border-[#1b5540] bg-black ${compact ? "rounded-lg" : "rounded-[1.6rem]"}`}
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
        <div className="h-full w-full animate-pulse bg-[#0a3a28]" />
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

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-slate-100">Preloader kits</h1>
          <p className="text-sm text-slate-400">
            Loading screens shown over your playables while they load. Pick a template, brand it, then choose which apps and concepts use it.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={newKit}
            disabled={!!state && state.kits.length >= state.limit}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40"
          >
            New kit
          </button>
        )}
      </div>

      {state && !canEdit && (
        <div className="mb-4 rounded-lg border border-[#1f6b4a] bg-[#0a3a28]/40 px-4 py-2 text-sm text-slate-300">
          Only workspace admins can edit kits. {state.canAssign ? "You can still choose which kit each app and concept uses below." : ""}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr_auto]">
        {/* kit list */}
        <aside className="grid content-start gap-1.5">
          {state?.kits.length === 0 && selected !== "new" && (
            <div className="rounded-lg border border-dashed border-[#1f6b4a] p-4 text-sm text-slate-400">
              No kits yet. {canEdit ? "Create one to brand your exports." : "Ask an admin to create one."}
            </div>
          )}
          {state?.kits.map((k) => (
            <button
              key={k.id}
              onClick={() => openKit(k)}
              className={`rounded-lg border px-3 py-2 text-left text-sm ${selected === k.id ? "border-amber-500 bg-amber-500/10" : "border-[#1b5540] hover:border-[#7cb342]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-100">{k.name}</span>
                {state.defaultKitId === k.id && <span className="shrink-0 rounded bg-amber-500 px-1.5 text-[10px] font-bold text-black">DEFAULT</span>}
              </div>
              <div className="text-[11px] text-slate-500">
                {templates.find((t) => t.id === k.template)?.name ?? k.template}
                {k.usedBy ? ` · used ${k.usedBy}×` : ""}
              </div>
            </button>
          ))}
          {selected === "new" && <div className="rounded-lg border border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-slate-100">{draft?.name || "New kit"} (unsaved)</div>}
        </aside>

        {/* editor */}
        {draft ? (
          <div className={`${panel} grid content-start gap-5`}>
            <div>
              <label className={label}>Kit name</label>
              <input className={input} value={draft.name} maxLength={60} disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} />
            </div>

            <div>
              <label className={label}>Template</label>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <TemplateThumb key={t.id} t={t} base={galleryBase} kitId={savedId} active={draft.template === t.id} disabled={!canEdit} onPick={() => set({ template: t.id })} />
                ))}
              </div>
              {tpl && <p className="mt-2 text-xs text-slate-400">{tpl.description}</p>}
            </div>

            <div>
              <label className={label}>{tpl?.imageRole === "background" ? "Splash image (fills the screen)" : "Logo"}</label>
              <div className="flex flex-wrap items-center gap-3">
                {shownLogo ? (
                  <img src={shownLogo} alt="Current image" className="h-10 w-10 rounded-md border border-[#1f6b4a] bg-black/30 object-contain" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-[#1f6b4a] text-[10px] text-slate-500">none</span>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  disabled={!canEdit}
                  onChange={(e) => pickLogo(e.target.files?.[0])}
                  className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-[#123f2d] file:px-3 file:py-1.5 file:text-slate-100"
                />
                {shownLogo && canEdit && (
                  <button onClick={clearLogo} className="text-xs text-red-400 hover:underline">
                    Remove image
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">PNG, JPEG, GIF, WebP or SVG, up to 512 KB. It is inlined into every export, so smaller is better.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label="Background" value={draft.bg} fallback="#0b1220" disabled={!canEdit} onChange={(v) => set({ bg: v })} />
              <ColorField label="Accent (bar, spinner)" value={draft.accent} fallback="#ffffff" auto disabled={!canEdit} onChange={(v) => set({ accent: v })} />
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label className={label}>Tagline (optional)</label>
                <input className={input} value={draft.text} maxLength={60} placeholder="Loading…" disabled={!canEdit} onChange={(e) => set({ text: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-200">
                <input type="checkbox" checked={draft.showPercent} disabled={!canEdit} onChange={(e) => set({ showPercent: e.target.checked })} className="accent-amber-500" />
                Show percentage
              </label>
            </div>

            {msg && <div className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</div>}

            {canEdit && (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => void save()} disabled={busy || !draft.name.trim()} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
                  {busy ? "Saving…" : savedId ? "Save kit" : "Create kit"}
                </button>
                {savedId && (
                  <>
                    <button
                      onClick={() => void act(() => setDefaultKit(isDefault ? null : savedId), savedId, isDefault ? "No workspace default now. Exports get a preloader only where an app or concept picks one." : "Now the workspace default.")}
                      disabled={busy}
                      className="rounded-lg border border-[#1f6b4a] px-3 py-2 text-sm text-slate-200 hover:border-[#7cb342] disabled:opacity-40"
                    >
                      {isDefault ? "Unset default" : "Make default"}
                    </button>
                    <button onClick={() => void act(async () => (await duplicateKit(savedId)).id)} disabled={busy} className="text-sm text-slate-300 hover:text-amber-300 hover:underline disabled:opacity-40">
                      Duplicate
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${draft.name}"? Apps and concepts using it fall back to the workspace default.`)) void act(() => deleteKit(savedId), null, "Kit deleted.");
                      }}
                      disabled={busy}
                      className="text-sm text-red-400 hover:underline disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#1f6b4a] p-8 text-center text-sm text-slate-400">
            {canEdit ? "Pick a kit, or create a new one." : "Pick a kit to see it."}
          </div>
        )}

        {/* live preview */}
        <div className="flex flex-col items-center">
          <span className="mb-3 text-sm text-slate-400">Preview (as exported)</span>
          <Phone html={draft ? previewHtml : null} title="preloader preview" />
        </div>
      </div>

      {state && <Assignments state={state} onChanged={() => void load(selected)} />}
    </div>
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
    <button
      onClick={onPick}
      disabled={disabled}
      title={t.description}
      className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 ${active ? "border-amber-500 bg-amber-500/10" : "border-[#1b5540] hover:border-[#7cb342]"} disabled:cursor-default`}
    >
      <Phone html={html} scale={0.28} title={`${t.name} template`} />
      <span className={`text-xs ${active ? "text-amber-200" : "text-slate-300"}`}>{t.name}</span>
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
    <div>
      <label className={label}>{text}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value ?? fallback} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-9 w-11 cursor-pointer rounded border border-[#1f6b4a] bg-transparent disabled:cursor-default" />
        <input
          value={raw}
          disabled={disabled}
          placeholder={auto ? "auto" : fallback}
          onChange={(e) => {
            setRaw(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value);
            else if (e.target.value === "") onChange(null);
          }}
          className="w-28 rounded-lg border border-[#1f6b4a] bg-[#06281c] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500 disabled:opacity-60"
        />
        {auto && value && !disabled && (
          <button onClick={() => onChange(null)} className="text-xs text-slate-400 hover:text-amber-300 hover:underline">
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
    <section className={`${panel} mt-8`}>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-amber-400">Where kits apply</h2>
      <p className="mb-4 text-xs text-slate-400">A concept uses its own kit if set, otherwise its app's, otherwise the workspace default. Re-export a creative to pick up a change.</p>
      {err && <div className="mb-3 text-sm text-red-400">{err}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="w-40 text-slate-300">Workspace default</span>
        <KitSelect
          kits={state.kits}
          value={state.defaultKitId}
          inheritLabel={null}
          disabled={!state.canEdit}
          onChange={(v) => void run(() => setDefaultKit(v === NONE ? null : v))}
        />
      </div>

      {apps.length === 0 ? (
        <div className="text-sm text-slate-500">No apps in this workspace yet.</div>
      ) : (
        <div className="grid gap-3">
          {apps.map((a) => {
            const appEffective = a.kitId ? nameOf(a.kitId) : workspaceLabel;
            return (
              <div key={a.id} className="rounded-lg border border-[#1b5540] p-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-40 truncate font-medium text-slate-100" title={a.name}>
                    {a.name}
                  </span>
                  <KitSelect kits={state.kits} value={a.kitId} inheritLabel={`Workspace default (${workspaceLabel})`} disabled={!state.canAssign} onChange={(v) => void run(() => setAppKit(a.id, v))} />
                </div>
                {concepts
                  .filter((c) => c.appId === a.id)
                  .map((c) => (
                    <div key={c.id} className="mt-2 flex flex-wrap items-center gap-3 pl-4 text-sm">
                      <span className="w-36 truncate text-slate-300" title={c.name}>
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
    <select
      value={v}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className="min-w-[220px] rounded-lg border border-[#1f6b4a] bg-[#06281c] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 disabled:opacity-60"
    >
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
