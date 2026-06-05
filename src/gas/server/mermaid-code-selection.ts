import { extractMermaidAtCursor, extractSelectedText } from "./doc-utils";
import type { MermaidSnippet } from "./types";

const alert = (message: string): void => {
  DocumentApp.getUi().alert(message);
};

/** Highlighted text → single preview snippet, or null after user alert. */
export function tryGetMermaidSnippetForPreview(): MermaidSnippet | null {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();

  if (!selection) {
    alert(
      "No text selected.\n\nHighlight the mermaid diagram text and try again.",
    );
    return null;
  }

  const { text, startIdx, endIdx } = extractSelectedText(
    selection,
    doc.getBody(),
  );

  if (!text) {
    alert("Selected text is empty.");
    return null;
  }

  return { definition: text, startIdx, endIdx };
}

/** Selection or cursor-in-block → convert dialog payload, or null after user alert. */
export function tryGetMermaidSnippetForConvert(): MermaidSnippet | null {
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
      alert(
        "No mermaid code selected.\n\n" +
          "Select a mermaid code block or place your cursor inside one, then try again.",
      );
      return null;
    }
    text = fromCursor.text;
    startIdx = fromCursor.startIdx;
    endIdx = fromCursor.endIdx;
  }

  if (!text) {
    alert("Selected text is empty.");
    return null;
  }

  return { definition: text, startIdx, endIdx };
}
