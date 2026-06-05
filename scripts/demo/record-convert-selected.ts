/**
 * Standalone recorder for "Convert Selected Code to Diagram" (recorder step 05).
 * Produces site/assets/gifs/code-to-diagram-for-one.gif without the full
 * demo:record pipeline — use when refreshing that one feature clip.
 *
 * Prerequisites:
 *   - .env with DOC_URL set
 *   - .playwright-state.json (run `yarn test:login` first)
 *   - The doc must have mermaid code blocks (run step 00-reset or have them ready)
 *   - ffmpeg installed (for gif conversion)
 *
 * Usage:
 *   tsx scripts/demo/record-convert-selected.ts
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  launchDemoBrowser,
  DOC_URL,
  STATE_FILE,
  VP_W,
  VP_H,
  sleep,
  injectCursor,
  setCursor,
  setLastPos,
  type StepContext,
} from "./helpers";
import { step05CodeToDiagramForOne } from "./steps/05-code-to-diagram-for-one";

const OUT_DIR = path.resolve("temp/demo");
const GIF_WIDTH = 720;
const GIF_FPS = 12;

const main = async (): Promise<void> => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await launchDemoBrowser();
  const context = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
    recordVideo: {
      dir: OUT_DIR,
      size: { width: VP_W, height: VP_H },
    },
  });
  const page = await context.newPage();

  page.on("dialog", async (d) => {
    console.log(`   [Alert] "${d.message()}"`);
    await d.accept();
  });

  console.log("Loading doc...");
  await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .waitForSelector("#docs-editor", { timeout: 30000 })
    .catch(() => {});
  await sleep(2000);
  await context.storageState({ path: STATE_FILE });
  await injectCursor(page);
  setLastPos(VP_W / 2, 350);
  await setCursor(page, VP_W / 2, 350);
  await page.mouse.move(VP_W / 2, 350);
  await sleep(400);

  const ctx: StepContext = {
    page,
    context,
    runTag: "convert-selected",
    isBatch: true,
    stepRange: { start: 0, end: 0 },
    shot: async (label: string) => {
      await page.screenshot({
        path: path.join(OUT_DIR, `convert-selected-${label}.png`),
      });
    },
  };

  try {
    await step05CodeToDiagramForOne(ctx);
    console.log("\n   Done recording.");
  } catch (e) {
    console.error("\n   Error:", e instanceof Error ? e.message : String(e));
  }

  await sleep(1500);
  const videoPath = await page.video()?.path();
  await page.close();
  await context.close();
  await browser.close();

  if (videoPath) {
    const webmDest = path.join(OUT_DIR, "code-to-diagram-for-one.webm");
    try {
      fs.renameSync(videoPath, webmDest);
    } catch {}
    console.log(`\nVideo: ${webmDest}`);

    const gifDest = path.resolve(
      "site/assets/gifs/code-to-diagram-for-one.gif",
    );
    const palette = path.join(OUT_DIR, "_palette_c2d1.png");

    console.log("Converting to gif...");
    try {
      execSync(
        `ffmpeg -y -i "${webmDest}" -vf "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" "${palette}"`,
        { stdio: "pipe" },
      );
      execSync(
        `ffmpeg -y -i "${webmDest}" -i "${palette}" -lavfi "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "${gifDest}"`,
        { stdio: "pipe" },
      );
      fs.unlinkSync(palette);
      const sizeMb = (fs.statSync(gifDest).size / (1024 * 1024)).toFixed(1);
      console.log(`Gif: ${gifDest} (${sizeMb} MB)`);
    } catch (e) {
      console.error(
        "ffmpeg failed:",
        e instanceof Error ? e.message : String(e),
      );
      console.log("Webm saved at:", webmDest);
    }
  }

  console.log("Done.");
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
