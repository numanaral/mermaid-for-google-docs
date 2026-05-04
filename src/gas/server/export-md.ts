// GAS limitation: export can be slow for large documents because the entire
// document body must be traversed server-side via DocumentApp. There is no
// way to stream or paginate this in Apps Script.
import { MERMAID_ALT_TITLE } from "./constants";
import { decodeMermaidSource } from "./doc-utils";

const textToMarkdown = (text: GoogleAppsScript.Document.Text): string => {
  const raw = text.getText();
  if (!raw) return "";

  const indices = text.getTextAttributeIndices();
  let result = "";
  const getAttr = (
    attrs: Record<string, unknown>,
    attr: GoogleAppsScript.Document.Attribute,
  ): unknown => attrs[attr as unknown as string];

  for (let idx = 0; idx < indices.length; idx++) {
    const start = indices[idx];
    const end = idx + 1 < indices.length ? indices[idx + 1] : raw.length;
    const attrs = text.getAttributes(start) as Record<string, unknown>;

    const bold = getAttr(attrs, DocumentApp.Attribute.BOLD) === true;
    const italic = getAttr(attrs, DocumentApp.Attribute.ITALIC) === true;
    const strikethrough =
      getAttr(attrs, DocumentApp.Attribute.STRIKETHROUGH) === true;
    const link = getAttr(attrs, DocumentApp.Attribute.LINK_URL) as
      | string
      | null
      | undefined;
    const font = getAttr(attrs, DocumentApp.Attribute.FONT_FAMILY);
    const isCode = font === "Roboto Mono" || font === "Courier New";

    let chunk = raw.substring(start, end);

    if (isCode) {
      chunk = "`" + chunk + "`";
    } else {
      if (bold && italic) {
        chunk = "***" + chunk + "***";
      } else if (bold) {
        chunk = "**" + chunk + "**";
      } else if (italic) {
        chunk = "*" + chunk + "*";
      }
      if (strikethrough) {
        chunk = "~~" + chunk + "~~";
      }
    }
    if (link) {
      chunk = "[" + chunk + "](" + link + ")";
    }
    result += chunk;
  }

  return result;
};

const headingLevel = (
  heading: GoogleAppsScript.Document.ParagraphHeading,
): number => {
  switch (heading) {
    case DocumentApp.ParagraphHeading.HEADING1:
      return 1;
    case DocumentApp.ParagraphHeading.HEADING2:
      return 2;
    case DocumentApp.ParagraphHeading.HEADING3:
      return 3;
    case DocumentApp.ParagraphHeading.HEADING4:
      return 4;
    case DocumentApp.ParagraphHeading.HEADING5:
      return 5;
    case DocumentApp.ParagraphHeading.HEADING6:
      return 6;
    default:
      return 0;
  }
};

// Checklist items are stored as plain text with a "[ ] " / "[x] " prefix and
// the extra emoji variants below are tolerated for legacy docs and copy-pasted
// content from other tools.
const UNCHECKED_PREFIXES = ["[ ] ", "☐ ", "⬜ "];
const CHECKED_PREFIXES = ["[x] ", "[X] ", "☑ ", "✅ ", "✓ "];

const matchPrefix = (
  md: string,
  prefixes: string[],
): { length: number } | null => {
  for (const prefix of prefixes) {
    if (md.startsWith(prefix)) return { length: prefix.length };
  }
  return null;
};

