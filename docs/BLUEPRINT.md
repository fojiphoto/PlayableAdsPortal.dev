# PlayableAdsPortal — A-to-Z Technical Blueprint

> **Goal:** Build a from-scratch clone of **playableforge.io** — a SaaS that turns a single
> Unity build into correct, size-checked **playable ads** for 27 ad networks.
> This document is the single source of truth: recon findings, full architecture,
> data model, and the phased build plan.
>
> **Status:** Phase 0 (recon) complete. Target product is greenfield.
> **Last updated:** 2026-10-26

---

## 0. TL;DR

- **What it is:** One Unity build in → one correct playable per ad network out (AppLovin, Meta,
  TikTok, Mintegral, Unity Ads, Google… 27 total), each packaged, sized and named to that
  network's review spec.
- **How the original works:** A Unity **editor plugin** collects the scene + its asset
  dependency closure + the game's C#, zips it into a `.pfu` bundle, and uploads it. The
  **actual C# → tiny-web-playable compilation happens server-side** (cloud), *not* in the plugin.
  A **dashboard** then exports/validates per network.
- **The one real moat / black box:** the **server-side compiler** (C# + assets → a small
  purpose-built web runtime, not a full Unity WebGL build). Everything else is mapped.
- **Our strategy:** Decouple the two hard problems. **MVP = the per-network Packager**
  (any HTML5 playable → 27 correct network packages) — sellable on its own, ~10× easier.
  **Phase 2 = the Unity plugin + cloud compiler** (the moat).

---

## 1. The Problem

Playable-ad creators (UA teams, game studios, playable studios) must **re-export per network**.
Each network has its own:
- **Size cap** (≈2–5 MB; varies per network),
- **Format** (single inlined HTML, ZIP, or MRAID),
- **Orientation** rules,
- **Click / CTA mechanism** (`mraid.open()` vs `window.open` vs network callbacks),
- **Required lifecycle callbacks** (viewable, complete, etc.),
- **Validator** (a review tool that rejects anything off-spec).

Doing this by hand is slow and error-prone. The product removes it: **upload once, export to all.**

---

## 2. Recon Findings (how we know all this)

### 2.1 Frontend
- **React + Vite** SPA, single bundle (~451 KB `index-[hash].js`). No react-router (custom
  history routing). **Stripe** (billing), **Cloudflare Turnstile** (captcha/bot protection).
- Auth is **bearer-token** based (localStorage `xuna_token`), **not** cookies. Other localStorage
  keys seen: `xn_view`, `xuna_org`, `pf.humanpass`, `xuna_email`, `xuna_role`.
- Backend lives on a separate host: **`api.playableforge.io`** (frontend proxies `/api/*`).

### 2.2 Backend API surface — 92 endpoints (full map)

**Auth & Users**
```
/api/login              /api/signup             /api/signup/verify      /api/signup/resend
/api/password           /api/password/forgot    /api/password/reset     /api/password/reset/check
/api/me                 /api/users              /api/users/role         /api/users/password
/api/users/remove       /api/users/2fa-exempt
/api/2fa/status         /api/2fa/begin          /api/2fa/confirm        /api/2fa/disable
/api/captcha/config
```

**Orgs / Workspaces / Teams**
```
/api/orgs               /api/orgs/plan          /api/orgs/assign        /api/orgs/unassign
/api/orgs/domain        /api/orgs/remove        /api/orgs/seen          /api/orgs/unseen
/api/orgs/{id}/members
/api/workspaces         /api/workspaces/switch
/api/domain             /api/domain/check
```

**Billing (Stripe)**
```
/api/billing/config     /api/billing/checkout   /api/billing/subscription
/api/billing/prices     /api/billing/cancel     /api/billing/resume      /api/billing/sync
```

