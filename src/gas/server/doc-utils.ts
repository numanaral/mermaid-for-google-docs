import { MERMAID_ALT_TITLE, MERMAID_KEYWORDS } from "./constants";
import {
  DOCS_MAX_ENCODED_ALT_DESCRIPTION_CHARS,
  encodeMermaidSource,
} from "../shared/scripts/docs-insert-limits";
import {
  MERMAID_DOCSTORE_ALT_PREFIX,
  docstoreIdFromAlt,
  loadEncodedMermaidFromDocument,
  storeEncodedMermaidInDocument,
} from "./mermaid-doc-store";

export { encodeMermaidSource };

export const isMermaidFirstLine = (firstLine: string): boolean => {
  const fl = firstLine.trim().toLowerCase();
  return MERMAID_KEYWORDS.some(
    (kw) => fl === kw || fl.startsWith(kw + " ") || fl.startsWith(kw + "-"),
  );
};

export const stripFences = (text: string): string => {
  return text
    .replace(/^```mermaid\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
};

export const getParaText = (
  child: GoogleAppsScript.Document.Element,
): string => {
  try {
    return (child as GoogleAppsScript.Document.Text).editAsText().getText();
  } catch {
    return "";
  }
};

export const tryExtractFencedMermaid = (text: string): string | null => {
  const trimmed = text.trim();
  if (
    !trimmed.startsWith("```mermaid") ||
    !trimmed.endsWith("```") ||
    trimmed === "```mermaid"
  )
    return null;

  const definition = stripFences(trimmed);
  if (!definition) return null;

  const firstLine = definition.split("\n")[0];
  if (!isMermaidFirstLine(firstLine)) return null;

  return definition;
};

/**
 * Read the text of a block-level element robustly. Native Google Docs code
 * blocks ("Insert → Building blocks → Code block") are surfaced by the
 * DocumentApp API as an element whose getType().toString() is "CODE_SNIPPET",
 * and the exact way its text is exposed is undocumented, so we try several
 * strategies: editAsText (works for most elements), concatenating child text
 * (containers that hold one paragraph per line), then getText.
 */
const readBlockElementText = (
  child: GoogleAppsScript.Document.Element,
): string => {
  const anyChild = child as unknown as {
    editAsText?: () => { getText?: () => string };
    getNumChildren?: () => number;
    getChild?: (i: number) => GoogleAppsScript.Document.Element;
    getText?: () => string;
  };

  try {
    const t = anyChild.editAsText?.().getText?.();
    if (t && t.trim()) return t;
  } catch {
    /* element does not support editAsText */
  }

  try {
    if (typeof anyChild.getNumChildren === "function" && anyChild.getChild) {
      const parts: string[] = [];
      const count = anyChild.getNumChildren();
      for (let k = 0; k < count; k++) {
        const gc = anyChild.getChild(k) as unknown as {
          editAsText?: () => { getText?: () => string };
          getText?: () => string;
        };
        try {
          parts.push(gc.editAsText?.().getText?.() ?? gc.getText?.() ?? "");
        } catch {
          /* skip unreadable grandchild */
        }
      }
      const joined = parts.join("\n");
      if (joined.trim()) return joined;
    }
  } catch {
    /* not a readable container */
  }

  try {
    const t = anyChild.getText?.();
    if (t && t.trim()) return t;
  } catch {
    /* no getText */
  }

  return "";
};

/**
 * Treat a block-level element (a native code block, or any non-paragraph block)
 * as Mermaid source. Native code blocks carry raw text with no Markdown fences,
 * so we strip optional fences and require the first line to be a Mermaid
 * keyword to avoid converting unrelated blocks.
 */
export const tryExtractMermaidFromBlock = (
  child: GoogleAppsScript.Document.Element,
): string | null => {
  const raw = readBlockElementText(child);
  if (!raw.trim()) return null;

  const definition = stripFences(raw);
  if (!definition) return null;

  if (!isMermaidFirstLine(definition.split("\n")[0])) return null;
  return definition;
};

export const makeBlob = (
  base64Data: string,
  index: number,
): GoogleAppsScript.Base.Blob => {
  return Utilities.newBlob(
    Utilities.base64Decode(base64Data),
    "image/png",
    "mermaid-diagram-" + index + ".png",
  );
};

export const setMermaidAlt = (
  image: GoogleAppsScript.Document.InlineImage,
  mermaidSource: string,
): void => {
  image.setAltTitle(MERMAID_ALT_TITLE);
  if (!mermaidSource) return;

  const encoded = encodeMermaidSource(mermaidSource);
  if (encoded.length > DOCS_MAX_ENCODED_ALT_DESCRIPTION_CHARS) {
    const id = storeEncodedMermaidInDocument(encoded);
    if (id) {
      try {
        image.setAltDescription(MERMAID_DOCSTORE_ALT_PREFIX + id);
      } catch {
        try {
          image.setAltDescription("");
        } catch {
          /* ignore */
        }
      }
    } else {
      try {
        image.setAltDescription("");
      } catch {
        /* ignore */
      }
    }
    return;
  }

  try {
    image.setAltDescription(encoded);
  } catch {
    try {
      image.setAltDescription("");
    } catch {
      /* ignore */
    }
  }
};

