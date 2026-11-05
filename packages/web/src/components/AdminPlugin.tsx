import { useEffect, useState, type FormEvent } from "react";
import { adminBanPlugin, adminLiftPluginBan, adminPluginBans, adminPluginDownloads } from "../api";
import type { AdminPluginDownload, PluginBan } from "../types";

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5";
const input = "rounded-lg border border-[#1f6b4a] bg-[#06281c] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500";
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "never");

/** Admin ▸ Plugin: every licensed download with who uses it (leak tracing), and download/user bans. */
export function AdminPlugin() {
  const [q, setQ] = useState("");
  const [shared, setShared] = useState(false);
  const [rows, setRows] = useState<AdminPluginDownload[]>([]);
  const [bans, setBans] = useState<PluginBan[]>([]);
  const [showLifted, setShowLifted] = useState(false);
  const [userTarget, setUserTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    adminPluginDownloads(q, shared).then(setRows).catch((e) => setErr((e as Error).message));
    adminPluginBans(showLifted).then(setBans).catch(() => {});
  };
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, shared, showLifted]);

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  function banDownload(d: AdminPluginDownload) {
    const reason = window.prompt(`Revoke licence ${d.wm} (${d.email})? Reason (optional):`);
    if (reason === null) return;
    void run(() => adminBanPlugin("download", d.id, reason || undefined));
  }
  function banUser(e: FormEvent) {
    e.preventDefault();
    if (!userTarget.trim()) return;
    const reason = window.prompt(`Ban ${userTarget.trim()} from the plugin? Reason (optional):`);
    if (reason === null) return;
    void run(async () => {
      await adminBanPlugin("user", userTarget.trim(), reason || undefined);
      setUserTarget("");
    });
  }

  return (
    <div className="grid min-w-0 gap-6">
      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{err}</div>}

      <section className={`${panel} min-w-0`}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-sm font-semibold uppercase tracking-wide text-amber-400">Downloads</h2>
          <input className={`${input} w-56`} placeholder="Email or licence code" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-amber-500" />
            Used by other accounts
          </label>
        </div>
        <p className="mb-3 text-xs text-slate-400">A download used by accounts other than its owner is a shared or leaked copy. Revoking it stops every request that copy makes.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-2 pr-3">Licence</th>
                <th className="pb-2 pr-3">Owner</th>
                <th className="pb-2 pr-3">Version</th>
                <th className="pb-2 pr-3">Downloaded</th>
                <th className="pb-2 pr-3">Accounts</th>
                <th className="pb-2 pr-3">Requests</th>
                <th className="pb-2 pr-3">Last used</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3 text-slate-500">
                    No downloads{q || shared ? " match" : " yet"}.
                  </td>
                </tr>
              )}
              {rows.map((d) => (
                <tr key={d.id} className="border-t border-[#1b5540]/60">
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-200">{d.wm}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{d.email}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{d.version}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-400">{when(d.createdAt)}</td>
                  <td className={`py-1.5 pr-3 ${d.otherAccounts > 0 ? "font-semibold text-amber-300" : "text-slate-300"}`}>
                    {d.accounts}
                    {d.otherAccounts > 0 && <span className="text-xs font-normal"> ({d.otherAccounts} other)</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-300">{d.requests}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-400">{when(d.lastSeenAt)}</td>
                  <td className="py-1.5 text-right">
                    {d.banned ? (
                      <span className="rounded bg-red-500/20 px-1.5 text-[11px] text-red-300">revoked</span>
                    ) : (
                      <button onClick={() => banDownload(d)} className="text-xs text-red-400 hover:underline">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${panel} min-w-0`}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-sm font-semibold uppercase tracking-wide text-amber-400">Bans</h2>
          <form onSubmit={banUser} className="flex gap-2">
            <input className={`${input} w-56`} placeholder="Ban a user by email" value={userTarget} onChange={(e) => setUserTarget(e.target.value)} />
            <button className="rounded-lg border border-red-500/50 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10">Ban user</button>
          </form>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={showLifted} onChange={(e) => setShowLifted(e.target.checked)} className="accent-amber-500" />
            Show lifted
          </label>
        </div>
        <p className="mb-3 text-xs text-slate-400">A banned user can't download the plugin and every plugin request they make is refused. The website itself keeps working for them.</p>
        {bans.length === 0 ? (
          <div className="text-sm text-slate-500">No active bans.</div>
        ) : (
          <div className="grid gap-2">
            {bans.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[#1b5540] px-3 py-2 text-sm">
                <span className="rounded bg-[#123f2d] px-1.5 text-[11px] uppercase text-slate-300">{b.scope}</span>
                <span className="text-slate-100">{b.targetLabel ?? b.target}</span>
                {b.reason && <span className="text-xs text-slate-400">“{b.reason}”</span>}
                <span className="ml-auto text-xs text-slate-500">{when(b.createdAt)}</span>
                {b.liftedAt ? (
                  <span className="text-xs text-slate-500">lifted {when(b.liftedAt)}</span>
                ) : (
                  <button onClick={() => void run(() => adminLiftPluginBan(b.id))} className="text-xs text-amber-400 hover:underline">
                    Lift
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
