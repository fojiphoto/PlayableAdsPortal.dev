# Deploying PlayableAdsPortal

## The one thing to know first

The app is a **stateful Node service** — a Fastify server that also serves the built SPA, and
keeps its data (users, apps, uploaded playables, exports) in a **SQLite file on disk**.

**Pinehoster (`factorialstudio.dev`) is PHP/MySQL shared hosting** — its tools are all
PHP/Softaculous, there is **no "Setup Node.js App"**. So the Node backend **cannot run on
Pinehoster.** Pinehoster is still useful for: **DNS** (subdomains + Manage DNS) and, optionally,
hosting the static SPA behind its **built-in CDN**.

So the Node app runs on an **external Node host**, and we point a `factorialstudio.dev` subdomain at it.

---

## Pick an architecture

### A) Single-origin (recommended, simplest)
One external host runs everything: the Fastify server serves **both** `/api/*` and the SPA.
- Domain: `app.factorialstudio.dev` → the external host.
- No CORS, no separate API domain, one deploy.

### B) Split (SPA on Pinehoster + CDN, API external)
- SPA (static `packages/web/dist`) uploaded to Pinehoster → `app.factorialstudio.dev`, cached by
  Pinehoster's CDN (Edge Caching).
- API on the external host → `api.factorialstudio.dev`.
- Build the SPA with the API URL baked in:
  ```bash
  VITE_API_BASE=https://api.factorialstudio.dev npm run build -w @forge/web
  ```
  Then upload `packages/web/dist` to Pinehoster (File Manager / FTP) and set CORS origin on the API.

Start with **(A)**; move to **(B)** later if you want Pinehoster's CDN on the frontend.

---

## Where the Node app runs — choose one host

All three read the repo and the configs already in it. Each needs a **persistent disk at `/data`**
(for the SQLite file) and the **`JWT_SECRET`** env var.

### Render (uses `render.yaml`)
1. render.com → **New → Blueprint** → connect this GitHub repo → it reads `render.yaml`.
2. It provisions a Docker web service + a 1 GB disk at `/data` and generates `JWT_SECRET`.
3. **Settings → Custom Domain** → add `app.factorialstudio.dev` → Render shows a CNAME target.

### Fly.io (uses `fly.toml` + `Dockerfile`)
```bash
fly launch --no-deploy
fly volumes create forge_data --size 1
fly secrets set JWT_SECRET=$(openssl rand -base64 48)
fly deploy
fly certs add app.factorialstudio.dev   # prints the DNS record to add
```

### A VPS with Docker (uses `Dockerfile` + `docker-compose.yml` + `deploy/Caddyfile`)
Any $4–5/mo VPS (Hetzner, DigitalOcean…). Point `app.factorialstudio.dev` A/AAAA → the VPS IP, open 80/443, then:
```bash
git clone <repo> && cd PlayableAdsPortal
export JWT_SECRET=$(openssl rand -base64 48)
docker compose up -d --build       # Caddy gets HTTPS automatically
```

---

## DNS on Pinehoster

Control panel → **Domain Names → Subdomains** (create `app`) and **Manage DNS**:
- **Render/Fly:** add a **CNAME** `app` → the target the platform gave you.
- **VPS:** add an **A** record `app` → the VPS IPv4 (and AAAA → IPv6).

(For split mode, also add `api` → the API host.)

---

## CDN

- **Single-origin on Render/Fly:** those platforms already serve over a global edge; Caddy on a VPS
  adds gzip/zstd. For a full CDN, put **Cloudflare** in front (add the domain to Cloudflare, proxy
  the `app` record) — gives caching + DDoS + TLS for free.
- **Split mode:** the SPA on Pinehoster uses Pinehoster's built-in **Edge Caching / Traffic
  Distribution** CDN directly.

---

## Environment

See `.env.example`. In production you MUST set `JWT_SECRET` (the server refuses to start with the
dev secret). `FORGE_DB` must point at the persistent disk (`/data/forge.db`).

---

## Scaling out: Postgres + object storage (optional)

Out of the box the server keeps everything in one SQLite file on the persistent disk, with uploads and
exports stored inside it. That's right for one instance and a small team. Two independent upgrades, each
off until you set its variables (see `.env.example`):

**1. Files → an object store (do this first: it's what fills the disk).** Create a bucket (Cloudflare R2:
R2 → Create bucket, then *Manage R2 API tokens* → a token with Object Read & Write on that bucket). In
Render set `BLOB_STORE=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` and redeploy. New files go to the bucket at once; old ones keep working from the
database. Then, from the Render shell, move the old ones (safe while the app runs):

    npm run blobs -w @forge/server -- migrate

On SQLite, run `VACUUM` afterwards to give the space back. `-- migrate --to-db` moves everything back.

**2. Database → Postgres (for a managed DB or several instances).** Create a Postgres database (Render →
New → PostgreSQL, or Neon/Supabase) and copy its *internal* connection string. Then, in a quiet moment:

1. Scale the web service to 0 instances (or stop writes).
2. From the Render shell: `DATABASE_URL=<url> npm run db:to-postgres -w @forge/server`
   — creates the schema, copies every table, verifies the counts; the SQLite file is left as a backup.
3. Set `DATABASE_URL` on the service and start it again.

With Postgres, rate limits, the job queue (claims are compare-and-set, running jobs heart-beat) and the
daily reminder run are shared, so you can add instances. Keep `JWT_SECRET` identical on all of them.

## ✅ What only you can do (I can't — needs your accounts/payment)

1. **Create/choose the Node host** (Render / Fly / Railway / a VPS) and connect this GitHub repo —
   needs your signup + card (≈$5–7/mo for an always-on service with a disk).
2. **Set `JWT_SECRET`** on that host (or let Render generate it).
3. **Add the DNS record** on Pinehoster (Manage DNS) for `app.factorialstudio.dev` → the host.
4. **(optional) Cloudflare** for CDN, or switch to split mode to use Pinehoster's CDN.

Everything else — code, Docker, CI, platform blueprints — is in the repo and ready. Tell me which
host you pick and I'll tailor the exact clicks + any config for it.