**Apps / Concepts / Creatives (the content hierarchy)**
```
/api/apps               /api/apps/update        /api/apps/sample        /api/apps/remove
/api/apps/{id}/icon     /api/apps/{id}/icon/refresh
/api/concepts           /api/concepts/rename    /api/concepts/config    /api/concepts/remove
/api/concepts/network-order     /api/concepts/{id}/file
/api/creatives/
```

**The CORE pipeline**
```
/api/plugin/download    /api/plugin/version     /api/plugin/downloads
/api/plugin/bans        /api/plugin/bans/{id}/lift
/api/compile/jobs       /api/compile/jobs/{id}
/api/export             /api/exports/           /api/download           /api/download-all
/api/preview            /api/analyze            /api/networks
/api/assets             /api/assets/remove
```

**Asset Kit / Branding (custom preloader/splash)**
```
/api/kit/create         /api/kit/preview        /api/kit/templates
```

**Analytics**
```
/api/analytics          /api/analytics/import   /api/analytics/links    /api/analytics/measurement
/api/capture/import     /api/capture/latest
```

**Support / Ops / Feedback**
```
/api/support/thread     /api/support/threads    /api/support/threads/reply
/api/support/threads/view       /api/support/unread
/api/feedback/bug       /api/feedback/bugs      /api/feedback/bugs/handled
/api/contact            /api/contact/handled
/api/reminders          /api/reminders/auto     /api/reminders/logins   /api/reminders/run
/api/reminders/send
```

### 2.3 Domain verification gate
After signup, an org must **prove ownership of its company domain** before it can download the
SDK or add apps. Any **one** of:
1. Sign up / be added with a **company-domain email** (not a public one like Gmail) — auto-verifies.
2. **DNS/HTTP file proof:**
   - Add a comment line to `https://<domain>/app-ads.txt`: `# pfv-<token>`, **or**
   - Put the token alone in `https://<domain>/playableforge-verify.txt`, then press **Check now**.
3. Email support for manual verification.
Backed by `/api/domain/check`, `/api/orgs/domain`. Classic Search-Console-style ownership proof.

### 2.4 The Unity plugin (decompiled — the big unlock)
Ships as a `.unitypackage` (v2.50.0, Unity 6 / 6000.0+, ~340 KB gzip) containing **obfuscated DLLs**:
- `Assets/PlayableForge/Editor/PlayableForge.Editor.dll` — **704 KB, all the logic**
- `Assets/PlayableForge/Runtime/PlayableForge.Runtime.dll` — **6.6 KB, public API facade**
- `Editor/PlayableForgeLicense.json`, `Editor/PlayableForgeRelease.json`, `EULA.md`, `LICENSE`

**Licensing:** `PlayableForgeLicense.json` carries a per-download **watermark** (`wm`) + **RSA
signature** (`sig`), verified in-plugin via **SHA256 + RSASignaturePadding.Pkcs1**. `Release.json`:
`version, commit, keys:"production", license_kid, export_kids`. So each download is uniquely
fingerprinted — relevant if we ever distribute our own plugin.

**What the Editor DLL actually does (from decompiled behaviour):**
1. Editor window with tabs: **Settings · Scenes · Assets · Code · Runtime Analysis · Preview ·
   Build & upload · Size breakdown · Plugin updates** (menu: `PlayableForge/Compiler Window %#x`
   = Ctrl+Shift+X; also `Compiler Settings`, `Build (headless settings)`).
2. Collects the selected scene + its **asset dependency closure**
   (`AssetDatabase.GetDependencies`, `FindAssets`, `GUIDToAssetPath`, `LoadAssetAtPath`).
3. Installs/uses **Roslyn** (`PLAYABLEFORGE_ROSLYN`, `RoslynInstaller`) to **statically analyze
   the game's C#** for unsupported APIs → the "Code: nothing unsupported" check.
4. Packages everything into a **ZIP/gzip bundle** named `playableforge-upload.pfu`
   (`ZipArchive`, `GZipStream`, `DeflateStream`).
