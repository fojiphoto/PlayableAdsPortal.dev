import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { uploadCreative, compileUnityBuild, waitForJob } from "../api";
import type { CompileJobResult, CreativeSummary, Job } from "../types";
import { Icon } from "./icons";

type Mode = "html" | "unity";

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** "Add a build" sheet: pick the source kind, drop the file, name it, upload (or compile a Unity build). */
export function UploadForm({
  conceptId,
  onUploaded,
}: {
  conceptId: string;
  onUploaded: (c: CreativeSummary) => void;
}) {
  const [mode, setMode] = useState<Mode>("html");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [iosUrl, setIos] = useState("");
  const [androidUrl, setAndroid] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [compiled, setCompiled] = useState<CompileJobResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setCompiled(null);
    setErr(null);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  }

  async function submit() {
    if (!file) {
      setErr(mode === "unity" ? "Choose the zipped WebGL build folder first" : "Choose a .zip or .html playable first");
      return;
    }
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const fields = { name: name || undefined, iosUrl: iosUrl || undefined, androidUrl: androidUrl || undefined };
      if (mode === "html") {
        onUploaded(await uploadCreative(conceptId, file, fields));
      } else {
        // compile job: upload → 202 → poll (the worker folds the Unity build into one HTML)
        const { jobId } = await compileUnityBuild(conceptId, file, fields);
        const done = await waitForJob(jobId, setJob);
        setCompiled(done.result as CompileJobResult);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setJob(null);
    }
  }

  if (compiled) {
    return (
      <CompileSummary
        r={compiled}
        onOpen={() =>
          onUploaded({
            id: compiled.creativeId,
            name: compiled.name,
            entry: "index.html",
            fileCount: 1,
            conceptId: compiled.conceptId,
            createdAt: new Date().toISOString(),
          } as CreativeSummary)
        }
        onAgain={() => {
          setCompiled(null);
          setFile(null);
        }}
      />
    );
  }

  const kinds = mode === "unity" ? ["WebGL build (.zip)"] : ["Folder (.zip)", "Single .html"];

  return (
    <div className="sh-sheet">
      <h2 className="sh-sheet-h">Add a build</h2>
      <p className="sh-sheet-sub">Upload a finished HTML5 playable, or a Unity WebGL build that we compile into one file.</p>

      {/* source switch */}
      <div className="sh-tabs" role="tablist" aria-label="Build type">
        {(
          [
            ["html", "HTML5 playable"],
            ["unity", "Unity WebGL build"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setFile(null);
              setErr(null);
            }}
            className={`sh-tab${mode === m ? " on" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label={file ? `Selected ${file.name}. Choose another file` : "Choose a build file"}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`sh-drop${drag ? " over" : ""}${file ? " has" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={mode === "unity" ? ".zip" : ".zip,.html,.htm"}
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {file ? (
          <div className="sh-file-row">
            <span className="sh-file-ico">
              <Icon.File />
            </span>
            <span className="sh-file-meta">
              <div className="sh-file-name">{file.name}</div>
              <div className="sh-file-sub">{fmtBytes(file.size)}</div>
            </span>
            <span className="sh-link-btn">Change</span>
          </div>
        ) : (
          <>
            <div className="sh-drop-ico">
              <Icon.Upload />
            </div>
            <div className="sh-drop-h">Drop your build here</div>
            <div className="sh-drop-p">
              or <b>browse</b> to choose a file
            </div>
            <div className="sh-drop-kinds">
              {kinds.map((k) => (
                <span key={k} className="sh-drop-kind">
                  {k}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {mode === "unity" && (
        <p className="sh-note" style={{ marginTop: 10 }}>
          File ▸ Build Settings ▸ WebGL, then zip the output folder (index.html + Build/). Use Compression Format = Disabled, Managed Stripping =
          High and Exceptions = None. Network caps are 2–5 MB, so this suits light games; the Unity plugin sets all of this for you.
        </p>
      )}

      <Field label="Creative name">
        <input className="sh-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="my_creative" />
      </Field>
      <div className="sh-grid2">
        <Field label="App Store URL (iOS)" optional>
          <input className="sh-input mono" value={iosUrl} onChange={(e) => setIos(e.target.value)} placeholder="https://apps.apple.com/…" />
        </Field>
        <Field label="Google Play URL" optional>
          <input className="sh-input mono" value={androidUrl} onChange={(e) => setAndroid(e.target.value)} placeholder="https://play.google.com/…" />
        </Field>
      </div>

      {err && (
        <div className="sh-alert err" role="alert" style={{ marginTop: 4 }}>
          <Icon.Alert />
          <span className="sh-alert-text">{err}</span>
        </div>
      )}

      <button type="button" onClick={() => void submit()} disabled={busy || !file} className="sh-btn sh-btn-primary sh-btn-block" style={{ marginTop: 8 }}>
        {busy ? (
          <>
            <span className="sh-spin" /> {mode === "unity" ? (job ? "Compiling…" : "Uploading…") : "Uploading…"}
          </>
        ) : (
          <>
            <Icon.Upload /> {mode === "unity" ? "Compile playable" : "Upload playable"}
          </>
        )}
      </button>

      {busy && mode === "unity" && (
        <div className="sh-progress" aria-live="polite">
          <div className="sh-progress-top">
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {job?.label ?? (job?.status === "queued" ? "Waiting for a worker…" : "Uploading the build…")}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{job?.progress ?? 0}%</span>
          </div>
          <div className="sh-progress-bar">
            <div style={{ width: `${Math.max(3, job?.progress ?? 0)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function CompileSummary({ r, onOpen, onAgain }: { r: CompileJobResult; onOpen: () => void; onAgain: () => void }) {
  const parts: { label: string; n: number; color: string }[] = [
    { label: "Code (.wasm)", n: r.breakdown.wasm, color: "var(--brand)" },
    { label: "Assets (.data)", n: r.breakdown.data, color: "var(--signal)" },
    { label: "Framework", n: r.breakdown.framework, color: "var(--orange)" },
    { label: "Loader", n: r.breakdown.loader, color: "var(--warn)" },
    ...(r.breakdown.streamingAssets ? [{ label: "StreamingAssets", n: r.breakdown.streamingAssets, color: "var(--brand-300)" }] : []),
  ];
  const total = Math.max(1, r.breakdown.totalRaw);
  const over = r.fitsNetworks.length === 0;
  return (
    <div className="sh-sheet">
      <div className="sh-card-t" style={{ color: "var(--brand-700)" }}>
        Compiled
      </div>
      <div className="sh-kpi">{fmtBytes(r.sizeBytes)}</div>
      <div style={{ fontSize: 13.5, marginTop: 2, color: over ? "#b91c1c" : "var(--text-2)" }}>
        {over ? "Above every network's size cap." : `Fits ${r.fitsNetworks.length} network${r.fitsNetworks.length === 1 ? "" : "s"}.`}
        {r.unityVersion && <span className="sh-dim"> · Unity {r.unityVersion}</span>}
      </div>

      <div className="sh-stack">
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} title={`${p.label}: ${fmtBytes(p.n)}`} />
        ))}
      </div>
      <div className="sh-legend">
        {parts.map((p) => (
          <div key={p.label}>
            <span>
              <i style={{ background: p.color }} />
              {p.label}
            </span>
            <b>{fmtBytes(p.n)}</b>
          </div>
        ))}
      </div>

      {r.warnings.length > 0 && (
        <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
          {r.warnings.map((w, i) => (
            <div key={i} className="sh-alert warn" style={{ margin: 0 }}>
              <Icon.Alert />
              <span className="sh-alert-text">{w}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <button type="button" onClick={onOpen} className="sh-btn sh-btn-primary" style={{ flex: 1 }}>
          Open creative <Icon.ArrowRight />
        </button>
        <button type="button" onClick={onAgain} className="sh-btn sh-btn-ghost">
          Compile another
        </button>
      </div>
    </div>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="sh-field">
      <span>
        {label} {optional && <span className="opt">(optional)</span>}
      </span>
      {children}
    </label>
  );
}
