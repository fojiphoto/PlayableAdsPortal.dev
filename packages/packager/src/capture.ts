import type { PlayableSource } from "./types.js";

/** A tappable hotspot authored over the gameplay clip (normalized 0..1, top-left origin). */
export interface TapZone {
  x: number;
  y: number;
  w: number;
  h: number;
  /** short prompt shown by the indicator, e.g. "Tap!" */
  label?: string;
  /** show the pulsing hand/finger indicator (default true) */
  hand?: boolean;
}

/** Rich, authorable end-card shown after the interaction completes. */
export interface EndCard {
  title?: string;
  subtitle?: string;
  cta?: string;
  /** overlay background (default translucent black) */
  bg?: string;
  titleColor?: string;
  ctaBg?: string;
  ctaColor?: string;
  /** optional logo shown above the title, as a data: URI */
  logoDataUri?: string;
}

export interface CaptureBuildOptions {
  /** mime of the frames (default image/jpeg) */
  mime?: string;
  /** playback frames per second (default 24) */
  fps?: number;
  /** loop the clip until the interaction is completed (default true when a tapZone is set) */
  loop?: boolean;
  /** interaction authoring: a hotspot the player must tap to complete */
  tapZone?: TapZone;
  /** taps inside the zone required to finish (default 1) */
  requiredTaps?: number;
  /** rich end-card */
  endCard?: EndCard;
  /**
   * Size tuning: a byte budget for the raw frames. When the frames exceed it, frames are
   * dropped evenly (first and last always kept) so the playable fits tighter network caps.
   */
  frameBudgetBytes?: number;