5. **Uploads** it via **multipart** (`MultipartFormDataSection`, `UnityWebRequest`/`HttpClient`,
   **Bearer** auth) to `/api/compile/jobs`.
6. **Never calls `BuildPipeline`/`BuildPlayer`** — it does **not** build the game locally.
7. Self-updates (`/api/plugin/version` → `importPackage`).

> **Decompiled source on disk:** `_recon/decompiled/PlayableForge.Editor.cs` (60k lines, names
> obfuscated to single letters but strings/API-calls/control-flow intact) and
> `PlayableForge.Runtime.cs`. Raw DLLs in `_recon/plugin/dlls/`.

### 2.5 The Runtime API (what game developers call in their C#)
`Runtime.dll` methods are **empty stubs in the editor**; their real implementations are **injected
server-side** when the game is compiled to web. This is the dev-facing contract we must replicate:

```csharp
// Mark a field as a dashboard-tunable "custom variable"
[PlayableForgeField(displayName, order, section, Min=, Max=)]
[PlayableForgeFieldStep(step)]

Playable.InstallFullGame(iosLink, androidLink);   // CTA / store-open
Playable.GetPlatform();  Playable.SetLoadingProgress(f);
Playable.GetPreferredLanguage();  Playable.GetPreferredLanguages();

LifeCycle.GameLoaded(); GameStarted(); GamePaused(); GameResumed();
LifeCycle.GameEnded(...); LifeCycle.LevelChanged(...);
LifeCycle.HapticTriggered(HapticFeedbackType.{Light…Error,Selection});
LifeCycle.OnPause / LifeCycle.OnResume;            // events

Analytics.LogEvent(name|EventType, value);         // EventType: LevelStart, LevelWon,
                                                   // LevelFailed, LevelRetry, EndCardShown,
                                                   // TutorialStarted, TutorialComplete, CUSTOM
Analytics.Applovin.LogChallenge{Started,Failed,Retry,Pass25,Pass50,Pass75,Solved}();
```

---

## 3. System Architecture

```
          ┌──────────────────────────── DEV's Unity project ────────────────────────────┐
          │  game C# (uses PlayableForge Runtime API) + scenes + prefabs + assets        │
          └───────────────────────────────────┬──────────────────────────────────────────┘
                                               │  Unity Editor Plugin
                                               │  • pick scene, set end card / CTA / assets
                                               │  • dependency-closure collect
                                               │  • Roslyn static analysis (unsupported APIs)
                                               │  • ZIP → playableforge-upload.pfu
                                               ▼  multipart + Bearer
                                     POST /api/compile/jobs
                                               │
             ┌─────────────────────────────────▼─────────────────────────────────┐
             │   🔒  SERVER-SIDE COMPILER   (the only black box / the real moat)   │
             │   C# + assets  ──►  tiny purpose-built WEB playable                 │
             │   • strips engine features the ad never uses                        │
             │   • wires Runtime API stubs → real MRAID / network calls            │
             │   • produces a single "master" interactive playable                 │
             └─────────────────────────────────┬─────────────────────────────────┘
                                               ▼
             ┌───────────────────────── PER-NETWORK PACKAGER ─────────────────────┐
             │  master playable ──►  27 network-specific packages                 │
             │  • MRAID wrap / single-HTML inline / ZIP per spec                  │
             │  • CTA + click handler rewrite   • size cap check   • validate     │
             └─────────────────────────────────┬─────────────────────────────────┘
                                               ▼
          DASHBOARD:  Apps ▸ Concepts ▸ Creatives → preview (phone frame) → export → download
          + Orgs/Workspaces/Roles, 2FA, Stripe billing, domain-verify gate, analytics, support
```

**Async job model:** uploads become **compile jobs** (`/api/compile/jobs`, polled by `{id}`),
processed by background workers — heavy CPU work is off the request path.

---

## 4. Data Model (inferred)

