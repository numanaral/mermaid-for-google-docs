import type { MermaidImage, MermaidSnippet } from "./types";
import {
  extractMermaidAtCursor,
  extractSelectedText,
  fitImageToPage,
  insertFencedCode,
  makeBlob,
  selectBodyElement,
  setMermaidAlt,
} from "./doc-utils";
import { findMermaidSnippets } from "./snippets";
import { findMermaidImages, findMermaidImageIn } from "./images";
import { exportDocAsMarkdown } from "./export-md";
import { getActiveBody } from "./tab-utils";

// --- Dialog helpers ---

const timeServer = <T>(label: string, fn: () => T): T => {
  const start = Date.now();
  try {
    return fn();
  } finally {
    console.log(`[perf] ${label}: ${Date.now() - start}ms`);
  }
};

const showPreviewDialog = (blockInfos: MermaidSnippet[] | null): void => {
  const template = HtmlService.createTemplateFromFile("Preview");
  template.blockInfos = JSON.stringify(blockInfos);

  const html = template.evaluate().setWidth(800).setHeight(600);
  DocumentApp.getUi().showModalDialog(html, "Convert Code to Diagrams");
};

const makeUniqueDiagramBlob = (
  base64Data: string,
): GoogleAppsScript.Base.Blob => {
  const stamp = Date.now();
  const id = Utilities.getUuid().slice(0, 8);
  return Utilities.newBlob(
    Utilities.base64Decode(base64Data),
    "image/png",
    `mermaid-diagram-${stamp}-${id}.png`,
  );
};

const openEditorForImage = (source: string, imageChildIndex: number): void => {
  // Access the document before template evaluation to ensure the
  // OAuth authorization prompt fires when permissions haven't been granted yet.
  // Without this, createTemplateFromFile().evaluate() fails silently.
  timeServer("auth:warm-active-document", () =>
    DocumentApp.getActiveDocument(),
  );

  const template = HtmlService.createTemplateFromFile("Editor");
  template.initialSource = source;
  template.imageChildIndex = imageChildIndex;

  const html = template.evaluate().setWidth(1000).setHeight(700);
  DocumentApp.getUi().showModalDialog(html, "Mermaid Editor");
};

const openExtractDialog = (images: MermaidImage[] | null): void => {
  const template = HtmlService.createTemplateFromFile("Extract");
  template.imageInfos = JSON.stringify(images);

  const html = template.evaluate().setWidth(800).setHeight(600);
  DocumentApp.getUi().showModalDialog(html, "Convert Diagrams to Code");
};

// --- Public functions (called by GAS menu / client dialogs) ---
// Exported so the build can discover and emit them as top-level GAS functions.

export const onOpen = (): void => {
  DocumentApp.getUi()
    .createMenu("Mermaid Toolkit")
    .addItem("Insert Mermaid Diagram", "openEditor")
    .addItem("Edit All Mermaid Diagrams", "openEditDiagrams")
    .addItem("Edit Selected Mermaid Diagram", "editSelectedMermaidImage")
    .addSeparator()
    .addItem("Convert All Code to Diagrams", "scanAndRender")
    .addItem("Convert Selected Code to Diagram", "convertSelectedCodeToDiagram")
    .addSeparator()
    .addItem("Convert All Diagrams to Code", "extractMermaidFromImages")
    .addItem("Convert Selected Diagram to Code", "convertSelectedImageToCode")
    .addSeparator()
    .addItem("Import from Markdown", "openImportMarkdown")
    .addItem("Export as Markdown", "openExportMarkdown")
    .addItem('Fix Native "Copy as Markdown"', "openFixMarkdown")
    .addSeparator()
    .addItem("Quick Guide", "showQuickGuide")
    .addItem("Dev Tools", "openDevTools")
    .addItem("About", "showAbout")
    .addToUi();
};

export const openEditor = (): void => {
  openEditorForImage("", -1);
};

export const scanAndRender = (): void => {
  showPreviewDialog(null);
};

export const getMermaidSnippetsForPreview = (): MermaidSnippet[] =>
  timeServer("scan:mermaid-snippets", () => findMermaidSnippets());

export const renderSelection = (): void => {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();

  if (!selection) {
    DocumentApp.getUi().alert(
      "No text selected.\n\nHighlight the mermaid diagram text and try again.",
    );
    return;
  }

  const { text, startIdx, endIdx } = extractSelectedText(
    selection,
    doc.getBody(),
  );

  if (!text) {
    DocumentApp.getUi().alert("Selected text is empty.");
    return;
  }

  showPreviewDialog([{ definition: text, startIdx, endIdx }]);
};

