/**
 * Real network logos (each network's own mark, simplified to a 24-unit glyph on its brand tile),
 * keyed by our network id (packages/packager/src/networks.ts). Networks without a mark here get a
 * two-letter tile.
 */
import type { CSSProperties } from "react";

const LOGOS: Record<string, { bg: string; svg: string }> = {
  "aarki": { bg: "#0E1116", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#3DD6C4\" d=\"M8 3.6 1.4 20.4h3.6l1.2-3.2h4.6l1.2 3.2h3.6L9 3.6H8Zm-.5 10.6 1.4-3.8 1.4 3.8H7.5Z\"></path><path fill=\"#fff\" d=\"M18.2 3.6h3.4v16.8h-3.4V3.6Z\" opacity=\".85\"></path></svg>" },
  "adcolony": { bg: "#0F1B2D", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#00B5E2\" d=\"M12 3.2 3.6 20.8h3.9l1.6-3.6h5.8l1.6 3.6h3.9L12 3.2Zm-1.5 10.9L12 10.6l1.5 3.5h-3Z\"></path></svg>" },
  "adikteev": { bg: "#101010", svg: "<svg viewBox=\"0 0 24 24\"><rect fill=\"#FF4D4D\" x=\"3.2\" y=\"3.2\" width=\"8\" height=\"8\" rx=\"1.4\"></rect><rect fill=\"#fff\" x=\"12.8\" y=\"12.8\" width=\"8\" height=\"8\" rx=\"1.4\"></rect><rect fill=\"#fff\" x=\"12.8\" y=\"3.2\" width=\"8\" height=\"8\" rx=\"1.4\" opacity=\".45\"></rect><rect fill=\"#FF4D4D\" x=\"3.2\" y=\"12.8\" width=\"8\" height=\"8\" rx=\"1.4\" opacity=\".45\"></rect></svg>" },
  "applovin": { bg: "#fff", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#1C1C1C\" d=\"M12 2.6 2.9 21.4h4.2L12 10.9l3.1 6.4h-2.6l1.9 4.1h7.7L12 2.6Z\"></path></svg>" },
  "appreciate": { bg: "#1A1F36", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#FFC24B\" d=\"M12 2.4 14.6 9l6.9.3-5.4 4.3 1.9 6.6L12 16.4l-6 3.8 1.9-6.6L2.5 9.3 9.4 9 12 2.4Z\"></path></svg>" },
  "bigabid": { bg: "#0B1F3A", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#4DA3FF\" d=\"M3.6 20.4V3.6h7.1c3.2 0 5 1.6 5 4.1 0 1.6-.8 2.8-2.1 3.4 1.7.5 2.8 1.9 2.8 3.9 0 2.9-2 5.4-5.6 5.4H3.6Zm3.4-10h3.3c1.3 0 2.1-.7 2.1-1.8s-.8-1.8-2.1-1.8H7v3.6Zm0 7h3.7c1.5 0 2.4-.8 2.4-2.1 0-1.3-.9-2.1-2.4-2.1H7v4.2Z\"></path><circle fill=\"#FF8A3D\" cx=\"19.6\" cy=\"6\" r=\"2.4\"></circle></svg>" },
  "chartboost": { bg: "#1B1F23", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M4 14.5h3.4V20H4zM10.3 10.5h3.4V20h-3.4z\"></path><path fill=\"#7AC143\" d=\"M16.6 5.6H20V20h-3.4z\"></path><path fill=\"#7AC143\" d=\"M4 9.8 11.9 5l2 1.7-7.9 4.8z\" opacity=\".9\"></path></svg>" },
  "dv360": { bg: "#fff", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#34A853\" d=\"M3.4 5.6A2.2 2.2 0 0 1 5.6 3.4h4.2v17.2H5.6a2.2 2.2 0 0 1-2.2-2.2V5.6Z\"></path><path fill=\"#FBBC04\" d=\"M11.6 3.4h4.2a2.2 2.2 0 0 1 2.2 2.2v12.8a2.2 2.2 0 0 1-2.2 2.2h-4.2V3.4Z\"></path><circle fill=\"#4285F4\" cx=\"19.8\" cy=\"12\" r=\"2.6\"></circle></svg>" },
  "fbinstant": { bg: "#1877F2", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M7.5 7h9a4.5 4.5 0 0 1 4.4 5.4l-.9 4.3A2.3 2.3 0 0 1 16 17.8L14.2 15H9.8L8 17.8a2.3 2.3 0 0 1-4-1.1l-.9-4.3A4.5 4.5 0 0 1 7.5 7Z\"></path><path fill=\"#1877F2\" d=\"M7 9.6h1.3v1.3h1.3v1.3H8.3v1.3H7v-1.3H5.7v-1.3H7V9.6Zm8.6.2a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm1.8 1.8a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z\"></path></svg>" },
  "fyber": { bg: "#00C7B1", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M7 3.5h11l-2.2 3.8H11v4h7.3l-2.2 3.8H11v5.4H7z\"></path></svg>" },
  "google": { bg: "#fff", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#FBBC04\" d=\"M2.4 17.1 8.6 6.4a2.6 2.6 0 1 1 4.5 2.6L6.9 19.7a2.6 2.6 0 1 1-4.5-2.6Z\"></path><path fill=\"#4285F4\" d=\"M21.6 17.1 15.4 6.4A2.6 2.6 0 1 0 10.9 9l6.2 10.7a2.6 2.6 0 1 0 4.5-2.6Z\"></path><circle fill=\"#34A853\" cx=\"4.6\" cy=\"18.4\" r=\"2.6\"></circle></svg>" },
  "inmobi": { bg: "#E4002B", svg: "<svg viewBox=\"0 0 24 24\"><circle fill=\"#fff\" cx=\"6.4\" cy=\"5.6\" r=\"2.2\"></circle><rect fill=\"#fff\" x=\"4.6\" y=\"9.6\" width=\"3.6\" height=\"10.8\" rx=\"1\"></rect><path fill=\"#fff\" d=\"M11.2 20.4V9.6h3.4v1.5a3.7 3.7 0 0 1 3.1-1.7c2.2 0 3.7 1.5 3.7 4v7h-3.5v-6.2c0-1.2-.6-1.9-1.7-1.9-1 0-1.6.7-1.6 1.9v6.2h-3.4Z\"></path></svg>" },
  "ironsource": { bg: "#0A0A0A", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M4 6.6 12 2l8 4.6-2.6 1.5L12 5 6.6 8.1 4 6.6Z\"></path><path fill=\"#4EE1A0\" d=\"M4 12l8-4.6 8 4.6-2.6 1.5L12 10.4l-5.4 3.1L4 12Z\"></path><path fill=\"#fff\" d=\"M4 17.4 12 12.8l8 4.6L12 22l-8-4.6Z\" opacity=\".55\"></path></svg>" },
  "liftoff": { bg: "#111827", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#FF5A5F\" d=\"M12 2.8 20.4 12h-4.6v9.2H8.2V12H3.6L12 2.8Z\"></path></svg>" },
  "line": { bg: "#06C755", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M12 3.6c-5 0-9 3.2-9 7.2 0 3.5 3.1 6.5 7.3 7.1.3.1.7.2.8.5.1.2.1.6 0 .9l-.1.8c0 .2-.2.9.8.5s5.4-3.2 7.4-5.5c1.3-1.4 1.8-2.7 1.8-4.3 0-4-4-7.2-9-7.2Zm-3.9 9.5H6.3a.5.5 0 0 1-.5-.5V9.2a.5.5 0 0 1 1 0v2.9h1.3a.5.5 0 1 1 0 1Zm2.1-.5a.5.5 0 0 1-1 0V9.2a.5.5 0 0 1 1 0v3.4Zm4.3 0a.5.5 0 0 1-.9.3l-1.7-2.3v2a.5.5 0 0 1-1 0V9.2a.5.5 0 0 1 .9-.3l1.7 2.3v-2a.5.5 0 0 1 1 0v3.4Zm3.2-2.2a.5.5 0 1 1 0 1h-1.3v.7h1.3a.5.5 0 1 1 0 1h-1.8a.5.5 0 0 1-.5-.5V9.2a.5.5 0 0 1 .5-.5h1.8a.5.5 0 1 1 0 1h-1.3v.7h1.3Z\"></path></svg>" },
  "meta": { bg: "#0866FF", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M14.6 8.3V6.6c0-.8.2-1.2 1.4-1.2h1.5V2.5h-2.5c-3 0-4 1.4-4 3.8v2H9.1v2.9h1.9v8.3h3.6v-8.3h2.4l.3-2.9h-2.7Z\"></path></svg>" },
  "mintegral": { bg: "#00C1B4", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M3.4 19.4V4.6h3.4l5.2 8.4 5.2-8.4h3.4v14.8h-3.2V10.2l-4.2 6.6h-2.4l-4.2-6.6v9.2H3.4Z\"></path></svg>" },
  "moloco": { bg: "#fff", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#1B6DE0\" d=\"M17.4 10.3a5.5 5.5 0 0 0-10.6-1.4A4.4 4.4 0 0 0 7.6 17.6h9.2a3.7 3.7 0 0 0 .6-7.3Zm-.6 5.3H7.6a2.4 2.4 0 0 1-.4-4.8l1.4-.2.3-1.3a3.5 3.5 0 0 1 6.8.9v1.6l1.6.1a1.7 1.7 0 0 1-.5 3.7Z\"></path><circle cx=\"10\" cy=\"13.4\" r=\"1.15\" fill=\"#1B6DE0\"></circle><circle cx=\"14\" cy=\"13.4\" r=\"1.15\" fill=\"#1B6DE0\"></circle></svg>" },
  "mraid": { bg: "#37404F", svg: "<svg viewBox=\"0 0 24 24\"><rect fill=\"none\" stroke=\"#fff\" stroke-width=\"2\" x=\"4.2\" y=\"2.8\" width=\"15.6\" height=\"18.4\" rx=\"2.2\"></rect><path fill=\"#fff\" d=\"M8.6 7.4h6.8v2H8.6zM8.6 11.4h6.8v2H8.6zM8.6 15.4h4v2h-4z\"></path></svg>" },
  "remerge": { bg: "#111111", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"none\" stroke=\"#00E08F\" stroke-width=\"2.4\" stroke-linecap=\"round\" d=\"M19 9.5a7.5 7.5 0 1 0 .6 5\"></path><path fill=\"#00E08F\" d=\"M15.4 3.6h4.9v4.9l-4.9-4.9Z\"></path></svg>" },
  "revx": { bg: "#fff", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#1B4FA0\" d=\"M4.5 4h4.1L19.5 20h-4.1z\"></path><path fill=\"#F58220\" d=\"M15.4 4h4.1L8.6 20H4.5z\"></path></svg>" },
  "snapchat": { bg: "#FFFC00", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#0B0B0B\" d=\"M12 2.4c2.7 0 4.5 2 4.6 4.7 0 .7-.1 1.4-.1 2 .3.2.7.2 1 .1.5-.2 1 .1 1.1.5.1.5-.2.9-.9 1.2-.6.2-1.3.5-1.4.9-.1.5.9 2 2.6 2.8.5.2.5.7.1 1-.5.4-1.4.6-2 .7-.2.4-.2 1-.7 1.1-.5.1-1.2-.2-2.1-.1-.8.1-1.4.9-2.2.9s-1.4-.8-2.2-.9c-.9-.1-1.6.2-2.1.1-.5-.1-.5-.7-.7-1.1-.6-.1-1.5-.3-2-.7-.4-.3-.4-.8.1-1 1.7-.8 2.7-2.3 2.6-2.8-.1-.4-.8-.7-1.4-.9-.7-.3-1-.7-.9-1.2.1-.4.6-.7 1.1-.5.3.1.7.1 1-.1 0-.6-.1-1.3-.1-2C7.5 4.4 9.3 2.4 12 2.4Z\"></path></svg>" },
  "tapjoy": { bg: "#FA4B5D", svg: "<svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"9.4\" r=\"3.4\" fill=\"#fff\"></circle><path fill=\"#fff\" d=\"M12 13.6c1.1 0 2 .9 2 2v3.9a2 2 0 1 1-4 0v-3.9c0-1.1.9-2 2-2Z\" opacity=\".92\"></path></svg>" },
  "tencent": { bg: "#0052D9", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M4.2 4.6h15.6v3.1h-6.1v11.7H10.3V7.7H4.2V4.6Z\"></path></svg>" },
  "tiktok": { bg: "#000", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#25F4EE\" d=\"M9.6 9.4v1.7a3.6 3.6 0 1 0 2.6 3.5V2.4h2.4a4.5 4.5 0 0 0 .4 1.8H12v12.4a5.9 5.9 0 1 1-5.9-5.9c.3 0 .6 0 .9.1v1.9a4 4 0 0 0-.9-.1\" opacity=\".85\"></path><path fill=\"#FE2C55\" d=\"M10.6 8.5v1.7a3.6 3.6 0 1 0 2.6 3.5V1.6h2.3a4.5 4.5 0 0 0 4 4v2.3a6.8 6.8 0 0 1-3.9-1.2v7A5.9 5.9 0 1 1 9.7 7.7c.3 0 .6 0 .9.1\" opacity=\".85\"></path><path fill=\"#fff\" d=\"M10.1 9v1.7a3.6 3.6 0 1 0 2.6 3.5V2h2.3a4.5 4.5 0 0 0 4 4v2.3a6.8 6.8 0 0 1-3.9-1.2v7a5.9 5.9 0 1 1-5.9-5.9c.3 0 .6 0 .9.1\"></path></svg>" },
  "unityads": { bg: "#0B0B0B", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M12 1.5 4.2 6v12l7.8 4.5 7.8-4.5V6L12 1.5Zm0 1.94 6.1 3.52-6.1 3.52-6.1-3.52L12 3.44ZM5.4 7.9l5.7 3.29v6.58L5.4 14.48V7.9Zm7.5 9.87v-6.58l5.7-3.29v6.58l-5.7 3.29Z\"></path></svg>" },
  "vungle": { bg: "#141414", svg: "<svg viewBox=\"0 0 24 24\"><path fill=\"#F73B3B\" d=\"M4.6 3.4 12 20.6l7.4-17.2h-4L12 12.2 8.6 3.4h-4Z\"></path></svg>" },
  "youappi": { bg: "#1B1464", svg: "<svg viewBox=\"0 0 24 24\"><circle fill=\"none\" stroke=\"#00E5C0\" stroke-width=\"2.2\" cx=\"12\" cy=\"12\" r=\"8.6\"></circle><path fill=\"#00E5C0\" d=\"M10 8.4 16 12l-6 3.6V8.4Z\"></path></svg>" },
};

/** our display names → ids, for places that only have the name (the landing page's lists) */
const BY_NAME: Record<string, string> = {
  applovin: "applovin", "unity ads": "unityads", unity: "unityads", "google ads": "google", google: "google", meta: "meta",
  facebook: "meta", "tiktok / pangle": "tiktok", tiktok: "tiktok", mintegral: "mintegral", ironsource: "ironsource",
  vungle: "vungle", liftoff: "liftoff", snapchat: "snapchat", moloco: "moloco", chartboost: "chartboost", dv360: "dv360",
  adcolony: "adcolony", inmobi: "inmobi", tapjoy: "tapjoy", fyber: "fyber", "fyber (digital turbine)": "fyber", smadex: "smadex",
  bigabid: "bigabid", kayzen: "kayzen", remerge: "remerge", "tencent ads": "tencent", tencent: "tencent", aarki: "aarki",
  "line ads": "line", line: "line", appreciate: "appreciate", revx: "revx", adikteev: "adikteev", youappi: "youappi",
  "mraid (generic)": "mraid", mraid: "mraid", "facebook instant games": "fbinstant",
};

export function networkIdFor(nameOrId: string): string {
  const k = nameOrId.trim().toLowerCase();
  return LOGOS[k] ? k : (BY_NAME[k] ?? k);
}

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  const caps = (words[0] ?? "?").match(/[A-Z0-9]/g) ?? [];
  return (caps.length >= 2 ? caps.slice(0, 2).join("") : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** A network's logo tile. `network` is an id ("applovin") or a display name ("Google Ads"). */
export function NetworkLogo({ network, name, size = 26, className = "" }: { network: string; name?: string; size?: number; className?: string }) {
  const id = networkIdFor(network);
  const logo = LOGOS[id];
  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.27),
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    overflow: "hidden",
  };
  if (!logo) {
    return (
      <span
        className={`net-logo net-logo-fallback ${className}`}
        aria-hidden="true"
        style={{ ...base, background: "#11704f", color: "#fff", fontWeight: 700, fontSize: Math.round(size * 0.38), letterSpacing: "0.02em" }}
      >
        {initials(name ?? network)}
      </span>
    );
  }
  const light = logo.bg.toLowerCase() === "#fff" || logo.bg.toLowerCase() === "#ffffff";
  return (
    <span
      className={`net-logo ${className}`}
      aria-hidden="true"
      style={{ ...base, background: logo.bg, boxShadow: light ? "inset 0 0 0 1px rgba(16,19,25,.12)" : "none", ["--net-glyph" as string]: `${Math.round(size * 0.62)}px` }}
      // static, hand-checked SVG strings from this file only
      dangerouslySetInnerHTML={{ __html: logo.svg.replace("<svg ", `<svg width="${Math.round(size * 0.62)}" height="${Math.round(size * 0.62)}" style="display:block" `) }}
    />
  );
}
