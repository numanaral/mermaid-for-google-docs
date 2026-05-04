import { timeAsync } from "../../shared/scripts/perf";
import { yieldToUi } from "../../shared/scripts/render-queue";

interface InspChildInfo {
  idx: number;
  type: string;
  heading: string;
  glyph: string;
  nest: number;
  text: string;
  listId: string;
  indent: string;
}

declare const inspectorData: {
  numChildren: number;
  tabId: string;
  isFirstTab: boolean;
  children: InspChildInfo[];
} | null;

(() => {
  const esc = (s: string): string => {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  };

  const trunc = (s: string, n: number): string =>
    s.length > n ? s.substring(0, n) + "..." : s;

  const columns: Array<{ key: keyof InspChildInfo; label: string }> = [
    { key: "idx", label: "#" },
    { key: "type", label: "Type" },
    { key: "heading", label: "Heading" },
    { key: "glyph", label: "Glyph" },
    { key: "listId", label: "List" },
    { key: "nest", label: "Nest" },
    { key: "indent", label: "Indent (start/first)" },
    { key: "text", label: "Text" },
  ];

  const cellFor = (c: InspChildInfo, key: keyof InspChildInfo): string => {
    if (key === "idx") return String(c.idx);
    if (key === "nest") return c.nest >= 0 ? String(c.nest) : "";
    if (key === "text") return trunc(c.text, 200);
    return String(c[key] ?? "");
  };

  let copyRows: string[] = [];
  const render = async (
    data: NonNullable<typeof inspectorData>,
  ): Promise<void> => {
    document.getElementById("stat-children")!.textContent =
      "Children: " + data.numChildren;
    document.getElementById("stat-tab")!.textContent =
      "Tab: " + (data.isFirstTab ? "#1 (primary)" : data.tabId);

    copyRows = [];
    copyRows.push("| " + columns.map((c) => c.label).join(" | ") + " |");
    copyRows.push("| " + columns.map(() => "---").join(" | ") + " |");

    const root = document.getElementById("tc-docapp")!;
    root.innerHTML = "";
    const table = document.createElement("table");
    let h = "<tr>";
    for (const col of columns) h += "<th>" + col.label + "</th>";
    h += "</tr>";
    table.innerHTML = h;
    root.appendChild(table);

    const chunkSize = 75;
    for (let start = 0; start < data.children.length; start += chunkSize) {
      let rowsHtml = "";
      for (const c of data.children.slice(start, start + chunkSize)) {
        const cls =
          c.type === "TABLE"
            ? "table-row"
            : c.heading && c.heading !== "NORMAL"
              ? "heading"
              : "";
        rowsHtml += '<tr class="' + cls + '">';
        const row: string[] = [];
        for (const col of columns) {
          const raw = cellFor(c, col.key);
          const tdClass = col.key === "text" ? ' class="mono"' : "";
          rowsHtml += "<td" + tdClass + ">" + esc(raw) + "</td>";
          // Pipes inside markdown tables must be escaped so the row parses cleanly.
          const cell =
            col.key === "text"
              ? raw.replace(/\|/g, "\\|").replace(/\n/g, "\\n")
              : raw;
          row.push(cell);
        }
        rowsHtml += "</tr>";
        copyRows.push("| " + row.join(" | ") + " |");
      }
      table.insertAdjacentHTML("beforeend", rowsHtml);
      await yieldToUi();
    }
  };

  const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement;
  const defaultLabel = copyBtn.textContent ?? "Copy as Markdown";
  copyBtn.addEventListener("click", () => {
    const text = copyRows.join("\n");

    const onSuccess = (): void => {
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.textContent = defaultLabel;
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
  });

  if (inspectorData) {
    void render(inspectorData);
    return;
  }

  copyBtn.disabled = true;
  document.getElementById("stat-children")!.textContent = "Loading...";
  document.getElementById("tc-docapp")!.innerHTML =
    '<div style="padding:1rem;color:var(--text-muted)">Scanning document body...</div>';
  void timeAsync(
    "inspector:fetch-data",
    () =>
      new Promise<NonNullable<typeof inspectorData>>((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .getInspectorData();
      }),
  )
    .then(async (data) => {
      await render(data);
      copyBtn.disabled = false;
    })
    .catch((err: Error) => {
      document.getElementById("tc-docapp")!.innerHTML =
        '<div style="padding:1rem;color:var(--danger)">Failed to load inspector data: ' +
        esc(String(err)) +
        "</div>";
    });
})();
