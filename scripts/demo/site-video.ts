/**
 * Cut the site demo video from the full recording, skipping the reset step.
 * Starts from step 1 (insert) so the video begins with the cursor ready below the title.
 *
 * Usage: yarn demo:site-video
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const SCREENSHOTS_DIR = path.resolve("temp/demo");
const SITE_ASSETS = path.resolve("site/assets/demo");

interface StepTimestamp {
  step: number;
  name: string;
  startMs: number;
  endMs: number;
}

const findLatestTimestamps = (): string => {
  const files = fs
    .readdirSync(SCREENSHOTS_DIR)
    .filter((f) => f.startsWith("demo-") && f.endsWith("-timestamps.json"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(SCREENSHOTS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) {
    console.error("No timestamps found in temp/demo/");
    process.exit(1);
  }
  return path.join(SCREENSHOTS_DIR, files[0].name);
};

const main = (): void => {
  const tsFile = findLatestTimestamps();
  const videoFile = path.join(SCREENSHOTS_DIR, "demo-recording.webm");
  if (!fs.existsSync(videoFile)) {
    console.error(
      "No demo-recording.webm found. Run 'yarn demo:record' first.",
    );
    process.exit(1);
  }

  const timestamps: StepTimestamp[] = JSON.parse(
    fs.readFileSync(tsFile, "utf8"),
  );
  const step1 = timestamps.find((t) => t.step === 1);
  const lastStep = timestamps[timestamps.length - 1];
  if (!step1 || !lastStep) {
    console.error("Could not find step 1 or last step in timestamps.");
    process.exit(1);
  }

  const startSec = (step1.startMs / 1000).toFixed(3);
  const endSec = ((lastStep.endMs - 200) / 1000).toFixed(3);
  const outFile = path.join(SITE_ASSETS, "demo.webm");

  console.log(`Cutting site video: ${startSec}s to ${endSec}s`);
  console.log(`Skipping step 0 (reset)\n`);

  execSync(
    `ffmpeg -y -ss ${startSec} -to ${endSec} -i "${videoFile}" -c:v libvpx-vp9 -crf 30 -b:v 0 -an "${outFile}"`,
    { stdio: "inherit" },
  );

  const sizeMB = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(1);
  console.log(`\nSite video saved to ${outFile} (${sizeMB} MB)`);

  // Aim for the moment inside step 01 where the Radar template chip is
  // highlighted, the radar chart preview is rendered in the Mermaid Editor,
  // and the "storage saved" Drive banner has already dismissed. In the current
  // step 01 flow that happens after the template chip iteration finishes and
  // before the custom flowchart typing loop begins. Tweak here if step 01's
  // timing changes (e.g. SLEEP or CLICK delays in 01-insert.ts).
  const POSTER_OFFSET_SEC = 12.76;
  const posterSec = (step1.startMs / 1000 + POSTER_OFFSET_SEC).toFixed(3);
  const posterPng = path.join(SITE_ASSETS, "demo-poster.png");
  const posterWebp = path.join(SITE_ASSETS, "demo-poster.webp");

  console.log(
    `\nExtracting poster frame at ${posterSec}s (step 01 + ${POSTER_OFFSET_SEC}s, Radar template preview)...`,
  );
  execSync(
    `ffmpeg -y -ss ${posterSec} -i "${videoFile}" -frames:v 1 -q:v 2 "${posterPng}"`,
    { stdio: "inherit" },
  );
  execSync(`cwebp -q 80 "${posterPng}" -o "${posterWebp}"`, {
    stdio: "inherit",
  });

  const posterKB = (fs.statSync(posterWebp).size / 1024).toFixed(0);
  console.log(`Poster saved to ${posterWebp} (${posterKB} KB)`);
};

main();
