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

## ✅ What only you can do (I can't — needs your accounts/payment)

1. **Create/choose the Node host** (Render / Fly / Railway / a VPS) and connect this GitHub repo —
   needs your signup + card (≈$5–7/mo for an always-on service with a disk).
2. **Set `JWT_SECRET`** on that host (or let Render generate it).
3. **Add the DNS record** on Pinehoster (Manage DNS) for `app.factorialstudio.dev` → the host.
4. **(optional) Cloudflare** for CDN, or switch to split mode to use Pinehoster's CDN.

Everything else — code, Docker, CI, platform blueprints — is in the repo and ready. Tell me which
host you pick and I'll tailor the exact clicks + any config for it.
