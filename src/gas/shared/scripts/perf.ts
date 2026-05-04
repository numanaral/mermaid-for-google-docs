const isPerfEnabled = true;

const now = (): number =>
  typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();

export const perfMark = (label: string): number => {
  const at = now();
  if (isPerfEnabled) console.info(`[perf] ${label} @ ${at.toFixed(1)}ms`);
  return at;
};

export const perfMeasure = (label: string, start: number): number => {
  const elapsed = now() - start;
  if (isPerfEnabled) console.info(`[perf] ${label}: ${elapsed.toFixed(1)}ms`);
  return elapsed;
};

export const timeAsync = async <T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const start = now();
  try {
    return await fn();
  } finally {
    perfMeasure(label, start);
  }
};

export const timeSync = <T>(label: string, fn: () => T): T => {
  const start = now();
  try {
    return fn();
  } finally {
    perfMeasure(label, start);
  }
};
