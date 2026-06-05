export type DialogStatusKind = "normal" | "error";

export const setDialogStatus = (
  el: HTMLElement,
  message: string,
  kind: DialogStatusKind = "normal",
): void => {
  el.classList.toggle("status-error", kind === "error");
  el.textContent = message;
};

export const setDialogStatusHtml = (
  el: HTMLElement,
  html: string,
  kind: DialogStatusKind = "normal",
): void => {
  el.classList.toggle("status-error", kind === "error");
  el.innerHTML = html;
};
