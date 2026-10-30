import { useEffect, useState } from "react";
import { getConcept, getCreative, exportCreativeAsync, downloadAllUrl, previewUrl } from "../api";
import type { CreativeRef, Job, Network, PackResultView } from "../types";
import { UploadForm } from "./UploadForm";
import { ResultCard } from "./ResultCard";
import { DevicePreview } from "./DevicePreview";

export function Workspace({
  conceptId,
  networks,
  onExported,
}: {
  conceptId: string;
  networks: Network[];
  onExported?: () => void;
}) {
  const [creatives, setCreatives] = useState<CreativeRef[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeName, setActiveName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<PackResultView[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null); // live progress of the running export job
  const [err, setErr] = useState<string | null>(null);

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
    getConcept(conceptId)
      .then((c) => {
        setCreatives(c.creatives);
        if (c.creatives[0]) void selectCreative(c.creatives[0]);
      })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptId]);

  async function selectCreative(ref: CreativeRef) {
    setActiveId(ref.id);
    setActiveName(ref.name);
    setUploading(false);
    setResults([]);
    setPreview(null);
    try {
      const d = await getCreative(ref.id);
      if (d.exports.length) {
        setResults(d.exports);
        setPreview((d.exports.find((r) => r.ok) ?? d.exports[0])?.network ?? null);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function onUploaded(summary: { id: string; name: string }) {
    setCreatives((cs) => [{ id: summary.id, name: summary.name, entry: "", createdAt: "" }, ...cs]);
    setActiveId(summary.id);
    setActiveName(summary.name);
    setResults([]);
    setPreview(null);
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

  return (
    <div>
      {/* creatives row */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {creatives.map((c) => (
          <button
            key={c.id}
            onClick={() => void selectCreative(c)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              activeId === c.id ? "border-amber-500 bg-amber-500/10 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"
            }`}
          >
            {c.name}
          </button>
        ))}
        <button
          onClick={() => {
            setUploading(true);
            setActiveId(null);
          }}
          className="rounded-lg border border-dashed border-[#1f6b4a] px-3 py-1.5 text-sm text-slate-400 hover:border-[#7cb342]"
        >
          + Upload
        </button>
      </div>

      {err && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{err}</div>}

      {uploading || !activeId ? (
        <div className="py-6">
          <UploadForm conceptId={conceptId} onUploaded={onUploaded} />
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Networks · <span className="text-slate-200">{activeName}</span>
              </h2>
              <div className="flex gap-2 text-xs">
                <button className="text-amber-400 hover:underline" onClick={() => setSelected(new Set(networks.map((n) => n.id)))}>
                  all
                </button>
                <button className="text-slate-400 hover:underline" onClick={() => setSelected(new Set())}>
                  none
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {networks.map((n) => (
                <label
                  key={n.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${
                    selected.has(n.id) ? "border-amber-500 bg-amber-500/5" : "border-[#1b5540] bg-[#0a3a28]/40"
                  }`}
                >
                  <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} className="accent-amber-500" />
                  <span className="flex-1 truncate text-slate-200">{n.name}</span>
                </label>
              ))}
            </div>

            <button
              onClick={() => void doExport()}
              disabled={busy || selected.size === 0}
              className="mt-4 w-full rounded-lg bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-500 disabled:opacity-40"
            >
              {busy ? (job?.status === "queued" ? "Queued…" : "Exporting…") : `Export ${selected.size} network${selected.size === 1 ? "" : "s"}`}
            </button>

            {busy && (
              <div className="mt-3" aria-live="polite">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                  <span className="truncate">{job?.label ?? (job?.status === "queued" ? "Waiting for a worker…" : "Starting…")}</span>
                  <span className="ml-3 tabular-nums">{job?.progress ?? 0}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#0a3a28]">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-[width] duration-300"
                    style={{ width: `${Math.max(3, job?.progress ?? 0)}%` }}
                  />
                </div>
              </div>
            )}

            {results.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Exports</h2>
                  <a href={downloadAllUrl(activeId)} download className="text-xs text-amber-400 hover:underline">
                    Download all (.zip)
                  </a>
                </div>
                <div className="grid gap-2">
                  {results.map((r) => (
                    <ResultCard key={r.network} creativeId={activeId} r={r} active={preview === r.network} onPreview={setPreview} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-8">
            <DevicePreview src={activeId && preview ? previewUrl(activeId, preview) : null} label={previewLabel} />
          </div>
        </div>
      )}
    </div>
  );
}
