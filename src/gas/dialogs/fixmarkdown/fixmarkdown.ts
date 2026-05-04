import { bindLineNumbers } from "../../shared/scripts/code-editor";

const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const refreshInputLineNumbers = bindLineNumbers(inputEl);
const outputEl = document.getElementById("output")!;
const diffBeforeEl = document.getElementById("diffBefore")!;
const diffAfterEl = document.getElementById("diffAfter")!;
const statusEl = document.getElementById("status")!;
const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement;
const normalView = document.getElementById("normalView")!;
const diffView = document.getElementById("diffView")!;

let currentView = "normal";
let lastRaw = "";
let lastFixed = "";
let diffDirty = false;
const DIFF_CELL_LIMIT = 250_000;

const renderCurrentDiffIfNeeded = (): void => {
  if (!diffDirty || currentView !== "diff") return;
  renderDiff(lastRaw, lastFixed);
  diffDirty = false;
};

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentView = tab.dataset.view || "normal";
    normalView.classList.toggle("visible", currentView === "normal");
    diffView.classList.toggle("visible", currentView === "diff");
    renderCurrentDiffIfNeeded();
  });
});

const renderDiff = (oldText: string, newText: string): void => {
  if (!oldText.trim()) {
    diffBeforeEl.innerHTML = "";
    diffAfterEl.innerHTML = "";
    return;
  }

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  if (oldLines.length * newLines.length > DIFF_CELL_LIMIT) {
    diffBeforeEl.innerHTML =
      '<div class="diff-line">Diff too large to render safely. Use Fixed Output for the full result.</div>';
    diffAfterEl.innerHTML =
      '<div class="diff-line">Diff too large to render safely. Use Fixed Output for the full result.</div>';
    return;
  }

  const lcs = (a: string[], b: string[]): Array<{ oi: number; ni: number }> => {
    const m = a.length,
      n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const result: Array<{ oi: number; ni: number }> = [];
    let i = m,
      j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift({ oi: i - 1, ni: j - 1 });
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    return result;
  };

  const common = lcs(oldLines, newLines);

  const beforeFrag = document.createDocumentFragment();
  const afterFrag = document.createDocumentFragment();

  const makeLine = (num: number, text: string, cls: string): HTMLDivElement => {
    const div = document.createElement("div");
    div.className = "diff-line" + (cls ? " " + cls : "");
    const ln = document.createElement("span");
    ln.className = "diff-ln";
    ln.textContent = String(num);
    div.appendChild(ln);
    div.appendChild(document.createTextNode(text));
    return div;
  };

  const padLine = (): HTMLDivElement => {
    const div = document.createElement("div");
    div.className = "diff-line pad";
    div.textContent = " ";
    return div;
  };

  let oi = 0,
    ni = 0;

  for (const c of common) {
    const delCount = c.oi - oi;
    const addCount = c.ni - ni;

    for (let k = 0; k < delCount; k++)
      beforeFrag.appendChild(makeLine(oi + k + 1, oldLines[oi + k], "del"));
    for (let k = 0; k < addCount; k++)
      afterFrag.appendChild(makeLine(ni + k + 1, newLines[ni + k], "add"));

    const maxPad = Math.max(delCount, addCount);
    for (let k = delCount; k < maxPad; k++) beforeFrag.appendChild(padLine());
    for (let k = addCount; k < maxPad; k++) afterFrag.appendChild(padLine());

    beforeFrag.appendChild(makeLine(c.oi + 1, oldLines[c.oi], ""));
    afterFrag.appendChild(makeLine(c.ni + 1, newLines[c.ni], ""));

    oi = c.oi + 1;
    ni = c.ni + 1;
  }

  const tailDel = oldLines.length - oi;
  const tailAdd = newLines.length - ni;
  for (let k = 0; k < tailDel; k++)
    beforeFrag.appendChild(makeLine(oi + k + 1, oldLines[oi + k], "del"));
  for (let k = 0; k < tailAdd; k++)
    afterFrag.appendChild(makeLine(ni + k + 1, newLines[ni + k], "add"));
  const tailPad = Math.max(tailDel, tailAdd);
  for (let k = tailDel; k < tailPad; k++) beforeFrag.appendChild(padLine());
  for (let k = tailAdd; k < tailPad; k++) afterFrag.appendChild(padLine());

  diffBeforeEl.innerHTML = "";
  diffAfterEl.innerHTML = "";
  diffBeforeEl.appendChild(beforeFrag);
  diffAfterEl.appendChild(afterFrag);

  let syncing = false;
  diffBeforeEl.parentElement!.onscroll = () => {
    if (syncing) return;
    syncing = true;
    diffAfterEl.parentElement!.scrollTop =
      diffBeforeEl.parentElement!.scrollTop;
    diffAfterEl.parentElement!.scrollLeft =
      diffBeforeEl.parentElement!.scrollLeft;
    syncing = false;
  };
  diffAfterEl.parentElement!.onscroll = () => {
    if (syncing) return;
    syncing = true;
    diffBeforeEl.parentElement!.scrollTop =
      diffAfterEl.parentElement!.scrollTop;
    diffBeforeEl.parentElement!.scrollLeft =
      diffAfterEl.parentElement!.scrollLeft;
    syncing = false;
  };
};

