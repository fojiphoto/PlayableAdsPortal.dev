# PlayableAdsPortal

One Unity build in → a correct, size-checked **playable ad** per ad network out.

A from-scratch build. See the full technical blueprint in **[docs/BLUEPRINT.md](docs/BLUEPRINT.md)**.

## Monorepo layout

```
packages/
  packager/   # ✅ core network-spec engine: HTML5 playable → per-network packages (MVP, building now)
  server/     # ⏳ Node REST API (apps/concepts/creatives, export, download) — placeholder
  web/        # ⏳ React + Vite dashboard — placeholder
docs/
  BLUEPRINT.md
```

## Strategy (from the blueprint)

The product is really **two** problems. We decouple them:

1. **The Packager** (this MVP) — any HTML5 playable → 27 correct network packages. Sellable alone.
2. **The Unity plugin + cloud compiler** (Phase 2) — the real moat.

## Getting started

```bash
npm install
npm run packager:test      # prove the engine works
```

## Packager quick use

```bash
# pack a folder of an HTML5 playable to all priority networks
node --import tsx packages/packager/src/cli.ts ./my-playable --out ./out --name my_creative
```

## Status

- Phase 0 — Recon ✅
- Phase 1 — MVP Packager 🚧 (engine first)
- Phase 2 — Unity plugin + compiler ⏳
- Phase 3 — Scale ⏳
