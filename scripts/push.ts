import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const CACHE_FILE = ".gas-push-cache.json";
const GAS_SRC = "src/gas";
const DIST = "dist/gas";

interface PushCache {
  sourceHash: string;
  verified: boolean;
  built: boolean;
  pushedHash?: string;
}

const readCache = (): PushCache | null => {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
};

const writeCache = (cache: PushCache): void => {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
};

const hashDirectory = (dir: string): string => {
  const hash = crypto.createHash("sha256");
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        hash.update(full);
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(dir);
  return hash.digest("hex").slice(0, 16);
};

const bin = (name: string): string =>
  path.join(process.cwd(), "node_modules", ".bin", name);

const run = (cmd: string): void => {
  execSync(cmd, { stdio: "inherit" });
};

const parseFlags = (): {
  force: boolean;
  skipVerify: boolean;
  playwrightProbes: boolean;
} => {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force") || argv.includes("-f");
  const skipVerify =
    argv.includes("--skip-verify") || argv.includes("--no-verify");
  const playwrightProbes =
    argv.includes("--playwright-probes") || argv.includes("--probes");
  return { force, skipVerify, playwrightProbes };
};

const main = (): void => {
  const t0 = Date.now();
  const { force: forceFlag, skipVerify, playwrightProbes } = parseFlags();
  if (playwrightProbes) {
    process.env.GAS_INCLUDE_PLAYWRIGHT_PROBES = "1";
    console.log("[push] Build: including Playwright probe server hooks");
  }
  const sourceHash = hashDirectory(GAS_SRC);
  const cache = readCache();
  const isCurrent = cache?.sourceHash === sourceHash;
  const hasNewChanges = cache?.pushedHash !== sourceHash;

  console.log(`[push] Source hash: ${sourceHash}`);

  if (skipVerify) {
    console.log("[push] Verify: skipped (--skip-verify)");
  } else if (isCurrent && cache?.verified) {
    console.log("[push] Verify: skipped (no changes since last verify)");
  } else {
    console.log("[push] Verify: running...\n");
    run("tsx scripts/verify.ts");
    writeCache({
      sourceHash,
      verified: true,
      built: false,
      pushedHash: cache?.pushedHash,
    });
    console.log("");
  }

  const distExists = fs.existsSync(DIST) && fs.readdirSync(DIST).length > 0;

  if (isCurrent && cache.built && distExists) {
    console.log("[push] Build: skipped (no changes since last build)");
  } else {
    console.log("[push] Build: running...\n");
    run("tsx scripts/build-gas.ts");
    writeCache({
      sourceHash,
      verified: true,
      built: true,
      pushedHash: cache?.pushedHash,
    });
    console.log("");
  }

  // Force the push whenever the manifest / source changed since the last push
  // clasp otherwise prompts interactively for manifest changes and silently
  // skips the push in non-TTY shells.
  const shouldForce = forceFlag || hasNewChanges;

  console.log(
    `[push] Pushing to Apps Script...${shouldForce ? " (force)" : ""}\n`,
  );
  run(`${bin("clasp")} push${shouldForce ? " -f" : ""}`);

  writeCache({
    sourceHash,
    verified: true,
    built: true,
    pushedHash: sourceHash,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`\n[push] Done in ${elapsed}s`);
};

main();
