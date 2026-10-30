# Factorial AdLab — Unity plugin (`com.factorialstudio.adlab`)

Build playable ads from your Unity game and upload them to **Factorial AdLab**
(`app.factorialstudio.dev`), which packages them for 20+ ad networks.

> **Status: Phase 2.1 — capture pipeline live.** Sign in, press Play, and **Capture & upload
> playable** records a short gameplay clip, uploads the frames, and the server builds a lightweight
> HTML5 playable stored as a creative ready to export to every network. See
> [../../docs/PHASE2.md](../../docs/PHASE2.md) for the full design and why we use a **capture-based**
> builder (not a full Unity→WebGL compile).

## Install (local)

Package Manager → **Add package from disk…** → select `packages/unity-plugin/package.json`.
(Or copy this folder into your project's `Packages/`.)

## Two ways to make a playable

| | **Compile the game** (Phase 2.3) | **Capture gameplay** (Phase 2.1/2.2) |
|---|---|---|
| What ships | The real game — a size-optimised Unity WebGL build folded into one HTML file | A short recorded clip replayed as a canvas flipbook with a tap zone + end-card |
| Button | **Build, compile & upload playable** (exit Play mode) | **Capture & upload playable** (in Play mode) |
| Fits | Light / hyper-casual games (network caps are 2–5 MB; base64 embedding adds ~33 %) | Any game, incl. heavy 3D |
| You get | Size breakdown (code / assets / framework / loader), which networks it fits, what to cut | A cap-sized playable every time |

The compile path sets Player Settings for a playable (WebGL compression off, High managed stripping,
no exceptions, strip engine code, IL2CPP size-optimised, minimal template, no data caching) for the
build only and restores your settings afterwards. Requires the **WebGL Build Support** module.

**Measured on Unity 6000.2 (one-cube test game, every size setting on): 11.8 MB wasm → 20 MB single file.** The
Unity 6 player alone is far above the 2–5 MB caps, so use the compile path to measure and to make web demos, and
the capture path to ship to networks. Components your scripts create only at runtime (e.g. a `CreatePrimitive`
collider) are removed by engine-code stripping — reference them in a scene or add a `link.xml`.

Headless build (CI): `Unity -batchmode -nographics -quit -projectPath <proj> -buildTarget WebGL -executeMethod FactorialAdLab.Editor.WebGLCompileUploader.BuildFromCommandLine -adlabOut <dir>`.

Your game talks to the ad through `FactorialAdLab.Playable.InstallFullGame()`, `LifeCycle.GameStarted()/GameEnded()`
and `Analytics.LogEvent("name")` — a WebGL `.jslib` bridges them to the per-network runtime shim.

## Use

- **Tools path:** `Factorial AdLab ▸ Playable Builder`.
- Sign in with your `app.factorialstudio.dev` account.
- Set the game name, clip length (frames × fps), capture width and CTA/store URLs.
- Optionally author a **tap-zone interaction** (a hotspot the player must tap, with a pulsing
  indicator and a required-tap count) and an **end-card subtitle**.
- Press **Play**, start gameplay, then **Capture & upload playable**. The plugin grabs the clip
  from the Game view, uploads the frames, and the server builds the playable under a concept in
  your dashboard — open it there and **Export** to every network.

Capture runs *inside* a running Play session (that's why the button is enabled only in Play mode):
toggling Play from the editor triggers a domain reload that would interrupt the capture.

## Layout

```
Runtime/Playable.cs              — dev-facing API façade ([AdLabField], Playable.*, LifeCycle.*)
Editor/FactorialAdLabWindow.cs   — the editor window (sign-in + capture settings + button)
Editor/CaptureUploader.cs        — grabs Game-view frames in Play mode, uploads to /api/.../capture
Editor/WebGLCompileUploader.cs   — WebGL build → zip → /api/.../compile job → polls progress + size breakdown
Runtime/Plugins/WebGL/*.jslib    — bridges Playable/LifeCycle/Analytics to the runtime shim (window.PF)
```
