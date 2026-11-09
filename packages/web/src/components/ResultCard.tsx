import { downloadUrl } from "../api";
import type { PackResultView } from "../types";
import { Icon } from "./icons";

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
  const tone = !r.ok ? "over" : pct > 80 ? "warn" : "ok";
  const bar = tone === "over" ? "#dc2626" : tone === "warn" ? "var(--warn)" : "var(--signal)";

  return (
    <div className={`sh-result${active ? " on" : ""}`}>
      <div className="sh-result-top">
        <div className="sh-result-name">
          <span className="sh-dot" style={{ background: r.ok ? "var(--signal)" : "#dc2626" }} aria-label={r.ok ? "Passed" : "Failed"} />
          <span title={r.networkName}>{r.networkName}</span>
          <span className="sh-fmt">{r.format === "zip" ? "zip" : "html"}</span>
        </div>
        <span className={`sh-size-pill ${tone}`} title={`${pct}% of the network's size cap`}>
          {r.sizeLabel}
        </span>
      </div>

      <div className="sh-meter">
        <div style={{ width: `${pct}%`, background: bar }} />
      </div>

      {r.validation.length > 0 && (
        <ul className="sh-valid">
          {r.validation.map((v, i) => (
            <li key={i} style={{ color: v.level === "error" ? "#b91c1c" : "#92400e" }}>
              {v.level === "error" ? "✗" : "•"} {v.message}
            </li>
          ))}
        </ul>
      )}

      <div className="sh-result-actions">
        <button type="button" onClick={() => onPreview(r.network)} className={`sh-mini-btn${active ? " on" : ""}`} aria-pressed={active}>
          <Icon.Eye /> Preview
        </button>
        <a href={downloadUrl(creativeId, r.network)} download className="sh-mini-btn">
          <Icon.Download /> Download
        </a>
      </div>
    </div>
  );
}
