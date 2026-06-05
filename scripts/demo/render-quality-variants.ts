/**
 * Builds a local visual comparison page for single-image Mermaid raster quality.
 * Usage: yarn demo:quality-variants
 */
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { loadMermaidFromFailingFixture } from "./fixtures/failing-image-fixture";
import { MERMAID_CDN_URL } from "../../src/gas/shared/scripts/constants";
import { MERMAID_CONFIG } from "../../src/gas/shared/scripts/mermaid-config";

const outDir = path.resolve("temp/quality-variants");
const bundlePath = path.resolve("temp/svg-to-png.bundle.js");
const htmlPath = path.join(outDir, "index.html");
const screenshotPath = path.join(outDir, "comparison.png");
const resultsPath = path.join(outDir, "results.json");

const variants = [
  {
    name: "Current app config",
    note: "Wider/shorter default now pushed to GAS.",
    config: MERMAID_CONFIG,
  },
  {
    name: "Previous spacing",
    note: "Old baseline: narrower and taller.",
    config: {
      ...MERMAID_CONFIG,
      flowchart: {
        ...MERMAID_CONFIG.flowchart,
        nodeSpacing: 40,
        rankSpacing: 45,
      },
    },
  },
  {
    name: "Extra wide",
    note: "More horizontal spread, more page-width pressure.",
    config: {
      ...MERMAID_CONFIG,
      flowchart: {
        ...MERMAID_CONFIG.flowchart,
        nodeSpacing: 130,
        rankSpacing: 22,
      },
    },
  },
  {
    name: "Compact vertical",
    note: "Shorter ranks with current horizontal spacing.",
    config: {
      ...MERMAID_CONFIG,
      flowchart: {
        ...MERMAID_CONFIG.flowchart,
        nodeSpacing: 90,
        rankSpacing: 18,
      },
    },
  },
  {
    name: "Larger text",
    note: "Bigger labels, but often fewer final horizontal pixels.",
    config: {
      ...MERMAID_CONFIG,
      themeVariables: {
        fontSize: "20px",
      },
    },
  },
] as const;

const htmlEscapeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const buildHtml = (source: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mermaid Raster Quality Variants</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.4;
      background: #f6f8fa;
      color: #1f2328;
    }
    body {
      margin: 0;
      padding: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }
    .intro {
      margin: 0 0 20px;
      color: #59636e;
      max-width: 900px;
    }
    #status {
      margin-bottom: 16px;
      padding: 10px 12px;
      border: 1px solid #d1d9e0;
      border-radius: 8px;
      background: #fff;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 16px;
      align-items: start;
    }
    .card {
      background: #fff;
      border: 1px solid #d1d9e0;
      border-radius: 12px;
      box-shadow: 0 1px 2px rgba(31, 35, 40, 0.06);
      overflow: hidden;
    }
    .card header {
      padding: 14px 16px 10px;
      border-bottom: 1px solid #d8dee4;
    }
    .card h2 {
      margin: 0 0 4px;
      font-size: 18px;
    }
    .note {
      margin: 0;
      color: #59636e;
      font-size: 13px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 10px;
      padding: 12px 16px;
      font-size: 13px;
      border-bottom: 1px solid #d8dee4;
    }
    .metrics div {
      white-space: nowrap;
    }
    .metrics b {
      color: #57606a;
      font-weight: 600;
    }
    .views {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      padding: 12px;
    }
    .label {
      margin: 0 0 6px;
      color: #57606a;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .scroll-view,
    .zoom-view {
      border: 1px solid #d1d9e0;
      border-radius: 8px;
      background: #fff;
      overflow: auto;
    }
    .scroll-view {
      height: 520px;
    }
    .scroll-view img {
      display: block;
      width: 100%;
      height: auto;
    }
    .zoom-view {
      height: 260px;
      overflow: hidden;
      position: relative;
    }
    .zoom-view img {
      display: block;
      width: 200%;
      max-width: none;
      height: auto;
      transform: translate(-18%, -8%);
      transform-origin: top left;
    }
    .error {
      padding: 16px;
      color: #cf222e;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <h1>Mermaid Raster Quality Variants</h1>
  <p class="intro">
    This page renders the same large fixture through different Mermaid configs,
    converts each SVG with the app's PNG pipeline, and shows a full scroll view plus
    a 200% crop to mimic manual image enlargement / Google Docs zoom checks.
  </p>
  <div id="status">Loading Mermaid and rendering variants...</div>
  <main id="results" class="grid"></main>

  <script src="${MERMAID_CDN_URL}"></script>
  <script src="../svg-to-png.bundle.js"></script>
  <script>
    const SOURCE = ${htmlEscapeJson(source)};
    const VARIANTS = ${htmlEscapeJson(variants)};

    const pngStats = (b64) => {
      const raw = atob(b64);
      const byte = (offset) => raw.charCodeAt(offset) & 0xff;
      const w = ((byte(16) << 24) | (byte(17) << 16) | (byte(18) << 8) | byte(19)) >>> 0;
      const h = ((byte(20) << 24) | (byte(21) << 16) | (byte(22) << 8) | byte(23)) >>> 0;
      return { w, h, bytes: raw.length, mp: (w * h) / 1e6 };
    };

    const jpegBytes = async (pngBase64) => {
      const img = new Image();
      const loaded = new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
      });
      img.src = "data:image/png;base64," + pngBase64;
      if (!(await loaded)) return 0;
      const { w, h } = pngStats(pngBase64);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      return Math.ceil(canvas.toDataURL("image/jpeg", 0.92).replace("data:image/jpeg;base64,", "").length * 0.75);
    };

    const metric = (label, value) => '<div><b>' + label + ':</b> ' + value + '</div>';

    const renderCard = (variant, result) => {
      if (result.error) {
        return '<article class="card"><header><h2>' + variant.name + '</h2><p class="note">' + variant.note + '</p></header><div class="error">' + result.error + '</div></article>';
      }
      const src = "data:image/png;base64," + result.base64;
      return '<article class="card">' +
        '<header><h2>' + variant.name + '</h2><p class="note">' + variant.note + '</p></header>' +
        '<section class="metrics">' +
        metric('SVG', result.svg.width + ' x ' + result.svg.height) +
        metric('PNG', result.png.w + ' x ' + result.png.h) +
        metric('PNG bytes', result.png.bytes.toLocaleString()) +
        metric('JPEG 92 bytes', result.jpeg92Bytes.toLocaleString()) +
        metric('Megapixels', result.png.mp.toFixed(2)) +
        metric('Aspect', (result.png.w / result.png.h).toFixed(3)) +
        '</section>' +
        '<section class="views">' +
        '<div><p class="label">Fit-width scroll view</p><div class="scroll-view"><img src="' + src + '" /></div></div>' +
        '<div><p class="label">200% crop simulation</p><div class="zoom-view"><img src="' + src + '" /></div></div>' +
        '</section>' +
        '</article>';
    };

    const run = async () => {
      const resultsEl = document.getElementById("results");
      const status = document.getElementById("status");
      const all = [];
      for (let i = 0; i < VARIANTS.length; i++) {
        const variant = VARIANTS[i];
        status.textContent = 'Rendering ' + variant.name + '...';
        try {
          mermaid.initialize(variant.config);
          const { svg } = await mermaid.render('quality-variant-' + i, SOURCE);
          const tag = svg.match(/<svg[^>]*>/)?.[0] || '';
          const base64 = await MermaidSvgPng.svgToPngBase64(svg);
          if (!base64) throw new Error('PNG conversion returned null');
          const result = {
            svg: {
              width: tag.match(/ width=["']([^"']+)["']/)?.[1] || '',
              height: tag.match(/ height=["']([^"']+)["']/)?.[1] || '',
              viewBox: tag.match(/viewBox=["']([^"']+)["']/)?.[1] || '',
            },
            png: pngStats(base64),
            jpeg92Bytes: await jpegBytes(base64),
            base64,
          };
          all.push({ variant: variant.name, ...result, base64: undefined });
          resultsEl.insertAdjacentHTML('beforeend', renderCard(variant, result));
        } catch (error) {
          const result = { error: String(error && error.stack ? error.stack : error) };
          all.push({ variant: variant.name, ...result });
          resultsEl.insertAdjacentHTML('beforeend', renderCard(variant, result));
        }
      }
      status.textContent = 'Rendered ' + all.length + ' variants.';
      status.dataset.state = 'ready';
      window.__QUALITY_VARIANT_RESULTS__ = all;
    };

    run();
  </script>
</body>
</html>
`;

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const esbuildBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    "esbuild",
  );
  execSync(
    `${esbuildBin} src/gas/shared/scripts/svg-to-png.ts --bundle --format=iife --global-name=MermaidSvgPng --platform=browser --outfile=${bundlePath}`,
    { stdio: "inherit" },
  );

  fs.writeFileSync(
    htmlPath,
    buildHtml(loadMermaidFromFailingFixture()),
    "utf8",
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  await page.goto(pathToFileURL(htmlPath).toString());
  await page.waitForSelector('#status[data-state="ready"]', {
    timeout: 60_000,
  });
  const results = await page.evaluate(
    "window.__QUALITY_VARIANT_RESULTS__ || []",
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await browser.close();

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Wrote ${htmlPath}`);
  console.log(`Wrote ${screenshotPath}`);
  console.log(`Wrote ${resultsPath}`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