export const exportDocAsMarkdown = (
  body: GoogleAppsScript.Document.Body,
): string => {
  const n = body.getNumChildren();
  const lines: string[] = [];
  let prevWasListItem = false;
  let prevListId: string | null = null;
  let prevNestLevel = -1;
  const orderedCounters: number[] = [];

  const resetListState = (): void => {
    prevListId = null;
    prevNestLevel = -1;
    orderedCounters.length = 0;
  };

  for (let i = 0; i < n; i++) {
    const child = body.getChild(i);
    const type = child.getType();

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      const para = child.asParagraph();
      const heading = para.getHeading();
      const level = headingLevel(heading);

      const numChildren = para.getNumChildren();
      let hasMermaidImage = false;
      let mermaidSource = "";

      for (let c = 0; c < numChildren; c++) {
        const pChild = para.getChild(c);
        if (pChild.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
          const img = pChild.asInlineImage();
          if (img.getAltTitle() === MERMAID_ALT_TITLE) {
            const raw = img.getAltDescription();
            if (raw) {
              hasMermaidImage = true;
              mermaidSource = decodeMermaidSource(raw);
            }
          }
        }
      }

      if (hasMermaidImage && mermaidSource) {
        lines.push("");
        lines.push("```mermaid");
        lines.push(mermaidSource);
        lines.push("```");
        lines.push("");
        prevWasListItem = false;
        continue;
      }

      if (
        para.getNumChildren() === 1 &&
        para.getChild(0).getType() === DocumentApp.ElementType.HORIZONTAL_RULE
      ) {
        lines.push("");
        lines.push("---");
        lines.push("");
        prevWasListItem = false;
        continue;
      }

      const md = textToMarkdown(para.editAsText());

      if (level > 0) {
        lines.push("");
        lines.push("#".repeat(level) + " " + md);
        lines.push("");
      } else if (md.trim() === "") {
        lines.push("");
      } else {
        // A paragraph that was imported as a blockquote was indented 36pt via
        // setIndentStart (see import-md.ts). Use that as the signal to emit
        // `> …` markdown so blockquotes round-trip without relying on a
        // dedicated DocumentApp paragraph style (which doesn't exist).
        let indentStart: number | null = null;
        try {
          indentStart = para.getIndentStart();
        } catch {
          indentStart = null;
        }
        if (indentStart !== null && indentStart >= 36) {
          lines.push("");
          for (const line of md.split("\n")) {
            lines.push("> " + line);
          }
          lines.push("");
        } else {
          lines.push(md);
        }
      }
      prevWasListItem = false;
      continue;
    }

    if (type === DocumentApp.ElementType.LIST_ITEM) {
      const li = child.asListItem();
      const md = textToMarkdown(li.editAsText());
      const glyph = li.getGlyphType();
      const nestLevel = li.getNestingLevel();
      const indent = "  ".repeat(nestLevel);
      const isOrdered =
        glyph === DocumentApp.GlyphType.NUMBER ||
        glyph === DocumentApp.GlyphType.LATIN_UPPER ||
        glyph === DocumentApp.GlyphType.LATIN_LOWER ||
        glyph === DocumentApp.GlyphType.ROMAN_UPPER ||
        glyph === DocumentApp.GlyphType.ROMAN_LOWER;

      const listId = li.getListId();
      if (listId !== prevListId) {
        orderedCounters.length = 0;
      } else if (nestLevel < prevNestLevel) {
        for (let l = nestLevel + 1; l < orderedCounters.length; l++) {
          orderedCounters[l] = 0;
        }
      }
      prevListId = listId;
      prevNestLevel = nestLevel;

      const unchecked = matchPrefix(md, UNCHECKED_PREFIXES);
      const checked = unchecked ? null : matchPrefix(md, CHECKED_PREFIXES);

      if (unchecked) {
        lines.push(`${indent}* [ ] ${md.substring(unchecked.length)}`);
      } else if (checked) {
        lines.push(`${indent}* [x] ${md.substring(checked.length)}`);
      } else if (isOrdered) {
        orderedCounters[nestLevel] = (orderedCounters[nestLevel] || 0) + 1;
        lines.push(indent + orderedCounters[nestLevel] + ". " + md);
      } else {
        lines.push(indent + "* " + md);
      }
      prevWasListItem = true;
      continue;
    }

    if (prevWasListItem) {
      lines.push("");
      prevWasListItem = false;
      resetListState();
    }

    if (type === DocumentApp.ElementType.TABLE) {
      const tbl = child.asTable();
      const rows = tbl.getNumRows();

      if (rows === 1 && tbl.getRow(0).getNumCells() === 1) {
        const cellText = tbl.getRow(0).getCell(0).editAsText().getText();
        const trimmed = cellText.trim();
        if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
          lines.push("");
          lines.push(trimmed);
          lines.push("");
          continue;
        }
        lines.push("");
        lines.push("```");
        lines.push(cellText);
        lines.push("```");
        lines.push("");
        continue;
      }

      lines.push("");
      for (let r = 0; r < rows; r++) {
        const row = tbl.getRow(r);
        const cells: string[] = [];
        for (let c = 0; c < row.getNumCells(); c++) {
          cells.push(textToMarkdown(row.getCell(c).editAsText()));
        }
        lines.push("| " + cells.join(" | ") + " |");
        if (r === 0) {
          lines.push("| " + cells.map(() => "---").join(" | ") + " |");
        }
      }
      lines.push("");
      continue;
    }

    if (type.toString() === "CODE_SNIPPET") {
      const text = child.asText?.() ? child.asText().getText() : "";
      if (!text) continue;
      lines.push("");
      lines.push("```");
      lines.push(text);
      lines.push("```");
      lines.push("");
      continue;
    }

    try {
      const text = (child as GoogleAppsScript.Document.Text)
        .editAsText()
        .getText();
      if (text) lines.push(text);
    } catch {
      /* skip unknown element types */
    }
  }

  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
};
