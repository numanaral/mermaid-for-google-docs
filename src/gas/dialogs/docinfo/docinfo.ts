import { timeAsync } from "../../shared/scripts/perf";

declare const infoData: { rows: [string, string][] } | null;

(() => {
  const table = document.getElementById("info-table")!;
  const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement;
  let activeInfoData = infoData;

  const render = (data: NonNullable<typeof infoData>): void => {
    let html = "";
    for (const [key, value] of data.rows) {
      html += "<tr><th>" + key + "</th><td>" + value + "</td></tr>";
    }
    table.innerHTML = html;
  };

  const doCopy = (): void => {
    if (!activeInfoData) return;
    let text = "";
    for (const [key, value] of activeInfoData.rows) {
      text += key + ": " + value + "\n";
    }

    const onSuccess = (): void => {
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("copied");
      }, 1500);
    };

    navigator.clipboard
      .writeText(text)
      .then(onSuccess)
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        onSuccess();
      });
  };

  copyBtn.addEventListener("click", doCopy);

  if (activeInfoData) {
    render(activeInfoData);
    return;
  }

  copyBtn.disabled = true;
  table.innerHTML = "<tr><td>Loading document info...</td></tr>";
  void timeAsync(
    "docinfo:fetch-data",
    () =>
      new Promise<NonNullable<typeof infoData>>((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .getDocumentInfoData();
      }),
  )
    .then((data) => {
      activeInfoData = data;
      render(data);
      copyBtn.disabled = false;
    })
    .catch((err: Error) => {
      table.innerHTML =
        "<tr><td>Failed to load document info: " + String(err) + "</td></tr>";
    });
})();
