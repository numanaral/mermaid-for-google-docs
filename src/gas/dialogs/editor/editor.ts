import { applyLimitNotices } from "../../shared/scripts/limit-warning-bar";
import {
  consumePngExportHitDimensionCap,
  svgToPngBase64,
} from "../../shared/scripts/svg-to-png";
import { loadMermaid } from "../../shared/scripts/mermaid-loader";
import { wrapImgWithFullscreen } from "../../shared/scripts/fullscreen";
import { setBtnLoading } from "../../shared/scripts/card-helpers";
import { timeAsync } from "../../shared/scripts/perf";
import { bindCodeEditor } from "../../shared/scripts/code-editor";

declare const mermaid: {
  render(id: string, src: string): Promise<{ svg: string }>;
};
declare const initialSource: string;
declare const imageChildIndex: number;

type FocusTrapWindow = Window & {
  __dialogFocusTrapDone?: boolean;
};

const sourceEl = document.getElementById("source") as HTMLTextAreaElement;
const previewEl = document.getElementById("preview-area")!;
const errorBar = document.getElementById("error-bar")!;
const limitNoticesEl = document.getElementById("limit-notices")!;
const statusEl = document.getElementById("status")!;
const insertBtn = document.getElementById("insert-btn") as HTMLButtonElement;
const replaceBtn = document.getElementById("replace-btn") as HTMLButtonElement;
const tplBtn = document.getElementById("tpl-btn") as HTMLButtonElement;
const tplRow = document.getElementById("tpl-row")!;

let currentBase64: string | null = null;
let mermaidReady = false;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let renderCounter = 0;

const setActionButtonsEnabled = (enabled: boolean, loading?: boolean): void => {
  insertBtn.disabled = !enabled;
  if (imageChildIndex >= 0) replaceBtn.disabled = !enabled;
  const showSpinner = loading ?? !enabled;
  setBtnLoading(insertBtn, showSpinner);
  if (imageChildIndex >= 0) setBtnLoading(replaceBtn, showSpinner);
};

const invalidateRenderedState = (statusText?: string): void => {
  currentBase64 = null;
  setActionButtonsEnabled(false, !!statusText);
  if (statusText) {
    statusEl.innerHTML = '<span class="spinner-inline"></span> ' + statusText;
  }
};

const waitForFocusTrapDone = async (): Promise<void> => {
  const focusTrapWindow = window as FocusTrapWindow;
  if (focusTrapWindow.__dialogFocusTrapDone !== false) return;
  await new Promise<void>((resolve) => {
    const onDone = (): void => {
      window.removeEventListener("dialog-focus-trap-done", onDone);
      resolve();
    };
    window.addEventListener("dialog-focus-trap-done", onDone, { once: true });
  });
};

const focusSourceWhenReady = async (): Promise<void> => {
  await waitForFocusTrapDone();
  sourceEl.focus({ preventScroll: true });
  const pos = sourceEl.value.length;
  sourceEl.selectionStart = sourceEl.selectionEnd = pos;
};

if (imageChildIndex >= 0) {
  replaceBtn.style.display = "";
  insertBtn.style.display = "none";
}

if (initialSource) {
  sourceEl.value = initialSource;
}
const refreshSourceLineNumbers = bindCodeEditor(sourceEl);

