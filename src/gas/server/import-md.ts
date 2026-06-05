import { appendCodeBlock, fitImageToPage, setMermaidAlt } from "./doc-utils";
import { getActiveBody } from "./tab-utils";

interface Seg {
  t: string;
  b?: boolean;
  i?: boolean;
  s?: boolean;
  c?: boolean;
  l?: string;
}

interface ImportListItem {
  text: Seg[];
  checked?: boolean;
  children?: ImportListItem[];
}

interface ImportElement {
  type:
    | "heading"
    | "paragraph"
    | "code"
    | "image"
    | "list"
    | "table"
    | "hr"
    | "blockquote";
  content: Seg[];
  level?: number;
  base64?: string;
  mermaidSource?: string;
  ordered?: boolean;
  rows?: Seg[][][];
  items?: ImportListItem[];
}

const timeServer = <T>(label: string, fn: () => T): T => {
  const start = Date.now();
  try {
    return fn();
  } finally {
    console.log(`[perf] ${label}: ${Date.now() - start}ms`);
  }
};

const applySegments = (
  text: GoogleAppsScript.Document.Text,
  segs: Seg[],
): void => {
  const plain = segs.map((s) => s.t).join("");
  if (!plain) {
    text.setText("");
    return;
  }

  text.setText(plain);

  let pos = 0;
  for (const seg of segs) {
    if (!seg.t) continue;
    const end = pos + seg.t.length - 1;
    if (seg.b) text.setBold(pos, end, true);
    if (seg.i) text.setItalic(pos, end, true);
    if (seg.s) text.setStrikethrough(pos, end, true);
    if (seg.c) {
      text.setFontFamily(pos, end, "Roboto Mono");
      text.setBackgroundColor(pos, end, "#f3f4f6");
      text.setForegroundColor(pos, end, "#d63384");
    }
    if (seg.l) {
      text.setLinkUrl(pos, end, seg.l);
      text.setForegroundColor(pos, end, "#1a73e8");
      text.setUnderline(pos, end, true);
    }
    pos += seg.t.length;
  }
};

// Prepends a plain-text [ ] / [x] marker to a checklist item so the checkbox
// state round-trips through export without requiring the Docs Advanced Service.
const withCheckboxPrefix = (segs: Seg[], checked: boolean): Seg[] => [
  { t: checked ? "[x] " : "[ ] " },
  ...segs,
];

const appendListItems = (
  body: GoogleAppsScript.Document.Body,
  items: ImportListItem[],
  depth: number,
  ordered: boolean,
  anchorItem: GoogleAppsScript.Document.ListItem | null,
): GoogleAppsScript.Document.ListItem => {
  const glyph = ordered
    ? DocumentApp.GlyphType.NUMBER
    : DocumentApp.GlyphType.BULLET;

  for (const item of items) {
    const li = body.appendListItem("");
    li.setNestingLevel(depth);
    li.setGlyphType(glyph);

    if (anchorItem) {
      li.setListId(anchorItem);
    }
    if (!anchorItem) {
      anchorItem = li;
    }

    const segs =
      item.checked === undefined
        ? item.text
        : withCheckboxPrefix(item.text, item.checked);
    applySegments(li.editAsText(), segs);

    if (item.children && item.children.length > 0) {
      anchorItem = appendListItems(
        body,
        item.children,
        depth + 1,
        ordered,
        anchorItem,
      );
    }
  }

  return anchorItem!;
};

// Block types that benefit from a blank paragraph separator from an adjacent
// non-text block (list ↔ table, table ↔ paragraph, image ↔ list, etc.) so the
// result matches how Google Docs™' own markdown paste visually spaces things.
// Consecutive paragraphs already look fine without a spacer.
const isHeavyBlock = (type: ImportElement["type"]): boolean =>
  type === "list" ||
  type === "table" ||
  type === "image" ||
  type === "code" ||
  type === "blockquote" ||
  type === "hr";

const needsSpacerBetween = (
  prev: ImportElement["type"],
  next: ImportElement["type"],
): boolean => isHeavyBlock(prev) || isHeavyBlock(next);

