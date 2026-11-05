# Changelog

The server reads the entry for the current `package.json` version as the release notes shown in the
plugin window and the dashboard. Keep `Editor/AdLabBuildInfo.cs` in step with `package.json`.

## [0.2.1] - 2026-11-05

- Sign in with two-factor authentication: the window asks for your authenticator code when your account uses 2FA.

## [0.2.0] - 2026-11-05

- Download the plugin from your dashboard (Settings ▸ Unity plugin) as a .unitypackage licensed to you.
- The plugin checks for updates and updates itself from the Playable Builder window.
- Shows your licence code; the server can refuse outdated or revoked copies with a clear message.

## [0.1.0] - 2026-10-30

- Build, compile & upload: the game as a single-file WebGL playable with a size breakdown.
- Capture & upload: a recorded clip with a tap zone and end card.
- Runtime API: `Playable`, `LifeCycle`, `Analytics`, `[AdLabField]` dashboard-tunable variables.
