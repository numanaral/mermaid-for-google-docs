import "dotenv/config";
import {
  chromium,
  type Browser,
  type Page,
  type Frame,
  type BrowserContext,
  type Locator,
} from "playwright";
import path from "path";
import fs from "fs";

// ─── Constants ───────────────────────────────────────

if (!process.env.DOC_URL) {
  throw new Error(
    "DOC_URL is not set. Copy .env.example to .env and fill it in.",
  );
}
export const DOC_URL = process.env.DOC_URL;

export const STATE_FILE = path.resolve(".playwright-state.json");
export const SCREENSHOTS_DIR = path.resolve("temp/demo");
export const RUN_COUNTER_FILE = path.resolve(".playwright-run-seq.json");
export const VP_W = 1440;
export const VP_H = 900;

const DEMO_BROWSER_ARGS = ["--disable-blink-features=AutomationControlled"];

/**
 * Launch a visible browser for Google Docs demos/tests.
 *
 * Default: Playwright's bundled Chromium (reliable on macOS).
 * Optional: set PLAYWRIGHT_CHANNEL=chrome to try system Google Chrome first;
 * if that hangs (common when Chrome.app is already running), we fall back.
 */
export const launchDemoBrowser = async (): Promise<Browser> => {
  const headless = process.env.HEADLESS === "1";
  const base = { headless, args: DEMO_BROWSER_ARGS };

  if (process.env.PLAYWRIGHT_CHANNEL === "chrome") {
    try {
      return await Promise.race([
        chromium.launch({ ...base, channel: "chrome" }),
        new Promise<Browser>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  "Google Chrome (channel) did not start within 8s — often hangs if Chrome.app is already open",
                ),
              ),
            8000,
          );
        }),
      ]);
    } catch (e) {
      console.warn(
        `[playwright] ${e instanceof Error ? e.message : String(e)}. Using bundled Chromium.`,
      );
    }
  }

  return chromium.launch(base);
};

/** True when the page looks like an authenticated Google Doc editor. */
export const isGoogleDocEditorReady = async (page: Page): Promise<boolean> =>
  page
    .locator("#docs-editor")
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);

/**
 * Wait for login if needed, ensure the doc editor is visible, and persist
 * session cookies only when the editor loaded (avoids overwriting a good
 * .playwright-state.json with a logged-out page).
 */
export const ensurePlaywrightDocSession = async (
  context: BrowserContext,
  page: Page,
): Promise<boolean> => {
  const title = await page.title();
  if (
    title.includes("Sign in") ||
    title.includes("Google Account") ||
    title.includes("accounts.google")
  ) {
    console.log("\n   *** Log in to Google in the browser window. ***");
    console.log("   *** Waiting up to 5 minutes… ***\n");
    await page.waitForURL("**/document/**", { timeout: 300000 });
    await sleep(5000);
  }

  console.log("   Waiting for Google Docs editor…");
  const ready = await page
    .waitForSelector("#docs-editor", { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  await sleep(2000);

  if (ready) {
    await context.storageState({ path: STATE_FILE });
    console.log("   Session saved to .playwright-state.json");
  } else {
    console.warn(
      "   ⚠ #docs-editor not found — not updating .playwright-state.json",
    );
    console.warn(
      "   Run `yarn test:login` (visible browser) and complete Google sign-in if prompted.",
    );
  }
  return ready;
};

/** Persist cookies after manual browsing (e.g. demo:open-doc). */
export const savePlaywrightSessionIfDocReady = async (
  context: BrowserContext,
  page: Page,
): Promise<void> => {
  if (await isGoogleDocEditorReady(page)) {
    await context.storageState({ path: STATE_FILE });
    console.log("Session refreshed in .playwright-state.json");
  }
};

// ─── Run tagging ─────────────────────────────────────

export const nextRunTag = (prefix: string): string => {
  let seq = 0;
  try {
    if (fs.existsSync(RUN_COUNTER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RUN_COUNTER_FILE, "utf8"));
      seq = Number(parsed.seq || 0);
    }
  } catch {}
  seq += 1;
  fs.writeFileSync(RUN_COUNTER_FILE, JSON.stringify({ seq }, null, 2));
  return `${prefix}-${String(seq).padStart(4, "0")}`;
};

// ─── CLI parsing ─────────────────────────────────────

export interface StepRange {
  start: number;
  end: number;
}

export const parseStepRange = (args: string[]): StepRange => {
  const rawArg = args.find(
    (arg) =>
      /^\d{1,2}(-\d{1,2})?$/.test(arg) ||
      /^--steps=\d{1,2}(-\d{1,2})?$/.test(arg),
  );
  const raw = rawArg?.startsWith("--steps=") ? rawArg.slice(8) : rawArg;
  if (!raw) return { start: 0, end: 13 };
  const [startRaw, endRaw = startRaw] = raw.split("-");
  const s = Number(startRaw);
  const e = Number(endRaw);
  if (
    !Number.isInteger(s) ||
    !Number.isInteger(e) ||
    s < 0 ||
    e > 13 ||
    s > e
  ) {
    throw new Error(`Invalid step range: ${raw}`);
  }
  return { start: s, end: e };
};

// ─── Sleep / Poll ────────────────────────────────────

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export const poll = async <T>(
  fn: () => Promise<T>,
  timeoutMs = 15000,
): Promise<T | null> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await sleep(400);
  }
  return null;
};