export const convertSelectedCodeToDiagram = (): void => {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();

  let text: string;
  let startIdx: number;
  let endIdx: number;

  if (selection) {
    const extracted = extractSelectedText(selection, doc.getBody());
    text = extracted.text;
    startIdx = extracted.startIdx;
    endIdx = extracted.endIdx;
  } else {
    const fromCursor = extractMermaidAtCursor(doc);
    if (!fromCursor) {
      DocumentApp.getUi().alert(
        "No mermaid code selected.\n\n" +
          "Select a mermaid code block or place your cursor inside one, then try again.",
      );
      return;
    }
    text = fromCursor.text;
    startIdx = fromCursor.startIdx;
    endIdx = fromCursor.endIdx;
  }

  if (!text) {
    DocumentApp.getUi().alert("Selected text is empty.");
    return;
  }

  const template = HtmlService.createTemplateFromFile("Convert");
  template.mermaidSource = text;
  template.startIdx = startIdx;
  template.endIdx = endIdx;

  const html = template.evaluate().setWidth(360).setHeight(180);
  DocumentApp.getUi().showModalDialog(html, "Converting...");
};

export const editSelectedMermaidImage = (): void => {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();

  if (!selection) {
    DocumentApp.getUi().alert(
      "No diagram selected.\n\n" +
        "Click on a Mermaid diagram to select it, then try again.",
    );
    return;
  }

  const body = doc.getBody();
  for (const re of selection.getRangeElements()) {
    const result = findMermaidImageIn(re.getElement(), body);
    if (result) {
      openEditorForImage(result.source, result.childIndex);
      return;
    }
  }

  DocumentApp.getUi().alert(
    "Selection is not a Mermaid diagram.\n\n" +
      "Only diagrams inserted by this add-on contain embedded Mermaid source code.",
  );
};

export const openEditDiagrams = (): void => {
  const template = HtmlService.createTemplateFromFile("EditDiagrams");
  template.imageInfos = "null";

  const html = template.evaluate().setWidth(800).setHeight(600);
  DocumentApp.getUi().showModalDialog(html, "Edit All Mermaid Diagrams");
};

export const getMermaidImagesForDialog = (): MermaidImage[] =>
  timeServer("scan:mermaid-images", () => findMermaidImages());

export const extractMermaidFromImages = (): void => {
  openExtractDialog(null);
};

export const convertSelectedImageToCode = (): void => {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();

  if (!selection) {
    DocumentApp.getUi().alert(
      "No diagram selected.\n\n" +
        "Click on a Mermaid diagram to select it, then try again.",
    );
    return;
  }

  const body = doc.getBody();
  for (const re of selection.getRangeElements()) {
    const result = findMermaidImageIn(re.getElement(), body);
    if (result) {
      const template = HtmlService.createTemplateFromFile("DiagramToCode");
      template.source = result.source;
      template.imageIdx = result.childIndex;

      const html = template.evaluate().setWidth(360).setHeight(180);
      DocumentApp.getUi().showModalDialog(html, "Converting...");
      return;
    }
  }

  DocumentApp.getUi().alert(
    "Selection is not a Mermaid diagram.\n\n" +
      "Only diagrams inserted by this add-on contain embedded Mermaid source code.",
  );
};

export const insertDiagramAfterText = (
  base64Data: string,
  startIdx: number,
  endIdx: number,
  index: number,
  mermaidSource: string,
): { success: boolean; index: number } => {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const blob = makeBlob(base64Data, index);
  const insertedIndex = endIdx >= 0 ? endIdx + 1 : body.getNumChildren();
  const image =
    endIdx >= 0
      ? body.insertImage(insertedIndex, blob)
      : body.appendImage(blob);
  fitImageToPage(image, body);
  if (mermaidSource) setMermaidAlt(image, mermaidSource);
  selectBodyElement(doc, body, image);
  return { success: true, index };
};

