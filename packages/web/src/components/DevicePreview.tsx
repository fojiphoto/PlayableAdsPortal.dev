import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

/** Calls that mean "the player tapped the CTA" for some network. */
const CTA_CALLS = new Set(["mraid.open", "ExitApi.exit", "FbPlayableAd.onCTAClick", "install", "openAppStore", "dapi.openStoreUrl", "window.open", "postMessage download"]);

interface HostEvent {
  t: number;
  call: string;
  detail: string | null;
}

/** device outer size (screen + 10px bezel each side), portrait */
const DEV_W = 278;
const DEV_H = 554;

/**
 * Phone-framed preview of one export. The frame is sandboxed (uploaded playables are untrusted
 * code) and the server simulates the network's container in it (MRAID 2.0, ExitApi, dapi, …), so the
 * log below shows exactly what the creative called — e.g. the CTA — without leaving the page.
 */
export function DevicePreview({ src, label }: { src: string | null; label?: string }) {
  const [landscape, setLandscape] = useState(false);
  const [run, setRun] = useState(0); // bump to restart the creative
  const [events, setEvents] = useState<HostEvent[]>([]);
  const [host, setHost] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [avail, setAvail] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const t0 = useRef(Date.now());

  // shrink the phone to fit narrow columns (landscape is 554px wide)
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const outerW = landscape ? DEV_H : DEV_W;
  const outerH = landscape ? DEV_W : DEV_H;
  const scale = avail ? Math.min(1, avail / outerW) : 1;

  // a new export / restart starts a fresh session log
  useEffect(() => {
    setEvents([]);
    setHost(null);
    setVisible(true);
    t0.current = Date.now();
  }, [src, run]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!frame.current || e.source !== frame.current.contentWindow) return; // only our frame
      const d = e.data as { __adlab?: string; call?: string; detail?: string | null } | string;
      let ev: HostEvent | null = null;
      if (typeof d === "string" && (d === "download" || d === "complete")) ev = { t: Date.now(), call: `postMessage ${d}`, detail: null };
      else if (d && typeof d === "object" && d.__adlab === "preview" && typeof d.call === "string") {
        if (d.call === "host") {
          setHost(String(d.detail ?? ""));
          return;
        }
        ev = { t: Date.now(), call: d.call, detail: d.detail == null ? null : String(d.detail) };
      }
      if (ev) setEvents((xs) => [...xs, ev!].slice(-50));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function toggleVisible() {
    const v = !visible;
    setVisible(v);
    frame.current?.contentWindow?.postMessage({ __adlab: "preview-control", action: "viewable", value: v }, "*");
  }

  const ctaCount = events.filter((e) => CTA_CALLS.has(e.call)).length;

  return (
    <>
      <div className="sh-preview-controls">
        <span className="sh-preview-label">{label ? `Preview · ${label}` : "Preview"}</span>
        <button type="button" className={`sh-pv-ctrl${!landscape ? " on" : ""}`} onClick={() => setLandscape(false)} title="Portrait" aria-pressed={!landscape}>
          <Icon.Phone />
        </button>
        <button type="button" className={`sh-pv-ctrl${landscape ? " on" : ""}`} onClick={() => setLandscape(true)} title="Landscape" aria-pressed={landscape}>
          <Icon.PhoneLandscape />
        </button>
        {src && (
          <button type="button" className="sh-pv-ctrl" onClick={() => setRun((n) => n + 1)} title="Restart">
            <Icon.Refresh />
          </button>
        )}
      </div>

      <div className="sh-device-wrap" ref={wrap} style={{ height: outerH * scale }}>
        <div className={`sh-device${landscape ? " landscape" : ""}`} style={scale < 1 ? { transform: `scale(${scale})` } : undefined}>
          <div className="sh-device-screen">
            {src ? (
              <iframe
                ref={frame}
                key={`${src}#${run}`}
                src={src}
                title="playable preview"
                sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-pointer-lock"
                className="sh-device-frame"
              />
            ) : (
              <div className="sh-device-empty">
                <Icon.Play />
                Export a network, then preview it here
              </div>
            )}
          </div>
        </div>
      </div>

      {src && (
        <div className="sh-host" aria-live="polite">
          <div className="sh-host-top">
            <span className="sh-host-k">Host</span>
            <span className="sh-host-v">{host ? `${host} (simulated)` : "starting…"}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
              <button type="button" onClick={toggleVisible} className="sh-mini-btn" title="Fire viewableChange: networks pause creatives that are off-screen">
                {visible ? <Icon.EyeOff /> : <Icon.Eye />}
                {visible ? "Hide ad" : "Show ad"}
              </button>
            </span>
          </div>
          {events.length === 0 ? (
            <div className="sh-dim">No calls yet. Play the creative and tap its install button.</div>
          ) : (
            <ol className="sh-host-log">
              {events.map((e, i) => (
                <li key={i} className={CTA_CALLS.has(e.call) ? "cta" : undefined}>
                  <span className="sh-dim">{((e.t - t0.current) / 1000).toFixed(1)}s</span> {e.call}
                  {e.detail && <span className="sh-dim"> {e.detail}</span>}
                </li>
              ))}
            </ol>
          )}
          {ctaCount > 0 && <div className="sh-host-ok">CTA fired {ctaCount === 1 ? "once" : `${ctaCount} times`}: the install button reaches the network.</div>}
        </div>
      )}
    </>
  );
}
