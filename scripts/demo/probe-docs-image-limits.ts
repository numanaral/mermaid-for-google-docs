/**
 * Empirical Google Docs insertImage limits via DocumentApp.appendImage
 * (same PNG blob path as Insert Mermaid Diagram).
 *
 * Requires: .env DOC_URL, .playwright-state.json (yarn test:login),
 * and deployed probeAppendImageBase64 (`yarn gas:push:probes`, or `yarn gas:push --playwright-probes`).
 *
 * Usage:
 *   yarn demo:probe-docs-image-limits
 *   yarn demo:probe-docs-image-limits:quick
 *
 * This opens Insert Mermaid Diagram but does NOT paste diagram source — it sends
 * synthetic PNGs via google.script.run.probeAppendImageBase64 (status bar updates).
 * To test temp/test-failing-image.md in the UI: yarn demo:failing-image:fixture
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import type { Frame, Page } from "playwright";
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
  openMenuItem,
  enterDialog,
  isDialogOpen,
} from "./helpers";

const OUT_JSON = path.resolve("temp/docs-image-limit-probe.json");
const OUT_MD = path.resolve("temp/docs-image-limit-probe.md");

export interface PngCase {
  id: string;
  w: number;
  h: number;
  fill: "flat" | "noise";
}

export interface ProbeRow {
  id: string;
  w: number;
  h: number;
  megapixels: number;
  pngBytes: number;
  base64Len: number;
  ok: boolean;
  error: string;
  durationMs: number;
  skipped?: string;
}

const pngStatsFromBase64 = (
  b64: string,
): { w: number; h: number; bytes: number } => {
  const raw = Buffer.from(b64, "base64");
  const w = raw.readUInt32BE(16);
  const h = raw.readUInt32BE(20);
  return { w, h, bytes: raw.length };
};

const generatePngBase64 = async (
  page: Page,
  c: PngCase,
): Promise<{ b64: string | null; skip?: string }> =>
  page.evaluate(
    async ({ w, h, fill, id }) => {
      const maxSide = 16384;
      if (w > maxSide || h > maxSide || w < 1 || h < 1) {
        return { b64: null, skip: `dimension out of browser canvas range` };
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { b64: null, skip: "no 2d context" };

      if (fill === "flat") {
        ctx.fillStyle = "#9aa0a6";
        ctx.fillRect(0, 0, w, h);
      } else {
        try {
          const img = ctx.createImageData(w, h);
          for (let i = 0; i < img.data.length; i += 4) {
            const v = (i / 4 + w) % 256;
            img.data[i] = v;
            img.data[i + 1] = (v * 3) % 256;
            img.data[i + 2] = (v * 7) % 256;
            img.data[i + 3] = 255;
          }
          ctx.putImageData(img, 0, 0);
        } catch {
          return { b64: null, skip: "createImageData failed (memory)" };
        }
      }

      try {
        const dataUrl = canvas.toDataURL("image/png");
        const b64 = dataUrl.split(",")[1] ?? null;
        if (!b64) return { b64: null, skip: "toDataURL empty" };
        return { b64, skip: undefined };
      } catch {
        return { b64: null, skip: `toDataURL failed for ${id}` };
      }
    },
    { w: c.w, h: c.h, fill: c.fill, id: c.id },
  );

const MINIMAL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const setEditorStatus = async (iframe: Frame, text: string): Promise<void> => {
  await iframe.evaluate((t) => {
    const el = document.getElementById("status");
    if (el) el.textContent = t;
  }, text);
};

const callGasProbe = async (
  iframe: Frame,
  b64: string,
): Promise<{ ok: boolean; error: string; bytes: number }> =>
  iframe.evaluate(
    (base64) =>
      new Promise((resolve) => {
        const run = (
          window as unknown as {
            google: {
              script: {
                run: {
                  withSuccessHandler: (
                    h: (r: {
                      ok: boolean;
                      error: string;
                      bytes: number;
                    }) => void,
                  ) => {
                    withFailureHandler: (
                      h: (e: { message?: string }) => void,
                    ) => {
                      probeAppendImageBase64: (b: string) => void;
                    };
                  };
                };
              };
            };
          }
        ).google.script.run;
        run
          .withSuccessHandler((r) => resolve(r))
          .withFailureHandler((e) =>
            resolve({
              ok: false,
              error: String(e?.message ?? e),
              bytes: 0,
            }),
          )
          .probeAppendImageBase64(base64);
      }),
    b64,
  );

const QUICK_CASES: PngCase[] = [
  { id: "400x300", w: 400, h: 300, fill: "flat" },
  { id: "1600x1600", w: 1600, h: 1600, fill: "flat" },
  { id: "2838x9003-fixture", w: 2838, h: 9003, fill: "flat" },
  { id: "4096x4096", w: 4096, h: 4096, fill: "flat" },
  { id: "5000x5000", w: 5000, h: 5000, fill: "flat" },
  { id: "5001x5001", w: 5001, h: 5001, fill: "flat" },
];

const FULL_CASES: PngCase[] = [
  ...QUICK_CASES,
  { id: "800x600", w: 800, h: 600, fill: "flat" },
  { id: "2000x2000", w: 2000, h: 2000, fill: "flat" },
  { id: "2000x2000-noise", w: 2000, h: 2000, fill: "noise" },
  { id: "3000x3000", w: 3000, h: 3000, fill: "flat" },
  { id: "4096x2048", w: 4096, h: 2048, fill: "flat" },
  { id: "8192x2048", w: 8192, h: 2048, fill: "flat" },
  { id: "2048x8192", w: 2048, h: 8192, fill: "flat" },
  { id: "4096x9000", w: 4096, h: 9000, fill: "flat" },
  { id: "9000x4096", w: 9000, h: 4096, fill: "flat" },
  { id: "10000x3000", w: 10000, h: 3000, fill: "flat" },
  { id: "3000x10000", w: 3000, h: 10000, fill: "flat" },
  { id: "5000x5001", w: 5000, h: 5001, fill: "flat" },
  { id: "6000x6000", w: 6000, h: 6000, fill: "flat" },
  { id: "4000x4000-noise", w: 4000, h: 4000, fill: "noise" },
];

const openEditorShell = async (page: Page): Promise<Frame | null> => {
  const opened = await openMenuItem(page, "Insert Mermaid Diagram");
  if (!opened) return null;
  const d = await enterDialog(page, (f) =>
    f
      .locator("#tpl-btn")
      .count()
      .then((c) => c > 0),
  );
  return d?.iframe ?? null;
};

const closeDialogIfOpen = async (page: Page): Promise<void> => {
  if (await isDialogOpen(page)) {
    await page.keyboard.press("Escape");
    await sleep(500);
  }
};

const formatMd = (rows: ProbeRow[], deployed: boolean): string => {
  const lines = [
    "# Google Docs PNG insert probe",
    "",
    `Run: ${new Date().toISOString()}`,
    `Doc: ${DOC_URL}`,
    `Server probeAppendImageBase64 deployed: ${deployed ? "yes" : "unknown/failed"}`,
    "",
    "| Case | W×H | MP | PNG bytes | MB | Result | Error |",
    "|------|-----|-----|-----------|-----|--------|-------|",
  ];
  for (const r of rows) {
    const mp = r.megapixels.toFixed(2);
    const mb = (r.pngBytes / (1024 * 1024)).toFixed(2);
    const result = r.skipped ? `SKIP (${r.skipped})` : r.ok ? "PASS" : "FAIL";
    const err = (r.error || r.skipped || "").replace(/\|/g, "\\|").slice(0, 80);
    lines.push(
      `| ${r.id} | ${r.w}×${r.h} | ${mp} | ${r.pngBytes} | ${mb} | ${result} | ${err} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

async function main(): Promise<void> {
  const quick = process.argv.includes("--quick");
  const cases = quick ? QUICK_CASES : FULL_CASES;

  console.log("\n═══ Docs image limit probe ═══\n");
  if (!fs.existsSync(STATE_FILE)) {
    console.log("No .playwright-state.json — run `yarn test:login` first.\n");
    process.exit(1);
  }

  const browser = await launchDemoBrowser();
  const context = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    storageState: STATE_FILE,
  });
  const page = await context.newPage();
  page.on("dialog", async (d) => {
    console.log(`   [Alert] ${d.message()}`);
    await d.accept();
  });

  console.log("Loading doc...");
  await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .waitForSelector("#docs-editor", { timeout: 30000 })
    .catch(() => {});
  await sleep(2000);
  await injectCursor(page);
  setLastPos(VP_W / 2, 350);
  await setCursor(page, VP_W / 2, 350);

  const iframe = await openEditorShell(page);
  if (!iframe) {
    console.error("Could not open Insert Mermaid Diagram dialog.");
    await browser.close();
    process.exit(1);
  }

  console.log(
    "Note: source/preview stay empty — probe uses server-side PNG inserts only.\n" +
      "      For temp/test-failing-image.md in this UI: yarn demo:failing-image:fixture\n",
  );
  await setEditorStatus(
    iframe,
    "Dimension probe: synthetic PNGs via server (not Mermaid source). See terminal.",
  );

  let deployed = true;
  const smoke = await callGasProbe(iframe, MINIMAL_PNG_B64);
  if (
    !smoke.ok &&
    /probeAppendImageBase64|is not a function|Unknown function/i.test(
      smoke.error,
    )
  ) {
    deployed = false;
    console.log(
      "\n⚠ probeAppendImageBase64 is not on the deployed add-on.\n" +
        "  Run: yarn gas:build && yarn gas:push\n" +
        "  Then re-run this script.\n",
    );
    await closeDialogIfOpen(page);
    await browser.close();
    process.exit(2);
  }

  const rows: ProbeRow[] = [];

  for (const c of cases) {
    const t0 = Date.now();
    process.stdout.write(`  ${c.id} (${c.w}×${c.h}) … `);

    const gen = await generatePngBase64(page, c);
    if (!gen.b64) {
      const row: ProbeRow = {
        id: c.id,
        w: c.w,
        h: c.h,
        megapixels: (c.w * c.h) / 1e6,
        pngBytes: 0,
        base64Len: 0,
        ok: false,
        error: "",
        durationMs: Date.now() - t0,
        skipped: gen.skip ?? "generate failed",
      };
      rows.push(row);
      console.log(`SKIP (${row.skipped})`);
      continue;
    }

    const stats = pngStatsFromBase64(gen.b64);
    const probe = await callGasProbe(iframe, gen.b64);
    await setEditorStatus(
      iframe,
      probe.ok
        ? `Probe PASS ${c.id} — ${stats.w}×${stats.h}, ${(stats.bytes / 1024).toFixed(0)} KB`
        : `Probe FAIL ${c.id} — ${probe.error.slice(0, 80)}`,
    );
    const row: ProbeRow = {
      id: c.id,
      w: stats.w,
      h: stats.h,
      megapixels: (stats.w * stats.h) / 1e6,
      pngBytes: stats.bytes,
      base64Len: gen.b64.length,
      ok: probe.ok,
      error: probe.error,
      durationMs: Date.now() - t0,
    };
    rows.push(row);
    console.log(
      probe.ok
        ? `PASS ${stats.bytes} B, ${row.megapixels.toFixed(2)} MP`
        : `FAIL ${probe.error.slice(0, 60)}`,
    );
    await sleep(300);
  }

  await closeDialogIfOpen(page);
  await context.storageState({ path: STATE_FILE });
  await browser.close();

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ deployed, rows }, null, 2));
  fs.writeFileSync(OUT_MD, formatMd(rows, deployed));

  console.log(`\nWrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
