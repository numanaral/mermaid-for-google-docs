# Playwright Testing for Google Apps Script Add-ons

A practical guide for automating and testing Google Apps Script (GAS) add-ons
inside Google Docs™ using [Playwright](https://playwright.dev/). Built from
real-world experience developing
[Mermaid Toolkit for Google Docs™](https://github.com/numanaral/mermaid-toolkit-for-google-docs).

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Server probes (optional GAS file)](#server-probes-optional-gas-file)
- [Setup](#setup)
- [Session Management (Persistent Login)](#session-management-persistent-login)
- [Navigating Google Docs™ UI](#navigating-google-docs-ui)
- [Working with GAS Dialogs](#working-with-gas-dialogs)
- [Interacting Inside Sandboxed Iframes](#interacting-inside-sandboxed-iframes)
- [Closing Dialogs Reliably](#closing-dialogs-reliably)
- [Polling Instead of Sleeping](#polling-instead-of-sleeping)
- [Handling Native Browser Dialogs](#handling-native-browser-dialogs)
- [Screenshots and Video Recording](#screenshots-and-video-recording)
- [Visual Cursor for Demos](#visual-cursor-for-demos)
- [Local Dialog Preview (Without Google Docs™)](#local-dialog-preview-without-google-docs)
- [Common Pitfalls](#common-pitfalls)
- [Full Snippets](#full-snippets)

---

## Architecture Overview

Google Apps Script add-on dialogs run inside a **triple-nested iframe** structure:

```
Google Docs™ page
└── Dialog overlay (WizDialog-dialog)
    └── Outer iframe (Google's wrapper)
        └── Inner iframe#userHtmlFrame (your sandboxed HTML)
```

Your add-on HTML lives in `userHtmlFrame`. Playwright can access it via
`page.frame('userHtmlFrame')`, but the sandboxed environment has strict Content
Security Policy (CSP) rules that affect what works at runtime.

### Key CSP Restrictions

| Blocked                        | Workaround                                  |
| ------------------------------ | ------------------------------------------- |
| `data:` URIs in `<img>` `src`  | Use external HTTPS URLs                     |
| ES module `import`             | Use UMD/IIFE script loading                 |
| `eval()` / inline scripts      | Use `<script>` tags bundled into the HTML   |
| Fetching arbitrary URLs        | Proxy through `google.script.run`           |

---

## Server probes (optional GAS file)

Node/Playwright can open Docs and call **`google.script.run`**, but only **Apps
Script server** code can use `DocumentApp` (insert image, set alt text, export
markdown). For limit experiments and docstore checks we avoid clicking through
the full UI by deploying optional server functions in
**`src/gas/server/playwright-probes.ts`**.

That file is compiled to a **separate** `PlaywrightProbes.gs` — not merged into
`Code.gs`:

```bash
yarn gas:push          # production: Code.gs only
yarn gas:push:probes    # test playground: Code.gs + PlaywrightProbes.gs
```

Exported probe functions: `probeSetAltDescription`, `probeAppendImageBase64`,
`probeDocstoreExportRoundTrip`. Demo drivers live under `scripts/demo/` (see
[`../README.md`](../README.md)). Throwaway spikes live in `temp/one-off/`.

**Do not** add probe-only re-exports to `Code.ts`. The editor’s
`insertImageAtCursor` is implemented in `diagram-ops.ts` and re-exported from
`Code.ts` for the editor; `playwright-probes.ts` imports it from the same module.

---

## Setup

### Dependencies

```bash
yarn add -D playwright
# Install browser binaries (only needed once)
yarn playwright install chromium
# Required for video recording
yarn playwright install ffmpeg
```

### Dry-Run URL

To test an unpublished add-on, use the `addon_dry_run` parameter. You get this
URL from the Apps Script editor: **Deploy → Test deployments → select a test
deployment → copy the URL**.

```
https://docs.google.com/document/d/<DOC_ID>/edit?addon_dry_run=<TOKEN>&tab=t.0
```

### Package Scripts

```json
{
  "scripts": {
    "test:login": "tsx scripts/test-gdocs.ts --login",
    "test:gdocs": "tsx scripts/test-gdocs.ts",
    "test:iframe": "node scripts/test-iframe.js",
    "test:edit": "node scripts/test-edit-flow.js",
    "test:mouse": "node scripts/test-mouse.js",
    "test:cursor": "node scripts/test-cursor-in-dialog.js"
  }
}
```

---

## Session Management (Persistent Login)

Google Docs™ requires authentication. Re-logging in every run is painful.
Playwright's `storageState` persists cookies and localStorage across runs.

### First-Time Login

```js
const STATE_FILE = path.resolve(".playwright-state.json");

const browser = await chromium.launch({
  channel: "chrome",       // use installed Chrome, not Chromium
  headless: false,         // must be visible for Google login
  args: ["--disable-blink-features=AutomationControlled"],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  // Reuse state if it exists
  storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
});

const page = await context.newPage();
await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
```

### Detecting Login Prompts

```js
const title = await page.title();
if (title.includes("Sign in") || title.includes("Google Account")) {
  console.log("Please log in manually in the browser window...");
  await page.waitForURL("**/document/**", { timeout: 300000 }); // 5 min
}
```

### Saving State After Login

Use `yarn test:login` — sign in if prompted, wait until `#docs-editor` is
visible, write `.playwright-state.json`, then **close the browser automatically**.

`ensurePlaywrightDocSession` in `helpers.ts` is what recorder / probes use: it
only overwrites the state file when the editor is actually on screen (so a
logged-out page does not clobber good cookies).

`yarn demo:open-doc` does **not** clear cookies; on exit it refreshes the state
file if the doc was still loaded.

### .gitignore

```gitignore
.playwright-state.json
.playwright-chrome-profile/
temp/
```

> **Tip**: The state file contains session cookies. Never commit it.

### Browser launch (`launchDemoBrowser` in `helpers.ts`)

Scripts use **Playwright’s bundled Chromium** by default. On some Macs,
`channel: "chrome"` (system Google Chrome) **never opens a window** and
Playwright hangs — especially when Chrome.app is already running.

Optional: `PLAYWRIGHT_CHANNEL=chrome` tries system Chrome first (8s timeout),
then falls back to bundled Chromium.

Saved `.playwright-state.json` works with either browser.

### Why `channel: "chrome"`? (legacy note)

Using the system Chrome (`channel: "chrome"`) instead of Playwright's bundled
Chromium avoids Google's bot-detection that blocks login on automation browsers.
The `--disable-blink-features=AutomationControlled` flag removes the
`navigator.webdriver` flag that Google checks.

---

## Navigating Google Docs™ UI

### Opening the Extensions Menu

Google Docs™ menus are custom DOM elements, not native `<select>` elements.

```js
// Wait for the Extensions menu to exist
await poll(
  () => page.$("#docs-extensions-menu").then((el) => !!el).catch(() => false),
  15000,
);

// Click it
await page.locator("#docs-extensions-menu").click({ timeout: 5000, force: true });
```

### Navigating Submenus

Add-on items live under a submenu. Hover to expand, then click the target.

```js
const submenu = page
  .locator('.goog-menuitem-content:has-text("Your Add-on Name")')
  .first();

// Retry loop — the submenu can be flaky
for (let attempt = 0; attempt < 3; attempt++) {
  await page.locator("#docs-extensions-menu").click({ timeout: 5000, force: true });
  const visible = await poll(
    () => submenu.isVisible().catch(() => false),
    4000,
  );
  if (visible) break;
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(1000);
}

// Hover to expand, then click the item
await submenu.hover({ timeout: 5000 });
await sleep(800); // let the submenu animate open

const menuItem = page.locator('.goog-menuitem-content:text-is("Menu Item Label")');
await menuItem.first().click({ timeout: 5000 });
```

### Handling Quoted Menu Labels

If your menu label contains quotes (e.g., `Fix Native "Copy as Markdown"`),
Playwright's `:text-is()` selector chokes. Use a prefix match instead:

```js
if (label.includes('"')) {
  const prefix = label.split('"')[0].trim();
  target = page.locator(`.goog-menuitem-content:has-text("${prefix}")`).first();
} else {
  target = page.locator(`.goog-menuitem-content:text-is("${label}")`).first();
}
```

---

## Working with GAS Dialogs

### Detecting an Open Dialog

GAS dialogs use Google's `WizDialog` component:

```js
const isDialogOpen = (page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('[class*="WizDialog-dialog"]')) {
      if (
        !el.className.includes("scrim") &&
        getComputedStyle(el).display !== "none"
      )
        return true;
    }
    return false;
  }).catch(() => false);
```

### Waiting for a Dialog to Appear

```js
const waitForDialog = (page) => poll(() => isDialogOpen(page), 20000);
```

### Accessing the Iframe Content

Your add-on HTML is inside `userHtmlFrame`:

```js
const waitForFrame = (page) =>
  poll(() => {
    const f = page.frame("userHtmlFrame");
    return f || null;
  }, 15000);

// Usage
const frame = await waitForFrame(page);
if (frame) {
  await frame.locator("#my-button").click({ timeout: 5000 });
}
```

> **Important**: Use `page.frame('userHtmlFrame')` (returns a `Frame`), not
> `page.frameLocator()` (returns a `FrameLocator`). The `Frame` object gives
> you `evaluate()`, which is essential for calling `google.script.host.close()`.

---

## Interacting Inside Sandboxed Iframes

### Filling Form Fields

```js
const frame = await waitForFrame(page);
await frame.locator("#source").click({ timeout: 5000 });
await frame.locator("#source").fill("Your content here");
```

### Clicking Buttons

```js
await frame.locator("#insert-btn").click({ timeout: 5000 });
```

### Waiting for Dynamic Content

```js
await poll(
  () =>
    frame
      .locator('#status:has-text("Preview up to date")')
      .count()
      .then((c) => c > 0)
      .catch(() => false),
  12000,
);
```

### Handling Dropdowns That Auto-Close

Some UI elements (like template dropdowns) close after a selection, so you need
to reopen them before the next interaction:

```js
const ensureDropdownOpen = async () => {
  const isOpen = await frame.locator("#dropdown.visible").count().catch(() => 0);
  if (!isOpen) {
    await frame.locator("#dropdown-toggle").click({ timeout: 5000 });
    await poll(
      () => frame.locator("#dropdown.visible").count().then((c) => c > 0).catch(() => false),
      5000,
    );
  }
};

// Before each selection
await ensureDropdownOpen();
await frame.locator('button:has-text("Option A")').click({ timeout: 5000 });
```

---

## Closing Dialogs Reliably

This is the hardest part. GAS dialogs are stubborn. Use a **three-tier
fallback** strategy:

```js
const closeDialog = async (page) => {
  if (!(await isDialogOpen(page))) return;

  // Tier 1: google.script.host.close() — most reliable
  const frame = page.frame("userHtmlFrame");
  if (frame) {
    try {
      await frame.evaluate(() => {
        if (window.google?.script?.host) window.google.script.host.close();
      });
      const closed = await poll(async () => !(await isDialogOpen(page)), 5000);
      if (closed) return;
    } catch { /* frame may have detached */ }
  }

  // Tier 2: Escape key
  try {
    await page.keyboard.press("Escape");
    const closed = await poll(async () => !(await isDialogOpen(page)), 3000);
    if (closed) return;
  } catch { /* ignore */ }

  // Tier 3: Full page reload (nuclear option)
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#docs-editor", { timeout: 20000 }).catch(() => {});
  await sleep(2000);
};
```

### Why `google.script.host.close()` Works Best

The GAS sandbox provides `google.script.host.close()` as the official way to
dismiss a dialog from client-side code. Unlike clicking the X button (which
requires finding it in the outer dialog chrome) or pressing Escape (which
doesn't always work), this API call reliably closes the dialog from within the
iframe.

### Ensuring All Nested Dialogs Are Closed

Some actions open a second dialog (e.g., Dev Tools → Document Inspector). Loop
until everything is dismissed:

```js
while (await isDialogOpen(page)) {
  await closeDialog(page);
  await sleep(1000);
}
```

---

## Polling Instead of Sleeping

Fixed `sleep()` calls are fragile — too short and you miss content, too long and
tests crawl. Use a polling helper:

```js
const poll = async (fn, timeoutMs = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await sleep(500);
  }
  return null;
};
```

### Usage Examples

```js
// Wait for an element to appear
await poll(() =>
  frame.locator("text=Preview up to date").count().then((c) => c > 0).catch(() => false),
  10000,
);

// Wait for an image to fully load
await poll(() =>
  frame.evaluate(() => {
    const img = document.getElementById("logo");
    return img && img.complete && img.naturalWidth > 0;
  }).catch(() => false),
  10000,
);

// Wait for a dialog to close
await poll(async () => !(await isDialogOpen(page)), 10000);

// Wait for the Extensions menu to be ready after a server operation
await poll(
  () => page.$("#docs-extensions-menu").then((el) => !!el).catch(() => false),
  10000,
);
```

---

## Handling Native Browser Dialogs

GAS server-side operations sometimes trigger native `alert()` or `confirm()`
dialogs (e.g., "5 diagrams converted"). These block Playwright unless handled:

```js
page.on("dialog", async (dialog) => {
  console.log(`Native dialog: "${dialog.message()}" — accepting.`);
  await dialog.accept();
});
```

Register this **before** any actions that might trigger alerts.

---

## Screenshots and Video Recording

### Screenshots

```js
const shot = async (page, name) => {
  try {
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, `${name}.png`),
      fullPage: false,
    });
  } catch (e) {
    console.log(`Screenshot ${name} failed: ${e.message}`);
  }
};
```

Wrap in try/catch because the page can navigate away mid-screenshot.

### Video Recording

Enable recording when creating the browser context:

```js
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
  recordVideo: { dir: SCREENSHOTS_DIR, size: { width: 1280, height: 800 } },
});
```

Save the video in the `finally` block to capture it even on errors:

```js
try {
  // ... test actions ...
} finally {
  const videoPath = await page.video()?.path();
  await context.close();   // must close context before moving the file
  await browser.close();
  if (videoPath) {
    const dest = path.join(SCREENSHOTS_DIR, "demo-recording.webm");
    fs.renameSync(videoPath, dest);
  }
}
```

> **Prerequisite**: `npx playwright install ffmpeg`

### Cleaning Up Old Artifacts

```js
if (fs.existsSync(SCREENSHOTS_DIR)) {
  for (const f of fs.readdirSync(SCREENSHOTS_DIR)) {
    if (f.endsWith(".png") || f.endsWith(".webm"))
      fs.unlinkSync(path.join(SCREENSHOTS_DIR, f));
  }
} else {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}
```

---

## Visual Cursor for Demos

Playwright moves the mouse invisibly. For demo recordings, inject a visible
cursor with click animations:

```js
const CURSOR_INJECT = `
(function() {
  if (document.getElementById('pw-cursor')) return;

  const cursor = document.createElement('div');
  cursor.id = 'pw-cursor';
  cursor.style.cssText = [
    'position:fixed', 'z-index:999999', 'pointer-events:none',
    'width:24px', 'height:24px', 'border-radius:50%',
    'background:rgba(234,67,53,0.5)', 'border:2px solid rgba(234,67,53,0.9)',
    'transform:translate(-50%,-50%)',
    'transition:left 0.08s,top 0.08s,transform 0.1s',
    'left:-100px', 'top:-100px',
  ].join(';');
  document.body.appendChild(cursor);

  // Outer ring for emphasis
  const ring = document.createElement('div');
  ring.id = 'pw-cursor-ring';
  ring.style.cssText = [
    'position:fixed', 'z-index:999998', 'pointer-events:none',
    'width:40px', 'height:40px', 'border-radius:50%',
    'border:2px solid rgba(234,67,53,0.3)',
    'transform:translate(-50%,-50%)',
    'transition:left 0.12s,top 0.12s',
    'left:-100px', 'top:-100px',
  ].join(';');
  document.body.appendChild(ring);

  document.addEventListener('mousemove', e => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
    ring.style.left = e.clientX + 'px';
    ring.style.top = e.clientY + 'px';
  });

  // Shrink on click for visual feedback
  document.addEventListener('mousedown', () => {
    cursor.style.transform = 'translate(-50%,-50%) scale(0.7)';
    cursor.style.background = 'rgba(234,67,53,0.8)';
  });
  document.addEventListener('mouseup', () => {
    cursor.style.transform = 'translate(-50%,-50%) scale(1)';
    cursor.style.background = 'rgba(234,67,53,0.5)';
  });
})();
`;

// Inject after page load and after each navigation
await page.evaluate(CURSOR_INJECT);
```

Re-inject after page reloads since the DOM is destroyed:

```js
await page.evaluate(CURSOR_INJECT).catch(() => {});
```

---

## Local Dialog Preview (Without Google Docs™)

Testing dialog HTML locally avoids repeated `clasp push` cycles. The challenge
is that GAS HTML files use server-side template tags (`<?!= ... ?>`) and depend
on `google.script.run`.

### Strategy

1. Build the GAS HTML files to `dist/`
2. Create a preview page that `fetch`es each built HTML file
3. Replace template variables with mock data via string substitution
4. Inject a `google.script` stub to prevent runtime errors
5. Serve via a local HTTP server (browsers block `file://` for `fetch`)

### The google.script Stub

```js
const gasStub = `<script>
window.google = {
  script: {
    run: {
      withSuccessHandler: function(f) {
        return {
          withFailureHandler: function() { return this; },
          // Stub each server function your dialogs call
          getExportMarkdown: function() {
            f("# Sample\\n\\nMock exported markdown.");
          },
        };
      },
      withFailureHandler: function() { return this; },
    },
    host: {
      close: function() { console.log("google.script.host.close() called"); },
    },
  },
};
</script>`;
```

### Loading and Patching Dialog HTML

```js
async function loadAndPatch(frameId, filePath, patches) {
  const resp = await fetch(filePath);
  let html = await resp.text();

  // Inject the GAS stub before </head>
  html = html.replace("</head>", gasStub + "</head>");

  // Replace template variables with mock data
  for (const [from, to] of Object.entries(patches)) {
    html = html.replace(from, to);
  }

  document.getElementById(frameId).srcdoc = html;
}

// Editor dialog — new mode (imageChildIndex = -1)
loadAndPatch("frame-editor", "../dist/gas/Editor.html", {
  '<?!= JSON.stringify(initialSource || "") ?>': '""',
  '<?!= JSON.stringify(imageChildIndex != null ? imageChildIndex : -1) ?>': "-1",
});

// Editor dialog — edit mode (imageChildIndex >= 0)
loadAndPatch("frame-editor-edit", "../dist/gas/Editor.html", {
  '<?!= JSON.stringify(initialSource || "") ?>':
    '"flowchart TD\\n    A[Start] --> B[End]"',
  '<?!= JSON.stringify(imageChildIndex != null ? imageChildIndex : -1) ?>': "5",
});
```

### Serving Locally

```bash
npx http-server . -p 8765
# Open http://localhost:8765/screenshots/preview-all-dialogs.html
```

### Preview Page Structure

Each dialog is rendered in an iframe at its actual GAS modal size:

```html
<div class="dialog-section">
  <div class="dialog-label">Insert Mermaid Diagram</div>
  <div class="dialog-meta">1000 × 700</div>
  <div class="dialog-frame-wrap">
    <div class="dialog-titlebar">Mermaid Editor<span class="close-x">×</span></div>
    <iframe id="frame-editor" width="1000" height="700"></iframe>
  </div>
</div>
```

---

## Common Pitfalls

### 1. Cursor IDE Sandbox Blocks Browser Launch

If you're running Playwright from an IDE terminal (like Cursor), the sandbox may
block spawning a GUI browser. Run from a native terminal instead:

```bash
# From your system terminal, not the IDE terminal
yarn test:iframe
```

### 2. Google Bot Detection

Playwright's bundled Chromium gets flagged by Google. Always use:

```js
chromium.launch({
  channel: "chrome",  // system Chrome
  args: ["--disable-blink-features=AutomationControlled"],
});
```

### 3. `data:` URIs Don't Render in GAS Iframes

Images set via `data:image/png;base64,...` will appear broken in GAS sandboxed
iframes due to CSP. Use externally hosted HTTPS URLs instead:

```html
<!-- Won't work in GAS iframe -->
<img src="data:image/png;base64,iVBOR..." />

<!-- Works -->
<img src="https://raw.githubusercontent.com/you/repo/main/icon.png" />
```

### 4. Menu Navigation Is Flaky

Google Docs™ menus can be in a transient state after server operations. Always:

- Poll for the Extensions menu element before clicking
- Use a retry loop (3 attempts) for submenu expansion
- Press Escape between retries to dismiss stuck menus
- Wait for the UI to stabilize after "Convert All" type operations

### 5. Dialogs Can Open Other Dialogs

Some actions (like clicking "Document Inspector" in Dev Tools) close the current
dialog and open a new one. Always loop to close all:

```js
while (await isDialogOpen(page)) {
  await closeDialog(page);
  await sleep(1000);
}
```

### 6. Video File Isn't Available Until Context Closes

Playwright writes the video file lazily. You **must** call `context.close()`
before accessing or moving the video file:

```js
const videoPath = await page.video()?.path();
await context.close();  // flushes video to disk
fs.renameSync(videoPath, "demo.webm");
```

### 7. Frame Detachment

When a dialog closes, its iframe detaches. Any pending `frame.evaluate()` or
`frame.locator()` calls will throw. Always wrap iframe interactions in
try/catch:

```js
try {
  await frame.locator("#btn").click({ timeout: 5000 });
} catch {
  // frame detached — dialog was closed
}
```

---

## Full Snippets

### Minimal Test Skeleton

```js
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const DOC_URL = "https://docs.google.com/document/d/YOUR_DOC/edit?addon_dry_run=YOUR_TOKEN";
const STATE_FILE = path.resolve(".playwright-state.json");
const SCREENSHOTS_DIR = path.resolve("temp/demo");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const poll = async (fn, timeoutMs = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(500);
  }
  return false;
};

const isDialogOpen = (page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('[class*="WizDialog-dialog"]')) {
      if (!el.className.includes("scrim") && getComputedStyle(el).display !== "none")
        return true;
    }
    return false;
  }).catch(() => false);

(async () => {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
    recordVideo: { dir: SCREENSHOTS_DIR, size: { width: 1280, height: 800 } },
  });

  const page = await context.newPage();

  // Auto-accept native dialogs
  page.on("dialog", async (d) => d.accept());

  await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#docs-editor", { timeout: 30000 }).catch(() => {});
  await sleep(2000);
  await context.storageState({ path: STATE_FILE });

  try {
    // Open Extensions → Your Add-on → Menu Item
    await page.locator("#docs-extensions-menu").click({ force: true });
    await sleep(1000);

    const submenu = page.locator('.goog-menuitem-content:has-text("Your Add-on")').first();
    await submenu.hover({ timeout: 5000 });
    await sleep(800);

    await page.locator('.goog-menuitem-content:text-is("Your Menu Item")').first().click();

    // Wait for dialog and interact with iframe
    await poll(() => isDialogOpen(page), 20000);
    const frame = await poll(() => page.frame("userHtmlFrame"), 15000);

    if (frame) {
      // Your interactions here
      await frame.locator("#my-button").click({ timeout: 5000 });
      await sleep(1000);
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "result.png") });

    // Close dialog
    if (frame) {
      await frame.evaluate(() => google.script.host.close()).catch(() => {});
    }
    await poll(async () => !(await isDialogOpen(page)), 5000);
  } finally {
    const videoPath = await page.video()?.path();
    await context.close();
    await browser.close();
    if (videoPath) {
      try { fs.renameSync(videoPath, path.join(SCREENSHOTS_DIR, "recording.webm")); }
      catch { /* no video */ }
    }
  }
})();
```

### Reusable `openMenuItem` Helper

```js
async function openMenuItem(page, submenuLabel, itemLabel) {
  await poll(
    () => page.$("#docs-extensions-menu").then((el) => !!el).catch(() => false),
    15000,
  );

  const submenu = page
    .locator(`.goog-menuitem-content:has-text("${submenuLabel}")`)
    .first();

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator("#docs-extensions-menu").click({ timeout: 5000, force: true });
    if (await poll(() => submenu.isVisible().catch(() => false), 4000)) break;
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(1000);
  }

  await submenu.hover({ timeout: 5000 });
  await sleep(800);

  let target;
  if (itemLabel.includes('"')) {
    const prefix = itemLabel.split('"')[0].trim();
    target = page.locator(`.goog-menuitem-content:has-text("${prefix}")`).first();
  } else {
    const exact = page.locator(`.goog-menuitem-content:text-is("${itemLabel}")`);
    target = (await exact.count()) > 0
      ? exact.first()
      : page.locator(`.goog-menuitem-content:has-text("${itemLabel.substring(0, 20)}")`).first();
  }

  await target.hover({ timeout: 5000 });
  await sleep(600);
  await target.click({ timeout: 5000 });
}
```

### Reusable `closeDialog` Helper

```js
async function closeDialog(page) {
  if (!(await isDialogOpen(page))) return;

  const frame = page.frame("userHtmlFrame");
  if (frame) {
    try {
      await frame.evaluate(() => window.google?.script?.host?.close());
      if (await poll(async () => !(await isDialogOpen(page)), 5000)) return;
    } catch {}
  }

  try {
    await page.keyboard.press("Escape");
    if (await poll(async () => !(await isDialogOpen(page)), 3000)) return;
  } catch {}

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#docs-editor", { timeout: 20000 }).catch(() => {});
  await sleep(2000);
}
```

---

## Adapting for Your Project

1. **Replace `DOC_URL`** with your own document + `addon_dry_run` token
2. **Replace `"Mermaid Toolkit"`** in menu selectors with your add-on name
3. **Update the `google.script` stub** in the local preview to match your
   server-side functions
4. **Adjust dialog selectors** (`#source`, `#insert-btn`, etc.) to match your
   HTML element IDs
5. **Add your template variable patches** in `loadAndPatch()` calls

The core patterns — session persistence, dialog detection, iframe access,
polling, and the three-tier close strategy — are universal to any GAS add-on
testing with Playwright.
