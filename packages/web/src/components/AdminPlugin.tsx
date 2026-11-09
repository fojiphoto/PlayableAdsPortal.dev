import { useEffect, useState, type FormEvent } from "react";
import { adminBanPlugin, adminLiftPluginBan, adminPluginBans, adminPluginDownloads } from "../api";
import type { AdminPluginDownload, PluginBan } from "../types";
import { Msg } from "./pageKit";

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
    adminPluginDownloads(q, shared)
      .then(setRows)
      .catch((e) => setErr((e as Error).message));
    adminPluginBans(showLifted)
      .then(setBans)
      .catch(() => {});
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
    <div className="pg-stack">
      {err && <Msg kind="err">{err}</Msg>}

      <section className="pg-card">
        <div className="pg-card-head" style={{ alignItems: "center" }}>
          <h2 className="pg-h">Downloads</h2>
          <div className="flex flex-wrap items-center gap-3">
            <input className="pg-input sm w-56 max-w-full" placeholder="Email or licence code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search downloads" />
            <label className="pg-checkrow text-[13px]">
              <input type="checkbox" className="pg-check" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Used by other accounts
            </label>
          </div>
        </div>
        <p className="pg-hint" style={{ margin: "0 0 14px" }}>
          A download used by accounts other than its owner is a shared or leaked copy. Revoking it stops every request that copy makes.
        </p>
        <div className="pg-tablewrap">
          <table className="pg-table">
            <thead>
              <tr>
                <th>Licence</th>
                <th>Owner</th>
                <th>Version</th>
                <th>Downloaded</th>
                <th className="r">Accounts</th>
                <th className="r">Requests</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="dim">
                    No downloads{q || shared ? " match" : " yet"}.
                  </td>
                </tr>
              )}
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono text-xs">{d.wm}</td>
                  <td>{d.email}</td>
                  <td>{d.version}</td>
                  <td className="dim">{when(d.createdAt)}</td>
                  <td className="r" style={d.otherAccounts > 0 ? { color: "#92400e", fontWeight: 700 } : undefined}>
                    {d.accounts}
                    {d.otherAccounts > 0 && <span className="font-normal"> ({d.otherAccounts} other)</span>}
                  </td>
                  <td className="r">{d.requests}</td>
                  <td className="dim">{when(d.lastSeenAt)}</td>
                  <td className="r">
                    {d.banned ? (
                      <span className="pg-tag err">revoked</span>
                    ) : (
                      <button onClick={() => banDownload(d)} className="pg-link danger text-[13px]">
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

      <section className="pg-card">
        <div className="pg-card-head" style={{ alignItems: "center" }}>
          <h2 className="pg-h">Bans</h2>
          <label className="pg-checkrow text-[13px]">
            <input type="checkbox" className="pg-check" checked={showLifted} onChange={(e) => setShowLifted(e.target.checked)} />
            Show lifted
          </label>
        </div>
        <form onSubmit={banUser} className="mb-3 flex flex-wrap gap-2">
          <input className="pg-input min-w-[200px] flex-1" placeholder="Ban a user by email" value={userTarget} onChange={(e) => setUserTarget(e.target.value)} aria-label="Email to ban" />
          <button className="pg-btn pg-btn-danger">Ban user</button>
        </form>
        <p className="pg-hint" style={{ margin: "0 0 14px" }}>
          A banned user can't download the plugin and every plugin request they make is refused. The website itself keeps working for them.
        </p>
        {bans.length === 0 ? (
          <p className="pg-p" style={{ margin: 0 }}>
            No active bans.
          </p>
        ) : (
          <div className="grid gap-2">
            {bans.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line px-3 py-2.5 text-[14px]">
                <span className="pg-tag">{b.scope}</span>
                <span className="min-w-0 font-medium text-text" style={{ overflowWrap: "anywhere" }}>
                  {b.targetLabel ?? b.target}
                </span>
                {b.reason && <span className="text-[13px] text-text-3">“{b.reason}”</span>}
                <span className="ml-auto text-[12px] text-text-3">{when(b.createdAt)}</span>
                {b.liftedAt ? (
                  <span className="text-[12px] text-text-3">lifted {when(b.liftedAt)}</span>
                ) : (
                  <button onClick={() => void run(() => adminLiftPluginBan(b.id))} className="pg-link text-[13px]">
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
