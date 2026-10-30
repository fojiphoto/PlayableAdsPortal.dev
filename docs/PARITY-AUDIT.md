# Factorial AdLab vs playableforge.io — Feature-Parity Audit

**Date:** 2026-10-29 · **Benchmark:** the competitor (playableforge.io) as the ideal product — "whatever they have, we must have."
**Method:** an independent read of `docs/BLUEPRINT.md` (the full competitor recon: ~92 API endpoints, plugin internals,
pricing, networks) against the actual code in `packages/*`. Judged by code, not by docs. Tests: `npm test` → **40/40 green**
(packager 18, server 22) — note the suite covers the happy paths of what exists, not parity.

## Headline

The Phase‑1 "Packager" slice is real and tested (upload → inline → per‑network wrap → size check → preview → download,
with plans/quota, Stripe billing, 2FA, team, preloader, domain token). Against the competitor as the benchmark:

- **~35–40% API parity** — 41 route handlers / 34 paths vs their ~92.
- ~~**20 of 27 networks**~~ → **29 networks** as of 2026-10-29 (all 27 of the competitor's + Smadex, Kayzen).
- **The core differentiator — a Unity C# → interactive web-playable compiler — is absent by design**, replaced by a
  pixel‑capture flipbook (PHASE2.md "approach B").
- Several DONE‑looking features are **shells**: the domain gate gates nothing, team roles authorize nothing,
  in‑playable analytics is a no‑op. *(Fixed 2026-10-29: the runtime now emits each network's real CTA/lifecycle hook and
  the validator checks bundled SDKs, a real click-through, orientation and allowlisted externals — see Gap #1.)*

## Live state (added by the build session, 2026-10-29)

- **Billing, test mode:** verified end‑to‑end on the live app — Checkout → test card → subscription → webhook → plan
  upgraded to Starter. Required fix found & shipped: webhook must also subscribe to `customer.subscription.created`.
- **Billing, live mode:** live prices + live webhook (4 events) created; live keys in Render; deployed. Checkout session
  creation currently fails with *"No valid payment method types"* because the **Stripe account activation is incomplete**
  ("capabilities paused — required task overdue"). No code change needed; blocked on account verification.
- Until Stripe is verified, customers can use everything **except paying for a paid plan** (Free tier works).

---

## 1. Parity matrix

Legend: **DONE** / **PARTIAL** / **MISSING**. Evidence is `file:line` or route.

### 1.1 Auth & account
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| `/login`, `/signup` (bearer token) | DONE | `routes/auth.ts`; token key `forge_token` `web/src/api.ts` |
| `/signup/verify`, `/signup/resend` (email verification) | MISSING | No mail transport anywhere. Signup returns a token immediately |
| `/password/forgot`, `/password/reset`, `/password/reset/check` | MISSING | Only authenticated change exists (`routes/account.ts`) |
| `/password` (change) | DONE | `routes/account.ts` (`/api/users/password`) |
| `/me` | DONE | `routes/auth.ts` (also returns plan status) |
| `/2fa/status|begin|confirm|disable` | DONE | `routes/account.ts`; TOTP RFC 6238 `totp.ts`; replay guard |
| `/users`, `/users/role`, `/users/remove`, `/users/2fa-exempt` | PARTIAL | `/api/team` list/invite/remove. No role-change; `role` stored but **never read for authorization** (`repo.ts accessibleOwnerIds`). No 2FA-exempt |
| `/captcha/config` (Turnstile) | MISSING | No captcha on signup/login |
| Login brute-force protection | DONE | `routes/auth.ts` (in-memory, single instance) |

### 1.2 Orgs / Workspaces / Teams
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| Org entity (plan, domain, billing, 2FA policy, quota on Org) | MISSING | No `orgs` table; everything is per-user on `users` |
| `/orgs/*` (9 endpoints), `/workspaces`, `/workspaces/switch` | MISSING | No workspace concept or switcher |
| Shared access to another user's apps | PARTIAL | `memberships` owner→member; flat; roles unenforced; invitee must already have an account; no email invite; members can't delete |

### 1.3 Billing & plans & quota
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| Stripe Checkout | DONE | `routes/billing.ts`, raw REST client `stripe.ts` |
| Webhook (signature-verified) | DONE | `billing.ts`, `stripe.ts verifyWebhook` |
| `/billing/config`, `/billing/prices` | PARTIAL | Hard-coded catalog `plans.ts`; no publishable-key/config endpoint |
| `/billing/subscription` | PARTIAL | `/api/billing/status` = plan+usage; subscription id/status stored but **not surfaced** (no renewal date / cancel-at-period-end) |
| `/billing/cancel`, `/billing/resume` | PARTIAL | Delegated to Stripe portal; no in-app cancel/resume |
| `/billing/sync` | MISSING | Webhook-only, no manual reconcile |
| Plans Free / Starter / Studio / Enterprise | DONE | `plans.ts` |
| Free = unlimited Unity Ads only | DONE | enforced in `plan-status.ts` |
| Rolling 30-day export quota | DONE | `plan-status.ts`, `creatives.ts` (re-export doesn't re-charge) |
| Pricing (theirs ≈ $200 / $1000) | PARTIAL (deliberate) | Ours $49 / $199 — positioning choice |
| Enterprise "custom network ordering" | MISSING | Advertised in `plans.ts` + landing; nothing implements it |

### 1.4 Apps / Concepts / Creatives
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| App → Concept → Creative hierarchy | DONE | `db.ts`; sidebar `App.tsx` |
| `/apps` create/list/get/remove | DONE | `routes/apps.ts` |
| `/apps/update` (rename/edit) | MISSING | No PUT/PATCH |
| `/apps/sample` | MISSING | — |
| `/apps/{id}/icon`, `/icon/refresh` (store icon) | MISSING | `platform` column unused for icons |
| `/concepts` create/list/get/remove | DONE | `routes/apps.ts` |
| `/concepts/rename`, `/concepts/config`, `/concepts/network-order` | MISSING | — |
| `/concepts/{id}/file` (source download) | MISSING | `source_zip` stored, no route serves it |
| Dashboard-tunable custom variables (`[PlayableForgeField]` → UI) | MISSING | `[AdLabField]` declared in `Runtime/Playable.cs` but nothing reads it |

### 1.5 Upload & packaging engine
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| Config-driven network spec engine | DONE | `packager/src/types.ts`, `networks.ts` |
| Multi-file → single self-contained HTML inliner | DONE | `inline.ts` |
| ZIP / single .html input | DONE | `source.ts`, `creatives.ts` |
| MRAID / single-HTML / ZIP output formats | DONE | `pack.ts`, `wrap.ts` |
| **CTA rewrite per network** | PARTIAL | Shim picks `mraid.open` if present else `window.open`. **No network-specific hooks**: Google `ExitApi.exit()`, AppLovin `CHALLENGE_*`, Meta `FbPlayableAd.onCTAClick()`, Mintegral `gameReady()/install()`, Pangle `openAppStore()`, ironSource `dapi.js` |
| Required lifecycle callbacks (viewable/ready/complete) | PARTIAL | Empty `mraid ready` listener; CTA not gated on ready; no `viewableChange` |
| Async compile/packaging jobs | MISSING | Export & capture are synchronous handlers; no queue/worker |
| `/analyze` (per-asset size breakdown) | MISSING | Only total size vs cap |
| `/assets`, `/assets/remove` | MISSING | — |
| Size caps verified against networks | PARTIAL | Code self-labels caps as placeholders to verify (`networks.ts`) |

### 1.6 Export / validation
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| `/export` per network, persisted | DONE | `creatives.ts`, `repo.ts` |
| `/exports/` list | PARTIAL | Only inside creative detail; no cross-creative history |
| Validator-matching ("passes each network's review tool") | PARTIAL | Checks size cap, external refs, viewport, mraid-ref. **Orientation never validated.** **`no-mraid-ref` is dead** — validation runs after shim injection, and the shim always contains "mraid", so it always passes |
| Per-network output naming | DONE | `pack.ts` |

### 1.7 Preview / device frame
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| `/preview` of exported playable | DONE | `creatives.ts`; `DevicePreview.tsx` |
| Phone-frame preview + orientation toggle | DONE | `DevicePreview.tsx` |
| MRAID stub in preview | MISSING | `window.mraid` undefined in the frame → MRAID CTA path never exercised |
| Shareable preview link | PARTIAL | UUID-guarded URL is shareable; no QR/short link UI |

### 1.8 Download — DONE (`/download/:network`, `/download-all`).

### 1.9 Preloader / loading screen (Asset Kit)
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| Custom preloader (logo + bg) in exports | DONE | `routes/preloader.ts`, `wrap.ts` |
| `/kit/templates` | MISSING | One fixed layout |
| `/kit/preview` (server-rendered) | PARTIAL | Client-side mock only |
| Per-concept/app kit | PARTIAL | One global kit per user |

### 1.10 Domain verification (app-ads.txt gate)
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| Token + verify file / `# token` in app-ads.txt / Check now | DONE | `routes/domain.ts` (+ SSRF guard) |
| Company-domain-email auto-verify | MISSING | — |
| **The gate itself** (block until verified) | MISSING | `domain_verified` is never read by apps/creatives/UI. Verification is cosmetic |
| Org-level domain | MISSING | Per user |

### 1.11 Analytics
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| `/analytics` | PARTIAL | Ours = export-usage counts. Theirs = in-playable gameplay events |
| In-playable events (`Analytics.LogEvent`) | MISSING | Shim `analytics.logEvent` is a no-op; no ingestion endpoint |
| `/analytics/import|links|measurement` | MISSING | — |

### 1.12 2FA / security — TOTP DONE; org 2FA policy / 2FA-exempt / captcha MISSING.

### 1.13 Unity plugin / SDK
| Competitor feature | Status | Evidence / what's lacking |
|---|---|---|
| Editor window with sign-in | DONE | `Editor/FactorialAdLabWindow.cs` |
| Tabs: Settings · Scenes · Assets · Code · Runtime Analysis · Preview · Build&upload · Size breakdown · Updates | PARTIAL | One panel: sign-in + capture + tap-zone + end-card |
| Scene/asset dependency-closure collection; Roslyn API analysis | MISSING | N/A to capture approach |
| `.pfu` bundle → `/compile/jobs` | MISSING (by design) | Uploads JPEG frames to `/concepts/:id/capture` |
| **Server-side C# → interactive web playable compiler** | MISSING | Replaced by canvas flipbook (`packager/src/capture.ts`). The competitor's moat and the headline promise |
| Runtime API `Playable.InstallFullGame/GetPlatform/SetLoadingProgress` | PARTIAL | Stubs; nothing consumes them |
| `GetPreferredLanguage(s)`, `GamePaused/Resumed`, haptics, `Analytics` class | MISSING | — |
| `[Field]` attribute w/ `order`, `[FieldStep]` | PARTIAL | `[AdLabField]` lacks `order`/`FieldStep`; unread |
| `/plugin/download|version|downloads`, self-update, license watermark, bans | MISSING | Local UPM folder only |

### 1.14 Landing / marketing — DONE (+ live playable demos). Claims to tighten: "20+ networks" (exactly 20), "custom network ordering" (unimplemented), "validated against current spec" (caps are placeholders).

### 1.15 Support / Ops / Admin — `support/*`, `feedback/*`, `contact*`, `reminders/*`, admin role/UI: all MISSING (mailto only).

### 1.16 Infrastructure (Blueprint §8) — Postgres, Redis/BullMQ, S3/R2 object storage: MISSING (SQLite + BLOBs). URL routing/deep links: MISSING (page is React state).

---

## 2. Networks

**Ours (20):** applovin, unityads, mintegral, meta, ironsource, google, tiktok (Pangle), vungle, liftoff, snapchat, moloco,
chartboost, dv360, adcolony, inmobi, tapjoy, fyber, smadex, bigabid, kayzen.

**Competitor (27):** AppLovin, Unity Ads, Google Ads, Meta, TikTok, Mintegral, Vungle, ironSource, Liftoff, DV360, Snapchat,
Moloco, Chartboost, Remerge, Tencent, AdColony, Aarki, InMobi, Fyber, Tapjoy, LINE, Appreciate, BigaBid, RevX, Adikteev,
YouAppi, MRAID generic.

- Overlap **18**. **Missing 9:** Remerge, Tencent, Aarki, LINE, Appreciate, RevX, Adikteev, YouAppi, **MRAID generic**.
  Ours-only: Smadex, Kayzen.
- Caveat: all 20 specs are two templates (2/5 MB) with unverified caps and no network-specific CTA hooks. Adding the 9 ids
  is trivial; making any of the 27 genuinely validator-correct is the real work.

## 3. API surface

Ours: **41 handlers / 34 paths** vs competitor **~92** (≈45% by count, less by feature weight). Notable missing groups:
auth recovery/verification + captcha; all `orgs/*` + workspaces; `billing/config|subscription|prices|cancel|resume|sync`;
`apps/update|sample|icon`, `concepts/rename|config|network-order|file`; `plugin/*`, `compile/jobs`, `exports/`, `analyze`,
`assets`; `kit/*`; `analytics/import|links|measurement`; all support/feedback/contact/reminders.
Ours with no analogue: `/api/health`, `/api/concepts/:id/capture`, `/api/billing/plan` (dev), `/api/billing/portal`.

## 4. Where we went beyond

Packager CLI; re-export doesn't re-charge quota; security hardening (SSRF guard, TOTP replay guard, login rate-limit,
logo size cap, webhook tolerance); keyless dev-mode billing + stale-Stripe-customer recovery; live playable demos on the
landing; two extra networks; a capture-based Unity path that ships *something* without a compiler (a substitute, not a superset).

## 5. Prioritized gap list

| # | Gap | Why it matters | Effort |
|---|---|---|---|
| 1 | ~~**Per-network CTA/lifecycle hooks + real validator**~~ **DONE 2026-10-29** — `ctaHook` per network (Google/DV360 `ExitApi.exit` + exitapi.js, Meta `FbPlayableAd.onCTAClick`, Mintegral `gameReady`/`install`, Pangle `openAppStore`/`gameEnd`, ironSource `dapi` ready+viewable, Vungle `postMessage`, ready-gated `mraid.open` + viewableChange→pause/resume); validator: bundled-SDK error, real click-through check, orientation, per-network external allowlist; caps reviewed. Remaining: AppLovin `CHALLENGE_*` analytics events (optional), live review-tool confirmation per network. | Core promise — was the #1 rejection risk | done |
| 2 | **Unity compiler / interactive playable from the game itself** | Competitor's moat and the headline; flipbook is a different product | XL |
| 3 | ~~Enforce the domain-verification gate~~ **DONE 2026-10-29** — `/export` returns 403 `domain-unverified` until the app owner's domain is verified (team members inherit the owner's verification) | Was cosmetic; now anti-abuse + publisher legitimacy | done |
| 4 | ~~Password reset + email verification + mail transport~~ **DONE 2026-10-30** — `mail.ts` (Resend REST via fetch; dev outbox when unset), `POST /password/forgot|reset/check|reset` (hashed one-time 1h tokens, no account enumeration, rate-limited), signup sends a 48h verification link + `POST /signup/verify|resend`, `/me.emailVerified`; web: Forgot/Reset screens, `?reset=`/`?verify=` deep links, verify banner with Resend. **Needs `RESEND_API_KEY` + `MAIL_FROM` in Render to deliver in prod.** | Table-stakes auth | done |
| 5 | **Org/Workspace model with enforced roles** (plan/domain/billing/quota on org; email invites) | Team/Studio tier advertised; roles unenforced | L |
| 6 | **Async job model + worker** for export/capture | Sync handlers block on big uploads; prerequisite for a compiler | M |
| 7 | **In-playable analytics ingestion** | Theirs = ad performance; ours = billing usage | M |
| 8 | ~~Missing 9 networks~~ **DONE 2026-10-29** — Remerge, Tencent, Aarki, LINE, Appreciate, RevX, Adikteev, YouAppi + MRAID generic added (all MRAID 2.0 specs, caps noted) → **29 networks** | Marketing now accurate | done |
| 9 | ~~Rename/update endpoints; network-order~~ **DONE 2026-10-29** — `PATCH /api/apps/:id` (name/platform), `PATCH /api/concepts/:id` (name + Enterprise-gated `networkOrder`, validated, used as the default `/export` set), `PATCH /api/creatives/:id` (name + CTA/store URLs); sidebar rename UI | The advertised Enterprise feature now exists | done |
| 10 | **Billing: surface subscription state, in-app cancel/resume, sync** | Users can't see renewal/cancel state | S–M |
| 11 | **Runtime API completeness** + actually read `[AdLabField]` | Half-declared contract | S declare / L wire |
| 12 | Preloader kit templates, per-concept kit, server preview | Template library | M |
| 13 | Plugin distribution (download/version/self-update, licensing) | No way to ship/revoke the plugin | M |
| 14 | Support/feedback/contact/reminders | Ops tooling (17 endpoints) | M |
| 15 | MRAID stub in preview; URL routing; Turnstile | UX/robustness | S each |
| 16 | Infra: Postgres, object storage, shared rate-limit store | SQLite BLOB storage won't hold a studio's exports | L |
