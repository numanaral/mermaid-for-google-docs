import { DOCS_MAX_PNG_LONGEST_SIDE_PX } from "./docs-insert-limits";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * PNG export for DocumentApp.insertImage. See docs-insert-limits.ts.
 */
const MAX_PNG_LONGEST_SIDE_PX = DOCS_MAX_PNG_LONGEST_SIDE_PX;
/** Baseline supersampling for crisp text/lines. */
const RETINA_SCALE = 2;
/** When under the Docs pixel cap, scale up toward max longest side (file size is OK). */
const MAX_UPSCALE_FACTOR = 6;
const MIN_LOGICAL_LONGEST_FOR_UPSCALE = 160;
/** Downsample from 2× internal raster for sharper edges when hitting the 5000px cap. */
const RENDER_SUPERSAMPLE = 2;
/** Avoid very large temporary canvases in browser dialogs. */
const MAX_SUPERSAMPLED_PIXELS = 40_000_000;
const MAX_SHARPEN_PIXELS = 12_000_000;
const SHARPEN_AMOUNT = 0.12;

let lastPngExportHitDimensionCap = false;

/** True if the last svgToPngBase64 call downscaled for the Docs 5000px limit. */
export const consumePngExportHitDimensionCap = (): boolean => {
  const hit = lastPngExportHitDimensionCap;
  lastPngExportHitDimensionCap = false;
  return hit;
};

/**
 * Pick raster scale: at least 2x, up to 6x, capped so longest side ≤ 5000px.
 * Large diagrams use the full dimension budget (not file size) for zoom/resize in Docs.
 */
const computeCanvasScale = (w: number, h: number): number => {
  const longest = Math.max(w, h, 1);
  const scaleToCap = MAX_PNG_LONGEST_SIDE_PX / longest;

  let scale = RETINA_SCALE;
  if (longest >= MIN_LOGICAL_LONGEST_FOR_UPSCALE && scaleToCap > RETINA_SCALE) {
    scale = Math.min(scaleToCap, MAX_UPSCALE_FACTOR);
  }

  const rasterLongest = longest * scale;
  if (rasterLongest > MAX_PNG_LONGEST_SIDE_PX) {
    lastPngExportHitDimensionCap = true;
    scale = scaleToCap;
  }
  return scale;
};

/** Rounded canvas size; uniform shrink if rounding pushes longest side over the cap. */
const canvasDimensions = (
  w: number,
  h: number,
  scale: number,
): { width: number; height: number; drawScale: number } => {
  let width = Math.max(1, Math.round(w * scale));
  let height = Math.max(1, Math.round(h * scale));
  const longest = Math.max(width, height);
  if (longest > MAX_PNG_LONGEST_SIDE_PX) {
    lastPngExportHitDimensionCap = true;
    const f = MAX_PNG_LONGEST_SIDE_PX / longest;
    width = Math.max(1, Math.floor(width * f));
    height = Math.max(1, Math.floor(height * f));
  }
  const drawScale = width / w;
  return { width, height, drawScale };
};

const renderSupersample = (width: number, height: number): number => {
  const pixels = width * height;
  if (pixels <= 0) return 1;
  return Math.max(
    1,
    Math.min(RENDER_SUPERSAMPLE, Math.sqrt(MAX_SUPERSAMPLED_PIXELS / pixels)),
  );
};

const applyMildSharpen = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void => {
  if (width * height > MAX_SHARPEN_PIXELS || width < 3 || height < 3) return;

  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const src = new Uint8ClampedArray(imageData.data);
    const dst = imageData.data;
    const stride = width * 4;
    const amount = SHARPEN_AMOUNT;
    const centerWeight = 1 + amount * 4;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * stride + x * 4;
        for (let channel = 0; channel < 3; channel++) {
          const value =
            src[idx + channel] * centerWeight -
            amount *
              (src[idx - 4 + channel] +
                src[idx + 4 + channel] +
                src[idx - stride + channel] +
                src[idx + stride + channel]);
          dst[idx + channel] = Math.max(0, Math.min(255, Math.round(value)));
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  } catch {
    /* Best-effort sharpening; keep the rendered image if pixel access fails. */
  }
};

interface TextSpan {
  text: string;
  bold: boolean;
  color: string;
  fontSize: number;
}

