# Phase 2 — Unity Plugin + Compiler (design / spike)

## The hard truth about the "compiler"

Playableforge.io's real moat is a **cloud compiler** that turns a Unity build into a tiny
(≤2–5 MB) web playable. Our recon confirmed it compiles the game's C# **server-side** and ships a
purpose-built runtime (not a general Unity WebGL build).

**Building that from scratch is Luna-Labs-level R&D (IL2CPP/C#→JS transpile + a custom WebGL
renderer) — months-to-years, not a sprint.** And it only matters for games simple enough to fit an
ad cap.

The live test project makes this concrete: **"Beat Matrix: Hop Ball 3D"** is a full 3D URP game
(Cinemachine, VFX Graph, Timeline, gltFast). A straight Unity **WebGL build of a game like this is
20–50 MB+** — it can never fit a 2–5 MB network cap, no matter how we strip it. So "compile any
Unity game to a tiny playable" is **not** an achievable near-term target.

## What real playable ads for heavy games actually are

Studios do **not** ship the whole 3D game as a playable. A playable ad for a game like Hop Ball is
a **lightweight, semi-interactive recreation** — captured/rebuilt gameplay with one or two tap
interactions and an end-card CTA. That's the industry norm, and it's what fits the size caps.

## Three approaches (and our pick)

| # | Approach | Output size | Effort | Fit |
|---|----------|-------------|--------|-----|
| A | Unity WebGL build + strip/compress | 15–50 MB | Medium | ❌ busts caps for real games |
| B | **Capture-based** — record gameplay (Unity **Recorder**, already installed) → sprite/video playable + tap hotspots + CTA | **1–4 MB** | Medium | ✅ fits caps, matches industry |
| C | Full C#→JS transpiler + custom runtime (the moat) | 1–5 MB | Years | ⏳ long-term only |

**Pick: B (capture-based), designed so C can slot in later.** It produces real, cap-sized playables
now, uses the Recorder package the project already has, and feeds straight into the HTML5 packager
we already built and shipped.

## Architecture (Phase 2 MVP)

```
Unity Editor
  └─ Factorial AdLab plugin (C# editor window)
       • Sign in with the app.factorialstudio.dev account (bearer token)
       • Pick a scene + a capture window (e.g. 8–12 s of gameplay)
       • Record via com.unity.recorder → frames / short clip + key sprites
       • Build a lightweight HTML5 playable: canvas player that plays the capture,
         one tap interaction, Factorial AdLab runtime shim (PF.install / lifecycle),
         end-card + CTA
       • Upload it to  POST /api/concepts/:id/creatives   (our EXISTING pipeline)
  ↓
Our server + @forge/packager  (already built, live)
  └─ inlines, wraps per-network (MRAID/CTA), size-checks, exports to 20+ networks
```

The plugin's job is to **produce one self-contained HTML5 playable and hand it to the pipeline we
already have.** No new server compiler needed for the MVP — the packager does the per-network work.

## Plugin pieces (buildable now)

1. **UPM package** `packages/unity-plugin/` → `com.factorialstudio.adlab`
   - `Editor/FactorialAdLabWindow.cs` — the editor window (sign-in, scene pick, capture, upload).
   - `Editor/Uploader.cs` — UnityWebRequest multipart upload to our API.
   - `Editor/PlayableBuilder.cs` — assembles the captured frames + runtime into one HTML.
   - `Runtime/Playable.cs` — the dev-facing API façade (`Playable.InstallFullGame`, `LifeCycle.*`,
     `[AdLabField]`) mirroring what we found in the decompiled PlayableForge runtime.
2. **Capture** — drive `com.unity.recorder` to grab an image sequence (or a short mp4) of play mode.
3. **Builder** — pack frames (downscaled/compressed) into a `<canvas>` player + tap + CTA + shim →
   one HTML file; POST to the API.

## Roadmap

- **2.0 ✅:** plugin skeleton — editor window + sign-in + scene pick.
- **2.1 ✅:** Play-mode frame capture (Game view → JPEG sequence) → `buildCapturePlayable` canvas
  flipbook (tap + end-card + CTA) → upload → export. Validated end-to-end.
- **2.2 ✅:** interaction authoring (a tap-zone hotspot with a pulsing indicator + required taps,
  looping the clip until completed), end-card editor (logo, title, subtitle, themed CTA), and size
  tuning (`frameBudgetBytes` drops frames evenly to hit tighter caps). Plumbed through the capture
  endpoint and the Unity plugin window.
- **2.3 ✅ (approach A/B — the game itself):** `compileUnityWebGL` in the packager turns a Unity WebGL
  build into ONE self-contained HTML playable (loader inlined, framework/wasm/data embedded as blob: URLs,
  StreamingAssets served through a fetch/XHR shim, gzip/brotli decompressed) with a size breakdown and
  cap guidance. It runs as a `compile` job (`POST /api/concepts/:id/compile`, alias `/api/compile/jobs`);
  the plugin's **Build, compile & upload playable** runs a size-optimised WebGL build (compression off,
  High stripping, no exceptions, IL2CPP size-optimised, Player Settings restored afterwards) and polls the
  job; the dashboard's upload form has a **Unity WebGL build** mode with the same breakdown. Base64 adds
  ~33 %, so a 5 MB network needs a ≈3.5 MB raw build — right for light / hyper-casual games; heavy 3D games
  stay on the capture path.
- **2.4+ (long-term moat):** C#→JS transpile + purpose-built renderer for sub-MB output (approach C).

## Integration note

The plugin uploads frames to **`/api/concepts/:id/capture`**, a sibling of the web dashboard's
`/api/concepts/:id/creatives`. The server builds the flipbook playable via `buildCapturePlayable`
(in `@forge/packager`) and stores it as an ordinary creative, so a Unity-made playable lands in the
same App ▸ Concept ▸ Creative hierarchy and exports to every network through the packager.

The capture builder lives in the packager (not C#): the plugin just grabs frames + uploads, so the
"compiler" is one tested TypeScript function shared by any future capture source.
