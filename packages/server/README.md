# @forge/server

Fastify REST API that wraps **`@forge/packager`**: upload an HTML5 playable, build per-network
packages, download them. In-memory store for the MVP (Postgres comes in Phase 3).

## Run

```bash
npm run dev -w @forge/server      # http://localhost:4000
npm run test -w @forge/server
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/health` | liveness |
| GET  | `/api/networks` | catalog of networks + specs |
| POST | `/api/creatives` | upload a playable (`multipart`: `file`=.zip or .html; fields: `name`, `appName`, `ctaUrl`, `iosUrl`, `androidUrl`, `entry`) |
| GET  | `/api/creatives` | list |
| GET  | `/api/creatives/:id` | details + current build results |
| POST | `/api/creatives/:id/export` | build packages (`{ networks?, ctaUrl?, iosUrl?, androidUrl?, async? }`); `async: true` (or `?async=1`) → 202 `{ jobId, statusUrl }` |
| GET | `/api/jobs/:id` | poll an async job: `status` queued/running/done/failed, `progress` 0–100, `label`, `result`, `error` |
| GET | `/api/jobs?limit=` | the caller's recent jobs |
| POST | `/api/concepts/:conceptId/compile` | multipart `file` = zipped Unity WebGL build (+ `name`, `iosUrl`, `androidUrl`, `companyName`) → 202 compile job; result = creative id + size breakdown + warnings + `fitsNetworks` |
| POST / GET | `/api/compile/jobs` (`conceptId` field) / `/api/compile/jobs/:id` | competitor-shaped aliases |
| GET / POST | `/api/workspaces`, `/api/workspaces/switch` | the caller's workspaces (role, isCurrent) / set the current one |
| POST | `/api/orgs` | create a workspace (you become owner) |
| GET / PATCH | `/api/orgs/current` | members + pending invites / rename (admin) |
| PATCH / DELETE | `/api/orgs/current/members/:userId` | change role / remove (admin; `me` = leave) |
| POST | `/api/orgs/current/transfer` | hand ownership to a member (owner) |
| POST / DELETE | `/api/orgs/current/invites[/:id]` | email invite with a 7-day link / revoke (admin) |
| GET / POST | `/api/invites/:token`, `/api/invites/accept` | what an invite is for (public) / join (signed in as the invited email) |
| POST / GET | `/api/support/thread`, `/api/support/threads[/:id]`, `…/:id/reply`, `…/:id/close`, `/api/support/unread` | workspace support tickets (admins reply through the same routes) |
| POST | `/api/feedback/bug` | bug report (admins: `GET /api/feedback/bugs`, `POST …/:id/handled`) |
| POST | `/api/contact` | public contact form (honeypot `website`, 5/h per IP; admins: `GET /api/admin/contact`, `POST /api/contact/:id/handled`) |
| GET / PATCH / DELETE | `/api/admin/overview`, `/api/admin/users[/:id]`, `/api/admin/support/threads`, `/api/admin/jobs` | platform admin console (`users.is_admin`; `ADMIN_EMAILS` bootstrap) |
| GET / POST | `/api/admin/reminders`, `…/logins`, `…/run` (`dryRun`), `…/send` | reminder emails |
| GET | `/api/kit/templates` | preloader template library (public) |
| GET / POST | `/api/kits` (alias `POST /api/kit/create`) | the workspace's preloader kits + default + app/concept assignments / create a kit (admin; JSON `name, template, bg, accent, text, showPercent, logoDataUri`) |
| PATCH / DELETE / POST | `/api/kits/:id`, `/api/kits/:id/duplicate` | edit (`logoDataUri: null` removes the image) / delete / copy a kit (admin) |
| PUT | `/api/kits/default` | `{ kitId \| null }` workspace default kit (admin) |
| POST / GET | `/api/kit/preview`, `/api/kits/:id/preview?progress=` | server-rendered preview HTML of a draft (optional `kitId` for its saved image, `progress` 0–1) / of a saved kit |
| PATCH | `/api/apps/:id`, `/api/concepts/:id` `{ kitId }` | pick a kit (`"none"` = no preloader, null = inherit; member) |
| GET | `/api/analytics?days=30&preview=0` | in-playable funnel (impressions, engagement, CTA, CTR; by network / creative; custom events) + export usage |
| GET | `/api/creatives/:id/analytics` | per-creative funnel |
| PATCH | `/api/analytics/settings` | `{ enabled }` — embed beacons in future exports |
| GET/POST | `/api/t/:creativeId/:network?e=&s=` | public beacon collector called from inside playables (no auth) |
| GET  | `/api/creatives/:id/download/:network` | download one package |
| GET  | `/api/creatives/:id/preview/:network` | inline HTML for an `<iframe>` |
| GET  | `/api/creatives/:id/download-all` | all packages as one zip |
| DELETE | `/api/creatives/:id` | remove |

## Example

```bash
# upload
curl -F file=@playable.zip -F name=lumber -F iosUrl=https://apps.apple.com/app/id123 \
  http://localhost:4000/api/creatives
# export (returns per-network size/validation)
curl -X POST http://localhost:4000/api/creatives/<id>/export \
  -H 'content-type: application/json' -d '{"networks":["applovin","meta"]}'
# download
curl -OJ http://localhost:4000/api/creatives/<id>/download/applovin
```

Config via env (see `.env.example`): `PORT`, `HOST`, `MAX_UPLOAD_BYTES`.
