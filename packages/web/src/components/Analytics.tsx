import { useEffect, useState } from "react";
import { getAnalytics } from "../api";
import type { Analytics as AnalyticsData } from "../types";

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getAnalytics()
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <div className="text-sm text-red-400">{err}</div>;
  if (!data) return <div className="text-sm text-slate-400">Loading…</div>;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.count));
  const maxNet = Math.max(1, ...data.byNetwork.map((n) => n.count));
  const first = data.daily[0]?.date.slice(5);
  const last = data.daily[data.daily.length - 1]?.date.slice(5);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-semibold text-slate-100">Analytics</h1>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Tile label="Exports · all time" value={data.total} />
        <Tile label="Exports · last 30 days" value={data.last30} />
        <Tile label="Networks used" value={data.byNetwork.length} />
      </div>

      <section className="mb-6 rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-amber-400">Exports · last 30 days</h2>
        {data.total === 0 ? (
          <p className="text-sm text-slate-400">No exports yet — export a playable to see it here.</p>
        ) : (
          <>
            <div className="flex h-36 items-end gap-[3px]">
              {data.daily.map((d) => (
                <div key={d.date} className="group relative flex-1" title={`${d.date}: ${d.count}`}>
                  <div
                    className="w-full rounded-t bg-amber-500/80 transition-all group-hover:bg-amber-400"
                    style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: d.count ? 3 : 0 }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-slate-400">
              <span>{first}</span>
              <span>{last}</span>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-amber-400">By network</h2>
        {data.byNetwork.length === 0 ? (
          <p className="text-sm text-slate-400">No exports yet.</p>
        ) : (
          <div className="grid gap-2">
            {data.byNetwork.map((n) => (
              <div key={n.network} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 truncate text-slate-300">{n.networkName}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-[#06281c]">
                  <div className="h-full rounded" style={{ width: `${(n.count / maxNet) * 100}%`, background: "linear-gradient(90deg,#7cb342,#a3d977)" }} />
                </div>
                <span className="w-8 text-right tabular-nums text-slate-400">{n.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-4">
      <div className="text-3xl text-amber-400" style={{ fontFamily: "Bungee, sans-serif" }}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}