export const replaceDiagramText = (
  base64Data: string,
  startIdx: number,
  endIdx: number,
  index: number,
  mermaidSource: string,
): { success: boolean; index: number } => {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();

  if (startIdx < 0 || endIdx < 0) {
    throw new Error("Cannot replace: code block position unknown.");
  }

  const blob = makeBlob(base64Data, index);
  const image = body.insertImage(startIdx, blob);
  fitImageToPage(image, body);

  for (let i = endIdx + 1; i > startIdx; i--) {
    body.removeChild(body.getChild(i));
  }

  if (mermaidSource) setMermaidAlt(image, mermaidSource);
  selectBodyElement(doc, body, image);
  return { success: true, index };
};

export const insertImageAtCursor = (
  base64Data: string,
  mermaidSource: string,
): { success: boolean; position: string } => {
  const doc = DocumentApp.getActiveDocument();
  const cursor = doc.getCursor();
  const body = doc.getBody();
  const blob = makeUniqueDiagramBlob(base64Data);

  if (cursor) {
    const el = cursor.getElement();
    let para: GoogleAppsScript.Document.Element = el;
    while (
      para.getParent() &&
      para.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION
    ) {
      para = para.getParent();
    }
    try {
      const idx = body.getChildIndex(para);
      const image = body.insertImage(idx + 1, blob);
      fitImageToPage(image, body);
      if (mermaidSource) setMermaidAlt(image, mermaidSource);
      selectBodyElement(doc, body, image);
      return { success: true, position: "cursor" };
    } catch {
      /* fall through to append */
    }
  }

  const image = body.appendImage(blob);
  fitImageToPage(image, body);
  if (mermaidSource) setMermaidAlt(image, mermaidSource);
  selectBodyElement(doc, body, image);
  return { success: true, position: "end" };
};

export const replaceImageInPlace = (
  base64Data: string,
  childIndex: number,
  mermaidSource: string,
): { success: boolean } => {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const blob = makeUniqueDiagramBlob(base64Data);

  const image = body.insertImage(childIndex, blob);
  fitImageToPage(image, body);
  body.removeChild(body.getChild(childIndex + 1));
  if (mermaidSource) setMermaidAlt(image, mermaidSource);
  selectBodyElement(doc, body, image);
  return { success: true };
};

export const insertCodeBlockAfterImage = (
  source: string,
  imageIdx: number,
): { success: boolean } => {
  const body = DocumentApp.getActiveDocument().getBody();
  insertFencedCode(body, imageIdx + 1, source);
  return { success: true };
};

export const replaceImageWithCodeBlock = (
  source: string,
  imageIdx: number,
): { success: boolean } => {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const table = insertFencedCode(body, imageIdx, source);
  body.removeChild(body.getChild(imageIdx + 1));
  doc.setCursor(doc.newPosition(table.getRow(0).getCell(0).editAsText(), 0));
  return { success: true };
};

// --- Batch operations (single round-trip for Replace All / Insert All) ---
// Items MUST arrive pre-sorted descending by position so later edits
// don't shift earlier indices.

interface BatchDiagramItem {
  base64: string;
  startIdx: number;
  endIdx: number;
  index: number;
  definition: string;
}

interface BatchResult {
  index: number;
  ok: boolean;
  error?: string;
}

export const batchInsertDiagrams = (
  items: BatchDiagramItem[],
): BatchResult[] => {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const results: BatchResult[] = [];
  let selectedImage: GoogleAppsScript.Document.InlineImage | null = null;
  let selectedIndex: number | null = null;
  for (const item of items) {
    try {
      const blob = makeBlob(item.base64, item.index);
      const insertedIndex =
        item.endIdx >= 0 ? item.endIdx + 1 : body.getNumChildren();
      const image =
        item.endIdx >= 0
          ? body.insertImage(insertedIndex, blob)
          : body.appendImage(blob);
      fitImageToPage(image, body);
      if (item.definition) setMermaidAlt(image, item.definition);
      if (selectedIndex === null || insertedIndex < selectedIndex) {
        selectedIndex = insertedIndex;
        selectedImage = image;
      }
      results.push({ index: item.index, ok: true });
    } catch (e) {
      results.push({ index: item.index, ok: false, error: String(e) });
    }
  }
  if (selectedImage) selectBodyElement(doc, body, selectedImage);
  return results;
};

