import { loadScript } from "../../shared/scripts/load-script";
import { svgToPngBase64 } from "../../shared/scripts/svg-to-png";
import { escapeHtml } from "../../shared/scripts/escape-html";
import { loadMermaid } from "../../shared/scripts/mermaid-loader";
import { wrapImgWithFullscreen } from "../../shared/scripts/fullscreen";
import { setBtnLoading } from "../../shared/scripts/card-helpers";
import { timeAsync } from "../../shared/scripts/perf";
import { yieldToUi } from "../../shared/scripts/render-queue";
import { bindLineNumbers } from "../../shared/scripts/code-editor";
import { showWarningToast } from "../../shared/scripts/toast";
import type { DialogToast } from "../../shared/scripts/toast";
import {
  LARGE_DOCUMENT_PERFORMANCE_MESSAGE,
  MARKED_CDN_URL,
} from "../../shared/scripts/constants";
import { composeLargeDocumentPerformanceUrl } from "../../shared/scripts/url-utils";

const PERFORMANCE_LIMITATION_URL =
  composeLargeDocumentPerformanceUrl("importmd");

declare const mermaid: {
  render(id: string, src: string): Promise<{ svg: string }>;
};

declare const marked: {
  lexer(src: string): Token[];
  parse(src: string): string;
};

interface Token {
  type: string;
  raw: string;
  text?: string;
  depth?: number;
  lang?: string;
  tokens?: Token[];
  items?: ListItem[];
  ordered?: boolean;
  header?: TableCell[];
  rows?: TableCell[][];
  href?: string;
  checked?: boolean;
  task?: boolean;
}

interface ListItem {
  type: string;
  raw: string;
  text: string;
  task: boolean;
  checked: boolean;
  tokens: Token[];
}

interface TableCell {
  text: string;
  tokens: Token[];
}

interface Seg {
  t: string;
  b?: boolean;
  i?: boolean;
  s?: boolean;
  c?: boolean;
  l?: string;
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

interface ImportListItem {
  text: Seg[];
  checked?: boolean;
  children?: ImportListItem[];
}

const sourceEl = document.getElementById("source") as HTMLTextAreaElement;
const refreshSourceLineNumbers = bindLineNumbers(sourceEl);
const previewEl = document.getElementById("preview-area")!;
const statusEl = document.getElementById("status")!;
const insertBtn = document.getElementById("insert-btn") as HTMLButtonElement;
const replaceBtn = document.getElementById("replace-btn") as HTMLButtonElement;
const importNotice = document.getElementById("import-notice")!;
const checkboxNoticeItem = importNotice.querySelector<HTMLElement>(
  '[data-notice="checkbox"]',
)!;
const codeblockNoticeItem = importNotice.querySelector<HTMLElement>(
  '[data-notice="codeblock"]',
)!;
let lastNoticeKey = "";
const updateImportNotice = (
  hasCheckbox: boolean,
  hasCodeblock: boolean,
): void => {
  const key = (hasCheckbox ? "c" : "") + (hasCodeblock ? "b" : "");
  if (key === lastNoticeKey) return;
  lastNoticeKey = key;
  importNotice.style.display = key ? "" : "none";
  checkboxNoticeItem.style.display = hasCheckbox ? "" : "none";
  codeblockNoticeItem.style.display = hasCodeblock ? "" : "none";
};

let markedReady = false;
let mermaidReady = false;
let mermaidLoadError = "";
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let parsedTokens: Token[] = [];
let mermaidImages: Map<number, string> = new Map();
let renderCounter = 0;
let activePreviewRun = 0;
let slowImportToast: DialogToast | null = null;

const inlineToSegments = (
  tokens: Token[],
  inherited: Omit<Seg, "t"> = {},
): Seg[] => {
  const segs: Seg[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "text":
        if (t.text) segs.push({ t: t.text, ...inherited });
        break;
      case "codespan":
        if (t.text) segs.push({ t: t.text, ...inherited, c: true });
        break;
      case "strong":
        segs.push(
          ...inlineToSegments(t.tokens ?? [], { ...inherited, b: true }),
        );
        break;
      case "em":
        segs.push(
          ...inlineToSegments(t.tokens ?? [], { ...inherited, i: true }),
        );
        break;
      case "del":
        segs.push(
          ...inlineToSegments(t.tokens ?? [], { ...inherited, s: true }),
        );
        break;
      case "link":
        segs.push(
          ...inlineToSegments(t.tokens ?? [], {
            ...inherited,
            l: t.href ?? "",
          }),
        );
        break;
      default:
        if (t.text) segs.push({ t: t.text, ...inherited });
        else if (t.raw) segs.push({ t: t.raw, ...inherited });
        break;
    }
  }
  return segs;
};

