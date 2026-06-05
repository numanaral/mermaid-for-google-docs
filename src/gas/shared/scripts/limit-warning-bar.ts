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
  container.replaceChildren();
  if (!warnings.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  for (const text of warnings) {
    const el = document.createElement("div");
    el.className = "notice notice-warn limit-notice";
    el.textContent = text;
    container.appendChild(el);
  }
};