const MERMAID_KEYWORDS = [
  "flowchart",
  "graph",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "erdiagram",
  "gantt",
  "pie",
  "gitgraph",
  "journey",
  "mindmap",
  "timeline",
  "sankey",
  "xychart",
  "block-beta",
  "packet-beta",
  "quadrantchart",
  "architecture-beta",
  "kanban",
  "requirementdiagram",
  "c4context",
  "c4container",
  "c4component",
  "c4dynamic",
  "c4deployment",
  "radar-beta",
];

const getMermaidKeyword = (text: string): string | null => {
  const first = text.trim().split(/[\s-]/)[0].toLowerCase();
  return (
    MERMAID_KEYWORDS.find(
      (kw) => first === kw || first === kw.replace("-", ""),
    ) ?? null
  );
};

/**
 * When Google Docs™ "Copy as Markdown" collapses newlines into spaces,
 * the body arrives as a single line where `\n` + indentation became
 * runs of 2+ spaces. Split those back into newlines.
 *
 * Only applied when the content is effectively a single non-trivial line
 * that starts with a recognized mermaid keyword.
 */
const restoreNewlines = (body: string): string => {
  body = body.replace(/\v/g, "\n");
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.length > 1) return body;

  const single = lines[0] ?? "";
  if (!getMermaidKeyword(single)) return body;

  const parts = single.split(/\s{2,}/);
  if (parts.length <= 1) return body;

  const result: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (getMermaidKeyword(trimmed) || result.length === 0) {
      result.push(trimmed);
    } else {
      result.push("    " + trimmed);
    }
  }
  return result.join("\n");
};

const TABLE_BLOCK_RE = /\|[^\n]*````[^\n]*````[^\n]*\|\s*\n\|\s*:?[-]+:?\s*\|/g;

const fixTableBlock = (match: string): string | null => {
  const row = match.split("\n")[0];
  let content = row.replace(/^\|\s*/, "").replace(/\s*\|$/, "");
  content = content.replace(/^`{4}\s*/, "").replace(/\s*`{4}$/, "");
  const m = content.match(/^```mermaid\s+([\s\S]*?)\s*```$/);
  if (!m) return null;
  const body = restoreNewlines(m[1]);
  return "```mermaid\n" + body + "\n```";
};

const BACKTICK_BLOCK_RE =
  /````\s*```mermaid\s*````[^\n]*\n([\s\S]*?)````\s*```\s*````/g;

const fixBacktickBlock = (_match: string, body: string): string => {
  const lines = body.split("\n").map((line) => {
    let l = line.replace(/\s{2,}$/, "");
    l = l.replace(/^(\s*)`(.*)`\s*$/, "$1$2");
    return l;
  });
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const joined = lines.join("\n");
  const restored = restoreNewlines(joined);
  return "```mermaid\n" + restored + "\n```";
};

const fixMarkdown = (input: string): { text: string; count: number } => {
  let fixed = input;
  let count = 0;

  fixed = fixed.replace(BACKTICK_BLOCK_RE, (match, body) => {
    count++;
    return fixBacktickBlock(match, body as string);
  });

  fixed = fixed.replace(TABLE_BLOCK_RE, (match) => {
    const result = fixTableBlock(match);
    if (result) {
      count++;
      return result;
    }
    return match;
  });

  return { text: fixed, count };
};

let debounceTimer: ReturnType<typeof setTimeout>;

inputEl.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(processInput, 150);
});

inputEl.addEventListener("paste", () => {
  setTimeout(() => {
    processInput();
  }, 0);
});

const processInput = (): void => {
  const raw = inputEl.value;

  if (!raw.trim()) {
    outputEl.textContent = "Output will appear here";
    outputEl.className = "output-content empty";
    diffBeforeEl.innerHTML = "";
    diffAfterEl.innerHTML = "";
    statusEl.textContent = "";
    statusEl.className = "status";
    copyBtn.disabled = true;
    lastRaw = "";
    lastFixed = "";
    diffDirty = false;
    return;
  }

  const { text, count } = fixMarkdown(raw);
  lastRaw = raw;
  lastFixed = text;

  outputEl.textContent = text;
  outputEl.className = "output-content";
  copyBtn.disabled = false;

  diffDirty = true;
  renderCurrentDiffIfNeeded();

  if (count > 0) {
    statusEl.textContent =
      "Fixed " + count + " mermaid block" + (count > 1 ? "s" : "");
    statusEl.className = "status ok";
  } else {
    statusEl.textContent = "No broken mermaid blocks detected";
    statusEl.className = "status warn";
  }
};

copyBtn.addEventListener("click", async () => {
  if (!lastFixed) return;
  try {
    await navigator.clipboard.writeText(lastFixed);
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy Fixed Markdown";
    }, 1500);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = lastFixed;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy Fixed Markdown";
    }, 1500);
  }
});

const pasteBtn = document.getElementById("pasteBtn")!;

pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      inputEl.value = text;
      refreshInputLineNumbers();
      processInput();
      return;
    }
  } catch {
    /* clipboard API blocked in sandboxed iframe */
  }
  inputEl.focus();
  statusEl.textContent = "Use Ctrl+V (or Cmd+V) to paste into the text area.";
  statusEl.className = "status";
});

inputEl.focus();