  /** @deprecated use endCard.title */
  endCardTitle?: string;
  /** @deprecated use endCard.cta */
  endCardCta?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Drop frames evenly to fit a raw byte budget, always keeping the first and last. */
export function fitFrameBudget(frames: Uint8Array[], budgetBytes: number): Uint8Array[] {
  const total = frames.reduce((n, f) => n + f.length, 0);
  if (total <= budgetBytes || frames.length <= 2) return frames;
  const avg = total / frames.length;
  const keep = Math.max(2, Math.floor(budgetBytes / avg));
  if (keep >= frames.length) return frames;
  const out: Uint8Array[] = [];
  for (let i = 0; i < keep; i++) {
    out.push(frames[Math.round((i * (frames.length - 1)) / (keep - 1))]!);
  }
  return out;
}

/**
 * Turn a captured gameplay frame sequence into a self-contained HTML5 playable: a canvas
 * "flipbook" that plays the frames, an authorable tap interaction (a hotspot the player taps, or
 * tap-anywhere-to-skip), and a rich end-card whose CTA calls `window.PF.install()`. The result is
 * a {@link PlayableSource} that feeds the normal `pack()` / `packAll()` pipeline (which inlines it,
 * wires the per-network CTA/MRAID and size-checks it) — Phase 2's "compiler" for capture playables.
 */
export function buildCapturePlayable(frames: Uint8Array[], opts: CaptureBuildOptions = {}): PlayableSource {
  if (frames.length === 0) throw new Error("buildCapturePlayable: no frames");

  let used = frames;
  if (opts.frameBudgetBytes && opts.frameBudgetBytes > 0) used = fitFrameBudget(frames, opts.frameBudgetBytes);

  const mime = opts.mime ?? "image/jpeg";
  const fps = opts.fps ?? 24;
  const zone = opts.tapZone;
  const requiredTaps = Math.max(1, opts.requiredTaps ?? 1);
  const loop = opts.loop ?? !!zone; // interactive playables loop until completed
  const ec: EndCard = {
    title: opts.endCard?.title ?? opts.endCardTitle ?? "Play the full game!",
    subtitle: opts.endCard?.subtitle ?? "",
    cta: opts.endCard?.cta ?? opts.endCardCta ?? "Play Now",
    bg: opts.endCard?.bg ?? "rgba(0,0,0,.62)",
    titleColor: opts.endCard?.titleColor ?? "#ffffff",
    ctaBg: opts.endCard?.ctaBg ?? "#fbbf24",
    ctaColor: opts.endCard?.ctaColor ?? "#3a2a06",
    logoDataUri: opts.endCard?.logoDataUri,
  };

  const uris = used.map((f) => `"data:${mime};base64,${Buffer.from(f).toString("base64")}"`).join(",");
  const zoneJson = zone
    ? JSON.stringify({ x: zone.x, y: zone.y, w: zone.w, h: zone.h, taps: requiredTaps })
    : "null";
  const showHand = zone ? zone.hand !== false : false;
  const zoneLabel = esc(zone?.label ?? "Tap!");
  const logo = ec.logoDataUri ? `<img id="pf_logo" src="${ec.logoDataUri}" alt="">` : "";
  const subtitle = ec.subtitle ? `<p id="pf_sub">${esc(ec.subtitle)}</p>` : "";

  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>playable</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:-apple-system,system-ui,sans-serif}
#pf_c{position:absolute;inset:0;width:100%;height:100%;display:block}
#pf_tap{position:absolute;left:0;right:0;bottom:8%;text-align:center;color:#fff;font-weight:700;font-size:18px;text-shadow:0 2px 8px rgba(0,0,0,.7);animation:pf_pulse 1.2s ease-in-out infinite;pointer-events:none}
#pf_hot{position:absolute;display:none;transform:translate(-50%,-50%);pointer-events:none;z-index:3}
#pf_hot.show{display:block}
#pf_ring{width:84px;height:84px;border-radius:50%;border:4px solid rgba(255,255,255,.9);box-shadow:0 0 18px rgba(255,255,255,.6);animation:pf_ring 1.1s ease-out infinite}
#pf_finger{position:absolute;left:52%;top:52%;font-size:40px;animation:pf_tapdown 1.1s ease-in-out infinite}
#pf_hotlabel{position:absolute;left:50%;top:92px;transform:translateX(-50%);color:#fff;font-weight:700;white-space:nowrap;text-shadow:0 2px 8px rgba(0,0,0,.8)}
#pf_end{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:${ec.bg};color:#fff;text-align:center;padding:24px}
#pf_end.show{display:flex}
#pf_logo{max-width:46%;max-height:24%;object-fit:contain}
#pf_end h2{font-size:26px;margin:0;max-width:84%;color:${ec.titleColor}}
#pf_sub{margin:0;font-size:16px;opacity:.9;max-width:80%}
#pf_cta{margin-top:6px;padding:16px 36px;font-size:20px;font-weight:700;border:0;border-radius:14px;background:${ec.ctaBg};color:${ec.ctaColor};cursor:pointer;animation:pf_pulse 1.1s ease-in-out infinite}
@keyframes pf_pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes pf_ring{0%{transform:scale(.7);opacity:1}100%{transform:scale(1.25);opacity:0}}
@keyframes pf_tapdown{0%,100%{transform:translateY(0)}50%{transform:translateY(7px)}}
</style></head><body>
<canvas id="pf_c"></canvas>
<div id="pf_tap">${zone ? zoneLabel : "\u{1F446} Tap to play"}</div>
<div id="pf_hot"><div id="pf_ring"></div>${showHand ? '<div id="pf_finger">\u{1F446}</div>' : ""}<div id="pf_hotlabel">${zoneLabel}</div></div>
<div id="pf_end">${logo}<h2>${esc(ec.title!)}</h2>${subtitle}<button id="pf_cta">${esc(ec.cta!)}</button></div>
<script>
(function(){
  var FR=[${uris}],FPS=${fps},LOOP=${loop},ZONE=${zoneJson};
  var cv=document.getElementById("pf_c"),ctx=cv.getContext("2d"),dpr=window.devicePixelRatio||1;
  var imgs=FR.map(function(u){var im=new Image();im.src=u;return im;});
  function fit(){cv.width=Math.max(1,cv.clientWidth*dpr);cv.height=Math.max(1,cv.clientHeight*dpr);}
  window.addEventListener("resize",fit);fit();
  function cover(im){if(!im||!im.naturalWidth)return;var cw=cv.width,ch=cv.height,iw=im.naturalWidth,ih=im.naturalHeight,s=Math.max(cw/iw,ch/ih),w=iw*s,h=ih*s;ctx.drawImage(im,(cw-w)/2,(ch-h)/2,w,h);}
  var i=0,playing=false,done=false,last=0,taps=0;
  var hot=document.getElementById("pf_hot"),tapHint=document.getElementById("pf_tap");
  function placeHot(){if(!ZONE)return;hot.style.left=((ZONE.x+ZONE.w/2)*100)+"%";hot.style.top=((ZONE.y+ZONE.h/2)*100)+"%";}
  placeHot();
  function endCard(){if(done)return;done=true;playing=false;hot.classList.remove("show");if(tapHint)tapHint.style.display="none";document.getElementById("pf_end").classList.add("show");if(window.PF&&window.PF.lifecycle)window.PF.lifecycle.gameEnded();}
  function loop(ts){if(!playing)return;if(ts-last>=1000/FPS){last=ts;cover(imgs[i]);i++;if(i>=imgs.length){if(LOOP){i=0;}else{endCard();return;}}}requestAnimationFrame(loop);}
  function start(){if(playing||done)return;playing=true;if(ZONE){hot.classList.add("show");}else if(tapHint){tapHint.style.display="none";}if(window.PF&&window.PF.lifecycle)window.PF.lifecycle.gameStarted();last=performance.now();requestAnimationFrame(loop);}
  function inZone(e){var r=cv.getBoundingClientRect(),nx=(e.clientX-r.left)/r.width,ny=(e.clientY-r.top)/r.height;return nx>=ZONE.x&&nx<=ZONE.x+ZONE.w&&ny>=ZONE.y&&ny<=ZONE.y+ZONE.h;}
  cv.addEventListener("pointerdown",function(e){
    if(done)return;
    if(!playing){start();if(!ZONE)return;}
    if(ZONE){if(inZone(e)){taps++;if(taps>=ZONE.taps)endCard();}}
    else{endCard();}
  });
  document.getElementById("pf_cta").addEventListener("click",function(){if(window.PF)window.PF.install();});
  if(window.PF&&window.PF.lifecycle)window.PF.lifecycle.gameLoaded();
  if(imgs[0]&&imgs[0].complete)cover(imgs[0]);else if(imgs[0])imgs[0].onload=function(){if(!playing)cover(imgs[0]);};
  setTimeout(start,900);
})();
</script></body></html>`;

  return { entry: "index.html", files: { "index.html": new TextEncoder().encode(html) } };
}
