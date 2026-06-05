/**
 * Standalone recorder for "Convert Selected Diagram to Code" (recorder step 04).
 * Produces site/assets/gifs/diagram-to-code-for-one.gif without running the full
 * demo:record pipeline — use when refreshing that one feature clip.
 *
 * Usage:
 *   tsx scripts/demo/record-diagram-to-code-selected.ts
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
import { step04DiagramToCodeForOne } from "./steps/04-diagram-to-code-for-one";

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
    runTag: "diagram-to-code-selected",
    isBatch: true,
    stepRange: { start: 0, end: 0 },
    shot: async (label: string) => {
      await page.screenshot({
        path: path.join(OUT_DIR, `diagram-to-code-selected-${label}.png`),
      });
    },
  };

  try {
    await step04DiagramToCodeForOne(ctx);
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
    const webmDest = path.join(OUT_DIR, "diagram-to-code-selected.webm");
    try {
      fs.renameSync(videoPath, webmDest);
    } catch {}
    console.log(`\nVideo: ${webmDest}`);

    const gifDest = path.resolve(
      "site/assets/gifs/diagram-to-code-for-one.gif",
    );
    const palette = path.join(OUT_DIR, "_palette_d2c.png");

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
