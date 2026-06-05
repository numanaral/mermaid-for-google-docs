/**
 * Smoke: Import dialog leaves "Loading libraries" and loads mermaid/marked.
 * yarn demo:smoke-import-dialog
 */
import fs from "fs";
import {
  launchDemoBrowser,
  DOC_URL,
  STATE_FILE,
  VP_W,
  VP_H,
  sleep,
  openMenuItem,
  enterDialog,
  poll,
} from "./helpers";

const WALL_MS = 120_000;
const READY_MS = 90_000;

const main = async (): Promise<void> => {
  const wall = setTimeout(() => process.exit(2), WALL_MS);
  if (!fs.existsSync(STATE_FILE)) {
    console.error("Run yarn test:login first.");
    process.exit(1);
  }

  const browser = await launchDemoBrowser();
  const context = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    storageState: STATE_FILE,
  });
  const page = await context.newPage();
  page.on("dialog", async (d) => {
    await d.accept();
  });

  let pass = false;
  let detail = "";

  try {
    await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(2000);
    if (!(await openMenuItem(page, "Import from Markdown"))) {
      detail = "menu open failed";
    } else {
      const d = await enterDialog(page, (f) => f.locator("#source").isVisible());
      if (!d) {
        detail = "dialog did not open";
      } else {
        const { iframe } = d;
        const ok = await poll(async () => {
          const status =
            (await iframe.locator("#status").textContent())?.trim() ?? "";
          if (/Dialog script error|Dialog error/i.test(status)) {
            detail = status;
            return true;
          }
          const hasMermaid = await iframe.evaluate(
            () => typeof (window as { mermaid?: unknown }).mermaid !== "undefined",
          );
          if (hasMermaid && !/^Loading libraries/i.test(status)) {
            detail = `ready: ${status.slice(0, 80)}`;
            return true;
          }
          if (
            !/^Loading libraries/i.test(status) &&
            /Ready|paste markdown|Failed to load/i.test(status)
          ) {
            detail = status.slice(0, 120);
            return true;
          }
          return false;
        }, READY_MS);
        pass =
          ok &&
          !/Dialog script error|Dialog error/i.test(detail) &&
          (detail.startsWith("ready:") || /Ready|Failed to load markdown/i.test(detail));
        if (ok && !pass) detail = detail || "timeout state unclear";
      }
    }
  } finally {
    clearTimeout(wall);
    await context.close();
    await browser.close();
  }

  console.log(pass ? `\n✅ smoke-import PASS — ${detail}\n` : `\n❌ smoke-import FAIL — ${detail}\n`);
  process.exit(pass ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
