interface WarningToastOptions {
  title: string;
  message: string;
  linkHref?: string;
  linkText?: string;
}

export interface DialogToast {
  hide: () => void;
}

const getToastHost = (): HTMLElement => {
  let host = document.querySelector<HTMLElement>(".dialog-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "dialog-toast-host";
    document.body.appendChild(host);
  }
  return host;
};

export const showWarningToast = ({
  title,
  message,
  linkHref,
  linkText = "See limitation",
}: WarningToastOptions): DialogToast => {
  const host = getToastHost();
  host.textContent = "";

  const toast = document.createElement("div");
  toast.className = "dialog-toast dialog-toast-warn";
  toast.setAttribute("role", "status");

  const content = document.createElement("div");
  content.className = "dialog-toast-content";

  const titleEl = document.createElement("div");
  titleEl.className = "dialog-toast-title";
  titleEl.textContent = title;

  const messageEl = document.createElement("div");
  messageEl.className = "dialog-toast-message";
  messageEl.textContent = message + " ";

  if (linkHref) {
    const link = document.createElement("a");
    link.href = linkHref;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = linkText;
    messageEl.appendChild(link);
  }

  const closeButton = document.createElement("button");
  closeButton.className = "dialog-toast-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Dismiss notice");
  closeButton.textContent = "×";

  content.appendChild(titleEl);
  content.appendChild(messageEl);
  toast.appendChild(content);
  toast.appendChild(closeButton);
  host.appendChild(toast);

  const hide = (): void => {
    toast.remove();
    if (!host.childElementCount) host.remove();
  };

  closeButton.addEventListener("click", hide);

  return { hide };
};
