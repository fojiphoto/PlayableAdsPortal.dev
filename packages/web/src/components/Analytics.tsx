import { useEffect, useState } from "react";
import { getAnalytics, setAnalyticsTracking } from "../api";
import type { Analytics as AnalyticsData, Funnel } from "../types";
import { Icon } from "./icons";
import { Loading, Msg, PageHead } from "./pageKit";

const WINDOWS = [7, 30, 90] as const;

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [includePreview, setIncludePreview] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getAnalytics(days, includePreview)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days, includePreview, reload]);

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

  const head = (
    <PageHead
      title="Analytics"
      sub="How your playables perform on each network: plays, engagement, completions and install taps."
      actions={
        <button className="pg-btn pg-btn-ghost" onClick={() => setReload((n) => n + 1)} disabled={loading}>
          <Icon.Refresh />
          Refresh
        </button>
      }
    />
  );

  if (err && !data)
    return (
      <div>
        {head}
        <Msg kind="err">{err}</Msg>
      </div>
    );
  if (!data)
    return (
      <div>
        {head}
        <Loading />
      </div>
    );

  const p = data.playable;
  const maxDaily = Math.max(1, ...p.daily.map((d) => d.impressions));
  const first = p.daily[0]?.date.slice(5);
  const last = p.daily[p.daily.length - 1]?.date.slice(5);
  const maxExportDaily = Math.max(1, ...data.daily.map((d) => d.count));
  const maxExportNet = Math.max(1, ...data.byNetwork.map((n) => n.count));

  return (
    <div className="mx-auto max-w-[1180px]">
      {head}

      <div className="pg-filters">
        <label>
          Period
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof WINDOWS)[number])}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                Last {w} days
              </option>
            ))}
          </select>
        </label>
        <label className="!flex-row items-center !gap-2 pb-2 !text-[13px] !font-medium !text-text-2">
          <input type="checkbox" className="pg-check" checked={includePreview} onChange={(e) => setIncludePreview(e.target.checked)} />
          Include device-preview plays
        </label>
        {loading && <span className="pb-2 text-[12.5px] text-text-3">Updating…</span>}
      </div>

      {err && <Msg kind="err">{err}</Msg>}

      {p.impressions === 0 ? (
        <EmptyPlayable enabled={data.tracking.enabled} />
      ) : (
        <div className="pg-stack">
          {/* standard events, in funnel order */}
          <section>
            <h2 className="pg-subhead">Standard events</h2>
            <FunnelSteps f={p} />
          </section>

          <section className="pg-card">
            <div className="pg-card-head">
              <h2 className="pg-h">Plays · last {days} days</h2>
              <span className="flex gap-4">
                <span className="pg-legend">
                  <i style={{ background: "var(--brand-300)" }} />
                  Impressions
                </span>
                <span className="pg-legend">
                  <i style={{ background: "var(--brand)" }} />
                  Install taps
                </span>
              </span>
            </div>
            <div className="flex h-40 items-end gap-[3px]">
              {p.daily.map((d) => (
                <div key={d.date} className="group relative flex h-full flex-1 items-end gap-px" title={`${d.date}: ${d.impressions} plays · ${d.ctaClicks} install taps`}>
                  <div className="flex-1 rounded-t-[3px] bg-brand-300 group-hover:bg-brand-400" style={{ height: `${(d.impressions / maxDaily) * 100}%`, minHeight: d.impressions ? 3 : 0 }} />
                  <div className="flex-1 rounded-t-[3px] bg-brand" style={{ height: `${(d.ctaClicks / maxDaily) * 100}%`, minHeight: d.ctaClicks ? 3 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between border-t border-line pt-1.5 text-[11px] text-text-3">
              <span>{first}</span>
              <span>{last}</span>
            </div>
          </section>

          {p.byNetwork.length > 0 && (
            <section>
              <h2 className="pg-subhead">By network</h2>
              <FunnelTable first="Network" rows={p.byNetwork.map((n) => ({ key: n.network, label: n.networkName, f: n }))} total={p} />
            </section>
          )}

          {p.byCreative.length > 0 && (
            <section>
              <h2 className="pg-subhead">By playable</h2>
              <FunnelTable first="Playable" rows={p.byCreative.map((c) => ({ key: c.creativeId, label: c.creative, sub: `${c.app} › ${c.concept}`, f: c }))} />
            </section>
          )}

          <section>
            <h2 className="pg-subhead">Custom events</h2>
            {p.customEvents.length === 0 ? (
              <div className="pg-empty" style={{ textAlign: "left" }}>
                None yet. Log one with <code className="pg-code">PF.analytics.logEvent("name")</code> or, in Unity, <code className="pg-code">Analytics.LogEvent("name")</code>.
              </div>
            ) : (
              <div className="pg-tablewrap">
                <table className="pg-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th className="r">Count</th>
                      <th className="r">Plays</th>
                      <th className="r">Value total</th>
                      <th className="r">Average value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.customEvents.map((e) => (
                      <tr key={e.name}>
                        <td className="l">{e.name}</td>
                        <td className="r">{fmt(e.hits)}</td>
                        <td className="r">{fmt(e.sessions)}</td>
                        <td className="r">{e.total != null && e.total !== 0 ? Number(e.total).toLocaleString() : "—"}</td>
                        <td className="r">{e.total != null && e.total !== 0 && e.hits ? (Number(e.total) / e.hits).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <div className="pg-stack mt-[18px]">
        {/* tracking setting */}
        <section className="pg-card flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="pg-h" style={{ margin: 0 }}>
                Analytics in exported playables
              </h2>
              <span className={`pg-tag ${data.tracking.enabled ? "ok" : ""}`}>{data.tracking.enabled ? "On" : "Off"}</span>
            </div>
            <p className="pg-hint" style={{ maxWidth: 640 }}>
              Exports carry a tiny beacon for impressions, first touch, game start and end, and install taps (one request per step, per play). It is left out of
              Meta, Google Ads, DV360, Mintegral and TikTok/Pangle packages, whose specs forbid outbound requests. Applies to future exports.
            </p>
          </div>
          <button onClick={() => void toggleTracking()} disabled={busy} className="pg-btn pg-btn-ghost">
            {busy ? "…" : data.tracking.enabled ? "Turn off" : "Turn on"}
          </button>
        </section>

        {/* export usage (billing) */}
        <section className="pg-card">
          <h2 className="pg-h">Export usage</h2>
          <div className="pg-stats mb-5">
            <Stat label="Exports · all time" value={fmt(data.total)} />
            <Stat label="Exports · last 30 days" value={fmt(data.last30)} />
            <Stat label="Networks used" value={fmt(data.byNetwork.length)} />
          </div>
          {data.total === 0 ? (
            <p className="pg-p" style={{ margin: 0 }}>
              No exports yet. Export a playable to see it here.
            </p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="min-w-0">
                <div className="flex h-24 items-end gap-[2px]">
                  {data.daily.map((d) => (
                    <div key={d.date} className="group relative h-full flex-1" title={`${d.date}: ${d.count}`}>
                      <div className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-brand-300 group-hover:bg-brand" style={{ height: `${(d.count / maxExportDaily) * 100}%`, minHeight: d.count ? 3 : 0 }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-text-3">Exports per day · last 30 days</div>
              </div>
              <div className="grid min-w-0 content-start gap-2">
                {data.byNetwork.slice(0, 8).map((n) => (
                  <div key={n.network} className="flex items-center gap-3 text-[13px]">
                    <span className="w-28 shrink-0 truncate text-text-2">{n.networkName}</span>
                    <div className="pg-bar flex-1">
                      <i style={{ width: `${(n.count / maxExportNet) * 100}%` }} />
                    </div>
                    <span className="w-7 text-right tabular-nums text-text-3">{n.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString();
const pct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;

function Stat({ label, value, hint, n }: { label: string; value: string; hint?: string; n?: number }) {
  return (
    <div className="pg-stat">
      {n !== undefined && <span className="pg-stat-k">{n}</span>}
      <div className="pg-stat-n">{value}</div>
      <div className="pg-stat-l">{label}</div>
      {hint && <div className="pg-stat-h">{hint}</div>}
    </div>
  );
}

function EmptyPlayable({ enabled }: { enabled: boolean }) {
  return (
    <div className="pg-card" style={{ padding: "26px 22px" }}>
      <h2 className="pg-h" style={{ marginBottom: 6 }}>
        No performance data yet.
      </h2>
      <p className="pg-p" style={{ margin: 0 }}>
        {enabled
          ? "Figures appear here by themselves once exported playables run on a network. Tick “Include device-preview plays” to see your own test plays. Packages built before tracking was on don’t report."
          : "Analytics in exported playables is off. Turn it on below and re-export to start collecting impressions, engagement and install taps."}
      </p>
    </div>
  );
}

function FunnelSteps({ f }: { f: Funnel }) {
  const rate = (n: number) => pct(f.impressions ? (n / f.impressions) * 100 : 0);
  const steps: { label: string; n: number; hint: string }[] = [
    { label: "Impressions", n: f.impressions, hint: "unique plays" },
    { label: "Engaged", n: f.engagements, hint: `${pct(f.engageRate)} touched the ad` },
    { label: "Started playing", n: f.starts, hint: `${rate(f.starts)} of plays` },
    { label: "Completed", n: f.completes, hint: `${pct(f.completionRate)} completion` },
    { label: "Install taps", n: f.ctaClicks, hint: `${pct(f.ctr)} CTR` },
  ];
  return (
    <div className="pg-stats">
      {steps.map((s, i) => (
        <Stat key={s.label} n={i + 1} label={s.label} value={fmt(s.n)} hint={s.hint} />
      ))}
    </div>
  );
}

function FunnelTable({ first, rows, total }: { first: string; rows: { key: string; label: string; sub?: string; f: Funnel }[]; total?: Funnel }) {
  const cells = (f: Funnel) => (
    <>
      <td className="r">{fmt(f.impressions)}</td>
      <td className="r">{fmt(f.engagements)}</td>
      <td className="r">{pct(f.engageRate)}</td>
      <td className="r">{fmt(f.starts)}</td>
      <td className="r">{fmt(f.completes)}</td>
      <td className="r">{pct(f.completionRate)}</td>
      <td className="r">{fmt(f.ctaClicks)}</td>
      <td className="r" style={{ color: "var(--brand-700)", fontWeight: 600 }}>
        {pct(f.ctr)}
      </td>
    </>
  );
  return (
    <div className="pg-tablewrap">
      <table className="pg-table">
        <thead>
          <tr>
            <th />
            <th colSpan={8} style={{ textAlign: "center", fontSize: 10, letterSpacing: "0.06em" }}>
              Measured in the playable
            </th>
          </tr>
          <tr>
            <th>{first}</th>
            <th className="r">Impressions</th>
            <th className="r">Engaged</th>
            <th className="r">Engagement</th>
            <th className="r">Started</th>
            <th className="r">Completed</th>
            <th className="r">Completion</th>
            <th className="r">Install taps</th>
            <th className="r">CTR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="l">
                <div className="max-w-[260px] truncate">{r.label}</div>
                {r.sub && <div className="max-w-[260px] truncate text-[11.5px] font-normal text-text-3">{r.sub}</div>}
              </td>
              {cells(r.f)}
            </tr>
          ))}
        </tbody>
        {total && rows.length > 1 && (
          <tfoot>
            <tr>
              <td>Total</td>
              {cells(total)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
