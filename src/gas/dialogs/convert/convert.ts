import { svgToPngBase64 } from "../../shared/scripts/svg-to-png";
import { loadMermaid } from "../../shared/scripts/mermaid-loader";
import { timeAsync } from "../../shared/scripts/perf";

declare const mermaid: {
  render(id: string, src: string): Promise<{ svg: string }>;
};
declare const mermaidSource: string;
declare const startIdx: number;
declare const endIdx: number;

const messageEl = document.getElementById("message")!;
const spinnerEl = document.getElementById("spinner")!;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;

const showError = (msg: string): void => {
  spinnerEl.style.display = "none";
  messageEl.className = "error-msg";
  messageEl.textContent = msg;
  closeBtn.style.display = "inline-block";
};

closeBtn.addEventListener("click", () => {
  google.script.host.close();
});

(async () => {
  try {
    await loadMermaid();
  } catch (e) {
    showError(
      "Failed to load mermaid.js: " +
        (e instanceof Error ? e.message : String(e)),
    );
    return;
  }

  messageEl.textContent = "Rendering diagram...";

  let rendered: { svg: string };
  try {
    rendered = await timeAsync("convert:mermaid-render", () =>
      mermaid.render("convert-svg", mermaidSource),
    );
  } catch (e) {
    showError("Render error: " + (e instanceof Error ? e.message : String(e)));
    return;
  }

  messageEl.textContent = "Converting to PNG...";

  let base64: string | null;
  try {
    base64 = await timeAsync("convert:svg-to-png", () =>
      svgToPngBase64(rendered.svg),
    );
  } catch {
    showError("PNG conversion failed.");
    return;
  }

  if (!base64) {
    showError("PNG conversion returned empty result.");
    return;
  }

  messageEl.textContent = "Replacing code with diagram...";

  google.script.run
    .withSuccessHandler(() => {
      google.script.host.close();
    })
    .withFailureHandler((err: Error) => {
      showError("Failed to insert: " + err);
    })
    .replaceDiagramText(base64, startIdx, endIdx, 0, mermaidSource);
})();