const groupSpansIntoLines = (el: Element): TextSpan[][] => {
  const lines: TextSpan[][] = [];
  let currentLine: TextSpan[] = [];

  const flush = (): void => {
    if (currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = [];
    }
  };

  const walk = (node: Node, inherited: Omit<TextSpan, "text">): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || "").trim();
      if (t) currentLine.push({ text: t, ...inherited });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const elem = node as HTMLElement;
    const style = elem.style || {};
    const tag = elem.tagName.toLowerCase();

    if (tag === "br") {
      flush();
      return;
    }

    const isBlock =
      tag === "div" ||
      tag === "p" ||
      tag === "li" ||
      tag === "h1" ||
      tag === "h2" ||
      tag === "h3";
    if (isBlock) flush();

    const current: Omit<TextSpan, "text"> = {
      bold:
        inherited.bold ||
        tag === "b" ||
        tag === "strong" ||
        style.fontWeight === "bold" ||
        parseInt(style.fontWeight || "0") >= 600,
      color: style.color || inherited.color,
      fontSize: style.fontSize
        ? parseFloat(style.fontSize) || inherited.fontSize
        : inherited.fontSize,
    };

    for (const child of Array.from(node.childNodes)) walk(child, current);
    if (isBlock) flush();
  };

  walk(el, { bold: false, color: "", fontSize: 14 });
  flush();
  return lines;
};

