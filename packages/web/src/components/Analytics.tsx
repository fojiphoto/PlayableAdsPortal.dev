import { useEffect, useState } from "react";
import { getAnalytics, setAnalyticsTracking } from "../api";
import type { Analytics as AnalyticsData, Funnel } from "../types";

const WINDOWS = [7, 30, 90] as const;

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [includePreview, setIncludePreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAnalytics(days, includePreview)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [days, includePreview]);

  async function toggleTracking() {
    if (!data) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await setAnalyticsTracking(!data.tracking.enabled);
      setData({ ...data, tracking: { enabled: r.enabled } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !data) return <div className="text-sm text-red-400">{err}</div>;
  if (!data) return <div className="text-sm text-slate-400">Loading…</div>;

  const p = data.playable;
  const maxDaily = Math.max(1, ...p.daily.map((d) => d.impressions));
  const first = p.daily[0]?.date.slice(5);
  const last = p.daily[p.daily.length - 1]?.date.slice(5);
  const maxExportDaily = Math.max(1, ...data.daily.map((d) => d.count));
  const maxExportNet = Math.max(1, ...data.byNetwork.map((n) => n.count));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-100">Analytics</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex overflow-hidden rounded-lg border border-[#1b5540]">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={`px-3 py-1.5 ${days === w ? "bg-amber-500/20 text-amber-200" : "text-slate-400 hover:text-slate-200"}`}
              >
                {w}d
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-slate-400">
            <input type="checkbox" checked={includePreview} onChange={(e) => setIncludePreview(e.target.checked)} className="accent-amber-500" />
            include device-preview plays
          </label>
        </div>
      </div>

      {err && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{err}</div>}

      {/* ── in-playable funnel ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Impressions" value={fmt(p.impressions)} hint="unique plays" />
        <Tile label="Engagement rate" value={pct(p.engageRate)} hint={`${fmt(p.engagements)} touched the ad`} />
        <Tile label="CTR" value={pct(p.ctr)} hint={`${fmt(p.ctaClicks)} store clicks`} />
        <Tile label="Completion" value={pct(p.completionRate)} hint={`${fmt(p.completes)} finished`} />
      </div>

      <section className="mb-6 rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">Plays · last {days} days</h2>
          <span className="text-[11px] text-slate-400">
            <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-500/80" />
            impressions
            <i className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-[#a3d977]" />
            CTA clicks
          </span>
        </div>
        {p.impressions === 0 ? (
          <EmptyPlayable enabled={data.tracking.enabled} />
        ) : (
          <>
            <div className="flex h-40 items-end gap-[3px]">
              {p.daily.map((d) => (
                <div key={d.date} className="group relative flex flex-1 items-end gap-px" title={`${d.date}: ${d.impressions} plays · ${d.ctaClicks} CTA`}>
                  <div
                    className="flex-1 rounded-t bg-amber-500/80 transition-all group-hover:bg-amber-400"
                    style={{ height: `${(d.impressions / maxDaily) * 100}%`, minHeight: d.impressions ? 3 : 0 }}
                  />
                  <div
                    className="flex-1 rounded-t bg-[#a3d977]"
                    style={{ height: `${(d.ctaClicks / maxDaily) * 100}%`, minHeight: d.ctaClicks ? 3 : 0 }}
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

      {p.impressions > 0 && (
        <section className="mb-6 rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-amber-400">Funnel</h2>
          <FunnelBars f={p} />
        </section>
      )}

      {p.byNetwork.length > 0 && (
        <section className="mb-6 rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-amber-400">Performance by network</h2>
          <FunnelTable
            rows={p.byNetwork.map((n) => ({ key: n.network, label: n.networkName, f: n }))}
          />
        </section>
      )}

      {p.byCreative.length > 0 && (
        <section className="mb-6 rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-amber-400">Performance by creative</h2>
          <FunnelTable
            rows={p.byCreative.map((c) => ({ key: c.creativeId, label: c.creative, sub: `${c.app} › ${c.concept}`, f: c }))}
          />
        </section>
      )}

      {p.customEvents.length > 0 && (
        <section className="mb-6 rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-amber-400">Custom events</h2>
          <p className="mb-4 text-xs text-slate-400">
            From <code className="text-slate-300">PF.analytics.logEvent("name")</code> / Unity <code className="text-slate-300">Analytics.LogEvent("name")</code>.
          </p>
          <div className="grid gap-1.5 text-sm">
            {p.customEvents.map((e) => (
              <div key={e.name} className="flex items-center justify-between rounded-lg bg-[#06281c]/60 px-3 py-1.5">
                <span className="truncate text-slate-200">{e.name}</span>
                <span className="ml-3 shrink-0 tabular-nums text-slate-400">
                  {fmt(e.hits)} <span className="text-slate-500">· {fmt(e.sessions)} plays</span>
                  {e.total != null && e.total !== 0 && <span className="text-slate-500"> · Σ {Number(e.total).toLocaleString()}</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── tracking setting ── */}
      <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5 text-sm">
        <div>
          <div className="font-medium text-slate-200">
            In-playable tracking: <span className={data.tracking.enabled ? "text-[#a3d977]" : "text-slate-400"}>{data.tracking.enabled ? "on" : "off"}</span>
          </div>
          <p className="mt-1 max-w-xl text-xs text-slate-400">
            Exports embed a tiny beacon for impressions, first touch, game start/end and store clicks (one request per step, per play).
            Automatically left out of Meta, Google Ads, DV360, Mintegral and TikTok/Pangle packages, whose specs forbid outbound requests.
            Applies to future exports.
          </p>
        </div>
        <button
          onClick={() => void toggleTracking()}
          disabled={busy}
          className="rounded-lg border border-[#1f6b4a] px-3 py-1.5 text-xs text-slate-200 hover:border-[#7cb342] disabled:opacity-50"
        >
          {busy ? "…" : data.tracking.enabled ? "Turn off" : "Turn on"}
        </button>
      </section>

      {/* ── export usage (billing) ── */}
      <section className="rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-amber-400">Export usage</h2>
        <div className="mb-4 grid grid-cols-3 gap-4">
          <Tile label="Exports · all time" value={fmt(data.total)} />
          <Tile label="Exports · last 30 days" value={fmt(data.last30)} />
          <Tile label="Networks used" value={fmt(data.byNetwork.length)} />
        </div>
        {data.total === 0 ? (
          <p className="text-sm text-slate-400">No exports yet — export a playable to see it here.</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="flex h-24 items-end gap-[2px]">
                {data.daily.map((d) => (
                  <div key={d.date} className="group relative flex-1" title={`${d.date}: ${d.count}`}>
                    <div
                      className="w-full rounded-t bg-amber-500/60 group-hover:bg-amber-400"
                      style={{ height: `${(d.count / maxExportDaily) * 100}%`, minHeight: d.count ? 3 : 0 }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-slate-400">exports per day · last 30 days</div>
            </div>
            <div className="grid content-start gap-1.5">
              {data.byNetwork.slice(0, 8).map((n) => (
                <div key={n.network} className="flex items-center gap-3 text-xs">
                  <span className="w-28 shrink-0 truncate text-slate-300">{n.networkName}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-[#06281c]">
                    <div className="h-full rounded" style={{ width: `${(n.count / maxExportNet) * 100}%`, background: "linear-gradient(90deg,#7cb342,#a3d977)" }} />
                  </div>
                  <span className="w-6 text-right tabular-nums text-slate-400">{n.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString();
const pct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-4">
      <div className="text-3xl text-amber-400" style={{ fontFamily: "Bungee, sans-serif" }}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function EmptyPlayable({ enabled }: { enabled: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-[#1f6b4a] p-5 text-sm text-slate-400">
      <p className="text-slate-300">No plays recorded yet.</p>
      <p className="mt-1 text-xs">
        {enabled
          ? "Export a creative and run it on a network (or tick “include device-preview plays” to see your own test plays). Packages built before tracking was on don’t report."
          : "In-playable tracking is off — turn it on below and re-export to start collecting impressions, engagement and store clicks."}
      </p>
    </div>
  );
}

function FunnelBars({ f }: { f: Funnel }) {
  const steps: { label: string; n: number }[] = [
    { label: "Impressions", n: f.impressions },
    { label: "Engaged (first touch)", n: f.engagements },
    { label: "Started playing", n: f.starts },
    { label: "Completed", n: f.completes },
    { label: "Clicked install", n: f.ctaClicks },
  ];
  const max = Math.max(1, f.impressions);
  return (
    <div className="grid gap-2">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate text-slate-300">{s.label}</span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-[#06281c]">
            <div className="h-full rounded" style={{ width: `${(s.n / max) * 100}%`, background: "linear-gradient(90deg,#f59e0b,#a3d977)" }} />
          </div>
          <span className="w-24 shrink-0 text-right tabular-nums text-slate-400">
            {fmt(s.n)} <span className="text-slate-500">({pct(f.impressions ? (s.n / f.impressions) * 100 : 0)})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function FunnelTable({ rows }: { rows: { key: string; label: string; sub?: string; f: Funnel }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="pb-2 pr-3 font-medium">Name</th>
            <th className="pb-2 pr-3 text-right font-medium">Plays</th>
            <th className="pb-2 pr-3 text-right font-medium">Engaged</th>
            <th className="pb-2 pr-3 text-right font-medium">Completed</th>
            <th className="pb-2 pr-3 text-right font-medium">CTA</th>
            <th className="pb-2 text-right font-medium">CTR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[#1b5540]/60">
              <td className="py-2 pr-3">
                <div className="truncate text-slate-200">{r.label}</div>
                {r.sub && <div className="truncate text-[11px] text-slate-500">{r.sub}</div>}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{fmt(r.f.impressions)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-300">
                {fmt(r.f.engagements)} <span className="text-slate-500">· {pct(r.f.engageRate)}</span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-300">
                {fmt(r.f.completes)} <span className="text-slate-500">· {pct(r.f.completionRate)}</span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{fmt(r.f.ctaClicks)}</td>
              <td className="py-2 text-right tabular-nums text-amber-300">{pct(r.f.ctr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
