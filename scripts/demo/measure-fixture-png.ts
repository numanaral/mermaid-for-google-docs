/**
 * Local PNG size check for temp/test-failing-image.md (no Google Doc required).
 * Compares output to svg-to-png.ts caps (longest side ≤ 5000 for Docs insert).
 * Usage: yarn demo:measure-fixture-png
 */
import { chromium } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadMermaidFromFailingFixture } from "./fixtures/failing-image-fixture";
import { MERMAID_CDN_URL } from "../../src/gas/shared/scripts/constants";
import { MERMAID_CONFIG } from "../../src/gas/shared/scripts/mermaid-config";

const bundlePath = path.resolve("temp/svg-to-png.bundle.js");

const pngStats = (b64: string) => {
  const raw = Buffer.from(b64, "base64");
  const w = raw.readUInt32BE(16);
  const h = raw.readUInt32BE(20);
  return { w, h, bytes: raw.length, mp: (w * h) / 1e6 };
};

const variants = [
  {
    name: "app-config",
    config: MERMAID_CONFIG,
  },
  {
    name: "previous-flowchart-spacing",
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
    name: "larger-text",
    config: {
      ...MERMAID_CONFIG,
      themeVariables: {
        fontSize: "20px",
      },
    },
  },
] as const;

async function main() {
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
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

  const source = loadMermaidFromFailingFixture();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("about:blank");
  await page.evaluate("globalThis.__name = (target) => target");
  await page.addScriptTag({ url: MERMAID_CDN_URL });
  await page.addScriptTag({ path: bundlePath });
  const results = [];
  for (const variant of variants) {
    const result = await page.evaluate(
      async ({ src, variantConfig, id }) => {
        await (
          window as unknown as { mermaid: { initialize: (c: object) => void } }
        ).mermaid.initialize(variantConfig);

        const parsePngSize = (b64: string): { w: number; h: number } => {
          const raw = atob(b64);
          const byte = (offset: number): number =>
            raw.charCodeAt(offset) & 0xff;
          return {
            w:
              ((byte(16) << 24) |
                (byte(17) << 16) |
                (byte(18) << 8) |
                byte(19)) >>>
              0,
            h:
              ((byte(20) << 24) |
                (byte(21) << 16) |
                (byte(22) << 8) |
                byte(23)) >>>
              0,
          };
        };

        const jpegStats = async (
          pngBase64: string,
        ): Promise<{ bytes: number } | null> => {
          const img = new Image();
          const loaded = new Promise<boolean>((resolve) => {
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
          });
          img.src = "data:image/png;base64," + pngBase64;
          if (!(await loaded)) return null;
          const { w, h } = parsePngSize(pngBase64);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
          return {
            bytes: Math.ceil(
              dataUrl.replace("data:image/jpeg;base64,", "").length * 0.75,
            ),
          };
        };

        const m = (
          window as unknown as {
            mermaid: {
              render: (id: string, s: string) => Promise<{ svg: string }>;
            };
            MermaidSvgPng: {
              svgToPngBase64: (svg: string) => Promise<string | null>;
            };
          }
        ).mermaid;
        const { svg } = await m.render(id, src);
        const svgTag = svg.match(/<svg[^>]*>/)?.[0] || "";
        const viewBox = svgTag.match(/viewBox=["']([^"']+)["']/)?.[1] || "";
        const width = svgTag.match(/ width=["']([^"']+)["']/)?.[1] || "";
        const height = svgTag.match(/ height=["']([^"']+)["']/)?.[1] || "";
        const b64 = await window.MermaidSvgPng.svgToPngBase64(svg);
        if (!b64) {
          return {
            b64: null,
            svg: { width, height, viewBox, tag: svgTag },
            jpeg: null,
          };
        }
        return {
          b64,
          svg: { width, height, viewBox },
          jpeg: await jpegStats(b64),
        };
      },
      {
        src: source,
        variantConfig: variant.config,
        id: "probe-" + variant.name,
      },
    );

    if (!result) {
      results.push({
        name: variant.name,
        error: "PNG conversion returned null",
      });
      continue;
    }
    if (!result.b64) {
      results.push({
        name: variant.name,
        error: "PNG conversion returned null",
        svg: result.svg,
      });
      continue;
    }

    results.push({
      name: variant.name,
      svg: result.svg,
      png: pngStats(result.b64),
      jpeg92: result.jpeg,
    });
  }

  await browser.close();

  console.log("Fixture raster variants:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
