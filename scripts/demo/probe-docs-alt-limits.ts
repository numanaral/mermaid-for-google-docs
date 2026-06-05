/**
 * Empirical DocumentApp.setAltDescription length limits on a real inserted image.
 *
 * Requires: .env DOC_URL, .playwright-state.json, deployed probeSetAltDescription
 * (`yarn gas:push:probes`, or `yarn gas:push --playwright-probes`).
 *
 * Usage: yarn demo:probe-docs-alt-limits
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import type { Frame } from "playwright";
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
import { loadMermaidFromFailingFixture } from "./fixtures/failing-image-fixture";

const OUT_JSON = path.resolve("temp/docs-alt-limit-probe.json");
const OUT_MD = path.resolve("temp/docs-alt-limit-probe.md");

const encodeMermaidSource = (source: string): string =>
  source.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");

/** Mermaid-like payload: letters + \\n line breaks (same encoding as doc-utils). */
const syntheticEncoded = (len: number): string => {
  if (len <= 0) return "";
  const line = "flowchart TD\\n";
  let s = "";
  while (s.length + line.length <= len) s += line;
  return (s + "x".repeat(Math.max(0, len - s.length))).slice(0, len);
};

const LENGTHS_COARSE = [
  1000, 2000, 4000, 6000, 7000, 7500, 8000, 8100, 8191, 8192, 8193, 8300, 8500,
  9000, 9500, 10000, 10240, 10500, 10600, 10628, 10629, 10630, 10700, 11000,
  12000, 16000,
];

const lengthsFine = (): number[] => {
  const out: number[] = [4001, 4010, 4500, 5000, 5500, 5990, 5999, 6000];
  for (let n = 4050; n <= 5950; n += 50) out.push(n);
  return [...new Set(out)].sort((a, b) => a - b);
};

const openEditorShell = async (
  page: import("playwright").Page,
): Promise<Frame | null> => {
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

const callProbe = async (
  iframe: Frame,
  encoded: string,
): Promise<{ ok: boolean; error: string; len: number }> =>
  iframe.evaluate(
    (text) =>
      new Promise((resolve) => {
        (
          window as unknown as {
            google: {
              script: {
                run: {
                  withSuccessHandler: (
                    h: (r: { ok: boolean; error: string; len: number }) => void,
                  ) => {
                    withFailureHandler: (
                      h: (e: { message?: string }) => void,
                    ) => {
                      probeSetAltDescription: (t: string) => void;
                    };
                  };
                };
              };
            };
          }
        ).google.script.run
          .withSuccessHandler((r) => resolve(r))
          .withFailureHandler((e) =>
            resolve({
              ok: false,
              error: String(e?.message ?? e),
              len: text.length,
            }),
          )
          .probeSetAltDescription(text);
      }),
    encoded,
  );

async function main(): Promise<void> {
  const fineOnly = process.argv.includes("--fine");
  const LENGTHS = fineOnly ? lengthsFine() : LENGTHS_COARSE;
  if (!fs.existsSync(STATE_FILE)) {
    console.error("Run yarn test:login first.");
    process.exit(1);
  }

  const fixtureSource = loadMermaidFromFailingFixture();
  const fixtureEncoded = encodeMermaidSource(fixtureSource);
  const fixtureLen = fixtureEncoded.length;

  const cases: Array<{ id: string; len: number; encoded: string }> = fineOnly
    ? LENGTHS.map((n) => ({
        id: `synthetic-${n}`,
        len: n,
        encoded: syntheticEncoded(n),
      }))
    : [
        {
          id: "fixture-full-encoded",
          len: fixtureLen,
          encoded: fixtureEncoded,
        },
        ...LENGTHS.filter((n) => n !== fixtureLen).map((n) => ({
          id: `synthetic-${n}`,
          len: n,
          encoded: syntheticEncoded(n),
        })),
      ];

  console.log("\n═══ Docs alt description limit probe ═══\n");
  console.log(`Fixture encoded length: ${fixtureLen}\n`);

  const browser = await launchDemoBrowser();
  const context = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    storageState: STATE_FILE,
  });
  const page = await context.newPage();
  await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2000);
  await injectCursor(page);
  setLastPos(VP_W / 2, 350);
  await setCursor(page, VP_W / 2, 350);

  const iframe = await openEditorShell(page);
  if (!iframe) {
    console.error("Could not open editor dialog.");
    await browser.close();
    process.exit(1);
  }

  const rows: Array<{
    id: string;
    len: number;
    ok: boolean;
    error: string;
  }> = [];

  for (const c of cases) {
    process.stdout.write(`  ${c.id} (${c.len} chars) … `);
    const r = await callProbe(iframe, c.encoded);
    rows.push({ id: c.id, len: c.len, ok: r.ok, error: r.error });
    console.log(r.ok ? "PASS" : `FAIL ${r.error.slice(0, 70)}`);
    await sleep(250);
  }

  const passing = rows.filter((r) => r.ok).map((r) => r.len);
  const failing = rows.filter((r) => !r.ok).map((r) => r.len);
  const maxPass = passing.length ? Math.max(...passing) : 0;
  const minFail = failing.length ? Math.min(...failing) : null;

  if (await isDialogOpen(page)) {
    await page.keyboard.press("Escape");
  }
  await browser.close();

  const summary = { maxPass, minFail, fixtureLen, rows };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));

  const md = [
    "# Docs setAltDescription length probe",
    "",
    `Fixture full encoded: **${fixtureLen}** chars`,
    `Max passing length (this run): **${maxPass}**`,
    minFail != null ? `Min failing length (this run): **${minFail}**` : "",
    "",
    "| Case | Len | Result | Error |",
    "|------|-----|--------|-------|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.len} | ${r.ok ? "PASS" : "FAIL"} | ${(r.error || "").replace(/\|/g, "\\|").slice(0, 60)} |`,
    ),
    "",
  ].join("\n");
  fs.writeFileSync(OUT_MD, md);

  console.log(`\nMax PASS length: ${maxPass}`);
  if (minFail != null) console.log(`Min FAIL length: ${minFail}`);
  console.log(`Wrote ${OUT_JSON}\nWrote ${OUT_MD}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
