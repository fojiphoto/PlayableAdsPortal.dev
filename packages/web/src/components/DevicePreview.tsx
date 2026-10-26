import { useState } from "react";

export function DevicePreview({ src, label }: { src: string | null; label?: string }) {
  const [landscape, setLandscape] = useState(false);
  const w = landscape ? 620 : 300;
  const h = landscape ? 300 : 620;

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm text-slate-400">{label ? `Preview · ${label}` : "Preview"}</span>
        <button
          onClick={() => setLandscape((v) => !v)}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
        >
          {landscape ? "Portrait" : "Landscape"}
        </button>
      </div>

      <div
        className="rounded-[2rem] border-[10px] border-slate-800 bg-black shadow-2xl transition-all"
        style={{ width: w + 20, height: h + 20 }}
      >
        {src ? (
          <iframe
            key={src}
            src={src}
            title="playable preview"
            className="h-full w-full rounded-[1.4rem] bg-white"
            style={{ width: w, height: h }}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-[1.4rem] text-center text-sm text-slate-600"
            style={{ width: w, height: h }}
          >
            Export a network, then preview it here
          </div>
        )}
      </div>
    </div>
  );
}
