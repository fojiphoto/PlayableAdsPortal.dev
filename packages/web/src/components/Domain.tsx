import { useEffect, useState } from "react";
import { getDomain, setDomain as apiSetDomain, checkDomain } from "../api";
import type { DomainStatus } from "../types";

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5";
const input = "w-full rounded-lg border border-[#1f6b4a] bg-[#0a3a28] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";

export function Domain() {
  const [st, setSt] = useState<DomainStatus | null>(null);
  const [domain, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getDomain()
      .then((d) => {
        setSt(d);
        if (d.domain) setDomainInput(d.domain);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      setSt(await apiSetDomain(domain));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await checkDomain();
      setSt((s) => (s ? { ...s, verified: r.verified } : s));
      setMsg(
        r.verified
          ? { ok: true, text: "Verified! Your domain ownership is confirmed." }
          : { ok: false, text: "Not found yet — DNS / the file can take a few minutes to propagate. Try again shortly." },
      );
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const code = "rounded bg-[#06281c] px-2 py-1 text-xs text-amber-300 break-all";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-100">Verify your domain</h1>
        {st?.token &&
          (st.verified ? (
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">✓ Verified</span>
          ) : (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">Not verified</span>
          ))}
      </div>

      <section className={`${panel} mb-5`}>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Company domain</label>
        <div className="flex gap-2">
          <input className={input} value={domain} onChange={(e) => setDomainInput(e.target.value)} placeholder="factorialstudio.dev" />
          <button onClick={save} disabled={busy || !domain.trim()} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
            Save
          </button>
        </div>
      </section>

      {st?.token && (
        <section className={panel}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-400">Prove ownership — do either one</h2>
          <ol className="grid gap-4 text-sm text-slate-300">
            <li>
              <b className="text-slate-100">1. Verification file</b>
              <p className="mt-1 text-slate-400">
                Create <code className={code}>https://{st.domain}/{st.verifyFile}</code> containing only:
              </p>
              <code className={`${code} mt-1 block`}>{st.token}</code>
            </li>
            <li>
              <b className="text-slate-100">2. Or add a line to app-ads.txt</b>
              <p className="mt-1 text-slate-400">
                Add this comment to <code className={code}>https://{st.domain}/app-ads.txt</code> (a line starting with <code className="text-amber-300">#</code> is ignored by ad networks):
              </p>
              <code className={`${code} mt-1 block`}># {st.token}</code>
            </li>
          </ol>

          {msg && <div className={`mt-4 text-sm ${msg.ok ? "text-emerald-400" : "text-amber-400"}`}>{msg.text}</div>}

          <button onClick={check} disabled={busy} className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
            {busy ? "Checking…" : "Check now"}
          </button>
        </section>
      )}
    </div>
  );
}
