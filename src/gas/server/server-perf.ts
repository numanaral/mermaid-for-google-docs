export const timeServer = <T>(label: string, fn: () => T): T => {
  const start = Date.now();
  try {
    return fn();
  } finally {
    console.log(`[perf] ${label}: ${Date.now() - start}ms`);
  }
};