const TEMPLATES: Record<string, string> = {
  flowchart:
    "flowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Do something]\n    B -->|No| D[Do something else]\n    C --> E[End]\n    D --> E",
  sequence:
    "sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello Bob\n    B-->>A: Hi Alice\n    A->>B: How are you?\n    B-->>A: Great!",
  class:
    "classDiagram\n    class Animal {\n        +String name\n        +int age\n        +makeSound()\n    }\n    class Dog {\n        +fetch()\n    }\n    class Cat {\n        +purr()\n    }\n    Animal <|-- Dog\n    Animal <|-- Cat",
  state:
    "stateDiagram-v2\n    [*] --> Idle\n    Idle --> Processing : submit\n    Processing --> Done : complete\n    Processing --> Error : fail\n    Error --> Idle : retry\n    Done --> [*]",
  er: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains\n    PRODUCT ||--o{ LINE_ITEM : "is in"',
  gantt:
    "gantt\n    title Project Timeline\n    dateFormat YYYY-MM-DD\n    section Phase 1\n    Task A :a1, 2026-01-01, 14d\n    Task B :a2, after a1, 10d\n    section Phase 2\n    Task C :b1, after a2, 7d\n    Task D :b2, after b1, 14d",
  pie: 'pie title Favorite Pets\n    "Dogs" : 45\n    "Cats" : 30\n    "Birds" : 15\n    "Fish" : 10',
  mindmap:
    "mindmap\n  root((Project))\n    Planning\n      Research\n      Requirements\n    Development\n      Frontend\n      Backend\n    Testing\n      Unit Tests\n      Integration",
  timeline:
    "timeline\n    title Project Milestones\n    2026-Q1 : Research\n             : Prototype\n    2026-Q2 : Development\n             : Testing\n    2026-Q3 : Launch\n             : Iterate",
  journey:
    "journey\n    title User Onboarding\n    section Sign Up\n      Visit site: 5: User\n      Create account: 3: User\n    section First Use\n      Complete tutorial: 4: User\n      Create first item: 5: User",
  gitgraph:
    "gitGraph\n    commit\n    commit\n    branch develop\n    checkout develop\n    commit\n    commit\n    checkout main\n    merge develop\n    commit",
  xychart:
    'xychart-beta\n    title "Sales Revenue"\n    x-axis [jan, feb, mar, apr, may]\n    y-axis "Revenue (k$)" 0 --> 150\n    bar [52, 78, 65, 120, 95]\n    line [52, 78, 65, 120, 95]',
  sankey:
    "sankey-beta\n\nAgricultural waste,Bio-conversion,124.729\nBio-conversion,Liquid,0.597\nBio-conversion,Losses,26.862\nBio-conversion,Solid,280.322\nBio-conversion,Gas,81.144",
  quadrant:
    "quadrantChart\n    title Reach and engagement\n    x-axis Low Reach --> High Reach\n    y-axis Low Engagement --> High Engagement\n    quadrant-1 We should expand\n    quadrant-2 Need to promote\n    quadrant-3 Re-evaluate\n    quadrant-4 May be improved\n    Campaign A: [0.3, 0.6]\n    Campaign B: [0.45, 0.23]\n    Campaign C: [0.57, 0.69]\n    Campaign D: [0.78, 0.34]",
  block:
    'block-beta\n  columns 3\n  a["Frontend"]:2 b["Backend"]\n  c["Database"] d["Cache"] e["Queue"]',
  packet:
    'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"\n  32-63: "Sequence Number"\n  64-95: "Acknowledgment Number"\n  96-99: "Data Offset"\n  100-105: "Reserved"\n  106-111: "Flags"\n  112-127: "Window Size"\n  128-143: "Checksum"\n  144-159: "Urgent Pointer"\n  160-191: "Options and Padding"',
  architecture:
    "architecture-beta\n    group api(cloud)[API]\n\n    service db(database)[Database] in api\n    service disk1(disk)[Storage] in api\n    service disk2(disk)[Backup] in api\n    service server(server)[Server] in api\n\n    db:L -- R:server\n    disk1:T -- B:server\n    disk2:T -- B:db",
  kanban:
    "kanban\n  Todo\n    id1[Design homepage]\n    id2[Write tests]\n  In Progress\n    id3[Implement API]\n  Done\n    id4[Setup CI/CD]",
  requirement:
    "requirementDiagram\n    requirement test_req {\n      id: 1\n      text: the test text\n      risk: high\n      verifymethod: test\n    }\n    element test_entity {\n      type: simulation\n    }\n    test_entity - satisfies -> test_req",
  c4context:
    'C4Context\n    title System Context diagram\n    Person(customerA, "Customer A", "A customer")\n    System(systemAA, "System A", "Main system")\n    System_Ext(systemC, "External System", "An external system")\n    Rel(customerA, systemAA, "Uses")\n    Rel(systemAA, systemC, "Sends data", "HTTPS")',
  c4container:
    'C4Container\n    title Container diagram for System A\n    Person(customerA, "Customer A", "A customer")\n    System_Boundary(c1, "System A") {\n      Container(web_app, "Web Application", "React", "Delivers content")\n      Container(api, "API", "Node.js", "Handles requests")\n      ContainerDb(db, "Database", "PostgreSQL", "Stores data")\n    }\n    Rel(customerA, web_app, "Uses", "HTTPS")\n    Rel(web_app, api, "Calls", "JSON/HTTPS")\n    Rel(api, db, "Reads/Writes", "SQL")',
  c4component:
    'C4Component\n    title Component diagram for API\n    Container_Boundary(api, "API Application") {\n      Component(auth, "Auth Controller", "Node.js", "Handles authentication")\n      Component(orders, "Orders Controller", "Node.js", "Handles orders")\n      Component(repo, "Repository", "Node.js", "Data access")\n    }\n    ContainerDb(db, "Database", "PostgreSQL")\n    Rel(auth, repo, "Uses")\n    Rel(orders, repo, "Uses")\n    Rel(repo, db, "Reads/Writes")',
  c4dynamic:
    'C4Dynamic\n    title Dynamic diagram for System A\n    ContainerDb(db, "Database", "PostgreSQL")\n    Container(api, "API", "Node.js")\n    Container(web, "Web App", "React")\n    Person(user, "User")\n    Rel(user, web, "1. Visits")\n    Rel(web, api, "2. Calls", "JSON/HTTPS")\n    Rel(api, db, "3. Reads/Writes", "SQL")',
  c4deployment:
    'C4Deployment\n    title Deployment Diagram\n    Deployment_Node(cloud, "AWS", "Amazon Web Services") {\n      Deployment_Node(ec2, "EC2 Instance") {\n        Container(api, "API", "Node.js", "Handles requests")\n      }\n      Deployment_Node(rds, "RDS") {\n        ContainerDb(db, "Database", "PostgreSQL")\n      }\n    }\n    Rel(api, db, "Reads/Writes", "SQL")',
  radar:
    'radar-beta\n  title Skills Assessment\n  axis f["Frontend"], b["Backend"], d["DevOps"], t["Testing"], u["Design"]\n  curve a["Developer A"]{4, 3, 2, 5, 1}\n  curve b["Developer B"]{2, 5, 4, 2, 3}\n  max 5',
};

const doRender = async (): Promise<void> => {
  const src = sourceEl.value.trim();
  if (!src) {
    previewEl.innerHTML =
      '<div class="placeholder">Start typing to see a live preview.</div>';
    errorBar.className = "error-bar";
    errorBar.textContent = "";
    applyLimitNotices(limitNoticesEl, "", null);
    invalidateRenderedState();
    statusEl.textContent = "Ready.";
    return;
  }
  if (!mermaidReady) return;

  const requestId = ++renderCounter;
  const id = "editor-svg-" + requestId;
  invalidateRenderedState("Rendering preview...");

  try {
    const rendered = await timeAsync("editor:mermaid-render", () =>
      mermaid.render(id, src),
    );
    const base64 = await timeAsync("editor:svg-to-png", () =>
      svgToPngBase64(rendered.svg),
    );
    const pngHitCap = consumePngExportHitDimensionCap();
    if (requestId !== renderCounter) return;
    if (base64) {
      currentBase64 = base64;
      previewEl.innerHTML =
        '<img src="data:image/png;base64,' + base64 + '" />';
      const img = previewEl.querySelector("img");
      if (img) wrapImgWithFullscreen(img);
      setActionButtonsEnabled(true);
      errorBar.className = "error-bar";
      errorBar.textContent = "";
      applyLimitNotices(limitNoticesEl, src, base64, pngHitCap);
      statusEl.textContent = "Preview up to date.";
    }
  } catch (e) {
    if (requestId !== renderCounter) return;
    const msg = e instanceof Error ? e.message : String(e);
    invalidateRenderedState();
    errorBar.textContent = msg;
    errorBar.className = "error-bar visible";
    statusEl.textContent = "Syntax error — showing last valid preview.";
  }

  const leftover = document.getElementById("d" + id);
  if (leftover) leftover.remove();
};

const scheduleRender = (): void => {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, 400);
};

