# Factorial AdLab — Unity plugin (`com.factorialstudio.adlab`)

Build playable ads from your Unity game and upload them to **Factorial AdLab**
(`app.factorialstudio.dev`), which packages them for 20+ ad networks.

> **Status: Phase 2.0 skeleton.** The editor window + sign-in work today; the capture→build→upload
> pipeline lands in 2.1. See [../../docs/PHASE2.md](../../docs/PHASE2.md) for the full design and
> why we use a **capture-based** builder (not a full Unity→WebGL compile).

## Install (local)

Package Manager → **Add package from disk…** → select `packages/unity-plugin/package.json`.
(Or copy this folder into your project's `Packages/`.)

## Use

- **Tools path:** `Factorial AdLab ▸ Playable Builder`.
- Sign in with your `app.factorialstudio.dev` account.
- (2.1) Pick a scene + capture window → the plugin records gameplay, builds a lightweight HTML5
  playable, and uploads it to your dashboard, where it exports to every network.

## Layout

```
Runtime/Playable.cs   — dev-facing API façade ([AdLabField], Playable.*, LifeCycle.*)
Editor/FactorialAdLabWindow.cs — the editor window (sign-in now; capture/upload in 2.1)
```
