/**
 * Open your DOC_URL in a Playwright browser and keep it open for manual testing.
 *
 *   yarn test:login          # saves session, closes when doc loads
 *   yarn demo:open-doc       # visible browser, stays open until Ctrl+C
 *
 * Optional: HEADLESS=1 for headless (not recommended for manual use).
 */
import "dotenv/config";
import fs from "fs";
import readline from "readline";
import {
  ensurePlaywrightDocSession,
  launchDemoBrowser,
  DOC_URL,
  STATE_FILE,
  VP_W,
  VP_H,
  savePlaywrightSessionIfDocReady,
} from "./helpers";

const main = async (): Promise<void> => {
  if (!fs.existsSync(STATE_FILE)) {
    console.error("Run `yarn test:login` first.\n");
    process.exit(1);
  }

  console.log("\nOpening Google Doc for manual testing…");
  console.log(DOC_URL);
  console.log(
    "Browser stays open until you press Enter in this terminal (or Ctrl+C).\n",
  );

  const browser = await launchDemoBrowser();
  const context = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    storageState: STATE_FILE,
  });
  const page = await context.newPage();
  page.on("dialog", async (d) => {
    await d.accept();
  });

  await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await ensurePlaywrightDocSession(context, page);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise<void>((resolve) => {
    rl.question("Press Enter to close the browser… ", () => {
      rl.close();
      resolve();
    });
  });

  await savePlaywrightSessionIfDocReady(context, page);
  await context.close();
  await browser.close();
  console.log("Done.\n");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