const updateTemplateHighlight = (): void => {
  const currentSrc = sourceEl.value;
  const tplBtns =
    tplRow.querySelectorAll<HTMLButtonElement>("button[data-tpl]");
  let matched: string | null = null;
  for (const btn of tplBtns) {
    const key = btn.getAttribute("data-tpl")!;
    if (TEMPLATES[key] && currentSrc === TEMPLATES[key]) {
      matched = key;
    }
    btn.classList.remove("active");
  }
  if (matched) {
    const activeBtn = tplRow.querySelector<HTMLButtonElement>(
      `button[data-tpl="${matched}"]`,
    );
    if (activeBtn) activeBtn.classList.add("active");
  }
};

sourceEl.addEventListener("input", () => {
  if (!insertBtn.disabled) invalidateRenderedState("Rendering preview...");
  scheduleRender();
  updateTemplateHighlight();
});

insertBtn.addEventListener("click", () => {
  if (!currentBase64) return;
  insertBtn.disabled = true;
  insertBtn.innerHTML = '<span class="spinner-inline"></span>Inserting...';
  statusEl.textContent = "Inserting into document...";

  google.script.run
    .withSuccessHandler(() => {
      google.script.host.close();
    })
    .withFailureHandler((err: Error) => {
      insertBtn.textContent = "Insert into Document";
      insertBtn.className = "btn btn-filled-primary";
      insertBtn.disabled = false;
      statusEl.textContent = "Error: " + err;
    })
    .insertImageAtCursor(currentBase64, sourceEl.value.trim());
});

