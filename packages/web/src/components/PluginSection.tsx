import { useEffect, useState } from "react";
import { downloadPlugin, getPluginRelease, myPluginDownloads } from "../api";
import type { PluginDownload, PluginRelease } from "../types";

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5";

/** Settings ▸ Unity plugin: the current release, a licensed download, and the user's past downloads. */
export function PluginSection() {
  const [rel, setRel] = useState<PluginRelease | null>(null);
  const [downloads, setDownloads] = useState<PluginDownload[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadDownloads = () => myPluginDownloads().then(setDownloads).catch(() => {});
  useEffect(() => {
    getPluginRelease().then(setRel).catch(() => {});
    void loadDownloads();
  }, []);

  async function download() {
    setBusy(true);
    setMsg(null);
    try {
      const wm = await downloadPlugin();
      setMsg({ ok: true, text: `Downloaded${wm ? `, licence ${wm}` : ""}. In Unity: Assets ▸ Import Package ▸ Custom Package…` });
      void loadDownloads();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${panel} mt-5`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">Unity plugin</h2>
          <p className="mt-1 text-sm text-slate-300">
            {rel ? (
              <>
                Version <span className="font-semibold text-slate-100">{rel.version}</span> for Unity {rel.unity}+
                {rel.releasedAt && <span className="text-slate-500"> · released {rel.releasedAt}</span>}
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        <button onClick={() => void download()} disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
          {busy ? "Preparing…" : "Download .unitypackage"}
        </button>
      </div>

      {rel && rel.notes.length > 0 && (
        <ul className="mb-3 list-disc space-y-0.5 pl-5 text-sm text-slate-300">
          {rel.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-400">
        Each download is licensed to you and carries a licence code. Import it into your project, then open <span className="text-slate-200">Factorial AdLab ▸ Playable Builder</span>.
        The plugin checks for updates itself and can update in place. Don't share your copy: every request it makes is traced back to its licence.
      </p>
      {msg && <div className={`mt-3 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</div>}

      {downloads.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-2 pr-3">Licence</th>
                <th className="pb-2 pr-3">Version</th>
                <th className="pb-2 pr-3">Downloaded</th>
                <th className="pb-2">Last used</th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((d) => (
                <tr key={d.id} className="border-t border-[#1b5540]/60">
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-200">
                    {d.wm}
                    {d.banned && <span className="ml-2 rounded bg-red-500/20 px-1.5 font-sans text-[10px] text-red-300">revoked</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-300">{d.version}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-400">{new Date(d.createdAt).toLocaleString()}</td>
                  <td className="py-1.5 text-xs text-slate-400">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
