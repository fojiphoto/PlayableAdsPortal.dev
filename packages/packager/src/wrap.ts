import type { NetworkSpec, PackOptions, PreloaderConfig } from "./types.js";
import { buildRuntimeShim } from "./runtime-shim.js";

/** A custom loading screen overlay (logo + spinner) that fades out when the playable loads. */
function buildPreloader(p: PreloaderConfig): string {
  const bg = p.bg || "#0b1220";
  const logo = p.logoDataUri
    ? `<img src="${p.logoDataUri}" alt="" style="max-width:42%;max-height:34%;object-fit:contain">`
    : "";
  return `<div id="__pf_pl" style="position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:${bg};transition:opacity .45s ease">${logo}<div style="width:34px;height:34px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:__pfspin .8s linear infinite"></div><style>@keyframes __pfspin{to{transform:rotate(360deg)}}</style></div><script>(function(){var p=document.getElementById("__pf_pl");if(!p)return;var done=false;function hide(){if(done)return;done=true;p.style.opacity="0";setTimeout(function(){if(p&&p.parentNode)p.parentNode.removeChild(p);},600);}window.addEventListener("load",function(){setTimeout(hide,700);});setTimeout(hide,3500);if(window.PF)window.PF.hidePreloader=hide;}());</script>`;
}

/** Insert raw HTML into <head> (after the opening tag), creating a head if none exists. */
function ensureInHead(html: string, snippet: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${snippet}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${snippet}</head>`);
  }
  return `${snippet}\n${html}`;
}

/** Inject the forge runtime shim + baseline meta tags into an (already-inlined) HTML string. */
export function injectRuntime(html: string, spec: NetworkSpec, opts: PackOptions): string {
  let out = html;

  if (!/name=["']viewport["']/i.test(out)) {
    out = ensureInHead(
      out,
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    );
  }
  if (!/charset=/i.test(out)) {
    out = ensureInHead(out, '<meta charset="utf-8">');
  }

  // Google Ads / DV360 fire the CTA through ExitApi.exit(), which lives in Google's own
  // exitapi.js — the one external script those networks require (allowlisted in the validator).
  if (spec.ctaHook === "google-exitapi" && !/exitapi\.js/i.test(out)) {
    out = ensureInHead(
      out,
      '<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>',
    );
  }

  // custom preloader / splash — injected at the top of <body> so it covers the playable
  if (opts.preloader && (opts.preloader.logoDataUri || opts.preloader.bg)) {
    const pl = buildPreloader(opts.preloader);
    if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${pl}`);
    else out = pl + out;
  }

  const shim = buildRuntimeShim({
    clickMode: spec.clickMode,
    ctaHook: spec.ctaHook,
    usesMraid: spec.usesMraid,
    ctaUrl: opts.ctaUrl ?? "",
    iosUrl: opts.iosUrl ?? "",
    androidUrl: opts.androidUrl ?? "",
    // beacons only where the network tolerates outbound requests (Meta/Google/Mintegral/Pangle don't)
    analytics:
      opts.analytics && spec.allowsNetworkRequests !== false
        ? { endpoint: opts.analytics.endpoint.replace(/\/$/, ""), creativeId: opts.analytics.creativeId, network: spec.id }
        : null,
  });

  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${shim}\n</body>`);
  if (/<\/html>/i.test(out)) return out.replace(/<\/html>/i, `${shim}\n</html>`);
  return out + shim;
}