replaceBtn.addEventListener("click", () => {
  if (!currentBase64 || imageChildIndex < 0) return;
  replaceBtn.disabled = true;
  replaceBtn.innerHTML = '<span class="spinner-inline"></span>Replacing...';
  statusEl.textContent = "Replacing diagram...";

  google.script.run
    .withSuccessHandler(() => {
      google.script.host.close();
    })
    .withFailureHandler((err: Error) => {
      replaceBtn.textContent = "Replace Diagram";
      replaceBtn.className = "btn btn-filled-secondary";
      replaceBtn.disabled = false;
      statusEl.textContent = "Error: " + err;
    })
    .replaceImageInPlace(currentBase64, imageChildIndex, sourceEl.value.trim());
});

tplBtn.addEventListener("click", () => {
  tplRow.classList.toggle("visible");
});

const tplBtns = tplRow.querySelectorAll<HTMLButtonElement>("button[data-tpl]");
for (const btn of tplBtns) {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-tpl")!;
    if (TEMPLATES[key]) {
      sourceEl.value = TEMPLATES[key];
      refreshSourceLineNumbers();
      invalidateRenderedState("Rendering preview...");
      updateTemplateHighlight();
      doRender();
    }
  });
}

(async () => {
  try {
    await loadMermaid();
    mermaidReady = true;
    if (sourceEl.value.trim()) {
      statusEl.textContent = "Source loaded — rendering...";
      void doRender();
    } else {
      statusEl.textContent = "Ready — start typing.";
    }
    void focusSourceWhenReady();
  } catch (e) {
    statusEl.textContent =
      "Failed to load mermaid.js: " +
      (e instanceof Error ? e.message : String(e)) +
      " (see browser console F12)";
  }
})();
