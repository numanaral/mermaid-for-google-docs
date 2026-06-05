/**
 * Playwright / local demo harness only. Compiled to PlaywrightProbes.gs when
 * GAS_INCLUDE_PLAYWRIGHT_PROBES=1 (yarn gas:build:probes / gas:push:probes).
 * Omitted from production builds so probe* is not deployed.
 */
import { MERMAID_ALT_TITLE } from "./constants";
import { insertImageAtCursor } from "./diagram-ops";
import { encodeMermaidSource, makeUniqueDiagramBlob } from "./doc-utils";
import { exportDocAsMarkdown } from "./export-md";
import { MERMAID_DOCSTORE_ALT_PREFIX } from "./mermaid-doc-store";

/** 1×1 PNG used for alt-text limit probes (minimal footprint). */
export const PROBE_TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const makeProbeTinyPngBlob = (): GoogleAppsScript.Base.Blob =>
  Utilities.newBlob(
    Utilities.base64Decode(PROBE_TINY_PNG_B64),
    "image/png",
    "probe-alt.png",
  );

/**
 * Append a body-level image, run `fn`, then try to remove the image.
 * Used so limit probes do not leave clutter when removal succeeds.
 */
export const withTemporaryBodyImage = <T>(
  blob: GoogleAppsScript.Base.Blob,
  fn: (image: GoogleAppsScript.Document.InlineImage) => T,
): T => {
  const body = DocumentApp.getActiveDocument().getBody();
  const image = body.appendImage(blob);
  try {
    return fn(image);
  } finally {
    try {
      body.removeChild(image);
    } catch {
      /* inline image may not be a direct body child */
    }
  }
};

export const listMermaidAltDescriptions = (
  body: GoogleAppsScript.Document.Body = DocumentApp.getActiveDocument().getBody(),
): string[] => {
  const out: string[] = [];
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    const para = child.asParagraph();
    for (let c = 0; c < para.getNumChildren(); c++) {
      const pc = para.getChild(c);
      if (pc.getType() !== DocumentApp.ElementType.INLINE_IMAGE) continue;
      const img = pc.asInlineImage();
      if (img.getAltTitle() !== MERMAID_ALT_TITLE) continue;
      const raw = img.getAltDescription();
      if (raw) out.push(raw);
    }
  }
  return out;
};

export const countExactMermaidFencesInMarkdown = (
  markdown: string,
  source: string,
): { fenceCount: number; exactMatchCount: number } => {
  const norm = source.trim();
  const re = /```mermaid\s*\n([\s\S]*?)```/gi;
  let fenceCount = 0;
  let exactMatchCount = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    fenceCount++;
    if (m[1].trim() === norm) exactMatchCount++;
  }
  return { fenceCount, exactMatchCount };
};

/** yarn demo:probe-docs-alt-limits */
export const probeSetAltDescription = (
  encodedText: string,
): { ok: boolean; error: string; len: number } => {
  const len = encodedText.length;
  return withTemporaryBodyImage(makeProbeTinyPngBlob(), (image) => {
    try {
      image.setAltTitle(MERMAID_ALT_TITLE);
      image.setAltDescription(encodedText);
      return { ok: true, error: "", len };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg, len };
    }
  });
};

/** yarn demo:probe-docs-image-limits */
export const probeAppendImageBase64 = (
  base64Data: string,
): { ok: boolean; error: string; bytes: number } => {
  let bytes = 0;
  try {
    bytes = Utilities.base64Decode(base64Data).length;
  } catch (e) {
    return { ok: false, error: `base64Decode: ${e}`, bytes: 0 };
  }
  const body = DocumentApp.getActiveDocument().getBody();
  const blob = makeUniqueDiagramBlob(base64Data);
  try {
    body.appendImage(blob);
    return { ok: true, error: "", bytes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, bytes };
  }
};

/** yarn demo:docstore-export */
export const probeDocstoreExportRoundTrip = (
  pngBase64: string,
  mermaidSource: string,
): {
  ok: boolean;
  fenceCount: number;
  exactMatchCount: number;
  altPointers: string[];
  altAllDocstore: boolean;
  encodedLen: number;
  error: string;
} => {
  const encodedLen = encodeMermaidSource(mermaidSource).length;
  const fail = (
    error: string,
    partial: {
      fenceCount?: number;
      exactMatchCount?: number;
      altPointers?: string[];
      altAllDocstore?: boolean;
    } = {},
  ) => ({
    ok: false,
    fenceCount: partial.fenceCount ?? 0,
    exactMatchCount: partial.exactMatchCount ?? 0,
    altPointers: partial.altPointers ?? [],
    altAllDocstore: partial.altAllDocstore ?? false,
    encodedLen,
    error,
  });

  try {
    const altCountBefore = listMermaidAltDescriptions().length;
    if (!insertImageAtCursor(pngBase64, mermaidSource).success) {
      return fail("first insert failed");
    }
    if (!insertImageAtCursor(pngBase64, mermaidSource).success) {
      return fail("second insert failed");
    }

    const altPointers = listMermaidAltDescriptions().slice(altCountBefore);
    const altAllDocstore =
      altPointers.length === 2 &&
      altPointers.every((a) => a.startsWith(MERMAID_DOCSTORE_ALT_PREFIX));

    const body = DocumentApp.getActiveDocument().getBody();
    const md = exportDocAsMarkdown(body);
    const { fenceCount, exactMatchCount } = countExactMermaidFencesInMarkdown(
      md,
      mermaidSource,
    );

    const ok = altAllDocstore && exactMatchCount >= 2;
    return {
      ok,
      fenceCount,
      exactMatchCount,
      altPointers,
      altAllDocstore,
      encodedLen,
      error: ok
        ? ""
        : `fences=${fenceCount} exact=${exactMatchCount} docstore=${altAllDocstore}`,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
};
