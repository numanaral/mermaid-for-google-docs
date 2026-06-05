import "dotenv/config";
import { type BrowserContext, type Page, type FrameLocator } from "playwright";
import path from "path";
import fs from "fs";
import {
  ensurePlaywrightDocSession,
  isGoogleDocEditorReady,
  launchDemoBrowser,
  DOC_URL,
  STATE_FILE,
  sleep,
} from "./demo/helpers";

const SCREENSHOTS_DIR = path.resolve("temp/demo");

interface MenuItem {
  label: string;
  wait?: number;
  afterOpen?: (
    page: Page,
    iframe: FrameLocator | null,
    slug: string,
    idx: string,
  ) => Promise<void>;
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: false,
  });
  console.log(`  Saved: ${name}.png`);
}

async function closeDialogAndReload(page: Page) {
  console.log("  Closing dialog (reload)...");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(4000);
  await page
    .waitForSelector("#docs-editor", { timeout: 15000 })
    .catch(() => {});
  await sleep(2000);
  console.log("  Page reloaded.");
}

async function getDialogIframe(page: Page): Promise<FrameLocator | null> {
  // GAS dialogs are inside nested iframes:
  // outer: Google's dialog wrapper iframe
  // inner: the actual sandboxed HTML
  const iframeSels = [
    '[class*="WizDialog-dialog"] iframe',
    ".apps-script-dialog iframe",
    'iframe[src*="userCodeAppPanel"]',
    'iframe[src*="macros"]',
  ];

  for (const sel of iframeSels) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      const outerFrame = page.frameLocator(sel).first();
      // Check if there's a nested iframe (sandboxed content)
      try {
        const innerCount = await outerFrame.locator("iframe").count();
        if (innerCount > 0) {
          return outerFrame.frameLocator("iframe").first();
        }
      } catch {
        // frame might not be accessible
      }
      return outerFrame;
    }
  }
  return null;
}

async function editorInteractions(
  page: Page,
  iframe: FrameLocator | null,
  slug: string,
  idx: string,
) {
  if (!iframe) {
    console.log("  (no iframe for editor)");
    return;
  }
  try {
    console.log("  Clicking Templates...");
    await iframe.locator("text=Templates").first().click({ timeout: 5000 });
    await sleep(1500);
    await shot(page, `${idx}-${slug}-templates`);

    console.log("  Selecting Flowchart...");
    await iframe.locator("text=Flowchart").first().click({ timeout: 3000 });
    await sleep(4000);
    await shot(page, `${idx}-${slug}-flowchart`);

    console.log("  Selecting Sequence...");
    await iframe.locator("text=Templates").first().click({ timeout: 3000 });
    await sleep(1000);
    await iframe.locator("text=Sequence").first().click({ timeout: 3000 });
    await sleep(4000);
    await shot(page, `${idx}-${slug}-sequence`);

    console.log("  Selecting Pie...");
    await iframe.locator("text=Templates").first().click({ timeout: 3000 });
    await sleep(1000);
    await iframe.locator("text=Pie").first().click({ timeout: 3000 });
    await sleep(4000);
    await shot(page, `${idx}-${slug}-pie`);
  } catch (err) {
    console.log(
      `  (editor: ${err instanceof Error ? err.message.split("\n")[0] : err})`,
    );
  }
}

async function exportInteractions(
  page: Page,
  iframe: FrameLocator | null,
  slug: string,
  idx: string,
) {
  // Wait for the export to finish loading (spinner -> content)
  console.log("  Waiting for export content to load...");
  await sleep(10000);
  await shot(page, `${idx}-${slug}-loaded`);
}

async function waitForDocLoaded(
  context: BrowserContext,
  page: Page,
): Promise<boolean> {
  const title = await page.title();
  console.log(`  Page title: ${title}`);
  const ok = await ensurePlaywrightDocSession(context, page);
  console.log("");
  return ok;
}

const MENU_ITEMS: MenuItem[] = [
  {
    label: "Insert Mermaid Diagram",
    wait: 5000,
    afterOpen: editorInteractions,
  },
  { label: "Quick Guide", wait: 3000 },
  { label: "About", wait: 3000 },
  { label: "Import from Markdown", wait: 4000 },
  {
    label: "Export as Markdown",
    wait: 5000,
    afterOpen: exportInteractions,
  },
  { label: 'Fix Native "Copy as Markdown"', wait: 4000 },
  { label: "Dev Tools", wait: 5000 },
];

