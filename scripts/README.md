# Scripts

Build tooling and automation for the Mermaid Toolkit project.

## Where dev notes live

| Topic | Doc |
|--------|-----|
| **This file** | Build/push scripts, GAS probe builds, `package.json` demo commands |
| **[`demo/PLAYWRIGHT-GUIDE.md`](demo/PLAYWRIGHT-GUIDE.md)** | Playwright + Google Docs™ (login, dialogs, recording, pitfalls) |
| **[`temp/one-off/README.md`](../temp/one-off/README.md)** | Spike scripts not in `package.json` (gitignored `temp/`) |
| **[`CONTRIBUTING.md`](../CONTRIBUTING.md)** | Clone, clasp, `.env`, `yarn gas:push` for contributors |

User-facing product docs: `site/`, `CHANGELOG.md`, `README.md`.

## Build & Dev

| Script | Description |
|---|---|
| `build-gas.ts` | GAS build — `Code.ts` → `dist/gas/Code.gs`; dialog HTML. Optional **`PlaywrightProbes.gs`** when `GAS_INCLUDE_PLAYWRIGHT_PROBES=1` or `--playwright-probes` (see below). |
| `dev-gas.ts` | File watcher that rebuilds GAS output on source changes |
| `push.ts` | Runs verify + build + `clasp push`. Use **`--playwright-probes`** / **`--probes`** to include probe server file in the build before push. Pass `--skip-verify` if root `tsc` fails on uncommitted demo scripts. |
| `preview-gas.ts` | Serves built GAS HTML dialogs locally for browser inspection |
| `build.sh` | Shell wrapper for site + GAS builds |
| `dev.sh` | Shell wrapper for concurrent site + GAS dev servers |

## Verification

| Script | Description |
|---|---|
| `verify.ts` | Runs ESLint + TypeScript checks across site and GAS code |
| `verify-fix.ts` | Same as verify but with ESLint auto-fix enabled |
| `typecheck.ts` | TypeScript-only check for the site |
| `typecheck-gas.ts` | TypeScript-only check for GAS code |

## Testing

| Script | Description |
|---|---|
| `test-gdocs.ts` | Standalone Playwright smoke test — opens a Google Doc™ with the add-on and exercises menu items. Requires `DOC_URL` in `.env`. |

### Playwright server probes (optional GAS file)

Some demos call `google.script.run.probe*` to hit **DocumentApp** without driving the full UI (limits, docstore round-trip). That code lives in **`src/gas/server/playwright-probes.ts`** — not in `Code.ts`.

| Command | Output |
|---------|--------|
| `yarn gas:build` | `dist/gas/Code.gs` only (production) |
| `yarn gas:build:probes` | `Code.gs` + **`PlaywrightProbes.gs`** |
| `yarn gas:push:probes` | Build with probes, then push both files |

Server TypeScript is split across modules; **`Code.ts`** is the esbuild entry (menu + exported RPC names) and compiles to **`Code.gs`**. **`PlaywrightProbes.gs`** is a separate optional bundle entry.

Probe/limit drivers (not in `package.json`; run with `tsx` after `yarn gas:push:probes`):

- `tsx scripts/demo/probe-docs-image-limits.ts` (optional `--quick`)
- `tsx scripts/demo/probe-docs-alt-limits.ts`
- `tsx scripts/demo/run-docstore-export.ts`

Details: [`demo/PLAYWRIGHT-GUIDE.md` — Server probes](demo/PLAYWRIGHT-GUIDE.md#server-probes-optional-gas-file).

## Demo Recording Pipeline (`demo/`)

End-to-end pipeline for recording, processing, and publishing demo assets.

| Script | Description |
|---|---|
| `demo/recorder.ts` | Orchestrator — launches Playwright browser, runs all step scripts in order, captures video + screenshots + timestamps |
| `demo/helpers.ts` | Shared constants (`DOC_URL`, `SCREENSHOTS_DIR`, viewport dimensions) and Playwright utility functions |
| `demo/steps/` | Individual step scripts (`00-reset.ts` through `13-about.ts`) — each demonstrates one add-on feature |
| `demo/split-clips.ts` | Splits the full recording into per-step `.webm` clips using timestamps |
| `demo/to-gif.ts` | Converts per-step clips to optimized GIFs (palette-based, scaled to 720px) |
| `demo/to-webm.ts` | Generates optimized VP9 WebM clips for the site (scaled to 720px) |
| `demo/demo-gif.ts` | Generates a single combined demo GIF from the full recording, skipping the reset step |
| `demo/site-video.ts` | Cuts the demo video (skip reset) and copies it to `site/assets/demo/demo.webm` |
| `demo/analyze-clips.ts` | Diagnostic tool for identifying timing drift between timestamps and actual video |
| `demo/trim-offsets.json` | Per-step trim configuration (start/end padding in ms) |

### Typical workflow

```bash
yarn demo:record       # Record full demo
yarn demo:gif          # Generate per-step GIFs
yarn demo:webm         # Generate per-step WebM clips for site
yarn demo:demo-gif     # Generate combined demo GIF
yarn demo:site-video   # Cut site video
```

All demo output goes to `temp/demo/` (gitignored). Site assets are written to `site/assets/demo/` (video), `site/assets/clips/` (WebM), and `site/assets/gifs/` (GIF for README/GitHub).

### `package.json` demo scripts (site pipeline only)

`demo:open-doc`, `demo:record`, `demo:split`, `demo:gif`, `demo:webm`, `demo:site-video`, `demo:demo-gif`, `demo:analyze`.

Other helpers under `scripts/demo/` (probes, smoke, fixtures, PNG harnesses) — **`tsx scripts/demo/<file>.ts`**. Auth: `yarn test:login`, `yarn test:gdocs`.

Standalone clip recorders (steps 04/05): `record-diagram-to-code-selected.ts`, `record-convert-selected.ts` — same, via `tsx`.

One-off spikes: **`temp/one-off/`** (see README there).

See `demo/PLAYWRIGHT-GUIDE.md` for browser setup and troubleshooting.