// ─── Screenshot ──────────────────────────────────────

export const saveShot = async (
  page: Page,
  label: string,
  runTag: string,
  isBatch: boolean,
): Promise<void> => {
  if (!isBatch) return;
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${runTag}-${label}.png`),
  });
};

// ─── Textarea helpers ────────────────────────────────

export interface TextareaState {
  active: boolean;
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export const getTextareaState = async (
  locator: Locator,
): Promise<TextareaState> =>
  locator.evaluate((el: HTMLTextAreaElement) => ({
    active: document.activeElement === el,
    value: el.value,
    selectionStart: el.selectionStart,
    selectionEnd: el.selectionEnd,
  }));

// ─── Cursor overlay ──────────────────────────────────

const CURSOR_STYLE =
  "position:fixed;z-index:2147483647;pointer-events:none;" +
  "width:22px;height:22px;border-radius:50%;" +
  "background:rgba(0,137,123,0.55);border:2px solid rgba(0,137,123,0.85);" +
  "transform:translate(-50%,-50%);left:-100px;top:-100px;" +
  "box-shadow:0 0 8px rgba(0,137,123,0.3);" +
  "transition:left 0.04s linear, top 0.04s linear;";

export let lastPos = { x: VP_W / 2, y: 350 };

export const setLastPos = (x: number, y: number): void => {
  lastPos = { x, y };
};

export const injectCursor = async (frame: Page | Frame): Promise<void> => {
  await frame
    .evaluate((style: string) => {
      if (document.getElementById("pw-cursor")) return;
      const d = document.createElement("div");
      d.id = "pw-cursor";
      d.style.cssText = style;
      document.documentElement.appendChild(d);
    }, CURSOR_STYLE)
    .catch(() => {});
};

export const setCursor = async (
  frame: Page | Frame,
  x: number,
  y: number,
): Promise<void> => {
  await frame
    .evaluate(
      ([cx, cy]: [number, number]) => {
        const el = document.getElementById("pw-cursor");
        if (el) {
          el.style.left = cx + "px";
          el.style.top = cy + "px";
        }
      },
      [x, y] as [number, number],
    )
    .catch(() => {});
};

export const hideCursor = async (frame: Page | Frame): Promise<void> => {
  await frame
    .evaluate(() => {
      const el = document.getElementById("pw-cursor");
      if (el) {
        el.style.left = "-100px";
        el.style.top = "-100px";
      }
    })
    .catch(() => {});
};

export const flashClick = async (frame: Page | Frame): Promise<void> => {
  await frame
    .evaluate(() => {
      const el = document.getElementById("pw-cursor");
      if (!el) return;
      el.style.transform = "translate(-50%,-50%) scale(0.65)";
      el.style.background = "rgba(0,137,123,0.85)";
      setTimeout(() => {
        el.style.transform = "translate(-50%,-50%) scale(1)";
        el.style.background = "rgba(0,137,123,0.55)";
      }, 120);
    })
    .catch(() => {});
};

// ─── Page-level glide ────────────────────────────────

export const pageGlide = async (
  page: Page,
  toX: number,
  toY: number,
  steps = 20,
): Promise<void> => {
  const from = { ...lastPos };
  for (let i = 1; i <= steps; i++) {
    const px = from.x + ((toX - from.x) * i) / steps;
    const py = from.y + ((toY - from.y) * i) / steps;
    await page.mouse.move(px, py);
    await setCursor(page, px, py);
    await sleep(8);
  }
  lastPos = { x: toX, y: toY };
};

// ─── Iframe offset ───────────────────────────────────

export interface IframeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const getIframeOffset = async (page: Page): Promise<IframeRect | null> =>
  page
    .evaluate(() => {
      let el: Element | null = document.querySelector(
        'iframe[name="userHtmlFrame"]',
      );
      if (!el) {
        let best: Element | null = null;
        let bestArea = 0;
        for (const f of document.querySelectorAll("iframe")) {
          const r = f.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > bestArea && r.width > 200 && r.height > 200) {
            best = f;
            bestArea = area;
          }
        }
        el = best;
      }
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })
    .catch(() => null);

// ─── Dialog detection ────────────────────────────────

export const isDialogOpen = (page: Page): Promise<boolean> =>
  page
    .evaluate(() => {
      for (const el of document.querySelectorAll(
        '[class*="WizDialog-dialog"]',
      )) {
        if (
          !el.className.includes("scrim") &&
          getComputedStyle(el).display !== "none"
        )
          return true;
      }
      return false;
    })
    .catch(() => false);

export const openDialogCount = (page: Page): Promise<number> =>
  page
    .evaluate(() => {
      let count = 0;
      for (const el of document.querySelectorAll(
        '[class*="WizDialog-dialog"]',
      )) {
        if (
          !el.className.includes("scrim") &&
          getComputedStyle(el).display !== "none"
        ) {
          count += 1;
        }
      }
      return count;
    })
    .catch(() => 0);

export const waitForVisible = async (
  locator: Locator,
  timeoutMs = 8000,
): Promise<boolean> =>
  !!(await poll(() => locator.isVisible().catch(() => false), timeoutMs));

export const waitForMermaidEditorReady = (iframe: Frame): Promise<unknown> =>
  poll(
    () =>
      iframe
        .locator("#source")
        .inputValue()
        .then((value: string) => value.trim().length > 0)
        .catch(() => false),
    15000,
  );

export const waitForValidPreview = (iframe: Frame): Promise<unknown> =>
  poll(async () => {
    const hasPreview = await iframe
      .locator("#preview-area svg, #preview-area img")
      .count()
      .then((count: number) => count > 0)
      .catch(() => false);
    const hasSyntaxError = await iframe
      .locator("text=/Syntax error|No diagram type detected/i")
      .count()
      .then((count: number) => count > 0)
      .catch(() => false);
    const upToDate = await iframe
      .locator('#status:has-text("Preview up to date")')
      .count()
      .then((count: number) => count > 0)
      .catch(() => false);
    return hasPreview && upToDate && !hasSyntaxError;
  }, 12000);

// ─── Dialog enter / close ────────────────────────────

export interface DialogContext {
  iframe: Frame;
  offset: IframeRect;
  iGlide: (toX: number, toY: number, steps?: number) => Promise<void>;
  iClick: (locator: Locator, steps?: number) => Promise<boolean>;
}

export const enterDialog = async (
  page: Page,
  contentCheck?: (f: Frame) => Promise<unknown>,
): Promise<DialogContext | null> => {
  const opened = await poll(() => isDialogOpen(page), 25000);
  if (!opened) {
    console.log("   ⚠ Dialog didn't open");
    return null;
  }
  const iframe = await poll(async () => {
    const current = page.frame("userHtmlFrame");
    if (!current) return null;
    const ready = contentCheck
      ? await contentCheck(current).catch(() => false)
      : await current
          .evaluate(() => document.body && document.body.innerHTML.length > 100)
          .catch(() => false);
    if (!ready) return null;
    const focusTrapDone = await current
      .evaluate(
        () =>
          (window as unknown as { __dialogFocusTrapDone?: boolean })
            .__dialogFocusTrapDone !== false,
      )
      .catch(() => true);
    return focusTrapDone ? current : null;
  }, 15000);
  if (!iframe) {
    console.log("   ⚠ No iframe found");
    return null;
  }
  await injectCursor(iframe);
  await hideCursor(page);

  const offset = await poll(() => getIframeOffset(page), 5000);
  if (!offset) {
    console.log("   ⚠ No iframe offset");
    return null;
  }
  console.log(`   iframe: ${offset.x},${offset.y} ${offset.w}x${offset.h}`);

  const cx = offset.x + offset.w / 2;
  const cy = offset.y + offset.h / 2;
  lastPos = { x: cx, y: cy };
  await page.mouse.move(cx, cy);
  await iframe
    .evaluate(
      ([lx, ly]: [number, number]) => {
        const el = document.getElementById("pw-cursor");
        if (el) {
          el.style.left = lx + "px";
          el.style.top = ly + "px";
        }
      },
      [cx - offset.x, cy - offset.y] as [number, number],
    )
    .catch(() => {});
  await sleep(200);

  const iGlide = async (
    toX: number,
    toY: number,
    steps = 18,
  ): Promise<void> => {
    const from = { ...lastPos };
    for (let i = 1; i <= steps; i++) {
      const px = from.x + ((toX - from.x) * i) / steps;
      const py = from.y + ((toY - from.y) * i) / steps;
      await page.mouse.move(px, py);
      await iframe
        .evaluate(
          ([lx, ly]: [number, number]) => {
            const el = document.getElementById("pw-cursor");
            if (el) {
              el.style.left = lx + "px";
              el.style.top = ly + "px";
            }
          },
          [px - offset.x, py - offset.y] as [number, number],
        )
        .catch(() => {});
      await sleep(8);
    }
    lastPos = { x: toX, y: toY };
  };

  const iClick = async (locator: Locator, steps = 16): Promise<boolean> => {
    const box = await locator.boundingBox().catch(() => null);
    if (!box) {
      console.log("   ⚠ Element not found for click");
      return false;
    }
    await iGlide(box.x + box.width / 2, box.y + box.height / 2, steps);
    await sleep(60);
    await flashClick(iframe);
    await locator.click({ timeout: 3000, force: true }).catch(() => {});
    return true;
  };

  return { iframe, offset, iGlide, iClick };
};

export const closeDialog = async (page: Page): Promise<void> => {
  const beforeCount = await openDialogCount(page);
  if (beforeCount === 0) return;
  const f = page.frame("userHtmlFrame");
  if (f) {
    try {
      await f.evaluate(() => {
        if (
          (
            window as unknown as {
              google?: { script?: { host?: { close?: () => void } } };
            }
          ).google?.script?.host?.close
        )
          (
            window as unknown as {
              google: { script: { host: { close: () => void } } };
            }
          ).google.script.host.close();
      });
      if (
        await poll(
          async () => (await openDialogCount(page)) < beforeCount,
          5000,
        )
      ) {
        await sleep(300);
        return;
      }
    } catch {}
  }
  await page.keyboard.press("Escape").catch(() => {});
  if (
    await poll(async () => (await openDialogCount(page)) < beforeCount, 3000)
  ) {
    await sleep(300);
    return;
  }
  const closeBtn = page
    .locator('[class*="WizDialog-dialog"] [aria-label="Close"]')
    .last();
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.click({ force: true }).catch(() => {});
    if (
      await poll(async () => (await openDialogCount(page)) < beforeCount, 3000)
    ) {
      await sleep(300);
      return;
    }
  }
  throw new Error("Could not close dialog without reloading the page.");
};

export const closeFrameDialog = async (
  frame: Frame,
  _page: Page,
  label = "Dialog",
): Promise<void> => {
  await frame
    .evaluate(() => {
      if (
        (
          window as unknown as {
            google?: { script?: { host?: { close?: () => void } } };
          }
        ).google?.script?.host?.close
      )
        (
          window as unknown as {
            google: { script: { host: { close: () => void } } };
          }
        ).google.script.host.close();
    })
    .catch(() => {});
  const closed = await poll(async () => {
    try {
      await frame.evaluate(() => document.body?.innerHTML.length ?? 0);
      return false;
    } catch {
      return true;
    }
  }, 3000);
  if (!closed) {
    throw new Error(`${label} did not close.`);
  }
  await sleep(250);
};

export const cleanBetween = async (page: Page): Promise<void> => {
  let attempts = 0;
  while ((await isDialogOpen(page)) && attempts < 5) {
    try {
      await closeDialog(page);
    } catch {
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(300);
      const closeBtn = page
        .locator('[class*="WizDialog-dialog"] [aria-label="Close"]')
        .last();
      if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await closeBtn.click({ force: true }).catch(() => {});
      }
    }
    await sleep(200);
    attempts += 1;
  }
  if (await isDialogOpen(page)) {
    console.log("   ⚠ Cleanup left a dialog open");
  }
  await sleep(400);
  await injectCursor(page);
  await setCursor(page, lastPos.x, lastPos.y);
  await page.mouse.move(lastPos.x, lastPos.y);
};

export const showDocumentScroll = async (
  page: Page,
  shot: (label: string) => Promise<void>,
  label: string,
): Promise<void> => {
  const editor = page.locator(".kix-appview-editor").first();
  const box = await editor.boundingBox().catch(() => null);
  const x = box ? box.x + box.width / 2 : VP_W / 2;
  const y = box ? box.y + box.height / 2 : VP_H / 2;

  console.log("   Scrolling document result...");
  await page.mouse.move(x, y);
  await sleep(300);
  await page.mouse.wheel(0, 760);
  await sleep(900);
  await shot(`${label}-scrolled`);
  await page.mouse.wheel(0, 760);
  await sleep(700);
  await shot(`${label}-scrolled-more`);

  await page.keyboard.press("Meta+ArrowUp");
  await sleep(900);
  await shot(`${label}-back-to-top`);
};

// ─── Menu navigation ─────────────────────────────────

export const openMenuItem = async (
  page: Page,
  label: string,
): Promise<boolean> => {
  await injectCursor(page);
  await setCursor(page, lastPos.x, lastPos.y);

  const extMenu = page.locator("#docs-extensions-menu");
  const mtk = page
    .locator('.goog-menuitem-content:has-text("Mermaid Toolkit")')
    .first();
  let target: Locator;
  if (label.includes('"')) {
    target = page
      .locator(
        `.goog-menuitem-content:has-text("${label.split('"')[0].trim()}")`,
      )
      .first();
  } else {
    target = page
      .locator(`.goog-menuitem-content:has-text("${label}")`)
      .first();
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const extBox = await extMenu.boundingBox().catch(() => null);
    if (!extBox) {
      await sleep(1000);
      continue;
    }
    if (lastPos.y > extBox.y + 50) {
      await pageGlide(page, extBox.x + 40, lastPos.y, 8);
    }
    await pageGlide(page, extBox.x + 40, extBox.y + 10, 10);
    await sleep(150);
    await flashClick(page);
    await extMenu.click({ force: true });
    await sleep(500);

    if (!(await poll(() => mtk.isVisible().catch(() => false), 4000))) {
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(500);
      continue;
    }
    const mtkBox = await mtk.boundingBox().catch(() => null);
    if (mtkBox)
      await pageGlide(
        page,
        mtkBox.x + mtkBox.width / 2,
        mtkBox.y + mtkBox.height / 2,
        12,
      );
    await mtk.hover({ timeout: 5000 });
    await sleep(600);

    if (!(await poll(() => target.isVisible().catch(() => false), 4000))) {
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(500);
      continue;
    }
    const targetBox = await target.boundingBox().catch(() => null);
    if (targetBox && mtkBox) {
      await pageGlide(
        page,
        mtkBox.x + mtkBox.width,
        targetBox.y + targetBox.height / 2,
        5,
      );
      await pageGlide(
        page,
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 2,
        10,
      );
    }
    await sleep(450);
    await flashClick(page);
    await target.click({ timeout: 5000 });
    await sleep(300);
    return true;
  }
  console.log(`   ⚠ Failed to open: ${label}`);
  return false;
};

