import { collectDocsInsertLimitWarnings } from "./docs-insert-limits";

/** One notice-warn block per warning (same pattern as import checkbox notices). */
export const applyLimitNotices = (
  container: HTMLElement,
  mermaidSource: string,
  pngBase64: string | null,
  pngHitDimensionCap?: boolean,
): void => {
  const warnings = collectDocsInsertLimitWarnings(
    mermaidSource,
    pngBase64,
    pngHitDimensionCap,
  );
  if (!warnings.length) {
    container.replaceChildren();
    if (container.classList.contains("error-bar")) {
      container.className = "error-bar";
      container.textContent = "";
    } else {
      container.hidden = true;
    }
    return;
  }

  if (container.classList.contains("error-bar")) {
    container.className = "error-bar warn";
    container.textContent = warnings.join("\n\n");
    return;
  }

  container.hidden = false;
  container.replaceChildren();
  for (const text of warnings) {
    const el = document.createElement("div");
    el.className = "notice notice-warn limit-notice";
    el.textContent = text;
    container.appendChild(el);
  }
};