export const resolveMermaidSourceFromAlt = (
  raw: string | null | undefined,
): string | null => {
  if (!raw) return null;
  const id = docstoreIdFromAlt(raw);
  if (id) {
    const encoded = loadEncodedMermaidFromDocument(id);
    if (!encoded) return null;
    return decodeMermaidSource(encoded);
  }
  return decodeMermaidSource(raw);
};

export const decodeMermaidSource = (encoded: string): string => {
  let result = "";
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "\\" && i + 1 < encoded.length) {
      const next = encoded[i + 1];
      if (next === "n") {
        result += "\n";
        i++;
        continue;
      }
      if (next === "\\") {
        result += "\\";
        i++;
        continue;
      }
    }
    result += encoded[i];
  }
  return result;
};

const getContentBoxSize = (
  body: GoogleAppsScript.Document.Body,
): { width: number; height: number } => {
  const pixelsPerPoint = 96 / 72;
  const fallback = { width: 624, height: 864 };
  try {
    const width =
      (body.getPageWidth() - body.getMarginLeft() - body.getMarginRight()) *
      pixelsPerPoint;
    const height =
      (body.getPageHeight() - body.getMarginTop() - body.getMarginBottom()) *
      pixelsPerPoint;
    return {
      width: Number.isFinite(width) && width > 0 ? width : fallback.width,
      height: Number.isFinite(height) && height > 0 ? height : fallback.height,
    };
  } catch {
    return fallback;
  }
};

export const fitImageToPage = (
  image: GoogleAppsScript.Document.InlineImage,
  body: GoogleAppsScript.Document.Body,
): void => {
  const { width: maxWidth, height: maxHeight } = getContentBoxSize(body);
  const currentWidth = image.getWidth();
  const currentHeight = image.getHeight();
  if (!currentWidth || !currentHeight) return;

  const comfortableMaxHeight = maxHeight * 0.88;
  let scale = 1;

  // Tall diagrams: shrink height to fit the page first so width keeps full PNG resolution.
  if (currentHeight > comfortableMaxHeight) {
    scale = comfortableMaxHeight / currentHeight;
  }
  const widthAfter = currentWidth * scale;
  if (widthAfter > maxWidth) {
    scale *= maxWidth / widthAfter;
  }

  if (scale >= 0.98) return;

  image.setWidth(Math.floor(currentWidth * scale));
  image.setHeight(Math.floor(currentHeight * scale));
};