export const openMenuItemDirect = async (
  page: Page,
  label: string,
): Promise<boolean> => {
  const extMenu = page.locator("#docs-extensions-menu");
  const toolkit = page
    .locator('.goog-menuitem-content:has-text("Mermaid Toolkit")')
    .first();
  const target = page
    .locator(`.goog-menuitem-content:has-text("${label}")`)
    .first();

  await extMenu.click({ force: true });
  if (!(await waitForVisible(toolkit, 5000))) {
    console.log("   ⚠ Mermaid Toolkit menu didn't appear");
    return false;
  }
  await toolkit.hover({ timeout: 5000 }).catch(() => {});
  if (!(await waitForVisible(target, 5000))) {
    console.log(`   ⚠ Menu item not visible: ${label}`);
    return false;
  }
  await target.click({ force: true });
  return true;
};

// ─── Typing ──────────────────────────────────────────

export const typeHumanLike = async (
  target: Locator,
  text: string,
  minDelay = 15,
  maxDelay = 35,
): Promise<void> => {
  for (const ch of text) {
    await target.type(ch, { delay: 0 });
    await sleep(minDelay + Math.random() * (maxDelay - minDelay));
  }
};

export const typeCodeLines = async (
  target: Locator,
  lines: string[],
  minDelay = 15,
  maxDelay = 35,
): Promise<void> => {
  for (let i = 0; i < lines.length; i++) {
    const current = await target.inputValue().catch(() => "");
    const currentLine = current.slice(current.lastIndexOf("\n") + 1);
    const desiredLine = lines[i];
    const remaining = desiredLine.startsWith(currentLine)
      ? desiredLine.slice(currentLine.length)
      : desiredLine;

    if (remaining) {
      await typeHumanLike(target, remaining, minDelay, maxDelay);
    }
    if (i < lines.length - 1) {
      await target.press("Enter");
      await sleep(40);
    }
  }
};

