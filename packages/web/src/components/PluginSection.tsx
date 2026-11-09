import { useEffect, useState } from "react";
import { downloadPlugin, getPluginRelease, myPluginDownloads } from "../api";
import type { PluginDownload, PluginRelease } from "../types";
import { Icon } from "./icons";
import { Msg } from "./pageKit";

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
    <section className="pg-card">
      <div className="pg-card-head" style={{ alignItems: "flex-start" }}>
        <div className="min-w-0 flex-[1_1_280px]">
          <h2 className="pg-h">Unity plugin</h2>
          <p className="pg-p" style={{ margin: "4px 0 0" }}>
            {rel ? (
              <>
                Version <b className="font-semibold text-text">{rel.version}</b> · .unitypackage · Unity {rel.unity} or newer
                {rel.releasedAt && <span className="text-text-3"> · released {rel.releasedAt}</span>}
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        <button onClick={() => void download()} disabled={busy} className="pg-btn pg-btn-primary">
          <Icon.Download />
          {busy ? "Preparing your copy…" : "Download plugin"}
        </button>
      </div>

      {rel && rel.notes.length > 0 && (
        <ul className="docs-list" style={{ marginBottom: 12 }}>
          {rel.notes.map((n) => (
            <li key={n} style={{ fontSize: 14 }}>
              <span className="docs-bullet">
                <Icon.Check />
              </span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="pg-hint" style={{ marginTop: 0 }}>
        Each download is licensed to you and carries a licence code. Import it into your project, then open <b className="font-semibold text-text-2">Factorial AdLab ▸ Playable Builder</b>.
        The plugin checks for updates itself and can update in place. Don't share your copy: every request it makes is traced back to its licence.
      </p>
      {msg && (
        <div className="mt-3">
          <Msg kind={msg.ok ? "success" : "err"}>{msg.text}</Msg>
        </div>
      )}

      {downloads.length > 0 && (
        <div className="pg-tablewrap mt-4">
          <table className="pg-table">
            <thead>
              <tr>
                <th>Licence</th>
                <th>Version</th>
                <th>Downloaded</th>
                <th>Last used</th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono text-xs">
                    {d.wm}
                    {d.banned && <span className="pg-tag err ml-2 font-sans">revoked</span>}
                  </td>
                  <td>{d.version}</td>
                  <td className="dim">{new Date(d.createdAt).toLocaleString()}</td>
                  <td className="dim">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
