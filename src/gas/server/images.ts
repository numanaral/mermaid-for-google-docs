import type { MermaidImage } from "./types";
import { MERMAID_ALT_TITLE } from "./constants";
import { resolveMermaidSourceFromAlt } from "./doc-utils";
import { timeServer } from "./server-perf";

export const findMermaidImages = (): MermaidImage[] => {
  const body = DocumentApp.getActiveDocument().getBody();
  const n = body.getNumChildren();
  const results: MermaidImage[] = [];

  for (let i = 0; i < n; i++) {
    const child = body.getChild(i);
    const type = child.getType();

    if (type === DocumentApp.ElementType.INLINE_IMAGE) {
      const img = child.asInlineImage();
      if (img.getAltTitle() === MERMAID_ALT_TITLE) {
        const raw = img.getAltDescription();
        if (raw) {
          const source = resolveMermaidSourceFromAlt(raw);
          if (source) results.push({ source, childIndex: i });
        }
      }
      continue;
    }

    if (type !== DocumentApp.ElementType.PARAGRAPH) continue;

    const para = child.asParagraph();
    const nc = para.getNumChildren();
    for (let j = 0; j < nc; j++) {
      const pc = para.getChild(j);
      if (pc.getType() !== DocumentApp.ElementType.INLINE_IMAGE) continue;

      const img = pc.asInlineImage();
      if (img.getAltTitle() !== MERMAID_ALT_TITLE) continue;

      const raw = img.getAltDescription();
      if (raw) {
        const source = resolveMermaidSourceFromAlt(raw);
        if (source) results.push({ source, childIndex: i });
      }
    }
  }

  return results;
};

export const findMermaidImageIn = (
  el: GoogleAppsScript.Document.Element,
  body: GoogleAppsScript.Document.Body,
): MermaidImage | null => {
  if (el.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
    const img = el.asInlineImage();
    if (img.getAltTitle() !== MERMAID_ALT_TITLE) return null;
    const raw = img.getAltDescription();
    if (!raw) return null;

    const parent = el.getParent();
    const idx =
      parent.getType() === DocumentApp.ElementType.BODY_SECTION
        ? body.getChildIndex(el)
        : body.getChildIndex(parent);
    const source = resolveMermaidSourceFromAlt(raw);
    return source ? { source, childIndex: idx } : null;
  }

  try {
    const container = el as GoogleAppsScript.Document.ContainerElement;
    const n = container.getNumChildren();
    for (let j = 0; j < n; j++) {
      const result = findMermaidImageIn(container.getChild(j), body);
      if (result) return result;
    }
  } catch {
    /* not a container element */
  }

  return null;
};

/** Called from Extract / Edit Diagrams dialogs via google.script.run */
export function getMermaidImagesForDialog(): MermaidImage[] {
  return timeServer("scan:mermaid-images", () => findMermaidImages());
}

const NOT_A_DIAGRAM_MSG =
  "Selection is not a Mermaid diagram.\n\n" +
  "Only diagrams inserted by this add-on contain embedded Mermaid source code.";

/** Current selection → mermaid diagram metadata, or null after user alert. */
export function tryGetSelectedMermaidImage(): MermaidImage | null {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();

  if (!selection) {
    DocumentApp.getUi().alert(
      "No diagram selected.\n\n" +
        "Click on a Mermaid diagram to select it, then try again.",
    );
    return null;
  }

  const body = doc.getBody();
  for (const re of selection.getRangeElements()) {
    const result = findMermaidImageIn(re.getElement(), body);
    if (result) return result;
  }

  DocumentApp.getUi().alert(NOT_A_DIAGRAM_MSG);
  return null;
}
