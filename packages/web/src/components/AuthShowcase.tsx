import { useEffect, useState } from "react";
import { getNetworks } from "../api";

/** Export formats the chip under the phone cycles through. */
const FORMATS = ["MRAID", "HTML5", "ZIP bundle", "index.html", "Inline base64"];
const CYCLE_MS = 1900;

/** Factorial Studio game thumbnails that peek out from behind the demo phone. */
const TILES = ["fortress-merge", "turbo-race", "golf-orbit", "zombie-invasion"];

/** How many networks we export to; fetched once and shared by every mount. */
let networkCount: Promise<number | null> | null = null;
function useNetworkCount(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    networkCount ??= getNetworks()
      .then((list) => (Array.isArray(list) && list.length ? list.length : null))
      .catch(() => {
        networkCount = null; // try again on the next mount
        return null;
      });
    let live = true;
    void networkCount.then((c) => live && setN(c));
    return () => {
      live = false;
    };
  }, []);
  return n;
}

function FormatStrip() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(
      () => setI((x) => (x + 1) % FORMATS.length),
      CYCLE_MS,
    );
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="au-fmt" aria-hidden="true">
      <span className="au-fmt-label">Exports as</span>
      {/* the key remounts the chip so its entrance animation replays */}
      <span key={i} className="au-fmt-chip">
        {FORMATS[i]}
      </span>
    </div>
  );
}

/** The left half of the auth screens: brand, demo phone, headline and stats on the brand gradient. */
export function AuthShowcase({
  variant,
  onBack,
}: {
  variant: "login" | "signup";
  onBack?: () => void;
}) {
  const count = useNetworkCount();
  const n = count ? String(count) : "20+";
  const year = new Date().getFullYear();

  const copy =
    variant === "signup"
      ? {
          h: ["Start free.", "Ship your first playable."],
          p: "Make an account, drop in your web build and export a ready-to-upload playable in a few minutes. Move to a paid plan only when you need more networks.",
          stats: [
            ["∞", "Unity Ads exports"],
            ["$0", "To start"],
            [n, "Networks on paid plans"],
          ],
        }
      : {
          h: ["One build.", `${n} ad networks.`],
          p: "Upload one HTML5 playable and AdLab packages it for each network: the right wrapper, CTA wiring and size checks, ready to upload.",
          stats: [
            [n, "Export targets"],
            ["<5MB", "Size-capped"],
            ["2D · 3D", "Engine builds"],
          ],
        };

  return (
    <aside className="au-panel">
      <div className="au-orbs" aria-hidden="true">
        <span className="au-orb au-orb-1" />
        <span className="au-orb au-orb-2" />
        <span className="au-orb au-orb-3" />
      </div>

      <button
        type="button"
        className="au-brand"
        onClick={onBack}
        aria-label="Factorial AdLab home"
      >
        <span className="au-brand-tile">
          <img src="/art/logo.webp" alt="" />
        </span>
        <span className="au-brand-name">
          Factorial <em>AdLab</em>
        </span>
      </button>

      <div className="au-body">
        <div className="au-stage">
          <div className="au-device-wrap">
            <div className="au-tiles" aria-hidden="true">
              {TILES.map((name, i) => (
                <span key={name} className={`au-tile au-tile-${i + 1}`}>
                  <img src={`/art/gamezone/${name}.jpg`} alt="" loading="lazy" />
                </span>
              ))}
            </div>
            <div className="au-device">
              <div className="au-notch" />
              <div className="au-screen">
                <iframe
                  src="/adlab-demo.html"
                  title="Sample playable made with Factorial AdLab"
                  sandbox="allow-scripts"
                  loading="lazy"
                  tabIndex={-1}
                />
                <div className="au-shield" />
              </div>
            </div>
          </div>
          <FormatStrip />
        </div>

        <div className="au-copy">
          <h1 className="au-h">
            {copy.h[0]}
            <br />
            <em>{copy.h[1]}</em>
          </h1>
          <p className="au-p">{copy.p}</p>
          <dl className="au-stats">
            {copy.stats.map(([num, label]) => (
              <div key={label} className="au-stat">
                <dt>{num}</dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="au-foot">© {year} Factorial AdLab</div>
    </aside>
  );
}
