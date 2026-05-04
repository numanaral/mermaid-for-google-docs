import { timeAsync } from "./perf";

const scriptPromises = new Map<string, Promise<void>>();

export interface LoadScriptOptions {
  label?: string;
  async?: boolean;
  defer?: boolean;
}

export const loadScript = (
  url: string,
  options: LoadScriptOptions = {},
): Promise<void> => {
  const cached = scriptPromises.get(url);
  if (cached) return cached;

  const promise = timeAsync(options.label || `loadScript:${url}`, () => {
    return new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${url}"]`,
      );
      if (existing?.dataset.loaded === "true") {
        resolve();
        return;
      }

      const s = document.createElement("script");
      s.src = url;
      s.async = options.async ?? true;
      s.defer = options.defer ?? false;
      s.onload = () => {
        s.dataset.loaded = "true";
        resolve();
      };
      s.onerror = () => {
        scriptPromises.delete(url);
        reject(new Error("Failed to load " + url));
      };
      document.head.appendChild(s);
    });
  });

  scriptPromises.set(url, promise);
  return promise;
};

export const loadScriptsParallel = (
  scripts: Array<{ url: string; options?: LoadScriptOptions }>,
): Promise<void[]> => {
  return Promise.all(
    scripts.map((script) => loadScript(script.url, script.options)),
  );
};