```
User ──* Membership *── Org ──* Workspace
Org    : plan, domain(verified), billing(stripe_customer/subscription), 2fa policy, export quota
App    : name, platform (iOS/Android icons), icon  ── belongs to Org
Concept: belongs to App, has network-order + config        (a creative "idea")
Creative / Export: belongs to Concept                      (a built playable + per-network outputs)
CompileJob: .pfu upload → status → produces master playable + size breakdown + warnings
Asset / Kit: custom preloader/splash/logo (templates)
License: per-plugin-download watermark + RSA signature
```

Hierarchy in UI: **App → Concept → Creative** (e.g. `Construction ASMR ▸ castle_v2 ▸ Creative 1`).
Export quota: **each network export counts as 1**; Free = unlimited **Unity Ads only**;
paid tiers reset every 30 days.

---

## 5. Per-Network Packaging Spec (the heart of our MVP)

A **config-driven** engine — each network is a declarative spec, not bespoke code:

```js
// example shape
applovin: {
  format: 'mraid-single-html',      // mraid-single-html | single-html | zip
  maxSizeMB: 5,
  orientation: 'both',              // portrait | landscape | both
  clickHandler: 'mraid.open',       // mraid.open | window.open | custom callback
  requiredHooks: ['mraid.ready', 'mraid.open'],
  inlineAssets: true,               // base64 everything into one HTML
  validate: [ sizeUnderCap, hasRequiredHooks, orientationOk, singleFileOk ],
}
```

- Adding a network = writing one spec object + (rarely) a wrapper template.
- **MRAID** covers AppLovin, ironSource, Vungle, Liftoff, etc.; **single-HTML** and **ZIP**
  cover the rest. 27 networks total.
- **Validator-matching** is the promise: output must pass each network's own review tool.

**Phase-1 priority networks** (biggest spend + simplest specs):
`AppLovin, Unity Ads, Mintegral, Meta, ironSource, Google`.

Full target list (27): AppLovin, Unity Ads, Google Ads, Meta, TikTok, Mintegral, Vungle,
ironSource, Liftoff, DV360, Snapchat, Moloco, Chartboost, Remerge, Tencent, AdColony, Aarki,
InMobi, Fyber, Tapjoy, LINE, Appreciate, BigaBid, RevX, Adikteev, YouAppi, (+ MRAID generic).

---

## 6. The Black Box — Server-side Compiler (Phase 2 research)

The hardest, hidden part. Options, hardest→most practical:

| Option | Approach | Verdict |
|--------|----------|---------|
| **A. IL2CPP/transpile → JS** | Luna-Labs style: convert C#/IL to JS + custom tiny WebGL renderer | Real moat, years of work |
| **B. Stripped Unity WebGL** | Standard WebGL + aggressive code/asset stripping, inline to single HTML | Often still too big (>3 MB) |
| **C. Capture + lightweight runtime** | Capture gameplay/assets from Unity, replay in a small JS engine (note: original has `/api/capture/*`) | Smaller output, semi-interactive |
| **D. HTML5 re-authoring** | Plugin exports scene data; rebuild rendering in Pixi/Three; logic re-authored | Medium, but not "zero-rewrite" |

Evidence the original is **not** full Unity WebGL: plugin ships a tiny 6.6 KB runtime, markets a
"purpose-built runtime", and compiles **server-side**. Our Phase-2 spike must pick A–D with a real
size budget (target single playable **≤ 3–5 MB**). **This is the biggest risk — schedule a spike
before committing.**

---

## 7. Build Plan (phased)

### Phase 0 — Recon ✅ (done)
92 endpoints mapped, plugin decompiled, runtime API captured, architecture understood.

### Phase 1 — MVP: "The Packager" (start here)
- **Input:** any HTML5 playable (folder/zip). **Output:** 6 networks, validated + sized + named.
- Web dashboard: upload → device-frame preview → export per network → download / download-all.
- Config-driven network spec engine + validator.
- Minimal auth + App/Concept/Creative structure. Stub billing (Stripe test mode).
- **Why first:** sellable alone, demoable without the Unity compiler, and it's the receiving end
  the plugin will later feed.