// ─── Image helpers ───────────────────────────────────

export const imageToolbarVisible = async (page: Page): Promise<boolean> =>
  page
    .evaluate(() => {
      const labels = ["Image options", "Replace image", "Crop image"];
      return labels.some((label) => {
        const el = document.querySelector(`[data-tooltip="${label}"]`);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(el).display !== "none"
        );
      });
    })
    .catch(() => false);

export const dismissGasAlert = async (page: Page): Promise<boolean> => {
  const ok = page.locator('[role="button"]:has-text("OK")').first();
  const visible = await ok.isVisible({ timeout: 300 }).catch(() => false);
  if (!visible) return false;
  await ok.click().catch(() => {});
  await sleep(300);
  return true;
};

// ─── Diagram source builders ─────────────────────────

export const buildInsertFlowchartLines = (runTag: string): string[] => [
  "flowchart LR",
  `    A[Google Doc ${runTag}] --> B{Action ${runTag}}`,
  "    B -->|New| C[Insert]",
  "    B -->|Edit| D[Modify]",
  "    C --> E[Preview]",
  "    D --> E",
  `    E --> F[Done ${runTag}]`,
];

export const buildEditedFlowchart = (_source: string, runTag: string): string =>
  [
    "sequenceDiagram",
    `    participant U as User ${runTag}`,
    "    participant D as Google Docs",
    "    participant M as Mermaid Toolkit",
    "    U->>D: Select existing diagram",
    "    D->>M: Open editor",
    "    M-->>U: Show live preview",
    "    U->>M: Update Mermaid source",
    `    M-->>D: Replace diagram ${runTag}`,
  ].join("\n");

