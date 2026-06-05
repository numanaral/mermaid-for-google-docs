import { setDialogStatus } from "../../shared/scripts/dialog-status";
import { applyLimitNotices } from "../../shared/scripts/limit-warning-bar";
import {
  consumePngExportHitDimensionCap,
  svgToPngBase64,
} from "../../shared/scripts/svg-to-png";
import { escapeHtml } from "../../shared/scripts/escape-html";
import { loadMermaid } from "../../shared/scripts/mermaid-loader";
import {
  markBtn,
  setLoading,
  setBtnLoading,
} from "../../shared/scripts/card-helpers";
import { openDataUriInNewTab } from "../../shared/scripts/dom-utils";
import { wrapImgWithFullscreen } from "../../shared/scripts/fullscreen";
import { OPEN_SVG } from "../../shared/scripts/icons";
import { timeAsync } from "../../shared/scripts/perf";
import { mapWithConcurrency } from "../../shared/scripts/render-queue";
import { bindCodeEditor } from "../../shared/scripts/code-editor";

declare const mermaid: {
  render(id: string, src: string): Promise<{ svg: string }>;
};
declare const imageInfos: Array<{ source: string; childIndex: number }> | null;

const cardsEl = document.getElementById("cards")!;
const statusEl = document.getElementById("status")!;

const cardEls: HTMLElement[] = [];
const sources: string[] = [];
const renderedBase64s: Array<string | null> = [];
const latestRenderIds: number[] = [];
let activeImageInfos: NonNullable<typeof imageInfos> = imageInfos ?? [];
let mermaidReady = false;
let renderCounter = 0;
let debounceTimers: Record<number, number> = {};

const getSaveBtn = (index: number): HTMLButtonElement | null =>
  document.getElementById("save-" + index) as HTMLButtonElement | null;

const setSaveEnabled = (
  index: number,
  enabled: boolean,
  loading?: boolean,
): void => {
  const saveBtn = getSaveBtn(index);
  if (!saveBtn || saveBtn.classList.contains("done")) return;
  saveBtn.disabled = !enabled;
  setBtnLoading(saveBtn, loading ?? false);
};

const invalidateCardRender = (index: number): void => {
  renderedBase64s[index] = null;
  setSaveEnabled(index, false);
};

const buildCard = (
  index: number,
  info: NonNullable<typeof imageInfos>[0],
  thumbBase64: string | null,
): void => {
  const card = document.createElement("div");
  card.className = "card";
  cardEls[index] = card;
  sources[index] = info.source;
  renderedBase64s[index] = thumbBase64;

  const thumbSrc = thumbBase64 ? "data:image/png;base64," + thumbBase64 : "";

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
  rowHtml +=
    '<button class="btn btn-filled-secondary" id="save-' +
    index +
    '" style="display:none">Save &amp; Replace</button>';
  rowHtml += "</div></div>";

  const editorHtml =
    '<div class="editor-wrap" id="editor-wrap-' +
    index +
    '">' +
    '<div class="editor-inner">' +
    '<div class="inline-panels">' +
    '<div class="inline-panel">' +
    '<div class="inline-panel-label">Source</div>' +
    '<div class="code-editor">' +
    '<div class="code-line-numbers" aria-hidden="true">1</div>' +
    '<textarea id="src-' +
    index +
    '" spellcheck="false">' +
    escapeHtml(info.source) +
    "</textarea>" +
    "</div>" +
    "</div>" +
    '<div class="inline-panel">' +
    '<div class="inline-panel-label">Preview</div>' +
    '<div class="error-bar" id="err-' +
    index +
    '"></div>' +
    '<div class="preview-scroll" id="pv-' +
    index +
    '">' +
    (thumbSrc
      ? '<img src="data:image/png;base64,' + thumbBase64 + '" />'
      : '<span style="color:var(--outline)">Rendering...</span>') +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>";

  card.innerHTML = rowHtml + editorHtml;
  cardsEl.appendChild(card);

  const row = card.querySelector(".card-row")!;
  row.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".header-actions, .thumb-hover"))
      return;
    toggleEditor(index);
  });

  const thumbEl = card.querySelector(".thumb-hover");
  if (thumbEl) {
    thumbEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const src = thumbEl.getAttribute("data-src");
      if (src) openDataUriInNewTab(src);
    });
  }

  const textarea = document.getElementById(
    "src-" + index,
  ) as HTMLTextAreaElement;
  bindCodeEditor(textarea);
  textarea.addEventListener("input", () => {
    sources[index] = textarea.value;
    const saveBtn = document.getElementById(
      "save-" + index,
    ) as HTMLButtonElement;
    if (
      saveBtn.classList.contains("done") ||
      saveBtn.classList.contains("failed")
    ) {
      saveBtn.classList.remove("done", "failed");
      saveBtn.className = "btn btn-filled-secondary";
      saveBtn.textContent = "Save & Replace";
      saveBtn.onclick = null;
      invalidateCardRender(index);
      setSaveEnabled(index, false, true);
    } else if (!saveBtn.disabled) {
      invalidateCardRender(index);
      setSaveEnabled(index, false, true);
    }
    schedulePreview(index);
  });

  const saveBtn = document.getElementById("save-" + index) as HTMLButtonElement;
  saveBtn.addEventListener("click", () => doSave(index));

  const pvInitImg = card.querySelector<HTMLImageElement>(".preview-scroll img");
  if (pvInitImg) wrapImgWithFullscreen(pvInitImg);
};

