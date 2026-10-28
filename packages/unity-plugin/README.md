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
```