const appendElements = (
  body: GoogleAppsScript.Document.Body,
  elements: ImportElement[],
  firstParagraph?: GoogleAppsScript.Document.Paragraph,
): void => {
  const headingMap: Record<number, GoogleAppsScript.Document.ParagraphHeading> =
    {
      1: DocumentApp.ParagraphHeading.HEADING1,
      2: DocumentApp.ParagraphHeading.HEADING2,
      3: DocumentApp.ParagraphHeading.HEADING3,
      4: DocumentApp.ParagraphHeading.HEADING4,
      5: DocumentApp.ParagraphHeading.HEADING5,
      6: DocumentApp.ParagraphHeading.HEADING6,
    };

  let prevType: ImportElement["type"] | null = null;
  let reusableParagraph = firstParagraph ?? null;
  const nextParagraph = (): GoogleAppsScript.Document.Paragraph => {
    if (reusableParagraph) {
      const para = reusableParagraph;
      reusableParagraph = null;
      return para;
    }
    return body.appendParagraph("");
  };

  for (const el of elements) {
    if (prevType && needsSpacerBetween(prevType, el.type)) {
      body.appendParagraph("");
    }

    switch (el.type) {
      case "heading": {
        const para = nextParagraph();
        para.setHeading(
          headingMap[el.level || 1] || DocumentApp.ParagraphHeading.HEADING1,
        );
        applySegments(para.editAsText(), el.content);
        break;
      }

      case "paragraph": {
        const para = nextParagraph();
        applySegments(para.editAsText(), el.content);
        break;
      }

      case "blockquote": {
        const para = nextParagraph();
        applySegments(para.editAsText(), el.content);
        // DocumentApp has no native "Quote" paragraph style, so we lean on
        // indent + italic + muted colour to signal "this is a quotation" in a
        // way that visually matches the preview's left-border treatment.
        para.setIndentStart(36);
        para.setIndentFirstLine(36);
        const t = para.editAsText();
        const raw = t.getText();
        // Apply formatting to the actual character range only. Calling the
        // argumentless setItalic(true) / setForegroundColor(...) would set the
        // paragraph's default text style, which Google Docs™ then inherits
        // into the next appended block (turning the whole following table
        // italic + grey — see the regression with the Features table).
        if (raw.length > 0) {
          t.setItalic(0, raw.length - 1, true);
          t.setForegroundColor(0, raw.length - 1, "#5f6368");
        }
        break;
      }

      case "code": {
        const codeText = el.content.map((s) => s.t).join("");
        appendCodeBlock(body, codeText);
        break;
      }

      case "image": {
        if (el.base64) {
          const blob = Utilities.newBlob(
            Utilities.base64Decode(el.base64),
            "image/png",
            "mermaid-diagram.png",
          );
          const image = body.appendImage(blob);
          fitImageToPage(image, body);
          if (el.mermaidSource) setMermaidAlt(image, el.mermaidSource);
        }
        break;
      }

      case "list": {
        if (el.items && el.items.length > 0) {
          appendListItems(body, el.items, 0, el.ordered ?? false, null);
        }
        break;
      }

      case "table": {
        if (el.rows && el.rows.length > 0) {
          const emptyRows = el.rows.map((row) => row.map(() => ""));
          const table = body.appendTable(emptyRows);
          for (let r = 0; r < table.getNumRows(); r++) {
            const row = table.getRow(r);
            for (let c = 0; c < row.getNumCells(); c++) {
              const cell = row.getCell(c);
              applySegments(cell.editAsText(), el.rows![r][c]);
              if (r === 0) {
                cell.editAsText().setBold(true);
                cell.setBackgroundColor("#f1f3f4");
              }
            }
          }
          table.setBorderColor("#dadce0");
          table.setBorderWidth(1);
        }
        break;
      }

      case "hr": {
        const para = body.appendParagraph("");
        para.appendHorizontalRule();
        break;
      }
    }

    prevType = el.type;
  }
};

export const importMarkdownAtCursor = (
  payloadJson: string,
): { success: boolean } => {
  let elements: ImportElement[];
  try {
    elements = timeServer("importmd:parse-payload", () =>
      JSON.parse(payloadJson),
    ) as ImportElement[];
  } catch {
    throw new Error("Invalid import payload. Please try again.");
  }
  const doc = DocumentApp.getActiveDocument();
  const { body } = getActiveBody(doc);

  timeServer("importmd:append-at-cursor", () => appendElements(body, elements));
  return { success: true };
};

export const importMarkdownReplace = (
  payloadJson: string,
): { success: boolean } => {
  let elements: ImportElement[];
  try {
    elements = timeServer("importmd:parse-payload", () =>
      JSON.parse(payloadJson),
    ) as ImportElement[];
  } catch {
    throw new Error("Invalid import payload. Please try again.");
  }
  const doc = DocumentApp.getActiveDocument();
  const { body } = getActiveBody(doc);
  let staleAnchor: GoogleAppsScript.Document.Element | null = null;

  const firstParagraph = timeServer("importmd:clear-old-content", () => {
    body.setText("");
    const first = body.getChild(0);
    if (first.getType() === DocumentApp.ElementType.PARAGRAPH) {
      return first.asParagraph();
    }
    staleAnchor = first;
    return undefined;
  });

  timeServer("importmd:append-replacement", () =>
    appendElements(body, elements, firstParagraph),
  );
  timeServer("importmd:cleanup-replacement-anchor", () => {
    if (staleAnchor && body.getNumChildren() > 1) {
      body.removeChild(staleAnchor);
    }
  });

  return { success: true };
};
