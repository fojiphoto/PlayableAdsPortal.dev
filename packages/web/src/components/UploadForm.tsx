import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { uploadCreative } from "../api";
import type { CreativeSummary } from "../types";

export function UploadForm({
  conceptId,
  onUploaded,
}: {
  conceptId: string;
  onUploaded: (c: CreativeSummary) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [iosUrl, setIos] = useState("");
  const [androidUrl, setAndroid] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  }

  async function submit() {
    if (!file) {
      setErr("Choose a .zip or .html playable first");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const c = await uploadCreative(conceptId, file, {
        name: name || undefined,
        iosUrl: iosUrl || undefined,
        androidUrl: androidUrl || undefined,
      });
      onUploaded(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto">
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
          accept=".zip,.html,.htm"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <div className="text-slate-300">
          {file ? (
            <span className="font-medium text-amber-300">{file.name}</span>
          ) : (
            <>
              <div className="text-lg font-medium">Drop an HTML5 playable</div>
              <div className="text-sm text-slate-500 mt-1">.zip (folder) or a single .html — or click to browse</div>
            </>
          )}
        </div>
      </div>

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
        {busy ? "Uploading…" : "Upload playable"}
      </button>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
