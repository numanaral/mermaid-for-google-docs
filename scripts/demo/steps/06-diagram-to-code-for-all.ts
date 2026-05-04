import type { StepContext } from "../helpers";
import {
  sleep,
  poll,
  openMenuItem,
  enterDialog,
  isDialogOpen,
  cleanBetween,
  showDocumentScroll,
} from "../helpers";

export const step06DiagramToCodeForAll = async (
  ctx: StepContext,
): Promise<void> => {
  const { page, shot } = ctx;
  console.log("\n[06] Convert All Diagrams to Code");
  await openMenuItem(page, "Convert All Diagrams to Code");
  const d = await enterDialog(page, (f) =>
    f.evaluate(() => {
      const s = document.getElementById("status");
      return s != null && !s.innerHTML.includes("spinner");
    }),
  );
  if (d) {
    const { iframe, iGlide, iClick } = d;
    await sleep(600);

    const chevron = iframe.locator(".card-chevron").first();
    if (await chevron.isVisible().catch(() => false)) {
      console.log("   Expanding first card...");
      await iClick(chevron);
      await sleep(800);
      const sourceWrap = iframe.locator(".source-wrap").first();
      if (await sourceWrap.isVisible().catch(() => false)) {
        const swBox = await sourceWrap.boundingBox().catch(() => null);
        if (swBox) {
          await iGlide(
            swBox.x + swBox.width / 2,
            swBox.y + swBox.height / 2,
            14,
          );
          await sleep(600);
        }
      }
    }

    const replaceAllBtn = iframe.locator("#replace-all-btn");
    const replaceAllEnabled = await poll(
      () => replaceAllBtn.isEnabled().catch(() => false),
      10000,
    );
    if (!replaceAllEnabled)
      throw new Error(
        "Convert All Diagrams to Code never enabled Replace All.",
      );
    await shot("17-extract-preview");
    console.log("   Clicking Replace All...");
    await iClick(replaceAllBtn, 18);
    console.log("   Watching replacements...");
    const closed = await poll(async () => !(await isDialogOpen(page)), 90000);
    if (!closed)
      throw new Error(
        "Convert All Diagrams to Code did not close after replace.",
      );
    await sleep(1500);
    await shot("18-after-diagrams-to-code");
    await showDocumentScroll(page, shot, "18-after-diagrams-to-code");
    console.log("   ✓ All replaced");
  }
  await cleanBetween(page);
};
