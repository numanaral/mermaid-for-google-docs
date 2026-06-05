/**
 * Server-side docstore round-trip: two large sources via insertImageAtCursor + export.
 * Skips editor Mermaid preview (CDN often hangs in Playwright).
 *
 *   yarn demo:docstore-export
 *   yarn demo:docstore-export --editor   # also try UI insert (short timeout)
 *
 * Requires probeDocstoreExportRoundTrip on the deployed add-on: `yarn gas:push:probes`.
 *
 * Hard wall-clock cap so the browser cannot run forever.
 */
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
  openMenuItem,
  enterDialog,
} from "./helpers";
import { loadMermaidFromFailingFixture } from "./fixtures/failing-image-fixture";

const OUT = path.resolve("temp/docstore-export-results.json");
const WALL_MS = 120_000;
const SERVER_PROBE_MS = 90_000;

/** 1×1 PNG — same as Code.ts PROBE_ALT_PNG_B64 */
const PROBE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type ProbeResult = {
  ok: boolean;
  fenceCount: number;
  exactMatchCount: number;
  altPointers: string[];
  altAllDocstore: boolean;
  encodedLen: number;
  error: string;
};

const openEditorIframe = async (
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

const callServerProbe = (
  iframe: Frame,
  source: string,
  timeoutMs: number,
): Promise<ProbeResult> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `probeDocstoreExportRoundTrip timed out after ${timeoutMs}ms`,
          ),
        ),
      timeoutMs,
    );
    iframe
      .evaluate(
        (args) =>
          new Promise<ProbeResult>((res, rej) => {
            const g = (
              window as unknown as {
                google?: {
                  script: {
                    run: {
                      withSuccessHandler: (h: (r: ProbeResult) => void) => {
                        withFailureHandler: (
                          h: (e: { message?: string }) => void,
                        ) => {
                          probeDocstoreExportRoundTrip: (
                            b64: string,
                            src: string,
                          ) => void;
                        };
                      };
                    };
                  };
                };
              }
            ).google?.script?.run;
            if (!g) {
              rej(new Error("google.script.run unavailable"));
              return;
            }
            g.withSuccessHandler((r) => res(r))
              .withFailureHandler((e) =>
                rej(new Error(String(e?.message ?? e))),
              )
              .probeDocstoreExportRoundTrip(args.b64, args.source);
          }),
        { b64: PROBE_PNG_B64, source },
      )
      .then((r) => {
        clearTimeout(t);
        resolve(r);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });

const main = async (): Promise<void> => {
  const tryEditor = process.argv.includes("--editor");
  const wall = setTimeout(() => {
    console.error(`\n❌ Hard timeout (${WALL_MS / 1000}s). Killing run.\n`);
    process.exit(2);
  }, WALL_MS);

  console.log("\n═══ Docstore export (server probe) ═══\n");
  if (!fs.existsSync(STATE_FILE)) {
    clearTimeout(wall);
    console.log("Run `yarn test:login` first.\n");
    process.exit(1);
  }

  const fixture = loadMermaidFromFailingFixture();
  const browser = await launchDemoBrowser();
  const context = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    storageState: STATE_FILE,
  });
  const page = await context.newPage();
  page.on("dialog", async (d) => {
    await d.accept();
  });

  let probe: ProbeResult | null = null;
  let probeError = "";

  try {
    console.log("Loading doc…");
    await page.goto(DOC_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page
      .waitForSelector("#docs-editor", { timeout: 30000 })
      .catch(() => {});
    await sleep(1500);

    console.log("Opening editor shell (for google.script.run only)…");
    const iframe = await openEditorIframe(page);
    if (!iframe) {
      probeError = "Could not open Insert Mermaid dialog";
    } else {
      const mermaidDiag = await Promise.race([
        iframe
          .evaluate(() => ({
            hasMermaid:
              typeof (window as { mermaid?: unknown }).mermaid !== "undefined",
            status:
              document.getElementById("status")?.textContent?.trim() ?? "",
          }))
          .catch((e) => ({ hasMermaid: false, status: String(e) })),
        new Promise<{ hasMermaid: boolean; status: string }>((res) =>
          setTimeout(
            () => res({ hasMermaid: false, status: "diag-timeout-15s" }),
            15000,
          ),
        ),
      ]);
      console.log(
        `   editor iframe: mermaid loaded=${mermaidDiag.hasMermaid} status="${mermaidDiag.status.slice(0, 80)}"`,
      );
      if (
        !mermaidDiag.hasMermaid &&
        /Loading mermaid/i.test(mermaidDiag.status)
      ) {
        console.log(
          "   (UI preview may hang on CDN; server probe below does not depend on it. If scripts break, check build-gas safeJs / minify.)",
        );
      }

      console.log(
        `Calling probeDocstoreExportRoundTrip (2 inserts + export, cap ${SERVER_PROBE_MS / 1000}s)…`,
      );
      probe = await callServerProbe(iframe, fixture, SERVER_PROBE_MS);
      console.log(
        `   probe: ok=${probe.ok} fences=${probe.fenceCount} exact=${probe.exactMatchCount} docstore=${probe.altAllDocstore} encodedLen=${probe.encodedLen}`,
      );
      if (probe.error) console.log(`   detail: ${probe.error}`);
      if (probe.altPointers?.length) {
        console.log(`   alts: ${probe.altPointers.join(", ")}`);
      }
    }

    if (tryEditor && probe?.ok) {
      console.log(
        "\n(--editor) Skipping slow UI path; server probe already passed.",
      );
    }
  } catch (e) {
    probeError = e instanceof Error ? e.message : String(e);
    console.error(`   Error: ${probeError}`);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    clearTimeout(wall);
  }

  const pass = probe?.ok === true;
  const summary = {
    pass,
    mode: "server-probe",
    probe,
    probeError: probeError || undefined,
    fixtureChars: fixture.length,
    note: "Inserts 2×1px PNGs with full fixture source; verifies docstore: alts + export fences.",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log("\n── Results ──");
  console.log(JSON.stringify(summary, null, 2));
  console.log(pass ? "\n✅ PASS\n" : "\n❌ FAIL\n");
  process.exitCode = pass ? 0 : 1;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
