import type { NetworkSpec, PackOptions } from "./types.js";
import { buildRuntimeShim } from "./runtime-shim.js";

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

  const shim = buildRuntimeShim({
    clickMode: spec.clickMode,
    usesMraid: spec.usesMraid,
    ctaUrl: opts.ctaUrl ?? "",
    iosUrl: opts.iosUrl ?? "",
    androidUrl: opts.androidUrl ?? "",
  });

  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${shim}\n</body>`);
  if (/<\/html>/i.test(out)) return out.replace(/<\/html>/i, `${shim}\n</html>`);
  return out + shim;
}
