import {
  fitImageToPage,
  insertFencedCode,
  makeBlob,
  makeUniqueDiagramBlob,
  selectBodyElement,
  setMermaidAlt,
} from "./doc-utils";

export interface BatchDiagramItem {
  base64: string;
  startIdx: number;
  endIdx: number;
  index: number;
  definition: string;
}

export interface BatchCodeBlockItem {
  source: string;
  childIndex: number;
  index: number;
}

export interface BatchResult {
  index: number;
  ok: boolean;
  error?: string;
}

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

// Items MUST arrive pre-sorted descending by position so later edits
// don't shift earlier indices.

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