const renderInlineTokens = (tokens: Token[]): string => {
  let html = "";
  for (const t of tokens) {
    switch (t.type) {
      case "text":
        html += escapeHtml(t.text ?? "");
        break;
      case "codespan":
        html += `<code>${escapeHtml(t.text ?? "")}</code>`;
        break;
      case "strong":
        html += `<strong>${renderInlineTokens(t.tokens ?? [])}</strong>`;
        break;
      case "em":
        html += `<em>${renderInlineTokens(t.tokens ?? [])}</em>`;
        break;
      case "del":
        html += `<del>${renderInlineTokens(t.tokens ?? [])}</del>`;
        break;
      case "link":
        html += `<a href="${escapeHtml(t.href ?? "")}" target="_blank">${renderInlineTokens(t.tokens ?? [])}</a>`;
        break;
      case "image":
        html += `<img src="${escapeHtml(t.href ?? "")}" alt="${escapeHtml(t.text ?? "")}" style="max-width:100%">`;
        break;
      case "br":
        html += "<br>";
        break;
      default:
        html += escapeHtml(t.raw);
    }
  }
  return html;
};

// Renders a list token but swaps marked's GFM checkbox `<input>` elements for
// literal `[ ]` / `[x] ` text so the preview matches exactly what the import
// will place in the document. Post-processing marked's output is safer than
// pre-processing the markdown source: marked@17 emits a single, predictable
// shape for task items so the regex stays trivial and isn't trying to
// reimplement the parser.
const renderListHtml = (list: Token): string => {
  return marked
    .parse(list.raw)
    .replace(/<li[^>]*>\s*<input\s+([^>]*)>\s*/g, (match, attrs: string) => {
      if (!/type="checkbox"/.test(attrs)) return match;
      return `<li>${/\bchecked\b/.test(attrs) ? "[x] " : "[ ] "}`;
    });
};

const renderTokenToHtml = (token: Token, idx: number): string => {
  switch (token.type) {
    case "heading":
      return `<h${token.depth}>${renderInlineTokens(token.tokens ?? [])}</h${token.depth}>`;
    case "paragraph":
      return `<p>${renderInlineTokens(token.tokens ?? [])}</p>`;
    case "code": {
      if (token.lang === "mermaid") {
        return `<div class="mermaid-diagram" id="mermaid-slot-${idx}"><div class="mermaid-rendering"><span class="spinner-inline"></span> Rendering diagram...</div></div>`;
      }
      return `<pre><code>${escapeHtml(token.text ?? "")}</code></pre>`;
    }
    case "list":
      return renderListHtml(token);
    case "table": {
      const headerCells = (token.header ?? [])
        .map((cell) => `<th>${renderInlineTokens(cell.tokens)}</th>`)
        .join("");
      const bodyRows = (token.rows ?? [])
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${renderInlineTokens(cell.tokens)}</td>`).join("")}</tr>`,
        )
        .join("");
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    }
    case "blockquote": {
      let inner = "";
      for (const child of token.tokens ?? []) {
        inner += renderTokenToHtml(child, idx);
      }
      return `<blockquote>${inner}</blockquote>`;
    }
    case "hr":
      return "<hr>";
    case "space":
      return "";
    default:
      return `<p>${escapeHtml(token.raw)}</p>`;
  }
};

const stripCheckboxPrefix = (segs: Seg[]): Seg[] => {
  if (segs.length === 0) return segs;
  const first = segs[0];
  const stripped = first.t.replace(/^\[[ xX]\]\s*/, "");
  if (stripped !== first.t) {
    if (!stripped) return segs.slice(1);
    return [{ ...first, t: stripped }, ...segs.slice(1)];
  }
  const joined = segs.map((s) => s.t).join("");
  if (/^\[[ xX]\]\s/.test(joined)) {
    let toStrip = joined.match(/^\[[ xX]\]\s*/)?.[0].length ?? 0;
    const result: Seg[] = [];
    for (const seg of segs) {
      if (toStrip <= 0) {
        result.push(seg);
      } else if (toStrip >= seg.t.length) {
        toStrip -= seg.t.length;
      } else {
        result.push({ ...seg, t: seg.t.slice(toStrip) });
        toStrip = 0;
      }
    }
    return result;
  }
  return segs;
};

