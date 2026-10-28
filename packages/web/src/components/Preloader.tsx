import { useEffect, useRef, useState } from "react";
import { getPreloader, savePreloader } from "../api";

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5";
const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500";

export function Preloader() {
  const [enabled, setEnabled] = useState(false);
  const [bg, setBg] = useState("#0b1220");
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [newLogo, setNewLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPreloader()
      .then((p) => {
        setEnabled(p.enabled);
        if (p.bg) setBg(p.bg);
        setLogoUri(p.logoDataUri);
      })
      .catch(() => {});
  }, []);

  function pickLogo(f: File | undefined) {
    if (!f) return;
    setNewLogo(f);
    setRemoveLogo(false);
    const r = new FileReader();
    r.onload = () => setLogoUri(String(r.result));
    r.readAsDataURL(f);
  }
  function clearLogo() {
    setNewLogo(null);
    setRemoveLogo(true);
    setLogoUri(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const p = await savePreloader({ enabled, bg, logo: newLogo, removeLogo });
      setLogoUri(p.logoDataUri);
      setNewLogo(null);
      setRemoveLogo(false);
      setMsg({ ok: true, text: "Saved — applied to your next exports." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-semibold text-slate-100">Customize preloader</h1>
      <p className="mb-6 text-sm text-slate-400">A loading screen with your logo, shown over the playable while it loads.</p>

      <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
        {/* controls */}
        <div className={panel}>
          <label className="mb-4 flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-amber-500" />
            Enable custom preloader on exports
          </label>

          <label className={label}>Logo / splash image</label>
          <div className="mb-4 flex items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => pickLogo(e.target.files?.[0])} className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-[#123f2d] file:px-3 file:py-1.5 file:text-slate-100" />
            {logoUri && (
              <button onClick={clearLogo} className="text-xs text-red-400 hover:underline">
                Remove
              </button>
            )}
          </div>

          <label className={label}>Background color</label>
          <div className="flex items-center gap-3">
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-[#1f6b4a] bg-transparent" />
            <input value={bg} onChange={(e) => setBg(e.target.value)} className="w-32 rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500" />
          </div>

          {msg && <div className={`mt-4 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</div>}

          <button onClick={save} disabled={busy} className="mt-5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
            {busy ? "Saving…" : "Save preloader"}
          </button>
        </div>

        {/* live preview */}
        <div className="flex flex-col items-center">
          <span className="mb-3 text-sm text-slate-400">Preview</span>
          <div className="overflow-hidden rounded-[2rem] border-[10px] border-[#1b5540] bg-black shadow-2xl" style={{ width: 240, height: 420 }}>
            <div className="flex h-full w-full flex-col items-center justify-center gap-5" style={{ background: bg }}>
              {logoUri ? (
                <img src={logoUri} alt="logo" style={{ maxWidth: "60%", maxHeight: "34%", objectFit: "contain" }} />
              ) : (
                <span className="text-xs text-white/50">your logo</span>
              )}
              <div style={{ width: 30, height: 30, border: "3px solid rgba(255,255,255,.25)", borderTopColor: "#fff", borderRadius: "50%", animation: "pfspin .8s linear infinite" }} />
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes pfspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