### Phase 2 — Unity plugin + cloud compiler (the moat)
- C# editor package: scene/CTA/asset marking, dependency-closure collect, Roslyn analysis,
  `.pfu` zip + multipart upload.
- Compile-jobs backend + the **server-side compiler spike** (Section 6).
- Runtime API facade (Section 2.5) + server-side wiring to MRAID/network calls.

### Phase 3 — Scale
Teams/workspaces/roles, 2FA, full Stripe billing + quotas, analytics, custom preloader kit,
support/feedback, remaining 21 networks, plugin self-update + licensing.

---

## 8. Recommended Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React + Vite + Tailwind | Matches original; fast, proven |
| Backend | Node (Fastify/NestJS) REST | Packaging = JS/HTML manipulation; natural fit |
| DB | Postgres | Orgs/apps/concepts/exports/billing |
| Queue | Redis + BullMQ | Compile/packaging job workers |
| Workers | Node (HTML inliner, MRAID wrapper, validators) | |
| Storage | S3 / Cloudflare R2 | Builds + exports |
| Billing | Stripe | Subscriptions + quotas |
| Captcha | Cloudflare Turnstile | Bot protection |
| Plugin | C# Unity 6 editor package (UPM/.unitypackage) | Phase 2 |
| Compiler host | TBD after Section 6 spike | The moat |

**Deployment / hosting:** Our product deploys to **`factorialstudio.dev`** (our domain) — same
pattern as the original on playableforge.io. A separate API host (e.g. `api.factorialstudio.dev`)
mirrors their frontend/`api.` split. The org's domain-verify gate (§2.3) will check
`factorialstudio.dev` ownership the same way.

---

## 9. Business Model (reference)

| Plan | Price (launch 50% off) | Limit |
|------|------------------------|-------|
| Free | $0 | Unlimited exports, **Unity Ads only** |
| Starter | $200/mo (orig $500) | 30 exports / 30 days, all 27 networks |
| Studio ⭐ | $1000/mo (orig $2500) | 100 exports / 30 days, priority support |
| Enterprise | Custom | Unlimited + custom network ordering |

Positioning vs competitors ($6k–$15k/mo): ~10× cheaper. Free tier = acquisition hook.

---

## 10. Open Questions / Risks

1. **Server-side compiler (Section 6)** — the make-or-break unknown. Spike before committing.
2. Exact **`.pfu` manifest format** — not fully decoded (upload field names were obfuscated/
   constructed). Decode by capturing a real upload or reading the uploader method deeply (REA).
3. Exact **per-network specs** (current caps/formats) — must be researched + kept updated.
4. Legal: the original plugin's **EULA likely forbids reverse engineering**; we build clean-room
   from behaviour/specs, not by copying their obfuscated code.
5. Does the compiler need the game's **C# source** or **compiled assemblies**? (Roslyn analysis is
   local; final compile is server-side — confirm what the `.pfu` actually ships.)

---

## 11. Appendix — artifacts on disk

```
F:\PlayableAdsPortal\
├─ PlayableAdsUnitySDK\        # test Unity project (Unity 6000.3.12f1, URP template)
├─ docs\BLUEPRINT.md           # this file
└─ _recon\
   ├─ plugin\
   │  ├─ plugin.unitypackage        # original downloaded package (v2.50.0)
   │  ├─ extracted\                 # unpacked GUID folders
   │  └─ dlls\  PlayableForge.Editor.dll (704 KB), PlayableForge.Runtime.dll (6.6 KB)
   ├─ decompiled\  PlayableForge.Editor.cs (60k lines), PlayableForge.Runtime.cs
   └─ decomp\       # ICSharpCode.Decompiler runner project
```

Plugin: **v2.50.0**, commit `2400c64`, Unity 6 (6000.0)+. Original hosts:
`playableforge.io` (SPA) + `api.playableforge.io` (REST).
