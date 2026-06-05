import { findMermaidImages } from "./images";
import { findMermaidSnippets } from "./snippets";
import { timeServer } from "./server-perf";
import { getActiveBody } from "./tab-utils";

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

export function getDocumentInfoData(): { rows: [string, string][] } {
  return timeServer("docinfo:build-data", () => buildDocumentInfoData());
}

export const openDocumentInfo = (): void => {
  const template = HtmlService.createTemplateFromFile("DocInfo");
  template.data = "null";
  const html = template.evaluate().setWidth(500).setHeight(350);
  DocumentApp.getUi().showModalDialog(html, "Document Info");
};
