import type { PlayableSource } from "./types.js";

export interface CaptureBuildOptions {
  /** mime of the frames (default image/jpeg) */
  mime?: string;
  /** playback frames per second (default 24) */
  fps?: number;
  /** end-card title */
  endCardTitle?: string;
  /** end-card CTA button label */
  endCardCta?: string;
}

/**
 * Turn a captured gameplay frame sequence into a self-contained HTML5 playable: a canvas
 * "flipbook" that plays the frames, a tap-to-play / tap-to-skip interaction, and an end-card
 * whose CTA calls `window.PF.install()`. The result is a {@link PlayableSource} that feeds the
 * normal `pack()` / `packAll()` pipeline (which inlines it, wires the per-network CTA/MRAID and
 * size-checks it) — this is Phase 2's "compiler" for capture-based playables.
 */
export function buildCapturePlayable(frames: Uint8Array[], opts: CaptureBuildOptions = {}): PlayableSource {
  if (frames.length === 0) throw new Error("buildCapturePlayable: no frames");
  const mime = opts.mime ?? "image/jpeg";
  const fps = opts.fps ?? 24;
  const title = (opts.endCardTitle ?? "Play the full game!").replace(/</g, "&lt;");
  const cta = (opts.endCardCta ?? "Play Now").replace(/</g, "&lt;");

  const uris = frames.map((f) => `"data:${mime};base64,${Buffer.from(f).toString("base64")}"`).join(",");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>playable</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:-apple-system,system-ui,sans-serif}
#pf_c{position:absolute;inset:0;width:100%;height:100%;display:block}
#pf_tap{position:absolute;left:0;right:0;bottom:8%;text-align:center;color:#fff;font-weight:700;font-size:18px;text-shadow:0 2px 8px rgba(0,0,0,.7);animation:pf_pulse 1.2s ease-in-out infinite;pointer-events:none}
#pf_end{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:rgba(0,0,0,.62);color:#fff;text-align:center;padding:24px}
#pf_end.show{display:flex}
#pf_end h2{font-size:26px;margin:0;max-width:80%}
#pf_cta{padding:16px 36px;font-size:20px;font-weight:700;border:0;border-radius:14px;background:#fbbf24;color:#3a2a06;cursor:pointer;animation:pf_pulse 1.1s ease-in-out infinite}
@keyframes pf_pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
</style></head><body>
<canvas id="pf_c"></canvas>
<div id="pf_tap">\u{1F446} Tap to play</div>
<div id="pf_end"><h2>${title}</h2><button id="pf_cta">${cta}</button></div>
<script>
(function(){
  var FR=[${uris}],FPS=${fps};
  var cv=document.getElementById("pf_c"),ctx=cv.getContext("2d"),dpr=window.devicePixelRatio||1;
  var imgs=FR.map(function(u){var im=new Image();im.src=u;return im;});
  function fit(){cv.width=Math.max(1,cv.clientWidth*dpr);cv.height=Math.max(1,cv.clientHeight*dpr);}
  window.addEventListener("resize",fit);fit();
  function cover(im){if(!im||!im.naturalWidth)return;var cw=cv.width,ch=cv.height,iw=im.naturalWidth,ih=im.naturalHeight,s=Math.max(cw/iw,ch/ih),w=iw*s,h=ih*s;ctx.drawImage(im,(cw-w)/2,(ch-h)/2,w,h);}
  var i=0,playing=false,done=false,last=0;
  function endCard(){if(done)return;done=true;playing=false;document.getElementById("pf_end").classList.add("show");var t=document.getElementById("pf_tap");if(t)t.style.display="none";if(window.PF&&window.PF.lifecycle)window.PF.lifecycle.gameEnded();}
  function loop(ts){if(!playing)return;if(ts-last>=1000/FPS){last=ts;cover(imgs[i]);i++;if(i>=imgs.length){endCard();return;}}requestAnimationFrame(loop);}
  function start(){if(playing||done)return;playing=true;var t=document.getElementById("pf_tap");if(t)t.style.display="none";if(window.PF&&window.PF.lifecycle)window.PF.lifecycle.gameStarted();last=performance.now();requestAnimationFrame(loop);}
  cv.addEventListener("pointerdown",function(){if(!playing&&!done)start();else if(playing)endCard();});
  document.getElementById("pf_cta").addEventListener("click",function(){if(window.PF)window.PF.install();});
  if(window.PF&&window.PF.lifecycle)window.PF.lifecycle.gameLoaded();
  if(imgs[0]&&imgs[0].complete)cover(imgs[0]);else if(imgs[0])imgs[0].onload=function(){if(!playing)cover(imgs[0]);};
  setTimeout(start,900);
})();
</script></body></html>`;

  return { entry: "index.html", files: { "index.html": new TextEncoder().encode(html) } };
}