const main = async () => {
  const loginOnly = process.argv.includes("--login");
  const itemFilter = process.argv
    .find((a) => a.startsWith("--only="))
    ?.split("=")[1];

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const hasState = fs.existsSync(STATE_FILE);
  console.log(
    hasState
      ? "Reusing saved session state..."
      : "No saved session -- you may need to log in.",
  );

  const browser = await launchDemoBrowser();

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: hasState ? STATE_FILE : undefined,
  });

  const page = await context.newPage();

  console.log("Navigating to Google Doc™...");
  await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);

  const docReady = await waitForDocLoaded(context, page);

  if (loginOnly) {
    if (!docReady) {
      console.error(
        "\nDoc editor never appeared. Fix login or DOC_URL, then run again.\n",
      );
      await browser.close();
      process.exit(1);
    }
    await context.storageState({ path: STATE_FILE });
    console.log("Login OK — session saved. Closing browser.\n");
    await browser.close();
    return;
  }

  await shot(page, "00-doc-baseline");

  const items = itemFilter
    ? MENU_ITEMS.filter((m) =>
        m.label.toLowerCase().includes(itemFilter.toLowerCase()),
      )
    : MENU_ITEMS;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const idx = String(i + 1).padStart(2, "0");
    const slug = item.label.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();

    console.log(`\n[${idx}] Opening: ${item.label}`);

    try {
      // Open Extensions menu
      await page
        .locator("#docs-extensions-menu")
        .click({ timeout: 5000, force: true });
      await sleep(1200);
      await shot(page, `${idx}-${slug}-menu`);

      // Hover Mermaid Toolkit
      const mermaidMenu = page.locator(
        '.goog-menuitem-content:has-text("Mermaid Toolkit")',
      );
      await mermaidMenu.first().hover({ timeout: 5000 });
      await sleep(1000);
      await shot(page, `${idx}-${slug}-submenu`);

      // Click the menu item (handle quotes in label)
      if (item.label.includes('"')) {
        const prefix = item.label.split('"')[0].trim();
        const target = page.locator(
          `.goog-menuitem-content:has-text("${prefix}")`,
        );
        await target.first().hover({ timeout: 5000 });
        await sleep(600);
        await shot(page, `${idx}-${slug}-hover`);
        await target.first().click({ timeout: 5000 });
      } else {
        const menuItem = page.locator(
          `.goog-menuitem-content:text-is("${item.label}")`,
        );
        let target = menuItem.first();
        if ((await menuItem.count()) === 0) {
          target = page
            .locator(
              `.goog-menuitem-content:has-text("${item.label.substring(0, 20)}")`,
            )
            .first();
        }
        await target.hover({ timeout: 5000 });
        await sleep(600);
        await shot(page, `${idx}-${slug}-hover`);
        await target.click({ timeout: 5000 });
      }

      // Wait for dialog
      console.log("  Waiting for dialog...");
      await sleep(item.wait || 3000);

      const hasDialog = await page.evaluate(() => {
        const d = document.querySelectorAll('[class*="WizDialog-dialog"]');
        for (const el of d) {
          if (
            !el.className.includes("scrim") &&
            getComputedStyle(el).display !== "none"
          )
            return true;
        }
        return false;
      });

      if (!hasDialog) {
        console.log("  Dialog not visible yet, waiting more...");
        await sleep(5000);
      }

      console.log("  Taking dialog screenshot...");
      await shot(page, `${idx}-${slug}`);

      // Get iframe for interactions
      const iframe = await getDialogIframe(page);
      if (item.afterOpen) {
        await item.afterOpen(page, iframe, slug, idx);
      }

      // Always reload to cleanly close (most reliable method)
      await closeDialogAndReload(page);
    } catch (err) {
      console.log(
        `  ERROR: ${err instanceof Error ? err.message.split("\n")[0] : err}`,
      );
      await shot(page, `${idx}-${slug}-error`);
      await closeDialogAndReload(page);
    }
  }

  console.log(`\n  All done! Screenshots saved to: ${SCREENSHOTS_DIR}/`);
  console.log("  Closing browser...");
  await browser.close();
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