const setInitialThumb = (index: number, base64: string): void => {
  renderedBase64s[index] = base64;
  const src = "data:image/png;base64," + base64;
  const row = cardEls[index]?.querySelector(".card-row");
  const spacer = row?.querySelector(".card-spacer");
  const pvEl = document.getElementById("pv-" + index);
  if (row && spacer && !row.querySelector(".thumb-hover")) {
    const thumbEl = document.createElement("div");
    thumbEl.className = "thumb-hover";
    thumbEl.setAttribute("data-src", src);
    thumbEl.innerHTML =
      '<img class="card-thumb" src="' +
      src +
      '" />' +
      '<div class="open-badge">' +
      OPEN_SVG +
      "</div>";
    thumbEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openDataUriInNewTab(src);
    });
    row.insertBefore(thumbEl, spacer);
  }
  if (pvEl && !cardEls[index]?.classList.contains("expanded")) {
    pvEl.innerHTML = '<img src="' + src + '" />';
    const img = pvEl.querySelector("img");
    if (img) wrapImgWithFullscreen(img);
  }
};

const toggleEditor = (index: number): void => {
  const card = cardEls[index];
  const wrap = document.getElementById("editor-wrap-" + index);
  const saveBtn = document.getElementById(
    "save-" + index,
  ) as HTMLButtonElement | null;
  if (!card || !wrap) return;

  const isOpen = card.classList.contains("expanded");
  card.classList.toggle("expanded", !isOpen);
  wrap.classList.toggle("visible", !isOpen);

  if (saveBtn) saveBtn.style.display = isOpen ? "none" : "";

  if (!isOpen) {
    setSaveEnabled(index, !!renderedBase64s[index]);
    schedulePreview(index, 0);
  }
};

const schedulePreview = (index: number, delay = 400): void => {
  if (debounceTimers[index]) clearTimeout(debounceTimers[index]);
  debounceTimers[index] = window.setTimeout(() => renderPreview(index), delay);
};

const renderPreview = async (index: number): Promise<void> => {
  const pvEl = document.getElementById("pv-" + index);
  const errEl = document.getElementById("err-" + index);
  if (!pvEl || !errEl) return;

  const src = sources[index].trim();
  if (!src) {
    pvEl.innerHTML =
      '<span style="color:var(--outline)">Enter Mermaid code</span>';
    errEl.textContent = "";
    invalidateCardRender(index);
    return;
  }
  if (!mermaidReady) {
    pvEl.innerHTML =
      '<span style="color:var(--outline)"><span class="spinner-inline"></span> Loading mermaid.js...</span>';
    errEl.textContent = "";
    setSaveEnabled(index, false);
    return;
  }

  setSaveEnabled(index, false, true);
  errEl.textContent = "";
  const requestId = ++renderCounter;
  latestRenderIds[index] = requestId;
  const id = "live-svg-" + index + "-" + requestId;
  try {
    const rendered = await mermaid.render(id, src);
    const base64 = await svgToPngBase64(rendered.svg);
    const hitCap = consumePngExportHitDimensionCap();
    if (latestRenderIds[index] !== requestId) return;
    if (base64) {
      renderedBase64s[index] = base64;
      pvEl.innerHTML = '<img src="data:image/png;base64,' + base64 + '" />';
      const img = pvEl.querySelector("img");
      if (img) wrapImgWithFullscreen(img);
      setSaveEnabled(index, true);
      applyLimitNotices(errEl, src, base64, hitCap);
    } else {
      invalidateCardRender(index);
      pvEl.innerHTML =
        '<span style="color:var(--outline)">Render failed</span>';
      errEl.className = "";
      errEl.textContent = "";
    }
  } catch (e) {
    if (latestRenderIds[index] !== requestId) return;
    invalidateCardRender(index);
    errEl.className = "error-bar";
    errEl.textContent = e instanceof Error ? e.message : String(e);
    const broken = document.getElementById(id);
    if (broken) broken.remove();
  }
};

