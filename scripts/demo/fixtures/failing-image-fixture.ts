import fs from "fs";
import path from "path";

const FAILING_MD = path.resolve("temp/test-failing-image.md");

/** Large Mermaid block from temp/test-failing-image.md (shared by probes and local PNG harnesses). */
export const loadMermaidFromFailingFixture = (): string => {
  const raw = fs.readFileSync(FAILING_MD, "utf8");
  const match = raw.match(/```+mermaid\s*\n([\s\S]*?)```+/i);
  if (!match) throw new Error(`No mermaid fence in ${FAILING_MD}`);
  return match[1].trim();
};
