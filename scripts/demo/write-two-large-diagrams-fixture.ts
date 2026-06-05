/**
 * Writes temp/manual-test-two-large-diagrams.md for manual Import testing.
 * Usage: yarn demo:fixture-two-large-md
 */
import fs from "fs";
import path from "path";
import { loadMermaidFromFailingFixture } from "./fixtures/failing-image-fixture";
import { encodeMermaidSource } from "../../src/gas/shared/scripts/docs-insert-limits";

const OUT = path.resolve("temp/manual-test-two-large-diagrams.md");

const build = (): string => {
  const a = loadMermaidFromFailingFixture();
  const b = a.replace(
    'start["PR / changeset is created"]',
    'startB["Diagram B — PR / changeset is created"]',
  );
  return `# Large diagram round-trip

Intro text **before** the first diagram. This paragraph should survive export and re-import unchanged.

\`\`\`mermaid
${a}
\`\`\`

**Text between the two diagrams** — if export and re-import work, you will still see this sentence between two different large flowcharts.

\`\`\`mermaid
${b}
\`\`\`

Closing paragraph after the second diagram.
`;
};

const main = (): void => {
  const a = loadMermaidFromFailingFixture();
  const b = a.replace(
    'start["PR / changeset is created"]',
    'startB["Diagram B — PR / changeset is created"]',
  );
  const md = build();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md, "utf8");
  console.log(`Wrote ${OUT} (${md.length} chars)`);
  for (const [label, src] of [
    ["diagram A", a],
    ["diagram B", b],
  ] as const) {
    const enc = encodeMermaidSource(src);
    console.log(
      `  ${label}: source ${src.length} chars, encoded ${enc.length} (Docs alt max 5000 → ${enc.length > 5000 ? "uses docstore" : "fits in alt"})`,
    );
  }
};

main();
