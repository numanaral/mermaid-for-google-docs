/**
 * Full Playwright demo recorder — showcases every Mermaid Toolkit menu item
 * with smooth cursor movement and real interactions inside each dialog.
 *
 * Usage:
 *   tsx scripts/demo/recorder.ts          # full run (steps 0-13)
 *   tsx scripts/demo/recorder.ts 0-2      # steps 0 through 2
 *   tsx scripts/demo/recorder.ts 8-13     # steps 8 through 13
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import {
  DOC_URL,
  STATE_FILE,
  SCREENSHOTS_DIR,
  VP_W,
  VP_H,
  parseStepRange,
  nextRunTag,
  sleep,
  injectCursor,
  setCursor,
  setLastPos,
  type StepContext,
} from "./helpers";

import { step00Reset } from "./steps/00-reset";
import { step01Insert } from "./steps/01-insert";
import { step02EditSelected } from "./steps/02-edit-selected";
import { step03EditAll } from "./steps/03-edit-all";
import { step04DiagramToCodeForOne } from "./steps/04-diagram-to-code-for-one";
import { step05CodeToDiagramForOne } from "./steps/05-code-to-diagram-for-one";
import { step06DiagramToCodeForAll } from "./steps/06-diagram-to-code-for-all";
import { step07CodeToDiagramForAll } from "./steps/07-code-to-diagram-for-all";
import { step08Import } from "./steps/08-import";
import { step09Export } from "./steps/09-export";
import { step10FixMarkdown } from "./steps/10-fix-markdown";
import { step11QuickGuide } from "./steps/11-quick-guide";
import { step12DevTools } from "./steps/12-dev-tools";
import { step13About } from "./steps/13-about";

const steps = [
  step00Reset,
  step01Insert,
  step02EditSelected,
  step03EditAll,
  step04DiagramToCodeForOne,
  step05CodeToDiagramForOne,
  step06DiagramToCodeForAll,
  step07CodeToDiagramForAll,
  step08Import,
  step09Export,
  step10FixMarkdown,
  step11QuickGuide,
  step12DevTools,
  step13About,
];

const TOTAL_STEPS = steps.length - 1;

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const stepRange = parseStepRange(args);
  const isBatch = stepRange.start !== 0 || stepRange.end !== TOTAL_STEPS;
  const captureShots = isBatch || args.includes("--shots");
  const rangeLabel = `${String(stepRange.start).padStart(2, "0")}-${String(stepRange.end).padStart(2, "0")}`;
  const runTag = nextRunTag(`demo-${rangeLabel}`);

  console.log("\n═══ Full Mermaid Toolkit Demo ═══\n");
  console.log(`Run tag: ${runTag}`);
  console.log(`Steps: ${rangeLabel} (total ${TOTAL_STEPS + 1})`);
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const timestampsPath = path.join(
    SCREENSHOTS_DIR,
    `${runTag}-timestamps.json`,
  );
  const timestamps: Array<{
    step: number;
    name: string;
    startMs: number;
    endMs: number;
  }> = [];

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
    recordVideo: {
      dir: SCREENSHOTS_DIR,
      size: { width: VP_W, height: VP_H },
    },
  });
  const videoStartMs = Date.now();
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

  const recordingStartMs = videoStartMs;

  const ctx: StepContext = {
    page,
    context,
    runTag,
    isBatch,
    stepRange,
    shot: async (label: string) => {
      if (!captureShots) return;
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `${runTag}-${label}.png`),
      });
    },
  };

  try {
    for (let i = stepRange.start; i <= stepRange.end; i++) {
      const stepFn = steps[i];
      if (!stepFn) continue;
      const stepStart = Date.now() - recordingStartMs;
      await stepFn(ctx);
      const stepEnd = Date.now() - recordingStartMs;
      timestamps.push({
        step: i,
        name: stepFn.name,
        startMs: stepStart,
        endMs: stepEnd,
      });
    }

    console.log(
      `\n✅ Completed step range ${rangeLabel}${isBatch ? "" : " (full demo)"}.`,
    );
  } catch (e) {
    console.error("\n❌ Error:", e instanceof Error ? e.message : String(e));
  } finally {
    fs.writeFileSync(timestampsPath, JSON.stringify(timestamps, null, 2));
    console.log(`\n📋 Timestamps: temp/demo/${path.basename(timestampsPath)}`);

    await sleep(1500);
    const videoPath = await page.video()?.path();
    await page.close();
    await context.close();
    await browser.close();
    if (videoPath) {
      const dest = path.join(
        SCREENSHOTS_DIR,
        isBatch ? `${runTag}.webm` : "demo-recording.webm",
      );
      try {
        fs.renameSync(videoPath, dest);
      } catch {}
      console.log(`\n🎬 Video: temp/demo/${path.basename(dest)}`);
    }
    console.log("Browser closed.");
  }
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
