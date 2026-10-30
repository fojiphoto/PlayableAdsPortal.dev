import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { uploadCreative, compileUnityBuild, waitForJob } from "../api";
import type { CompileJobResult, CreativeSummary, Job } from "../types";

type Mode = "html" | "unity";

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

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* source switch */}
      <div className="mb-4 flex overflow-hidden rounded-lg border border-[#1b5540] text-sm">
        {(
          [
            ["html", "HTML5 playable"],
            ["unity", "Unity WebGL build"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setFile(null);
              setErr(null);
            }}
            className={`flex-1 px-3 py-2 ${mode === m ? "bg-amber-500/20 text-amber-200" : "text-slate-400 hover:text-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
          drag ? "border-amber-400 bg-amber-500/10" : "border-[#1f6b4a] hover:border-[#7cb342]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={mode === "unity" ? ".zip" : ".zip,.html,.htm"}
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <div className="text-slate-300">
          {file ? (
            <span className="font-medium text-amber-300">{file.name}</span>
          ) : mode === "unity" ? (
            <>
              <div className="text-lg font-medium">Drop a zipped Unity WebGL build</div>
              <div className="mt-1 text-sm text-slate-400">
                File ▸ Build Settings ▸ WebGL, then zip the output folder (index.html + Build/). We compile it into one self-contained
                playable and tell you what to shrink.
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-medium">Drop an HTML5 playable</div>
              <div className="text-sm text-slate-400 mt-1">.zip (folder) or a single .html — or click to browse</div>
            </>
          )}
        </div>
      </div>

      {mode === "unity" && (
        <p className="mt-2 text-[11px] text-slate-500">
          Tip: Publishing Settings ▸ Compression Format = Disabled, Managed Stripping = High, Exceptions = None. Network caps are 2–5 MB, so
          this suits light games; the Unity plugin does these settings for you.
        </p>
      )}

      <div className="mt-4 grid gap-3">
        <Field label="Creative name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="my_creative" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="iOS App Store URL">
            <input className={inputCls} value={iosUrl} onChange={(e) => setIos(e.target.value)} placeholder="https://apps.apple.com/…" />
          </Field>
          <Field label="Google Play URL">
            <input className={inputCls} value={androidUrl} onChange={(e) => setAndroid(e.target.value)} placeholder="https://play.google.com/…" />
          </Field>
        </div>
      </div>

      {err && <div className="mt-3 text-sm text-red-400">{err}</div>}

      <button
        onClick={submit}
        disabled={busy || !file}
        className="mt-5 w-full rounded-lg bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? (mode === "unity" ? (job ? "Compiling…" : "Uploading…") : "Uploading…") : mode === "unity" ? "Compile playable" : "Upload playable"}
      </button>

      {busy && mode === "unity" && (
        <div className="mt-3" aria-live="polite">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span className="truncate">{job?.label ?? (job?.status === "queued" ? "Waiting for a worker…" : "Uploading the build…")}</span>
            <span className="ml-3 tabular-nums">{job?.progress ?? 0}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#0a3a28]">
            <div className="h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${Math.max(3, job?.progress ?? 0)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

function CompileSummary({ r, onOpen, onAgain }: { r: CompileJobResult; onOpen: () => void; onAgain: () => void }) {
  const parts: { label: string; n: number; color: string }[] = [
    { label: "Code (.wasm)", n: r.breakdown.wasm, color: "#f59e0b" },
    { label: "Assets (.data)", n: r.breakdown.data, color: "#a3d977" },
    { label: "Framework", n: r.breakdown.framework, color: "#60a5fa" },
    { label: "Loader", n: r.breakdown.loader, color: "#c084fc" },
    ...(r.breakdown.streamingAssets ? [{ label: "StreamingAssets", n: r.breakdown.streamingAssets, color: "#f472b6" }] : []),
  ];
  const total = Math.max(1, r.breakdown.totalRaw);
  const over = r.fitsNetworks.length === 0;
  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-400">Compiled</div>
        <div className="text-2xl text-slate-100" style={{ fontFamily: "Bungee, sans-serif" }}>
          {fmtBytes(r.sizeBytes)}
        </div>
        <div className={`mt-1 text-sm ${over ? "text-red-300" : "text-slate-300"}`}>
          {over ? "Above every network's size cap." : `Fits ${r.fitsNetworks.length} network${r.fitsNetworks.length === 1 ? "" : "s"}.`}
          {r.unityVersion && <span className="text-slate-500"> · Unity {r.unityVersion}</span>}
        </div>

        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#06281c]">
          {parts.map((p) => (
            <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} title={`${p.label}: ${fmtBytes(p.n)}`} />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
          {parts.map((p) => (
            <div key={p.label} className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
                {p.label}
              </span>
              <span className="tabular-nums text-slate-300">{fmtBytes(p.n)}</span>
            </div>
          ))}
        </div>

        {r.warnings.length > 0 && (
          <ul className="mt-4 grid gap-1.5 text-xs text-slate-300">
            {r.warnings.map((w, i) => (
              <li key={i} className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5">
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={onOpen} className="flex-1 rounded-lg bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-500">
          Open creative → export
        </button>
        <button onClick={onAgain} className="rounded-lg border border-[#1f6b4a] px-4 py-2.5 text-sm text-slate-300 hover:border-[#7cb342]">
          Compile another
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}
