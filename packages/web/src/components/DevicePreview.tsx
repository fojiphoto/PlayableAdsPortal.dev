import { useEffect, useRef, useState } from "react";

/** Calls that mean "the player tapped the CTA" for some network. */
const CTA_CALLS = new Set(["mraid.open", "ExitApi.exit", "FbPlayableAd.onCTAClick", "install", "openAppStore", "dapi.openStoreUrl", "window.open", "postMessage download"]);

interface HostEvent {
  t: number;
  call: string;
  detail: string | null;
}

/**
 * Phone-framed preview of one export. The frame is sandboxed (uploaded playables are untrusted
 * code) and the server simulates the network's container in it (MRAID 2.0, ExitApi, dapi, …), so the
 * console below shows exactly what the creative called — e.g. the CTA — without leaving the page.
 */
export function DevicePreview({ src, label }: { src: string | null; label?: string }) {
  const [landscape, setLandscape] = useState(false);
  const [run, setRun] = useState(0); // bump to restart the creative
  const [events, setEvents] = useState<HostEvent[]>([]);
  const [host, setHost] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const t0 = useRef(Date.now());
  const w = landscape ? 620 : 300;
  const h = landscape ? 300 : 620;

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
    <div className="flex flex-col items-center">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm text-slate-400">{label ? `Preview · ${label}` : "Preview"}</span>
        <button
          onClick={() => setLandscape((v) => !v)}
          className="rounded-md border border-[#1f6b4a] px-2 py-1 text-xs text-slate-300 hover:border-[#7cb342]"
        >
          {landscape ? "Portrait" : "Landscape"}
        </button>
      </div>

      <div
        className="rounded-[2rem] border-[10px] border-[#1b5540] bg-black shadow-2xl transition-all"
        style={{ width: w + 20, height: h + 20 }}
      >
        {src ? (
          <iframe
            ref={frame}
            key={`${src}#${run}`}
            src={src}
            title="playable preview"
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-pointer-lock"
            className="h-full w-full rounded-[1.4rem] bg-white"
            style={{ width: w, height: h }}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-[1.4rem] text-center text-sm text-slate-400"
            style={{ width: w, height: h }}
          >
            Export a network, then preview it here
          </div>
        )}
      </div>

      {src && (
        <div className="mt-3 w-full max-w-[320px] rounded-lg border border-[#1b5540] bg-[#0a3a28]/50 p-3 text-xs" aria-live="polite">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-semibold uppercase tracking-wide text-amber-400">Host</span>
            <span className="truncate text-slate-300">{host ? `${host} (simulated)` : "starting…"}</span>
            <span className="ml-auto flex gap-1.5">
              <button onClick={toggleVisible} className="rounded border border-[#1f6b4a] px-1.5 py-0.5 text-slate-300 hover:border-[#7cb342]" title="Fire viewableChange: networks pause creatives that are off-screen">
                {visible ? "Hide ad" : "Show ad"}
              </button>
              <button onClick={() => setRun((n) => n + 1)} className="rounded border border-[#1f6b4a] px-1.5 py-0.5 text-slate-300 hover:border-[#7cb342]">
                Restart
              </button>
            </span>
          </div>
          {events.length === 0 ? (
            <div className="text-slate-500">No calls yet. Play the creative and tap its install button.</div>
          ) : (
            <ol className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px]">
              {events.map((e, i) => (
                <li key={i} className={CTA_CALLS.has(e.call) ? "text-amber-200" : "text-slate-400"}>
                  <span className="text-slate-500">{((e.t - t0.current) / 1000).toFixed(1)}s</span> {e.call}
                  {e.detail && <span className="break-all text-slate-500"> {e.detail}</span>}
                </li>
              ))}
            </ol>
          )}
          {ctaCount > 0 && <div className="mt-2 text-[11px] text-emerald-400">CTA fired {ctaCount === 1 ? "once" : `${ctaCount} times`}: the install button reaches the network.</div>}
        </div>
      )}
    </div>
  );
}
