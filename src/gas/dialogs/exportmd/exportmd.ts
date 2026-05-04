import { timeAsync } from "../../shared/scripts/perf";
import { bindLineNumbers } from "../../shared/scripts/code-editor";
import { showWarningToast } from "../../shared/scripts/toast";
import type { DialogToast } from "../../shared/scripts/toast";
import { LARGE_DOCUMENT_PERFORMANCE_MESSAGE } from "../../shared/scripts/constants";
import { composeLargeDocumentPerformanceUrl } from "../../shared/scripts/url-utils";

const PERFORMANCE_LIMITATION_URL =
  composeLargeDocumentPerformanceUrl("exportmd");

const exportOutput = document.getElementById("output") as HTMLTextAreaElement;
const exportOutputWrap = document.getElementById("output-wrap")!;
const refreshExportLineNumbers = bindLineNumbers(exportOutput);
const exportCopyBtn = document.getElementById("copy-btn") as HTMLButtonElement;
const exportStatus = document.getElementById("status")!;
const loadingEl = document.getElementById("loading")!;
const cbNotice = document.getElementById("checkbox-notice")!;
let slowExportToast: DialogToast | null = null;

const slowExportTimer = window.setTimeout(() => {
  slowExportToast = showWarningToast({
    title: "Still exporting...",
    message: LARGE_DOCUMENT_PERFORMANCE_MESSAGE,
    linkHref: PERFORMANCE_LIMITATION_URL,
  });
}, 5000);

const hideSlowExportNotice = (): void => {
  slowExportToast?.hide();
  slowExportToast = null;
};

timeAsync(
  "exportmd:get-export-markdown",
  () =>
    new Promise<string>((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .getExportMarkdown();
    }),
)
  .then((md: string) => {
    window.clearTimeout(slowExportTimer);
    hideSlowExportNotice();
    loadingEl.style.display = "none";
    exportOutputWrap.style.display = "";

    if (md) {
      exportOutput.value = md;
      refreshExportLineNumbers();
      exportCopyBtn.disabled = false;
      const lineCount = md.split("\n").length;
      const charCount = md.length;
      exportStatus.textContent = `${lineCount} lines, ${charCount} characters`;

      if (/^[ \t]*- \[ \] /m.test(md)) {
        cbNotice.style.display = "";
      }
    } else {
      refreshExportLineNumbers();
      exportStatus.textContent = "Document is empty.";
    }
  })
  .catch((err: Error) => {
    window.clearTimeout(slowExportTimer);
    hideSlowExportNotice();
    loadingEl.style.display = "none";
    exportOutputWrap.style.display = "";
    exportOutput.value = "";
    refreshExportLineNumbers();
    exportStatus.textContent = "Error: " + err;
  });

exportCopyBtn.addEventListener("click", () => {
  navigator.clipboard
    .writeText(exportOutput.value)
    .then(() => {
      exportCopyBtn.textContent = "Copied!";
      setTimeout(() => {
        exportCopyBtn.textContent = "Copy to Clipboard";
      }, 1500);
    })
    .catch(() => {
      exportOutput.select();
      document.execCommand("copy");
      exportCopyBtn.textContent = "Copied!";
      setTimeout(() => {
        exportCopyBtn.textContent = "Copy to Clipboard";
      }, 1500);
    });
});