export const buildEditAllFlowchart = (
  _source: string,
  runTag: string,
): string =>
  [
    "flowchart TB",
    `    A([Release Plan ${runTag}]) --> B[Draft Notes]`,
    "    B --> C{Ready to ship?}",
    "    C -->|Yes| D[Publish Update]",
    "    C -->|No| E[Revise Scope]",
    "    E -.-> B",
    "    D --> F{{Notify Team}}",
    `    F --> G[(Archive ${runTag})]`,
  ].join("\n");

export const SAMPLE_MARKDOWN = `# Sample Document

## Overview

This is a **sample markdown** document with diagrams.

\`\`\`mermaid
pie title Feature Usage
    "Editor" : 40
    "Import/Export" : 30
    "Bulk Convert" : 20
    "Fix Markdown" : 10
\`\`\`

### Checklist

- [ ] Unchecked item imports as a bullet with a literal [ ] marker
  - [ ] Nested unchecked item
- [x] Checked item imports as a bullet with a literal [x] marker
  - [x] Nested checked item

### Architecture

\`\`\`mermaid
graph TD
    A[User] --> B[Google Docs]
    B --> C[Mermaid Toolkit]
    C --> D[Rendered Diagram]
\`\`\`

### Features

- Live editor with preview
- Code to diagram conversion
- Import/export markdown

> Everything runs client-side in the browser.

| Feature | Status |
|---------|--------|
| Editor | Done |
| Import | Done |
| Export | Done |
`;

export const BROKEN_MARKDOWN = [
  "# Architecture Doc",
  "",
  "Here is the system flow:",
  "",
  "```` ```mermaid ````",
  "`graph TD`",
  "`    A[Client] --> B[API Gateway]`",
  "`    B --> C[Auth Service]`",
  "`    B --> D[Data Service]`",
  "`    C --> E[Database]`",
  "`    D --> E`",
  "```` ``` ````",
  "",
  "And another one:",
  "",
  "```` ```mermaid ````",
  "`sequenceDiagram`",
  "`    Alice->>Bob: Hello Bob`",
  "`    Bob-->>Alice: Hi Alice`",
  "```` ``` ````",
].join("\n");

// ─── Step context ────────────────────────────────────

export interface StepContext {
  page: Page;
  context: BrowserContext;
  runTag: string;
  isBatch: boolean;
  stepRange: StepRange;
  shot: (label: string) => Promise<void>;
}
