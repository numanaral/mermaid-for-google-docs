import { loadScript } from "./load-script";
import { MERMAID_CDN_URL } from "./constants";
import { MERMAID_CONFIG } from "./mermaid-config";
import { timeAsync } from "./perf";

declare const mermaid: {
  initialize(config: unknown): void;
};

let mermaidLoadPromise: Promise<void> | null = null;
let mermaidInitialized = false;

export const loadMermaid = (): Promise<void> => {
  if (mermaidInitialized) return Promise.resolve();
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = timeAsync("mermaid:load+init", async () => {
      await loadScript(MERMAID_CDN_URL, { label: "mermaid:script" });
      mermaid.initialize(MERMAID_CONFIG);
      mermaidInitialized = true;
    }).catch((err) => {
      mermaidLoadPromise = null;
      throw err;
    });
  }
  return mermaidLoadPromise;
};