const doSave = (idx: number): void => {
  const btn = document.getElementById("save-" + idx) as HTMLButtonElement;
  const base64 = renderedBase64s[idx];
  if (!base64) {
    setDialogStatus(statusEl, "Fix diagram errors before saving.", "error");
    btn.disabled = true;
    return;
  }
  setLoading(btn, "Saving...");
  disableCard(idx);

  const newSource = sources[idx];

  google.script.run
    .withSuccessHandler(() => {
      markBtn(btn, true);
      btn.textContent = "Saved ✓";
      enableCard(idx);

      const thumb = cardEls[idx].querySelector<HTMLImageElement>(".card-thumb");
      if (thumb) thumb.src = "data:image/png;base64," + base64;
      const thumbWrap = cardEls[idx].querySelector(".thumb-hover");
      if (thumbWrap)
        thumbWrap.setAttribute("data-src", "data:image/png;base64," + base64);
    })
    .withFailureHandler((err: Error) => {
      markBtn(btn, false);
      btn.textContent = "Retry Save";
      btn.disabled = false;
      btn.onclick = () => doSave(idx);
      enableCard(idx);
      setDialogStatus(statusEl, "Error: " + err, "error");
    })
    .replaceImageInPlace(base64, activeImageInfos[idx].childIndex, newSource);
};

const disableCard = (idx: number): void => {
  const card = cardEls[idx];
  if (!card) return;
  card.querySelectorAll<HTMLButtonElement>(".btn").forEach((b) => {
    b.disabled = true;
  });
};

const enableCard = (idx: number): void => {
  const card = cardEls[idx];
  if (!card) return;
  card.querySelectorAll<HTMLButtonElement>(".btn").forEach((b) => {
    if (b.classList.contains("done") || b.classList.contains("failed")) return;
    if (b.id === "save-" + idx) {
      b.disabled = !renderedBase64s[idx];
      return;
    }
    b.disabled = false;
  });
};

const fetchImageInfos = (): Promise<NonNullable<typeof imageInfos>> =>
  timeAsync(
    "editdiagrams:fetch-mermaid-images",
    () =>
      new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .getMermaidImagesForDialog();
      }),
  );

(async () => {
  if (!imageInfos) {
    statusEl.innerHTML =
      '<span class="spinner-inline" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--text-muted)"></span>' +
      "Scanning document for Mermaid diagrams...";
    try {
      activeImageInfos = await fetchImageInfos();
    } catch (e) {
      statusEl.textContent =
        "Failed to scan document: " +
        (e instanceof Error ? e.message : String(e));
      return;
    }
  }

  if (activeImageInfos.length === 0) {
    statusEl.textContent =
      "No Mermaid diagrams found. Only diagrams inserted by this add-on contain embedded Mermaid source.";
    return;
  }

  for (let i = 0; i < activeImageInfos.length; i++) {
    buildCard(i, activeImageInfos[i], null);
  }
  statusEl.textContent =
    activeImageInfos.length + " diagram(s) found. Loading previews...";

  try {
    await loadMermaid();
    mermaidReady = true;
  } catch {
    setDialogStatus(statusEl, "Failed to load mermaid.js.", "error");
    return;
  }

  statusEl.innerHTML =
    '<span class="spinner-inline" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--text-muted)"></span>' +
    "Rendering " +
    activeImageInfos.length +
    " preview(s)...";

  await mapWithConcurrency(activeImageInfos, 2, async (info, i) => {
    statusEl.innerHTML =
      '<span class="spinner-inline" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--text-muted)"></span>' +
      "Rendering preview " +
      (i + 1) +
      " of " +
      activeImageInfos.length +
      "...";

    let thumbBase64: string | null = null;

    try {
      const rendered = await timeAsync(`editdiagrams:mermaid-render:${i}`, () =>
        mermaid.render("edit-svg-" + i, info.source),
      );
      const base64 = await timeAsync(`editdiagrams:svg-to-png:${i}`, () =>
        svgToPngBase64(rendered.svg),
      );
      if (base64) thumbBase64 = base64;
    } catch {
      // thumbnail not available
    }

    if (thumbBase64 && sources[i] === info.source) {
      setInitialThumb(i, thumbBase64);
    }
  });

  statusEl.textContent =
    activeImageInfos.length + " diagram(s) found. Click a card to edit.";
})();
