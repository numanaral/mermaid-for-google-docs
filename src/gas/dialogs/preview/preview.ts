import { svgToPngBase64 } from "../../shared/scripts/svg-to-png";
import { escapeHtml } from "../../shared/scripts/escape-html";
import { loadMermaid } from "../../shared/scripts/mermaid-loader";
import {
  markBtn,
  setLoading,
  setBtnLoading,
} from "../../shared/scripts/card-helpers";
import { openDataUriInNewTab } from "../../shared/scripts/dom-utils";
import { OPEN_SVG } from "../../shared/scripts/icons";
import { timeAsync } from "../../shared/scripts/perf";
import { mapWithConcurrency } from "../../shared/scripts/render-queue";
import { showWarningToast } from "../../shared/scripts/toast";
import type { DialogToast } from "../../shared/scripts/toast";
import { LARGE_DOCUMENT_PERFORMANCE_MESSAGE } from "../../shared/scripts/constants";
import { composeLargeDocumentPerformanceUrl } from "../../shared/scripts/url-utils";

const PERFORMANCE_LIMITATION_URL =
  composeLargeDocumentPerformanceUrl("preview");

declare const mermaid: {
  render(id: string, src: string): Promise<{ svg: string }>;
};
declare const blockInfos: Array<{
  definition: string;
  startIdx: number;
  endIdx: number;
}> | null;

interface RenderResult {
  definition: string;
  startIdx: number;
  endIdx: number;
  base64: string | null;
  error: string | null;
}

const cardsEl = document.getElementById("cards")!;
const statusEl = document.getElementById("status")!;
const insertAllB = document.getElementById(
  "insert-all-btn",
) as HTMLButtonElement;
const replaceAllB = document.getElementById(
  "replace-all-btn",
) as HTMLButtonElement;

const results: RenderResult[] = [];
const cardEls: HTMLElement[] = [];
let slowBatchToast: DialogToast | null = null;

const showSlowBatchNotice = (title: string): number =>
  window.setTimeout(() => {
    slowBatchToast = showWarningToast({
      title,
      message: LARGE_DOCUMENT_PERFORMANCE_MESSAGE,
      linkHref: PERFORMANCE_LIMITATION_URL,
    });
  }, 5000);

const hideSlowBatchNotice = (): void => {
  slowBatchToast?.hide();
  slowBatchToast = null;
};

const buildCard = (index: number, result: RenderResult): void => {
  const card = document.createElement("div");
  card.className = "card";
  const existingCard = cardEls[index];
  cardEls[index] = card;

  const thumbSrc = result.base64
    ? "data:image/png;base64," + result.base64
    : "";

  let rowHtml =
    '<div class="card-row">' +
    '<span class="card-chevron">&#9654;</span>' +
    '<span class="card-num">' +
    (index + 1) +
    "</span>";

  if (thumbSrc) {
    rowHtml +=
      '<div class="thumb-hover" data-src="' +
      thumbSrc +
      '">' +
      '<img class="card-thumb" src="' +
      thumbSrc +
      '" />' +
      '<div class="open-badge">' +
      OPEN_SVG +
      "</div></div>";
  }

  rowHtml += '<span class="card-spacer"></span>';
  rowHtml += '<div class="header-actions">';

  if (result.base64) {
    rowHtml +=
      '<button class="btn btn-filled-primary" id="ins-' +
      index +
      '">Insert After</button>' +
      '<button class="btn btn-filled-secondary" id="rep-' +
      index +
      '">Replace</button>';
  } else if (result.error) {
    rowHtml += '<span class="card-status failed">Error</span>';
  } else {
    rowHtml +=
      '<span class="card-status"><span class="spinner-inline"></span>Rendering...</span>';
  }

  rowHtml += "</div></div>";

  let sourceHtml =
    '<div class="source-wrap" id="source-wrap-' +
    index +
    '"><pre class="source-block">' +
    escapeHtml(result.definition) +
    "</pre></div>";

  card.innerHTML = rowHtml + sourceHtml;
  if (existingCard) existingCard.replaceWith(card);
  else cardsEl.appendChild(card);

  const row = card.querySelector(".card-row")!;
  row.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".header-actions, .thumb-hover"))
      return;
    card.classList.toggle("expanded");
    const wrap = card.querySelector(".source-wrap");
    if (wrap) wrap.classList.toggle("visible");
  });

  const thumbEl = card.querySelector(".thumb-hover");
  if (thumbEl) {
    thumbEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const src = thumbEl.getAttribute("data-src");
      if (src) openDataUriInNewTab(src);
    });
  }

  const insBtn = document.getElementById(
    "ins-" + index,
  ) as HTMLButtonElement | null;
  const repBtn = document.getElementById(
    "rep-" + index,
  ) as HTMLButtonElement | null;

  if (insBtn)
    insBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      doInsert(index);
    });
  if (repBtn)
    repBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      doReplace(index);
    });
};

