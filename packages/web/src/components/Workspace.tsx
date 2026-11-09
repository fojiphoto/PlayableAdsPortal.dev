import { useEffect, useState } from "react";
import { getConcept, getCreative, exportCreativeAsync, downloadAllUrl, previewUrl, getKits, setConceptKit } from "../api";
import type { CreativeRef, EffectiveKit, Job, Kit, Network, PackResultView, VariableDef, VariableValues } from "../types";
import { VariablesPanel } from "./VariablesPanel";
import { UploadForm } from "./UploadForm";
import { ResultCard } from "./ResultCard";
import { DevicePreview } from "./DevicePreview";
import { Icon } from "./icons";

/**
 * The creative studio for one concept: builds on the left (with their variables), the phone preview in
 * the middle, networks + export + results on the right. Uploading a new build takes the middle and
 * right columns.
 */
export function Workspace({
  conceptId,
  networks,
  onExported,
  readOnly = false,
  creativeId = null,
  onCreativeChange,
  onActiveName,
}: {
  conceptId: string;
  networks: Network[];
  onExported?: () => void;
  /** viewer role: preview/download only — no upload, no export */
  readOnly?: boolean;
  /** the creative named in the URL (null = first creative, or the upload form) */
  creativeId?: string | null;
  /** selection changed: put it in the URL (`replace` for automatic picks, push for the user's) */
  onCreativeChange?: (id: string | null, replace: boolean) => void;
  /** the selected creative's name (for the breadcrumb); null while uploading */
  onActiveName?: (name: string | null) => void;
}) {
  const [creatives, setCreatives] = useState<CreativeRef[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeName, setActiveName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<PackResultView[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null); // live progress of the running export job
  const [variables, setVariables] = useState<VariableValues>({});
  const [variableSchema, setVariableSchema] = useState<VariableDef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // preloader kit for this concept: its own override + what exports actually get
  const [kitId, setKitId] = useState<string | null>(null);
  const [effective, setEffective] = useState<EffectiveKit | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);

  // default-select the first 6 (priority) networks once loaded
  useEffect(() => {
    if (networks.length && selected.size === 0) setSelected(new Set(networks.slice(0, 6).map((n) => n.id)));
  }, [networks, selected.size]);

  // load the concept's creatives when it changes
  useEffect(() => {
    setActiveId(null);
    setResults([]);
    setPreview(null);
    setUploading(true);
    setErr(null);
    setLoaded(false);
    getConcept(conceptId)
      .then((c) => {
        setCreatives(c.creatives);
        setKitId(c.kitId ?? null);
        setEffective(c.preloader ?? null);
        // the creative from the URL if it's here, else the newest one (recorded without a new history entry)
        const pick = c.creatives.find((x) => x.id === creativeId) ?? c.creatives[0];
        if (pick) void selectCreative(pick, true);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoaded(true));
    getKits()
      .then((s) => setKits(s.kits))
      .catch(() => setKits([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId]);

  // tell the page which creative is open (breadcrumb)
  useEffect(() => {
    onActiveName?.(uploading || !activeId ? null : activeName || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading, activeId, activeName]);

  async function changeKit(v: string | null) {
    setErr(null);
    try {
      const c = await setConceptKit(conceptId, v);
      setKitId(c.kitId ?? null);
      setEffective(c.preloader ?? null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const sourceLabel = { concept: "this concept", app: "the app", workspace: "workspace default" } as const;

  // back/forward between creatives (or to the upload form) of this concept
  useEffect(() => {
    if (creativeId && creativeId !== activeId) {
      const ref = creatives.find((c) => c.id === creativeId);
      if (ref) void selectCreative(ref, true);
    } else if (!creativeId && activeId && creatives.length && !readOnly) {
      setUploading(true);
      setActiveId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeId]);

  async function selectCreative(ref: CreativeRef, auto = false) {
    onCreativeChange?.(ref.id, auto);
    setActiveId(ref.id);
    setActiveName(ref.name);
    setUploading(false);
    setResults([]);
    setPreview(null);
    try {
      const d = await getCreative(ref.id);
      setVariables(d.variables ?? {});
      setVariableSchema(d.variableSchema ?? []);
      if (d.exports.length) {
        setResults(d.exports);
        setPreview((d.exports.find((r) => r.ok) ?? d.exports[0])?.network ?? null);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function onUploaded(summary: { id: string; name: string }) {
    onCreativeChange?.(summary.id, false);
    setCreatives((cs) => [{ id: summary.id, name: summary.name, entry: "", createdAt: "" }, ...cs]);
    setActiveId(summary.id);
    setActiveName(summary.name);
    setResults([]);
    setPreview(null);
    setVariables({});
    setVariableSchema([]);
    setUploading(false);
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function doExport() {
    if (!activeId || selected.size === 0) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      // exports run as a background job on the server; we poll it and show per-network progress
      const rs = await exportCreativeAsync(activeId, [...selected], setJob);
      setResults(rs);
      setPreview((rs.find((r) => r.ok) ?? rs[0])?.network ?? null);
      onExported?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setJob(null);
    }
  }

  const previewLabel = networks.find((n) => n.id === preview)?.name;
  const allOn = networks.length > 0 && selected.size === networks.length;
  const showUpload = uploading || !activeId;

  return (
    <div>
      {err && (
        <div className="sh-alert err" role="alert">
          <Icon.Alert />
          <span className="sh-alert-text">{err}</span>
          <button type="button" className="sh-alert-x" onClick={() => setErr(null)} aria-label="Dismiss">
            <Icon.X />
          </button>
        </div>
      )}

      <div className="sh-studio">
        {/* left: builds + variables */}
        <div className="sh-studio-left">
          <div className="sh-card">
            <div className="sh-card-h">
              <span className="sh-card-t">Creatives · {creatives.length}</span>
            </div>
            {!loaded ? (
              <div className="sh-loading" style={{ padding: 14 }}>
                <span className="sh-spin dark" />
              </div>
            ) : (
              <div className="sh-cre-list">
                {creatives.length === 0 && <p className="sh-note">No builds in this concept yet.</p>}
                {creatives.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void selectCreative(c)}
                    className={`sh-cre${activeId === c.id && !uploading ? " on" : ""}`}
                    aria-current={activeId === c.id && !uploading ? "true" : undefined}
                  >
                    <span className="sh-con-ico">
                      <Icon.File />
                    </span>
                    <span className="sh-cre-name" title={c.name}>
                      {c.name}
                    </span>
                  </button>
                ))}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploading(true);
                      setActiveId(null);
                      onCreativeChange?.(null, false);
                    }}
                    className={`sh-cre sh-cre-add${showUpload ? " on" : ""}`}
                  >
                    <Icon.Upload /> Add a build
                  </button>
                )}
              </div>
            )}
            {readOnly && (
              <p className="sh-note" style={{ marginTop: 10 }}>
                View-only access. Ask a workspace admin for the member role to upload or export.
              </p>
            )}
          </div>
          {!showUpload && activeId && (
            <VariablesPanel creativeId={activeId} schema={variableSchema} values={variables} readOnly={readOnly} onSaved={setVariables} />
          )}
        </div>

        {showUpload ? (
          <div className="sh-studio-wide">
            {readOnly ? (
              <div className="sh-lib-empty">
                <div className="sh-lib-empty-ico">
                  <Icon.Layers />
                </div>
                <h3>{creatives.length ? "Pick a creative" : "No creatives yet"}</h3>
                <p>{creatives.length ? "Choose a build on the left to preview and download it." : "Nobody has uploaded a build to this concept yet."}</p>
              </div>
            ) : (
              <UploadForm conceptId={conceptId} onUploaded={onUploaded} />
            )}
          </div>
        ) : (
          <>
            {/* center: phone preview */}
            <div className="sh-studio-center">
              <DevicePreview src={activeId && preview ? previewUrl(activeId, preview) : null} label={previewLabel} />
            </div>

            {/* right: networks, export, results */}
            <div className="sh-studio-right">
              <div className="sh-net-panel">
                <div className="sh-net-panel-top">
                  <div style={{ minWidth: 0 }}>
                    <div className="sh-net-panel-h">Export to networks</div>
                    <div className="sh-net-panel-count">
                      {selected.size} of {networks.length} selected · <span title={activeName}>{activeName}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="sh-link-btn"
                    onClick={() => setSelected(allOn ? new Set() : new Set(networks.map((n) => n.id)))}
                    disabled={!networks.length}
                  >
                    {allOn ? "Clear" : "Select all"}
                  </button>
                </div>

                <div className="sh-net-list">
                  {networks.map((n) => {
                    const on = selected.has(n.id);
                    return (
                      <label key={n.id} className={`sh-netrow${on ? " sel" : ""}`} title={n.name}>
                        <input type="checkbox" checked={on} onChange={() => toggle(n.id)} />
                        <span className="sh-netrow-check" aria-hidden="true">
                          {on && <Icon.Check />}
                        </span>
                        <span className="sh-netrow-name">{n.name}</span>
                      </label>
                    );
                  })}
                </div>

                <div className="sh-kit-row">
                  <span>Preloader</span>
                  <select
                    className="sh-select sm"
                    value={kitId ?? ""}
                    disabled={readOnly}
                    onChange={(e) => void changeKit(e.target.value === "" ? null : e.target.value)}
                  >
                    <option value="">{kitId === null ? `Inherit: ${effective?.kitName ?? "no preloader"}` : "Inherit from app / workspace"}</option>
                    {kits.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                    <option value="none">No preloader</option>
                  </select>
                  {effective?.source && effective.kitName && kitId === null && <span>from {sourceLabel[effective.source]}</span>}
                </div>

                <button
                  type="button"
                  onClick={() => void doExport()}
                  disabled={busy || selected.size === 0 || readOnly}
                  title={readOnly ? "Viewers cannot export" : undefined}
                  className="sh-btn sh-btn-primary sh-btn-block"
                >
                  {busy ? (
                    <>
                      <span className="sh-spin" /> {job?.status === "queued" ? "Queued…" : "Exporting…"}
                    </>
                  ) : (
                    <>
                      <Icon.Download /> Export {selected.size} network{selected.size === 1 ? "" : "s"}
                    </>
                  )}
                </button>

                {busy && (
                  <div className="sh-progress" aria-live="polite">
                    <div className="sh-progress-top">
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {job?.label ?? (job?.status === "queued" ? "Waiting for a worker…" : "Starting…")}
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{job?.progress ?? 0}%</span>
                    </div>
                    <div className="sh-progress-bar">
                      <div style={{ width: `${Math.max(3, job?.progress ?? 0)}%` }} />
                    </div>
                  </div>
                )}

                {results.length > 0 && activeId && (
                  <>
                    <div className="sh-results-h">
                      <span className="sh-card-t">Exports · {results.length}</span>
                      <a href={downloadAllUrl(activeId)} download className="sh-dl-all">
                        <Icon.Download /> Download all (.zip)
                      </a>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {results.map((r) => (
                        <ResultCard key={r.network} creativeId={activeId} r={r} active={preview === r.network} onPreview={setPreview} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
