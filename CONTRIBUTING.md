# Contributing to Mermaid Toolkit for Google Docs™

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Yarn](https://classic.yarnpkg.com/) v1 (Classic)
- A Google account with access to Google Docs™

## Getting Started

```bash
# 1. Clone the repo
git clone https://github.com/numanaral/mermaid-toolkit-for-google-docs.git
cd mermaid-toolkit-for-google-docs

# 2. Install dependencies
yarn install

# 3. Copy the environment template
cp .env.example .env
```

## Setting Up the Add-on for Testing

You'll need your own Apps Script project to test changes in Google Docs™.

### Create a test Apps Script project

1. Open a Google Doc™ (or create a new one)
2. Go to **Extensions > Apps Script**
3. In the Apps Script editor, go to **Project Settings** (gear icon)
4. Copy the **Script ID**

### Configure clasp

1. Create `.clasp.json` in the repo root with your Script ID:
   ```json
   {
     "scriptId": "your-script-id-here",
     "rootDir": "dist/gas"
   }
   ```

2. Enable the Apps Script API at https://script.google.com/home/usersettings

3. Log in to clasp:
   ```bash
   yarn gas:login
   ```

### Configure `.env`

The `.env` file (created from `.env.example` during setup) contains `DOC_URL` — the Google Docs™ URL with an `addon_dry_run` token, used by Playwright demo recording and test scripts.

To get this URL:
1. Open your test Google Doc™ with the add-on installed
2. Use the add-on's dry-run URL (the full URL including `?addon_dry_run=...`)
3. Paste it into `.env` as `DOC_URL=...`

This is only needed if you plan to run `yarn demo:record` or `yarn test:gdocs`.

### Deploy and test

```bash
# Build the add-on and push to your Apps Script project
yarn gas:push

# This runs: lint -> typecheck -> build -> clasp push
```

After pushing, reload your Google Doc™. The add-on appears under **Extensions > Mermaid Toolkit**.

### Development workflow

```bash
# Watch for changes and rebuild automatically
yarn gas:dev

# In another terminal, push when ready
yarn gas:push
```

**Dev tooling notes** (Playwright demos, optional server probes, demo script
layout): [`scripts/README.md`](scripts/README.md) and
[`scripts/demo/PLAYWRIGHT-GUIDE.md`](scripts/demo/PLAYWRIGHT-GUIDE.md).
One-off spike scripts: `temp/one-off/README.md` (not committed).

## Project Structure

```
├── site/                  # Marketing website (Eleventy + SCSS + TS)
│   ├── _data/             # Site data (site.json)
│   ├── _includes/         # Nunjucks templates
│   ├── assets/            # Images, brand assets
│   ├── scripts/           # Client-side TypeScript
│   └── styles/            # SCSS (base, components, layout)
├── src/gas/               # Google Apps Script add-on
│   ├── server/            # Server-side code (Code.ts, utilities)
│   ├── dialogs/           # Dialog UI (HTML + SCSS + TS per dialog)
│   │   ├── editor/        # Live Mermaid editor
│   │   ├── preview/       # Code-to-diagram preview
│   │   ├── extract/       # Diagram-to-code extraction
│   │   ├── convert/       # Single code-to-diagram conversion
│   │   ├── importmd/      # Import from Markdown
│   │   ├── exportmd/      # Export as Markdown
│   │   ├── fixmarkdown/   # Markdown repair tool
│   │   ├── devtools/      # Developer tools and document inspector
│   │   ├── about/         # About dialog
│   │   └── quickguide/    # Quick guide dialog
│   └── shared/            # Shared styles, scripts, templates
│       ├── styles/        # SCSS (base, components, layout)
│       ├── scripts/       # Shared TypeScript utilities
│       └── templates/     # Shared HTML partials (footer)
├── scripts/               # Build tooling and automation (TypeScript)
│   ├── build-gas.ts       # GAS build pipeline
│   ├── dev-gas.ts         # GAS file watcher
│   ├── push.ts            # Verify + build + clasp push
│   ├── verify.ts          # ESLint + typecheck
│   ├── verify-fix.ts      # ESLint fix + typecheck
│   ├── test-gdocs.ts      # Standalone Playwright smoke test
│   └── demo/              # Demo recording pipeline
│       ├── recorder.ts    # Orchestrator — launches browser, runs steps
│       ├── helpers.ts     # Shared constants and Playwright utilities
│       ├── steps/         # Individual demo step scripts (00-reset … 13-about)
│       ├── split-clips.ts # Split full recording into per-step clips
│       ├── to-gif.ts      # Convert clips to optimized GIFs
│       ├── to-webm.ts     # Generate optimized WebM clips for site
│       ├── demo-gif.ts    # Generate combined demo GIF (skip reset)
│       ├── site-video.ts  # Cut and copy demo video to site assets
│       ├── analyze-clips.ts # Diagnose clip timing drift
│       └── PLAYWRIGHT-GUIDE.md # Playwright cookbook / reference
├── dist/gas/              # Built GAS output (gitignored)
└── _site/                 # Built site output (gitignored)
```

## Available Scripts

| Command | Description |
|---|---|
| `yarn site:dev` | Start the site dev server with live reload |
| `yarn site:build` | Production build for the site |
| `yarn gas:dev` | Watch GAS source files and rebuild on change |
| `yarn gas:build` | Build the GAS add-on to `dist/gas/` |
| `yarn gas:push` | Verify, build, and push to Apps Script |
| `yarn gas:login` | Authenticate with Google via clasp |
| `yarn verify` | Run ESLint + TypeScript checks (site + GAS) |
| `yarn verify:fix` | Run ESLint fix + TypeScript checks |
| `yarn site:lint` | Run ESLint on site code |
| `yarn gas:lint` | Run ESLint on GAS code |
| `yarn demo:record` | Record a full-feature Playwright demo |
| `yarn demo:split` | Split recording into per-step clips |
| `yarn demo:gif` | Convert clips to optimized GIFs |
| `yarn demo:webm` | Generate optimized WebM clips for site |
| `yarn demo:demo-gif` | Generate combined demo GIF (skip reset) |
| `yarn demo:site-video` | Cut demo video for the marketing site |
| `yarn demo:analyze` | Diagnose clip timing drift |
| `yarn test:gdocs` | Run Playwright smoke test against Google Docs™ |

## Code Style

- **TypeScript** for all source code (no plain `.js` except Eleventy config)
- **SCSS** with `@use` imports (no `@import`)
- **`interface`** over `type` for object shapes
- Explicit `return` with braces for multi-line arrow functions
- ESLint enforces consistent style — run `yarn verify` before committing

## How the GAS Build Works

The build pipeline (`scripts/build-gas.ts`) does the following:

1. **Server**: Bundles `src/gas/server/Code.ts` (menu handlers + re-exports for dialog RPC) via esbuild into one `Code.gs` with top-level function declarations and no module system
2. **Styles**: Compiles each dialog's SCSS to minified CSS
3. **Scripts**: Bundles each dialog's TypeScript to minified IIFE
4. **Assembly**: Injects compiled CSS and JS into each dialog's HTML template, producing self-contained HTML files that GAS can serve

## Pull Requests

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run `yarn verify` to ensure lint and types pass
4. Run `yarn gas:build` to verify the build succeeds
5. Test in Google Docs™ if your change affects the add-on
6. Open a PR with a clear description of what changed and why

## Reporting Issues

Use [GitHub Issues](https://github.com/numanaral/mermaid-toolkit-for-google-docs/issues) for bug reports and feature requests. Include:

- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Screenshots if applicable
- Browser and OS info
