import { downloadUrl } from "../api";
import type { PackResultView } from "../types";

export function ResultCard({
  creativeId,
  r,
  active,
  onPreview,
}: {
  creativeId: string;
  r: PackResultView;
  active: boolean;
  onPreview: (network: string) => void;
}) {
  const pct = Math.min(100, Math.round((r.sizeBytes / r.maxSizeBytes) * 100));
  const bar = !r.ok ? "bg-red-500" : pct > 80 ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div
      className={`rounded-lg border p-3 transition ${
        active ? "border-violet-500 bg-violet-500/5" : "border-slate-800 bg-slate-900/50"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${r.ok ? "bg-emerald-400" : "bg-red-400"}`} />
          <span className="font-medium text-slate-100">{r.networkName}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            {r.format === "zip" ? "zip" : "html"}
          </span>
        </div>
        <span className="text-xs tabular-nums text-slate-400">{r.sizeLabel}</span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>

      {r.validation.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {r.validation.map((v, i) => (
            <li key={i} className={`text-xs ${v.level === "error" ? "text-red-400" : "text-amber-400"}`}>
              {v.level === "error" ? "✗" : "•"} {v.message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onPreview(r.network)}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500"
        >
          Preview
        </button>
        <a
          href={downloadUrl(creativeId, r.network)}
          download
          className="rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-100 hover:bg-slate-700"
        >
          Download
        </a>
      </div>
    </div>
  );
}
