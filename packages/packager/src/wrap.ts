import type { NetworkSpec, PackOptions } from "./types.js";
import { buildRuntimeShim } from "./runtime-shim.js";
import { buildPreloader, hasPreloaderContent } from "./preloader.js";

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
  if (hasPreloaderContent(opts.preloader)) {
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
    vars: opts.variables ?? {},
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