const getComputedFontSize = (fo: Element): number => {
  const body = fo.querySelector("body, div, span, p");
  if (body) {
    const fs = (body as HTMLElement).style?.fontSize;
    if (fs) {
      const n = parseFloat(fs);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return 14;
};

const getFillColor = (fo: Element): string => {
  const body = fo.querySelector("body, div, span, p");
  if (body) {
    const c = (body as HTMLElement).style?.color;
    if (c) return c;
  }
  return "currentColor";
};

const getTextAlign = (fo: Element): string => {
  const body = fo.querySelector("body, div, span, p");
  if (body) {
    const ta = (body as HTMLElement).style?.textAlign;
    if (ta === "left" || ta === "right" || ta === "start" || ta === "end")
      return ta;
  }
  return "center";
};

/**
 * Replace <foreignObject> nodes with SVG <text> equivalents so the
 * resulting SVG can be drawn to a canvas without tainting it.
 * Preserves inline styles (bold, color, font-size) from the HTML content
 * and groups text into lines based on block-level HTML elements.
 */
const sanitizeSvg = (svg: SVGSVGElement): void => {
  svg.querySelectorAll("foreignObject").forEach((fo) => {
    const parent = fo.parentNode;
    if (!parent) return;

    const x = parseFloat(fo.getAttribute("x") || "0");
    const y = parseFloat(fo.getAttribute("y") || "0");
    const w = parseFloat(fo.getAttribute("width") || "0");
    const h = parseFloat(fo.getAttribute("height") || "0");

    const lines = groupSpansIntoLines(fo);
    if (lines.length === 0 || lines.every((l) => l.length === 0)) {
      fo.remove();
      return;
    }

    const baseFontSize = getComputedFontSize(fo);
    const baseFill = getFillColor(fo);
    const align = getTextAlign(fo);
    const lineHeight = baseFontSize * 1.35;
    const g = fo.ownerDocument.createElementNS(SVG_NS, "g");

    const totalTextHeight = lines.length * lineHeight;
    const startY = y + (h > 0 ? (h - totalTextHeight) / 2 : 0) + baseFontSize;

    let anchor: string;
    let textX: number;
    if (align === "left" || align === "start") {
      anchor = "start";
      textX = x + 4;
    } else if (align === "right" || align === "end") {
      anchor = "end";
      textX = x + w - 4;
    } else {
      anchor = "middle";
      textX = w > 0 ? x + w / 2 : x;
    }

    for (let i = 0; i < lines.length; i++) {
      const lineSpans = lines[i];
      if (lineSpans.length === 0) continue;

      const textEl = fo.ownerDocument.createElementNS(SVG_NS, "text");
      textEl.setAttribute("x", String(textX));
      textEl.setAttribute("y", String(startY + i * lineHeight));
      textEl.setAttribute("text-anchor", anchor);
      textEl.setAttribute("dominant-baseline", "auto");
      textEl.setAttribute(
        "font-family",
        "'trebuchet ms', verdana, arial, sans-serif",
      );

      if (lineSpans.length === 1) {
        const span = lineSpans[0];
        textEl.setAttribute("font-size", String(span.fontSize || baseFontSize));
        textEl.setAttribute("fill", span.color || baseFill);
        if (span.bold) textEl.setAttribute("font-weight", "bold");
        textEl.textContent = span.text;
      } else {
        textEl.setAttribute("font-size", String(baseFontSize));
        textEl.setAttribute("fill", baseFill);
        for (const span of lineSpans) {
          const tspan = fo.ownerDocument.createElementNS(SVG_NS, "tspan");
          if (span.bold) tspan.setAttribute("font-weight", "bold");
          if (span.color && span.color !== baseFill)
            tspan.setAttribute("fill", span.color);
          if (span.fontSize && span.fontSize !== baseFontSize)
            tspan.setAttribute("font-size", String(span.fontSize));
          tspan.textContent = span.text;
          textEl.appendChild(tspan);
        }
      }

      g.appendChild(textEl);
    }

    parent.replaceChild(g, fo);
  });

  const styleTag = svg.querySelector("style");
  if (styleTag) {
    styleTag.textContent = (styleTag.textContent || "")
      .replace(/@font-face\s*\{[^}]*\}/g, "")
      .replace(/url\(['"]?https?:\/\/[^)]+\)/g, "none")
      .replace(/html\s*,\s*body\s*\{[^}]*\}/g, "")
      .replace(/parsererror\s*\+\s*svg\s*\{[^}]*\}/g, "");
  }
};

/**
 * Prepare an SVG element for canvas rendering: fix dimensions, strip
 * max-width, and clean up styles. Does NOT remove foreignObject.
 *
 * Mermaid generates SVGs with various dimension patterns:
 * - Explicit width/height attributes (simple case)
 * - width="100%" with no height, viewBox for actual dimensions
 * - max-width in style attribute with viewBox
 * - Negative viewBox offsets (e.g. "0 -70 1248 835")
 */
const prepareSvg = (svg: SVGSVGElement): { w: number; h: number } => {
  const rawW = svg.getAttribute("width") || "";
  const rawH = svg.getAttribute("height") || "";

  let w = rawW.includes("%") ? 0 : parseFloat(rawW) || 0;
  let h = rawH.includes("%") ? 0 : parseFloat(rawH) || 0;

  if (!w || !h) {
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/);
    if (vb.length === 4) {
      if (!w) w = parseFloat(vb[2]);
      if (!h) h = parseFloat(vb[3]);
    }
  }

  if (!w) {
    const styleAttr = svg.getAttribute("style") || "";
    const mw = styleAttr.match(/max-width:\s*([\d.]+)px/);
    if (mw) w = parseFloat(mw[1]);
  }

  if (!w || isNaN(w)) w = 800;
  if (!h || isNaN(h)) h = 600;

  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.removeAttribute("style");

  // Insert white background to ensure visible rendering
  const vb = (svg.getAttribute("viewBox") || `0 0 ${w} ${h}`).split(/[\s,]+/);
  const bgRect = svg.ownerDocument.createElementNS(SVG_NS, "rect");
  bgRect.setAttribute("x", vb[0]);
  bgRect.setAttribute("y", vb[1]);
  bgRect.setAttribute("width", vb[2]);
  bgRect.setAttribute("height", vb[3]);
  bgRect.setAttribute("fill", "white");
  svg.insertBefore(bgRect, svg.firstChild);

  return { w, h };
};

/**
 * Render an SVG to canvas and extract base64 PNG.
 * Returns null if the canvas is tainted or rendering fails.
 */
const renderToCanvas = (
  svgString: string,
  w: number,
  h: number,
): Promise<string | null> => {
  return new Promise((resolve) => {
    const encoded =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
    const img = new Image();
    img.width = w;
    img.height = h;

    img.onload = () => {
      const scale = computeCanvasScale(w, h);
      const { width, height, drawScale } = canvasDimensions(w, h, scale);
      const ss = renderSupersample(width, height);
      const hiWidth = Math.max(1, Math.round(width * ss));
      const hiHeight = Math.max(1, Math.round(height * ss));
      const hi = document.createElement("canvas");
      hi.width = hiWidth;
      hi.height = hiHeight;
      const hiCtx = hi.getContext("2d")!;
      hiCtx.imageSmoothingEnabled = true;
      hiCtx.imageSmoothingQuality = "high";
      hiCtx.scale(
        drawScale * (hiWidth / width),
        drawScale * (hiHeight / height),
      );
      hiCtx.drawImage(img, 0, 0, w, h);

      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(hi, 0, 0, width, height);
      if (Math.max(width, height) >= MAX_PNG_LONGEST_SIDE_PX) {
        applyMildSharpen(ctx, width, height);
      }

      try {
        const dataUrl = c.toDataURL("image/png");
        resolve(dataUrl.replace(/^data:image\/png;base64,/, ""));
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      resolve(null);
    };

    img.src = encoded;
  });
};

/**
 * Measure the SVG's actual rendered bounds via a live DOM insertion,
 * then normalise the viewBox so content starts at (0,0).  This fixes
 * diagrams (e.g. C4) whose CSS-driven layout produces content at
 * offsets the static SVG-as-image renderer cannot resolve.
 */
const prepareSvgViaDom = async (
  svgString: string,
): Promise<{ serialized: string; w: number; h: number } | null> => {
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:0;top:0;width:100vw;opacity:0;pointer-events:none;z-index:-9999;overflow:hidden;height:0;";
  container.innerHTML = svgString;
  document.body.appendChild(container);

  await new Promise((r) => setTimeout(r, 200));

  const liveSvg = container.querySelector("svg") as SVGSVGElement | null;
  if (!liveSvg) {
    document.body.removeChild(container);
    return null;
  }

  const bbox = liveSvg.getBBox();
  const pad = 10;
  const w = Math.ceil(bbox.width + pad * 2);
  const h = Math.ceil(bbox.height + pad * 2);

  const wrapper = liveSvg.ownerDocument.createElementNS(SVG_NS, "g");
  wrapper.setAttribute(
    "transform",
    `translate(${-bbox.x + pad},${-bbox.y + pad})`,
  );
  const children = Array.from(liveSvg.childNodes);
  children.forEach((c) => wrapper.appendChild(c));
  liveSvg.appendChild(wrapper);

  liveSvg.setAttribute("width", String(w));
  liveSvg.setAttribute("height", String(h));
  liveSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  liveSvg.removeAttribute("style");
  sanitizeSvg(liveSvg);

  const bgRect = liveSvg.ownerDocument.createElementNS(SVG_NS, "rect");
  bgRect.setAttribute("x", "0");
  bgRect.setAttribute("y", "0");
  bgRect.setAttribute("width", String(w));
  bgRect.setAttribute("height", String(h));
  bgRect.setAttribute("fill", "white");
  liveSvg.insertBefore(bgRect, liveSvg.firstChild);

  const serialized = new XMLSerializer().serializeToString(liveSvg);
  document.body.removeChild(container);

  return { serialized, w, h };
};

/**
 * Check whether the SVG has a CSS-driven layout that the static
 * SVG-as-image renderer cannot resolve (e.g. C4 diagrams).
 * The telltale sign is a viewBox with negative offsets, which means
 * content is positioned above or left of the origin.
 */
const needsDomLayout = (svgString: string): boolean => {
  const m = svgString.match(/<svg[^>]*>/);
  if (!m) return false;
  const tag = m[0];
  const vb = tag.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (vb) {
    const parts = vb[1].split(/[\s,]+/).map(Number);
    if (parts.length === 4 && (parts[0] < 0 || parts[1] < 0)) return true;
  }
  return false;
};

/**
 * Multi-pass SVG to PNG conversion:
 * 1. For SVGs with CSS-driven layout (C4, etc.), use DOM-based
 *    measurement to get accurate bounds before rendering.
 * 2. Otherwise try rendering as-is (preserves foreignObject fidelity).
 * 3. If canvas is tainted, sanitize foreignObject and retry.
 */
export const svgToPngBase64 = async (
  svgString: string,
): Promise<string | null> => {
  lastPngExportHitDimensionCap = false;
  if (needsDomLayout(svgString)) {
    const domResult = await prepareSvgViaDom(svgString);
    if (domResult) {
      const result = await renderToCanvas(
        domResult.serialized,
        domResult.w,
        domResult.h,
      );
      if (result) return result;
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return null;

  const { w, h } = prepareSvg(svg);

  const hasForeignObject = svg.querySelector("foreignObject") !== null;

  if (!hasForeignObject) {
    sanitizeSvg(svg);
    const serialized = new XMLSerializer().serializeToString(svg);
    return renderToCanvas(serialized, w, h);
  }

  // Pass 1: try with foreignObject intact (best visual fidelity)
  const pass1Svg = new XMLSerializer().serializeToString(svg);
  const pass1 = await renderToCanvas(pass1Svg, w, h);
  if (pass1) return pass1;

  // Pass 2: sanitize foreignObject and retry
  sanitizeSvg(svg);
  const pass2Svg = new XMLSerializer().serializeToString(svg);
  return renderToCanvas(pass2Svg, w, h);
};
