import { timeServer } from "./server-perf";
import { getActiveBody } from "./tab-utils";

export interface InspectorChildInfo {
  idx: number;
  type: string;
  heading: string;
  glyph: string;
  nest: number;
  text: string;
  listId: string;
  indent: string;
}

export interface InspectorData {
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

export function getInspectorData(): InspectorData {
  return timeServer("inspector:build-data", () => buildInspectorData());
}

export const debugDocStructure = (): void => {
  const template = HtmlService.createTemplateFromFile("Inspector");
  template.data = "null";
  const html = template.evaluate().setWidth(1100).setHeight(700);
  DocumentApp.getUi().showModalDialog(html, "Document Body Inspector");
};
