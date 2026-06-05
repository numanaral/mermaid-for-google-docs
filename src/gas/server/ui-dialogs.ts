import type { MermaidImage, MermaidSnippet } from "./types";
import { timeServer } from "./server-perf";

export function showPreviewDialog(blockInfos: MermaidSnippet[] | null): void {
  const template = HtmlService.createTemplateFromFile("Preview");
  template.blockInfos = JSON.stringify(blockInfos);

  const html = template.evaluate().setWidth(800).setHeight(600);
  DocumentApp.getUi().showModalDialog(html, "Convert Code to Diagrams");
}

export function openEditorForImage(
  source: string,
  imageChildIndex: number,
): void {
  // Access the document before template evaluation to ensure the
  // OAuth authorization prompt fires when permissions haven't been granted yet.
  // Without this, createTemplateFromFile().evaluate() fails silently.
  timeServer("auth:warm-active-document", () =>
    DocumentApp.getActiveDocument(),
  );

  const template = HtmlService.createTemplateFromFile("Editor");
  // Prevent </script> in source from terminating the preceding <script> in HTML.
  template.initialSourceJs = JSON.stringify(source || "").replace(
    /</g,
    "\\u003c",
  );
  template.imageChildIndex = imageChildIndex;

  const html = template.evaluate().setWidth(1000).setHeight(700);
  DocumentApp.getUi().showModalDialog(html, "Mermaid Editor");
}

export function openExtractDialog(images: MermaidImage[] | null): void {
  const template = HtmlService.createTemplateFromFile("Extract");
  template.imageInfos = JSON.stringify(images);

  const html = template.evaluate().setWidth(800).setHeight(600);
  DocumentApp.getUi().showModalDialog(html, "Convert Diagrams to Code");
}

export function openEditDiagramsDialog(): void {
  const template = HtmlService.createTemplateFromFile("EditDiagrams");
  template.imageInfos = "null";

  const html = template.evaluate().setWidth(800).setHeight(600);
  DocumentApp.getUi().showModalDialog(html, "Edit All Mermaid Diagrams");
}

export function openConvertDialog(
  mermaidSource: string,
  startIdx: number,
  endIdx: number,
): void {
  const template = HtmlService.createTemplateFromFile("Convert");
  template.mermaidSource = mermaidSource;
  template.startIdx = startIdx;
  template.endIdx = endIdx;

  const html = template.evaluate().setWidth(360).setHeight(180);
  DocumentApp.getUi().showModalDialog(html, "Converting...");
}

export function openDiagramToCodeDialog(
  source: string,
  imageIdx: number,
): void {
  const template = HtmlService.createTemplateFromFile("DiagramToCode");
  template.source = source;
  template.imageIdx = imageIdx;

  const html = template.evaluate().setWidth(360).setHeight(180);
  DocumentApp.getUi().showModalDialog(html, "Converting...");
}

export function openSimpleHtmlDialog(
  htmlFile: string,
  width: number,
  height: number,
  title: string,
): void {
  const html = HtmlService.createHtmlOutputFromFile(htmlFile)
    .setWidth(width)
    .setHeight(height);
  DocumentApp.getUi().showModalDialog(html, title);
}