const doInsert = (idx: number): void => {
  const btn = document.getElementById("ins-" + idx) as HTMLButtonElement;
  setLoading(btn, "Inserting...");
  disableCard(idx);

  google.script.run
    .withSuccessHandler(() => {
      markBtn(btn, true);
      btn.textContent = "Inserted ✓";
      enableCard(idx);
      updateStatusCount();
    })
    .withFailureHandler((err: Error) => {
      markBtn(btn, false);
      btn.textContent = "Retry Insert";
      btn.disabled = false;
      btn.onclick = () => doInsert(idx);
      enableCard(idx);
      statusEl.textContent = "Error: " + err;
    })
    .insertDiagramAfterText(
      results[idx].base64,
      results[idx].startIdx,
      results[idx].endIdx,
      idx,
      results[idx].definition,
    );
};

const doReplace = (idx: number): void => {
  const btn = document.getElementById("rep-" + idx) as HTMLButtonElement;
  setLoading(btn, "Replacing...");
  disableCard(idx);

  google.script.run
    .withSuccessHandler(() => {
      markBtn(btn, true);
      btn.textContent = "Replaced ✓";
      const insBtn = document.getElementById(
        "ins-" + idx,
      ) as HTMLButtonElement | null;
      if (insBtn) {
        insBtn.disabled = true;
        insBtn.style.opacity = "0.3";
      }
      enableCard(idx);
      updateStatusCount();
    })
    .withFailureHandler((err: Error) => {
      markBtn(btn, false);
      btn.textContent = "Retry Replace";
      btn.disabled = false;
      btn.onclick = () => doReplace(idx);
      enableCard(idx);
      statusEl.textContent = "Error: " + err;
    })
    .replaceDiagramText(
      results[idx].base64,
      results[idx].startIdx,
      results[idx].endIdx,
      idx,
      results[idx].definition,
    );
};

const updateStatusCount = (): void => {
  let remaining = 0;
  for (let i = 0; i < cardEls.length; i++) {
    const rep = document.getElementById("rep-" + i) as HTMLButtonElement | null;
    if (rep && !rep.classList.contains("done")) remaining++;
  }
  if (remaining === 0) {
    statusEl.textContent = "All diagrams processed. Choose an action or close.";
  } else {
    statusEl.textContent =
      remaining + " of " + results.length + " diagram(s) remaining.";
  }
};

const disableCard = (idx: number): void => {
  const card = cardEls[idx];
  if (!card) return;
  card
    .querySelectorAll<HTMLButtonElement>(".header-actions .btn")
    .forEach((b) => {
      b.disabled = true;
    });
};

const enableCard = (idx: number): void => {
  const card = cardEls[idx];
  if (!card) return;
  card
    .querySelectorAll<HTMLButtonElement>(".header-actions .btn")
    .forEach((b) => {
      if (!b.classList.contains("done") && !b.classList.contains("failed"))
        b.disabled = false;
    });
};

interface BatchResult {
  index: number;
  ok: boolean;
  error?: string;
}

const doBatchDiagrams = (action: "insert" | "replace"): void => {
  const isReplace = action === "replace";
  const btnPrefix = isReplace ? "rep-" : "ins-";
  const serverFn = isReplace ? "batchReplaceDiagrams" : "batchInsertDiagrams";

  const queue: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (!results[i].base64) continue;
    const btn = document.getElementById(
      btnPrefix + i,
    ) as HTMLButtonElement | null;
    if (btn?.classList.contains("done")) continue;
    queue.push(i);
  }

  if (queue.length === 0) {
    statusEl.textContent =
      "All items have already been " +
      (isReplace ? "replaced" : "inserted") +
      ".";
    return;
  }

  queue.sort((a, b) => results[b].startIdx - results[a].startIdx);

  insertAllB.disabled = true;
  replaceAllB.disabled = true;
  const activeBtn = isReplace ? replaceAllB : insertAllB;
  activeBtn.innerHTML =
    '<span class="spinner-inline"></span>' +
    (isReplace ? "Replacing..." : "Inserting...");
  statusEl.innerHTML =
    '<span class="spinner-inline" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--text-muted)"></span>' +
    (isReplace ? "Replacing" : "Inserting") +
    " " +
    queue.length +
    " diagram(s)...";
  hideSlowBatchNotice();
  const slowNoticeTimer = showSlowBatchNotice(
    isReplace ? "Still converting..." : "Still inserting...",
  );

  for (const idx of queue) disableCard(idx);

  const items = queue.map((idx) => ({
    base64: results[idx].base64!,
    startIdx: results[idx].startIdx,
    endIdx: results[idx].endIdx,
    index: idx,
    definition: results[idx].definition,
  }));

  google.script.run
    .withSuccessHandler((batchResults: BatchResult[]) => {
      window.clearTimeout(slowNoticeTimer);
      hideSlowBatchNotice();
      let okCount = 0;
      let errCount = 0;
      for (const r of batchResults) {
        const insBtn = document.getElementById(
          "ins-" + r.index,
        ) as HTMLButtonElement | null;
        const repBtn = document.getElementById(
          "rep-" + r.index,
        ) as HTMLButtonElement | null;
        if (r.ok) {
          okCount++;
          if (isReplace) {
            if (repBtn) markBtn(repBtn, true);
            if (insBtn) {
              insBtn.disabled = true;
              insBtn.textContent = "N/A";
            }
          } else {
            if (insBtn) markBtn(insBtn, true);
          }
        } else {
          errCount++;
          const btn = isReplace ? repBtn : insBtn;
          if (btn) markBtn(btn, false);
        }
        enableCard(r.index);
      }
      updateStatusCount();
      if (errCount > 0) {
        statusEl.textContent = okCount + " succeeded, " + errCount + " failed.";
        activeBtn.textContent = isReplace ? "Replace All" : "Insert All";
        insertAllB.disabled = false;
        replaceAllB.disabled = false;
      } else {
        google.script.host.close();
      }
    })
    .withFailureHandler((err: Error) => {
      window.clearTimeout(slowNoticeTimer);
      hideSlowBatchNotice();
      statusEl.textContent = "Batch error: " + err;
      for (const idx of queue) enableCard(idx);
      insertAllB.disabled = false;
      replaceAllB.disabled = false;
      activeBtn.textContent = isReplace ? "Replace All" : "Insert All";
    })
    [serverFn](items);
};

