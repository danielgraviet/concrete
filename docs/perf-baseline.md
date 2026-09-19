# Concrete performance baseline (issue #9)

Generated / refreshed by `npm run perf:baseline`. Re-run after meaningful changes and update the scorecard below.

## Dev folder vs what users receive

| Layer | Who feels it | Notes |
| --- | --- | --- |
| `node_modules/` (~1.1GB) | Developers only | Includes Electron + agent SDKs used at build/dev time |
| `release/` (~1GB locally) | Developers only | gitignored pack output; wipe with `npm run clean` |
| `dist/` (~5.3MB) | Packaged into app | Renderer JS/CSS/fonts (code-split) |
| `Concrete.app` / DMG | End users | Electron runtime dominates; `app.asar` ~94MB |
| `~/Library/Application Support/concrete` | End users | Chromium disk/code caches; capped + cleared on quit |

## Scorecard

Run date: 2026-09-19

| Metric | Before | After | Notes |
| --- | --- | --- | --- |
| Repo working tree | ~2.2GB | ~2.2GB | Still dominated by `node_modules` + `release/` |
| Main entry JS (raw) | ~2.1MB monolith | **~417KB** (`index-*.js`) | Editor / KaTeX / CodeMirror / settings / AI orb split out |
| Main CSS (app shell) | ~824KB (incl. KaTeX) | **~82KB** + lazy KaTeX CSS ~29KB | KaTeX CSS/fonts load on first math render |
| Lazy panels | eager | Settings / GenerateQuiz / AiOrb chunks | Loaded on demand via `React.lazy` |
| App Support Cache+Code Cache | ~545MB | Cap 50MB + clear on quit | Existing caches shrink after next quit |
| Cold start marks | none | `[perf] …` in main + `perf:mark` IPC | See below |
| Packaged `app.asar` | ~94.5MB | ~94.5MB | Agent SDKs still packaged; deferred at runtime |
| `dist/` | ~5.5MB | ~5.3MB | |

## How to measure cold start

1. Dev: `npm run dev`, watch the Electron terminal for `[perf] window-ready-to-show` and `[perf] renderer-interactive`.
2. Packaged: launch Concrete; same lines in Console.app filtered by process name.

Marks:

- `app-ready` — Electron `app.whenReady`
- `window-create-start` / `window-ready-to-show` — shell visible
- `renderer-interactive` — vault restore settled (or skipped)

## Bundle analysis

```bash
ANALYZE=1 npm run build   # or: npm run build:analyze
open docs/bundle-stats.html
npm run perf:baseline
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run perf:baseline` | Print disk scorecard |
| `npm run build:analyze` | Build + write `docs/bundle-stats.html` |
| `npm run clean` | Remove `release/`, `dist/`, Vite cache, bundle stats |

## Follow-ups

See [perf-followups.md](./perf-followups.md) for Phase 4 / editor scalability items not landed in this pass.