const flattenListItems = (
  items: ListItem[],
  ordered: boolean,
  depth: number,
): ImportListItem[] => {
  const result: ImportListItem[] = [];
  for (const item of items) {
    let segs: Seg[] = [];
    let children: ImportListItem[] | undefined;

    for (const token of item.tokens) {
      if (token.type === "text" && token.tokens) {
        segs.push(...inlineToSegments(token.tokens));
      } else if (token.type === "text") {
        if (token.text) segs.push({ t: token.text.replace(/\n$/, "") });
      } else if (token.type === "list") {
        children = flattenListItems(
          token.items ?? [],
          token.ordered ?? false,
          depth + 1,
        );
      } else if (token.type !== "space") {
        segs.push(...inlineToSegments([token]));
      }
    }

    if (item.task) {
      segs = stripCheckboxPrefix(segs);
    }

    result.push({
      text: segs,
      checked: item.task ? item.checked : undefined,
      children: children && children.length > 0 ? children : undefined,
    });
  }
  return result;
};

const tokenToPayload = (token: Token, idx: number): ImportElement | null => {
  switch (token.type) {
    case "heading":
      return {
        type: "heading",
        content: inlineToSegments(token.tokens ?? []),
        level: token.depth,
      };
    case "paragraph":
      return {
        type: "paragraph",
        content: inlineToSegments(token.tokens ?? []),
      };
    case "code": {
      if (token.lang === "mermaid") {
        const base64 = mermaidImages.get(idx);
        if (base64) {
          return {
            type: "image",
            content: [],
            base64,
            mermaidSource: token.text,
          };
        }
        return { type: "code", content: [{ t: token.text ?? "" }] };
      }
      return { type: "code", content: [{ t: token.text ?? "" }] };
    }
    case "list": {
      const ord = token.ordered ?? false;
      return {
        type: "list",
        content: [],
        ordered: ord,
        items: flattenListItems(token.items ?? [], ord, 0),
      };
    }
    case "table": {
      const rows = [
        (token.header ?? []).map((cell) => inlineToSegments(cell.tokens)),
        ...(token.rows ?? []).map((row) =>
          row.map((cell) => inlineToSegments(cell.tokens)),
        ),
      ];
      return { type: "table", content: [], rows };
    }
    case "blockquote": {
      const segs: Seg[] = [];
      const children = token.tokens ?? [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === "paragraph") {
          if (i > 0) segs.push({ t: "\n" });
          segs.push(...inlineToSegments(child.tokens ?? []));
        } else if (child.type !== "space") {
          if (i > 0) segs.push({ t: "\n" });
          segs.push({ t: child.raw.trim() });
        }
      }
      return { type: "blockquote", content: segs };
    }
    case "hr":
      return { type: "hr", content: [] };
    case "space":
      return null;
    default:
      if (token.raw.trim()) {
        return { type: "paragraph", content: [{ t: token.raw.trim() }] };
      }
      return null;
  }
};

const TASK_ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s/m;

const hasNonMermaidCodeBlock = (tokens: Token[] | undefined): boolean => {
  if (!tokens) return false;
  for (const t of tokens) {
    if (t.type === "code" && t.lang !== "mermaid") return true;
    if (t.tokens && hasNonMermaidCodeBlock(t.tokens)) return true;
    if (t.items) {
      for (const item of t.items) {
        if (hasNonMermaidCodeBlock(item.tokens as Token[] | undefined))
          return true;
      }
    }
  }
  return false;
};

const getMermaidTokenIndexes = (tokens: Token[]): number[] => {
  const indexes: number[] = [];
  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    if (token.type === "code" && token.lang === "mermaid") indexes.push(idx);
  }
  return indexes;
};

