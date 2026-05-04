const INDENT = "  ";

const TOP_LEVEL_DIRECTIVE =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|xychart-beta|sankey-beta|quadrantChart|block-beta|packet-beta|architecture-beta|kanban|requirementDiagram|C4(?:Context|Container|Component|Dynamic|Deployment))\b/i;

const lineStartFor = (value: string, offset: number): number =>
  value.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;

const lineEndFor = (value: string, offset: number): number => {
  const nextNewline = value.indexOf("\n", offset);
  return nextNewline === -1 ? value.length : nextNewline;
};

const notifyInput = (textarea: HTMLTextAreaElement): void => {
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

const numberValueRows = (value: string): string[] => value.split("\n");

const numericStyleValue = (
  style: CSSStyleDeclaration,
  property: keyof CSSStyleDeclaration,
  fallback = 0,
): number => {
  const value = style[property];
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolvedLineHeight = (style: CSSStyleDeclaration): number => {
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;
  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 20;
};

const configureMeasureMirror = (
  textarea: HTMLTextAreaElement,
  mirror: HTMLElement,
): { lineHeight: number; contentWidth: number } => {
  const style = getComputedStyle(textarea);
  const lineHeight = resolvedLineHeight(style);
  const paddingLeft = numericStyleValue(style, "paddingLeft");
  const paddingRight = numericStyleValue(style, "paddingRight");
  const contentWidth = Math.max(
    0,
    textarea.clientWidth - paddingLeft - paddingRight,
  );

  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: "-1",
    top: "0",
    left: "0",
    width: `${contentWidth}px`,
    padding: "0",
    border: "0",
    boxSizing: "content-box",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "normal",
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    tabSize: style.tabSize,
  });

  return { lineHeight, contentWidth };
};

const measuredLineHeight = (
  mirror: HTMLElement,
  line: string,
  lineHeight: number,
): number => {
  const measureLine = document.createElement("div");
  measureLine.textContent = line || "\u00a0";
  measureLine.style.minHeight = `${lineHeight}px`;
  mirror.appendChild(measureLine);
  const height = measureLine.getBoundingClientRect().height;
  mirror.textContent = "";
  return Math.max(lineHeight, Math.ceil(height));
};

const updateLineNumbers = (
  textarea: HTMLTextAreaElement,
  lineNumbers: HTMLElement | null,
  mirror: HTMLElement | null,
): void => {
  if (!lineNumbers || !mirror) return;

  const lines = numberValueRows(textarea.value);
  const { lineHeight, contentWidth } = configureMeasureMirror(textarea, mirror);
  const fragment = document.createDocumentFragment();

  lines.forEach((line, index) => {
    const row = document.createElement("div");
    row.textContent = String(index + 1);
    row.style.height =
      contentWidth > 0
        ? `${measuredLineHeight(mirror, line, lineHeight)}px`
        : `${lineHeight}px`;
    row.style.lineHeight = `${lineHeight}px`;
    fragment.appendChild(row);
  });

  lineNumbers.replaceChildren(fragment);
};

const currentLineIndent = (
  value: string,
  caret: number,
): { indent: string; extra: string } => {
  const lineStart = lineStartFor(value, caret);
  const line = value.slice(lineStart, caret);
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const trimmed = line.trim();
  const extra =
    indent === "" && TOP_LEVEL_DIRECTIVE.test(trimmed) ? INDENT : "";
  return { indent, extra };
};

const insertAtSelection = (
  textarea: HTMLTextAreaElement,
  text: string,
): void => {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value =
    textarea.value.slice(0, start) + text + textarea.value.slice(end);
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  notifyInput(textarea);
};

const indentSelection = (textarea: HTMLTextAreaElement): void => {
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;

  if (start === end || !value.slice(start, end).includes("\n")) {
    insertAtSelection(textarea, INDENT);
    return;
  }

  const blockStart = lineStartFor(value, start);
  const blockEnd = lineEndFor(value, end);
  const before = value.slice(0, blockStart);
  const selected = value.slice(blockStart, blockEnd);
  const after = value.slice(blockEnd);
  const indented = selected
    .split("\n")
    .map((line) => INDENT + line)
    .join("\n");

  textarea.value = before + indented + after;
  textarea.selectionStart = start + INDENT.length;
  textarea.selectionEnd = end + INDENT.length * selected.split("\n").length;
  notifyInput(textarea);
};

const outdentSelection = (textarea: HTMLTextAreaElement): void => {
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const blockStart = lineStartFor(value, start);
  const blockEnd = lineEndFor(value, end);
  const before = value.slice(0, blockStart);
  const selected = value.slice(blockStart, blockEnd);
  const after = value.slice(blockEnd);
  let removedBeforeStart = 0;
  let removedTotal = 0;
  let runningOffset = blockStart;

  const outdented = selected
    .split("\n")
    .map((line) => {
      const removeCount = line.startsWith(INDENT)
        ? INDENT.length
        : line.startsWith(" ")
          ? 1
          : 0;
      if (runningOffset < start) removedBeforeStart += removeCount;
      removedTotal += removeCount;
      runningOffset += line.length + 1;
      return line.slice(removeCount);
    })
    .join("\n");

  textarea.value = before + outdented + after;
  textarea.selectionStart = Math.max(blockStart, start - removedBeforeStart);
  textarea.selectionEnd = Math.max(textarea.selectionStart, end - removedTotal);
  notifyInput(textarea);
};

export const bindLineNumbers = (
  textarea: HTMLTextAreaElement,
): (() => void) => {
  const wrapper = textarea.closest<HTMLElement>(".code-editor");
  const lineNumbers =
    wrapper?.querySelector<HTMLElement>(".code-line-numbers") ?? null;
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.className = "code-line-measure";
  wrapper?.appendChild(mirror);

  const refresh = (): void => updateLineNumbers(textarea, lineNumbers, mirror);
  refresh();

  textarea.addEventListener("input", () => {
    refresh();
  });

  textarea.addEventListener("scroll", () => {
    if (lineNumbers) lineNumbers.scrollTop = textarea.scrollTop;
  });

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(refresh);
    observer.observe(textarea);
  } else {
    window.addEventListener("resize", refresh);
  }

  return refresh;
};

export const bindCodeEditor = (textarea: HTMLTextAreaElement): (() => void) => {
  const refreshLineNumbers = bindLineNumbers(textarea);

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        outdentSelection(textarea);
      } else {
        indentSelection(textarea);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const { indent, extra } = currentLineIndent(
        textarea.value,
        textarea.selectionStart,
      );
      insertAtSelection(textarea, "\n" + indent + extra);
    }
  });

  return refreshLineNumbers;
};
