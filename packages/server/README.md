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