const trySetCursorAtElementStart = (
  doc: GoogleAppsScript.Document.Document,
  element: GoogleAppsScript.Document.Element,
): boolean => {
  try {
    const type = element.getType();
    if (
      type === DocumentApp.ElementType.PARAGRAPH ||
      type === DocumentApp.ElementType.LIST_ITEM
    ) {
      const text =
        type === DocumentApp.ElementType.PARAGRAPH
          ? element.asParagraph().editAsText()
          : element.asListItem().editAsText();
      doc.setCursor(doc.newPosition(text, 0));
      return true;
    }
    if (type === DocumentApp.ElementType.TABLE) {
      const table = element.asTable();
      const text = table.getRow(0).getCell(0).editAsText();
      doc.setCursor(doc.newPosition(text, 0));
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

export const moveCursorAfterBodyChild = (
  doc: GoogleAppsScript.Document.Document,
  body: GoogleAppsScript.Document.Body,
  childIndex: number,
): void => {
  try {
    if (childIndex + 1 < body.getNumChildren()) {
      const next = body.getChild(childIndex + 1);
      if (trySetCursorAtElementStart(doc, next)) return;
    }

    const para =
      childIndex + 1 <= body.getNumChildren()
        ? body.insertParagraph(childIndex + 1, "")
        : body.appendParagraph("");
    doc.setCursor(doc.newPosition(para.editAsText(), 0));
  } catch {
    /* Cursor placement is a UX enhancement; never fail the document edit. */
  }
};

export const moveCursorAfterBodyElement = (
  doc: GoogleAppsScript.Document.Document,
  body: GoogleAppsScript.Document.Body,
  element: GoogleAppsScript.Document.Element,
): void => {
  try {
    let topLevel = element;
    while (
      topLevel.getParent() &&
      topLevel.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION
    ) {
      topLevel = topLevel.getParent();
    }

    moveCursorAfterBodyChild(doc, body, body.getChildIndex(topLevel));
  } catch {
    /* Cursor placement is a UX enhancement; never fail the document edit. */
  }
};

export const selectBodyElement = (
  doc: GoogleAppsScript.Document.Document,
  body: GoogleAppsScript.Document.Body,
  element: GoogleAppsScript.Document.Element,
): void => {
  try {
    const range = doc.newRange().addElement(element).build();
    doc.setSelection(range);
  } catch {
    moveCursorAfterBodyElement(doc, body, element);
  }
};

const styleCodeTable = (table: GoogleAppsScript.Document.Table): void => {
  const cell = table.getRow(0).getCell(0);
  cell.setBackgroundColor("#f6f8fa");
  cell.setPaddingTop(8);
  cell.setPaddingBottom(8);
  cell.setPaddingLeft(12);
  cell.setPaddingRight(12);
  const text = cell.editAsText();
  text.setFontFamily("Roboto Mono");
  text.setFontSize(10);
  text.setForegroundColor("#24292f");
  table.setBorderColor("#d1d9e0");
  table.setBorderWidth(1);
};

export const appendCodeBlock = (
  body: GoogleAppsScript.Document.Body,
  content: string,
): GoogleAppsScript.Document.Table => {
  const table = body.appendTable([[content]]);
  styleCodeTable(table);
  return table;
};

export const insertFencedCode = (
  body: GoogleAppsScript.Document.Body,
  idx: number,
  source: string,
): GoogleAppsScript.Document.Table => {
  const wrapped = "```mermaid\n" + source + "\n```";
  const table = body.insertTable(idx, [[wrapped]]);
  styleCodeTable(table);
  return table;
};

export const extractMermaidAtCursor = (
  doc: GoogleAppsScript.Document.Document,
): { text: string; startIdx: number; endIdx: number } | null => {
  const cursor = doc.getCursor();
  if (!cursor) return null;

  // Walk up from the cursor to the element that sits directly under the body,
  // remembering a containing single-cell table (our styled code block) along
  // the way.
  let node: GoogleAppsScript.Document.Element | null = cursor.getElement();
  let table: GoogleAppsScript.Document.Table | null = null;
  let bodyChild: GoogleAppsScript.Document.Element | null = null;

  while (node) {
    if (node.getType() === DocumentApp.ElementType.TABLE) {
      table = node as GoogleAppsScript.Document.Table;
    }
    const parent = node.getParent();
    if (parent && parent.getType() === DocumentApp.ElementType.BODY_SECTION) {
      bodyChild = node;
      break;
    }
    node = parent;
  }

  if (!bodyChild) return null;

  try {
    const body = doc.getBody();

    // Our styled code block: a single-cell table holding ```mermaid … ```.
    if (table) {
      const idx = body.getChildIndex(table);
      const definition = stripFences(
        table.getRow(0).getCell(0).editAsText().getText(),
      );
      if (!definition || !isMermaidFirstLine(definition.split("\n")[0]))
        return null;
      return { text: definition, startIdx: idx, endIdx: idx };
    }

    // Native Google Docs code block (or any other non-paragraph block element)
    // that reads as Mermaid source. Plain paragraphs/list items are left to the
    // selection and "Convert All" paths so a single line isn't half-converted.
    if (
      bodyChild.getType() !== DocumentApp.ElementType.PARAGRAPH &&
      bodyChild.getType() !== DocumentApp.ElementType.LIST_ITEM
    ) {
      const definition = tryExtractMermaidFromBlock(bodyChild);
      if (!definition) return null;
      return {
        text: definition,
        startIdx: body.getChildIndex(bodyChild),
        endIdx: body.getChildIndex(bodyChild),
      };
    }

    return null;
  } catch {
    return null;
  }
};

export const extractSelectedText = (
  selection: GoogleAppsScript.Document.Range,
  body: GoogleAppsScript.Document.Body,
): { text: string; startIdx: number; endIdx: number } => {
  const elements = selection.getRangeElements();
  let selectedText = "";
  let startIdx = -1;
  let endIdx = -1;

  for (const re of elements) {
    const el = re.getElement();

    let para: GoogleAppsScript.Document.Element = el;
    while (
      para.getParent() &&
      para.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION
    ) {
      para = para.getParent();
    }

    try {
      const idx = body.getChildIndex(para);
      if (startIdx === -1 || idx < startIdx) startIdx = idx;
      if (idx > endIdx) endIdx = idx;
    } catch {
      /* element not direct child */
    }

    const asText = el as GoogleAppsScript.Document.Text;
    if (asText.editAsText) {
      const text = asText.editAsText().getText();
      if (re.isPartial()) {
        selectedText += text.substring(
          re.getStartOffset(),
          re.getEndOffsetInclusive() + 1,
        );
      } else {
        selectedText += text;
      }
      selectedText += "\n";
    }
  }

  return { text: stripFences(selectedText), startIdx, endIdx };
};