const renderPreview = async (): Promise<void> => {
  const runId = ++activePreviewRun;
  const md = sourceEl.value;
  if (!md.trim()) {
    previewEl.innerHTML =
      '<div class="placeholder">Paste markdown to see a preview.</div>';
    insertBtn.disabled = true;
    replaceBtn.disabled = true;
    // scheduleRender flips the buttons into the loading/spinner state
    // on every keystroke; clear it here so deleting all text doesn't
    // leave the buttons stuck pending forever.
    setBtnLoading(insertBtn, false);
    setBtnLoading(replaceBtn, false);
    updateImportNotice(false, false);
    statusEl.textContent = "Ready.";
    return;
  }

  if (!markedReady || typeof marked === "undefined" || !marked.lexer) {
    statusEl.innerHTML =
      '<span class="spinner-inline"></span> Loading markdown parser...';
    insertBtn.disabled = true;
    replaceBtn.disabled = true;
    setBtnLoading(insertBtn, false);
    setBtnLoading(replaceBtn, false);
    return;
  }

  parsedTokens = await timeAsync("importmd:marked-lexer", async () =>
    marked.lexer(md),
  );
  mermaidImages = new Map();

  // Non-mermaid fenced code blocks get rendered server-side as single-cell
  // tables (see import-md.ts → appendCodeBlock). Walk the full token tree
  // so code blocks nested inside list items and blockquotes are still caught.
  updateImportNotice(
    TASK_ITEM_RE.test(md),
    hasNonMermaidCodeBlock(parsedTokens),
  );

  const htmlParts: string[] = [];

  await timeAsync("importmd:build-preview-html", async () => {
    for (let idx = 0; idx < parsedTokens.length; idx++) {
      htmlParts.push(renderTokenToHtml(parsedTokens[idx], idx));
    }
  });

  previewEl.innerHTML = `<div class="md-preview">${htmlParts.join("")}</div>`;
  insertBtn.disabled = true;
  replaceBtn.disabled = true;
  setBtnLoading(insertBtn, false);
  setBtnLoading(replaceBtn, false);

  const mermaidIndexes = getMermaidTokenIndexes(parsedTokens);
  if (mermaidIndexes.length === 0) {
    statusEl.textContent = "Preview ready. No mermaid diagrams found.";
    insertBtn.disabled = false;
    replaceBtn.disabled = false;
    return;
  }

  if (!mermaidReady) {
    if (mermaidLoadError) {
      for (const idx of mermaidIndexes) {
        const slot = document.getElementById(`mermaid-slot-${idx}`);
        if (slot) {
          slot.innerHTML =
            '<div class="mermaid-error">Diagram preview unavailable; this block will import as code.</div>';
        }
      }
      statusEl.textContent = mermaidLoadError;
      insertBtn.disabled = false;
      replaceBtn.disabled = false;
      return;
    }
    statusEl.innerHTML =
      '<span class="spinner-inline"></span> Preview ready. Loading mermaid diagrams...';
    return;
  }

  setBtnLoading(insertBtn, true);
  setBtnLoading(replaceBtn, true);
  statusEl.innerHTML =
    '<span class="spinner-inline"></span> Rendering mermaid diagrams...';
  let renderedCount = 0;

  await timeAsync("importmd:render-mermaid-diagrams", async () => {
    for (let i = 0; i < mermaidIndexes.length; i++) {
      if (runId !== activePreviewRun) return;
      const idx = mermaidIndexes[i];
      const token = parsedTokens[idx];

      const slot = document.getElementById(`mermaid-slot-${idx}`);
      if (!slot) continue;

      statusEl.innerHTML =
        '<span class="spinner-inline"></span>' +
        `Rendering diagram ${i + 1} of ${mermaidIndexes.length}...`;

      renderCounter++;
      const renderId = "import-svg-" + renderCounter;

      try {
        const result = await mermaid.render(renderId, token.text ?? "");
        const base64 = await svgToPngBase64(result.svg);
        if (runId !== activePreviewRun) return;
        if (base64) {
          mermaidImages.set(idx, base64);
          slot.innerHTML = `<img src="data:image/png;base64,${base64}" />`;
          const img = slot.querySelector("img");
          if (img) wrapImgWithFullscreen(img);
          renderedCount++;
        } else {
          slot.innerHTML =
            '<div class="mermaid-error">Failed to render diagram.</div>';
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        slot.innerHTML = `<div class="mermaid-error">Diagram error: ${escapeHtml(msg)}</div>`;
      }

      const leftover = document.getElementById("d" + renderId);
      if (leftover) leftover.remove();
      await yieldToUi();
    }
  });

  if (runId !== activePreviewRun) return;

  statusEl.textContent = `Rendered ${renderedCount}/${mermaidIndexes.length} diagram${mermaidIndexes.length > 1 ? "s" : ""}. Ready to import.`;

  insertBtn.disabled = false;
  replaceBtn.disabled = false;
  setBtnLoading(insertBtn, false);
  setBtnLoading(replaceBtn, false);
};

const scheduleRender = (): void => {
  if (renderTimer) clearTimeout(renderTimer);
  if (!insertBtn.disabled) {
    insertBtn.disabled = true;
    replaceBtn.disabled = true;
    setBtnLoading(insertBtn, true);
    setBtnLoading(replaceBtn, true);
  }
  renderTimer = setTimeout(renderPreview, 500);
};

sourceEl.addEventListener("input", scheduleRender);

const showSlowImportNotice = (): number =>
  window.setTimeout(() => {
    slowImportToast = showWarningToast({
      title: "Still working...",
      message: LARGE_DOCUMENT_PERFORMANCE_MESSAGE,
      linkHref: PERFORMANCE_LIMITATION_URL,
    });
  }, 5000);

const hideSlowImportNotice = (): void => {
  slowImportToast?.hide();
  slowImportToast = null;
};

const buildImportPayload = (): ImportElement[] => {
  const elements: ImportElement[] = [];
  for (let idx = 0; idx < parsedTokens.length; idx++) {
    const el = tokenToPayload(parsedTokens[idx], idx);
    if (el) elements.push(el);
  }
  return elements;
};

insertBtn.addEventListener("click", () => {
  const payload = buildImportPayload();
  if (payload.length === 0) return;

  insertBtn.disabled = true;
  insertBtn.innerHTML = '<span class="spinner-inline"></span>Importing...';
  replaceBtn.disabled = true;
  statusEl.textContent = "Importing markdown into document...";
  hideSlowImportNotice();
  const slowNoticeTimer = showSlowImportNotice();

  void timeAsync(
    "importmd:server-insert-roundtrip",
    () =>
      new Promise<void>((resolve, reject) => {
        google.script.run
          .withSuccessHandler(() => resolve())
          .withFailureHandler(reject)
          .importMarkdownAtCursor(JSON.stringify(payload));
      }),
  )
    .then(() => {
      window.clearTimeout(slowNoticeTimer);
      hideSlowImportNotice();
      google.script.host.close();
    })
    .catch((err: Error) => {
      window.clearTimeout(slowNoticeTimer);
      hideSlowImportNotice();
      insertBtn.textContent = "Insert into Document";
      insertBtn.classList.remove("done", "failed");
      insertBtn.className = "btn btn-filled-primary";
      insertBtn.disabled = false;
      replaceBtn.disabled = false;
      statusEl.textContent = "Error: " + err;
    });
});

replaceBtn.addEventListener("click", () => {
  const payload = buildImportPayload();
  if (payload.length === 0) return;

  replaceBtn.disabled = true;
  replaceBtn.innerHTML = '<span class="spinner-inline"></span>Replacing...';
  insertBtn.disabled = true;
  statusEl.textContent = "Replacing document content...";
  hideSlowImportNotice();
  const slowNoticeTimer = showSlowImportNotice();

  void timeAsync(
    "importmd:server-replace-roundtrip",
    () =>
      new Promise<void>((resolve, reject) => {
        google.script.run
          .withSuccessHandler(() => resolve())
          .withFailureHandler(reject)
          .importMarkdownReplace(JSON.stringify(payload));
      }),
  )
    .then(() => {
      window.clearTimeout(slowNoticeTimer);
      hideSlowImportNotice();
      google.script.host.close();
    })
    .catch((err: Error) => {
      window.clearTimeout(slowNoticeTimer);
      hideSlowImportNotice();
      replaceBtn.textContent = "Replace Document";
      replaceBtn.className = "btn btn-filled-secondary";
      replaceBtn.disabled = false;
      insertBtn.disabled = false;
      statusEl.textContent = "Error: " + err;
    });
});

const pasteBtn = document.getElementById("pasteBtn")!;
pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      sourceEl.value = text;
      refreshSourceLineNumbers();
      renderPreview();
      return;
    }
  } catch {
    /* clipboard API blocked in sandboxed iframe */
  }
  sourceEl.focus();
  statusEl.textContent = "Use Ctrl+V (or Cmd+V) to paste into the text area.";
});

(async () => {
  const mermaidPromise = loadMermaid()
    .then(() => {
      mermaidReady = true;
      if (sourceEl.value.trim()) void renderPreview();
    })
    .catch((e: Error) => {
      mermaidLoadError =
        "Mermaid diagrams unavailable: " +
        (e instanceof Error ? e.message : String(e));
      statusEl.textContent = mermaidLoadError;
      if (sourceEl.value.trim() && markedReady) void renderPreview();
    });

  try {
    await loadScript(MARKED_CDN_URL, { label: "marked:script" });
    markedReady = true;
    if (sourceEl.value.trim()) {
      await renderPreview();
    } else {
      statusEl.textContent = "Ready — paste markdown to preview.";
    }
  } catch (e) {
    statusEl.textContent =
      "Failed to load markdown parser: " +
      (e instanceof Error ? e.message : String(e));
  }

  void mermaidPromise;
})();