export const batchReplaceDiagrams = (
  items: BatchDiagramItem[],
): BatchResult[] => {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const results: BatchResult[] = [];
  let selectedImage: GoogleAppsScript.Document.InlineImage | null = null;
  let selectedIndex: number | null = null;
  for (const item of items) {
    try {
      if (item.startIdx < 0 || item.endIdx < 0) {
        throw new Error("Cannot replace: code block position unknown.");
      }
      const blob = makeBlob(item.base64, item.index);
      const image = body.insertImage(item.startIdx, blob);
      fitImageToPage(image, body);
      for (let i = item.endIdx + 1; i > item.startIdx; i--) {
        body.removeChild(body.getChild(i));
      }
      if (item.definition) setMermaidAlt(image, item.definition);
      if (selectedIndex === null || item.startIdx < selectedIndex) {
        selectedIndex = item.startIdx;
        selectedImage = image;
      }
      results.push({ index: item.index, ok: true });
    } catch (e) {
      results.push({ index: item.index, ok: false, error: String(e) });
    }
  }
  if (selectedImage) selectBodyElement(doc, body, selectedImage);
  return results;
};

interface BatchCodeBlockItem {
  source: string;
  childIndex: number;
  index: number;
}

export const batchInsertCodeBlocks = (
  items: BatchCodeBlockItem[],
): BatchResult[] => {
  const body = DocumentApp.getActiveDocument().getBody();
  const results: BatchResult[] = [];
  for (const item of items) {
    try {
      insertFencedCode(body, item.childIndex + 1, item.source);
      results.push({ index: item.index, ok: true });
    } catch (e) {
      results.push({ index: item.index, ok: false, error: String(e) });
    }
  }
  return results;
};

export const batchReplaceWithCodeBlocks = (
  items: BatchCodeBlockItem[],
): BatchResult[] => {
  const body = DocumentApp.getActiveDocument().getBody();
  const results: BatchResult[] = [];
  for (const item of items) {
    try {
      insertFencedCode(body, item.childIndex, item.source);
      body.removeChild(body.getChild(item.childIndex + 1));
      results.push({ index: item.index, ok: true });
    } catch (e) {
      results.push({ index: item.index, ok: false, error: String(e) });
    }
  }
  return results;
};

export const openEditorWithSource = (source: string): void => {
  openEditorForImage(source, -1);
};

export const openImportMarkdown = (): void => {
  const html = HtmlService.createHtmlOutputFromFile("ImportMarkdown")
    .setWidth(1000)
    .setHeight(700);
  DocumentApp.getUi().showModalDialog(html, "Import from Markdown");
};

export { importMarkdownAtCursor, importMarkdownReplace } from "./import-md";

export const openExportMarkdown = (): void => {
  const html = HtmlService.createHtmlOutputFromFile("ExportMarkdown")
    .setWidth(900)
    .setHeight(600);
  DocumentApp.getUi().showModalDialog(html, "Export as Markdown");
};

export const getExportMarkdown = (): string => {
  const doc = DocumentApp.getActiveDocument();
  const { body } = getActiveBody(doc);
  return timeServer("exportmd:build-markdown", () => exportDocAsMarkdown(body));
};

export const openFixMarkdown = (): void => {
  const html = HtmlService.createHtmlOutputFromFile("FixMarkdown")
    .setWidth(900)
    .setHeight(600);
  DocumentApp.getUi().showModalDialog(html, 'Fix Native "Copy as Markdown"');
};

export const showQuickGuide = (): void => {
  const html = HtmlService.createHtmlOutputFromFile("QuickGuide")
    .setWidth(560)
    .setHeight(460);
  DocumentApp.getUi().showModalDialog(html, "Quick Guide");
};

export const openDevTools = (): void => {
  const html = HtmlService.createHtmlOutputFromFile("DevTools")
    .setWidth(400)
    .setHeight(320);
  DocumentApp.getUi().showModalDialog(html, "Dev Tools");
};

export const showAbout = (): void => {
  const html = HtmlService.createHtmlOutputFromFile("About")
    .setWidth(320)
    .setHeight(280);
  DocumentApp.getUi().showModalDialog(html, "About");
};

const buildDocumentInfoData = (): { rows: [string, string][] } => {
  const doc = DocumentApp.getActiveDocument();
  const { body, tabId, isFirstTab } = getActiveBody(doc);
  const n = body.getNumChildren();
  const images = timeServer("docinfo:scan-images", () => findMermaidImages());
  const snippets = timeServer("docinfo:scan-snippets", () =>
    findMermaidSnippets(),
  );

  return {
    rows: [
      ["Document ID", doc.getId()],
      ["Name", doc.getName()],
      ["Tab", isFirstTab ? "#1 (primary)" : tabId],
      ["Children", String(n)],
      ["Mermaid Diagrams", String(images.length)],
      ["Mermaid Code Blocks", String(snippets.length)],
      ["URL", doc.getUrl()],
    ],
  };
};