insertAllB.addEventListener("click", () => doBatchDiagrams("insert"));
replaceAllB.addEventListener("click", () => doBatchDiagrams("replace"));

const fetchBlockInfos = (): Promise<NonNullable<typeof blockInfos>> =>
  timeAsync(
    "preview:fetch-mermaid-snippets",
    () =>
      new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .getMermaidSnippetsForPreview();
      }),
  );

(async () => {
  let blocks = blockInfos;
  setBtnLoading(insertAllB, true);
  setBtnLoading(replaceAllB, true);
  if (!blocks) {
    statusEl.innerHTML =
      '<span class="spinner-inline" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--text-muted)"></span>' +
      "Scanning document for Mermaid code blocks...";
    try {
      blocks = await fetchBlockInfos();
    } catch (e) {
      statusEl.textContent =
        "Failed to scan document: " +
        (e instanceof Error ? e.message : String(e));
      setBtnLoading(insertAllB, false);
      setBtnLoading(replaceAllB, false);
      return;
    }
  }

  if (blocks.length === 0) {
    statusEl.textContent =
      "No mermaid code blocks found. Add Mermaid code blocks or ```mermaid fences, then try again.";
    setBtnLoading(insertAllB, false);
    setBtnLoading(replaceAllB, false);
    return;
  }

  for (let i = 0; i < blocks.length; i++) {
    results[i] = {
      definition: blocks[i].definition,
      startIdx: blocks[i].startIdx,
      endIdx: blocks[i].endIdx,
      base64: null,
      error: null,
    };
    buildCard(i, results[i]);
  }

  try {
    await loadMermaid();
  } catch (e) {
    statusEl.textContent =
      "Failed to load mermaid.js: " +
      (e instanceof Error ? e.message : String(e));
    for (let i = 0; i < results.length; i++) {
      results[i].error = "Failed to load mermaid.js.";
      buildCard(i, results[i]);
    }
    setBtnLoading(insertAllB, false);
    setBtnLoading(replaceAllB, false);
    return;
  }

  statusEl.innerHTML =
    '<span class="spinner-inline" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--text-muted)"></span>' +
    "Rendering " +
    blocks.length +
    " diagram(s)...";

  let successCount = 0;

  await mapWithConcurrency(blocks, 2, async (info, i) => {
    statusEl.innerHTML =
      '<span class="spinner-inline" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--text-muted)"></span>' +
      "Rendering diagram " +
      (i + 1) +
      " of " +
      blocks.length +
      "...";

    const result: RenderResult = {
      definition: info.definition,
      startIdx: info.startIdx,
      endIdx: info.endIdx,
      base64: null,
      error: null,
    };

    try {
      const rendered = await timeAsync(`preview:mermaid-render:${i}`, () =>
        mermaid.render("mermaid-svg-" + i, info.definition),
      );
      const base64 = await timeAsync(`preview:svg-to-png:${i}`, () =>
        svgToPngBase64(rendered.svg),
      );
      if (base64) {
        result.base64 = base64;
        successCount++;
      } else {
        result.error = "SVG to PNG conversion failed.";
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }

    results[i] = result;
    buildCard(i, result);
  });

  statusEl.textContent =
    successCount +
    " of " +
    blocks.length +
    " diagram(s) rendered. Choose an action.";

  setBtnLoading(insertAllB, false);
  setBtnLoading(replaceAllB, false);
  if (successCount > 0) {
    insertAllB.disabled = false;
    replaceAllB.disabled = false;
  }
})();
