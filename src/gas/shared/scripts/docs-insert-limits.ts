/** Limits measured via yarn demo:probe-docs-image-limits / probe-docs-alt-limits. */

export const DOCS_MAX_PNG_LONGEST_SIDE_PX = 5000;
export const DOCS_MAX_ENCODED_ALT_DESCRIPTION_CHARS = 5000;

export const encodeMermaidSource = (source: string): string =>
  source.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");

export const pngLongestSideFromBase64 = (base64: string): number | null => {
  try {
    // `atob` only exists in the dialog (browser) context, where this runs.
    // Referencing it via globalThis keeps the shared file typechecking under
    // the GAS server config too, where it simply degrades to null.
    const decode = (globalThis as { atob?: (input: string) => string }).atob;
    if (!decode) return null;
    const raw = decode(base64);
    if (raw.length < 24) return null;
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
    const w = ((u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19]) >>> 0;
    const h = ((u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23]) >>> 0;
    return Math.max(w, h);
  } catch {
    return null;
  }
};

export const collectDocsInsertLimitWarnings = (
  mermaidSource: string,
  pngBase64: string | null,
  pngHitDimensionCap?: boolean,
): string[] => {
  const warnings: string[] = [];
  if (pngHitDimensionCap && pngBase64) {
    const longest = pngLongestSideFromBase64(pngBase64);
    const px = longest !== null ? longest.toLocaleString() : "5000";
    warnings.push(
      `Diagram image was downscaled to fit Google Docs (longest side ${px}px; max ${DOCS_MAX_PNG_LONGEST_SIDE_PX.toLocaleString()}px).`,
    );
  }
  const encodedLen = encodeMermaidSource(mermaidSource).length;
  if (encodedLen > DOCS_MAX_ENCODED_ALT_DESCRIPTION_CHARS) {
    warnings.push(
      `Mermaid source exceeds Google Docs alt-text limits (${encodedLen.toLocaleString()} encoded characters; max ${DOCS_MAX_ENCODED_ALT_DESCRIPTION_CHARS.toLocaleString()}). Full source is saved in this document hidden properties (Export as Markdown can recover it).`,
    );
  }
  return warnings;
};

export const DOCS_INSERT_LIMITS_URL = "/limitations/#diagram-insert-limits";

export const summarizeInsertLimitWarnings = (
  blocks: Array<{
    source: string;
    base64: string | null;
    pngHitDimensionCap?: boolean;
  }>,
): string[] => {
  if (blocks.length === 0) return [];
  if (blocks.length === 1) {
    return collectDocsInsertLimitWarnings(
      blocks[0].source,
      blocks[0].base64,
      blocks[0].pngHitDimensionCap,
    );
  }

  let altOver = 0;
  let pngCapped = 0;
  for (const b of blocks) {
    const w = collectDocsInsertLimitWarnings(
      b.source,
      b.base64,
      b.pngHitDimensionCap,
    );
    if (w.some((line) => line.includes("too long"))) altOver++;
    if (w.some((line) => line.includes("downscaled"))) pngCapped++;
  }

  const out: string[] = [];
  if (pngCapped > 0) {
    out.push(
      `${pngCapped} diagram${pngCapped > 1 ? "s" : ""} downscaled to fit Google Docs (max ${DOCS_MAX_PNG_LONGEST_SIDE_PX.toLocaleString()}px on the longest side).`,
    );
  }
  if (altOver > 0) {
    out.push(
      `${altOver} diagram${altOver > 1 ? "s" : ""} store full source in document metadata (alt limit ${DOCS_MAX_ENCODED_ALT_DESCRIPTION_CHARS.toLocaleString()} chars). Use Export as Markdown to recover.`,
    );
  }
  return out;
};