export const getDocumentInfoData = (): { rows: [string, string][] } =>
  timeServer("docinfo:build-data", () => buildDocumentInfoData());

export const openDocumentInfo = (): void => {
  const template = HtmlService.createTemplateFromFile("DocInfo");
  template.data = "null";
  const html = template.evaluate().setWidth(500).setHeight(350);
  DocumentApp.getUi().showModalDialog(html, "Document Info");
};

interface InspectorChildInfo {
  idx: number;
  type: string;
  heading: string;
  glyph: string;
  nest: number;
  text: string;
  listId: string;
  indent: string;
}

interface InspectorData {
  numChildren: number;
  tabId: string;
  isFirstTab: boolean;
  children: InspectorChildInfo[];
}

const buildInspectorData = (): InspectorData => {
  const doc = DocumentApp.getActiveDocument();
  const { body, tabId, isFirstTab } = getActiveBody(doc);
  const n = body.getNumChildren();

  const children: InspectorChildInfo[] = [];

  // Collapse opaque list IDs to short stable labels (L1, L2, ...) so readers
  // can see which list items share a parent list at a glance without having
  // to parse the raw IDs.
  const listIdMap = new Map<string, string>();
  const shortListId = (raw: string): string => {
    if (!raw) return "";
    const existing = listIdMap.get(raw);
    if (existing) return existing;
    const label = `L${listIdMap.size + 1}`;
    listIdMap.set(raw, label);
    return label;
  };

  const ptOrEmpty = (v: number | null | undefined): string =>
    typeof v === "number" && !Number.isNaN(v) ? v.toFixed(0) : "";

  const probeAttr = <T>(fn: () => T | null | undefined): T | null => {
    try {
      const v = fn();
      return v === undefined ? null : v;
    } catch {
      return null;
    }
  };

  for (let i = 0; i < n; i++) {
    const child = body.getChild(i);
    const type = child.getType().toString();
    let text = "";
    let heading = "";
    let glyph = "";
    let nest = -1;
    let listId = "";
    let indent = "";

    try {
      if (type === "TABLE") {
        const tbl = child.asTable();
        const cellTexts: string[] = [];
        for (let r = 0; r < tbl.getNumRows() && r < 2; r++) {
          const row = tbl.getRow(r);
          for (let c = 0; c < row.getNumCells() && c < 3; c++) {
            cellTexts.push(row.getCell(c).editAsText().getText());
          }
        }
        text = cellTexts.join(" | ");
      } else if (type === "LIST_ITEM") {
        const li = child.asListItem();
        text = li.editAsText().getText();
        glyph = String(li.getGlyphType());
        nest = li.getNestingLevel();
        listId = shortListId(probeAttr(() => li.getListId()) ?? "");
        const start = probeAttr(() => li.getIndentStart());
        const first = probeAttr(() => li.getIndentFirstLine());
        indent =
          start !== null || first !== null
            ? `${ptOrEmpty(start)}/${ptOrEmpty(first)}`
            : "";
      } else if (type === "PARAGRAPH") {
        const para = child.asParagraph();
        text = para.editAsText().getText();
        heading = String(para.getHeading());
        const start = probeAttr(() => para.getIndentStart());
        const first = probeAttr(() => para.getIndentFirstLine());
        indent =
          start !== null || first !== null
            ? `${ptOrEmpty(start)}/${ptOrEmpty(first)}`
            : "";
      } else {
        text = (child as GoogleAppsScript.Document.Text).editAsText().getText();
      }
    } catch {
      text = "(unable to read)";
    }

    children.push({
      idx: i,
      type,
      heading,
      glyph,
      nest,
      text,
      listId,
      indent,
    });
  }

  return {
    numChildren: n,
    tabId,
    isFirstTab,
    children,
  };
};

export const getInspectorData = (): InspectorData =>
  timeServer("inspector:build-data", () => buildInspectorData());

export const debugDocStructure = (): void => {
  const template = HtmlService.createTemplateFromFile("Inspector");
  template.data = "null";
  const html = template.evaluate().setWidth(1100).setHeight(700);
  DocumentApp.getUi().showModalDialog(html, "Document Body Inspector");
};
