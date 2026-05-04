import type { StepContext } from "../helpers";
import {
  sleep,
  poll,
  openMenuItem,
  enterDialog,
  closeDialog,
  typeCodeLines,
  getTextareaState,
  buildEditAllFlowchart,
} from "../helpers";

export const step03EditAll = async (ctx: StepContext): Promise<void> => {
  const { page, context, runTag, isBatch, shot } = ctx;
  console.log("\n[03] Edit All Mermaid Diagrams");
  await openMenuItem(page, "Edit All Mermaid Diagrams");
  const d = await enterDialog(page, (f) =>
    f.evaluate(() => {
      const s = document.getElementById("status");
      return Boolean(s?.textContent?.includes("found"));
    }),
  );
  if (d) {
    const { iframe, iGlide, iClick } = d;
    await sleep(400);

    console.log("   Expanding first card...");
    const chevron = iframe.locator(".card-chevron").first();
    await iClick(chevron);
    await poll(
      () =>
        iframe
          .locator("#src-0")
          .isVisible()
          .catch(() => false),
      10000,
    );

    const thumbHover = iframe.locator(".thumb-hover").first();
    if (await thumbHover.isVisible().catch(() => false)) {
      const thumbBox = await thumbHover.boundingBox().catch(() => null);
      if (thumbBox) {
        console.log("   Hovering thumbnail...");
        await iGlide(
          thumbBox.x + thumbBox.width / 2,
          thumbBox.y + thumbBox.height / 2,
          14,
        );
        await sleep(700);
        await shot("11-editall-thumb-hover");

        console.log("   Full preview tab available via badge");
        // Playwright records one page at a time, so a real popup tab would not
        // appear in the main demo video and can trigger Chrome's debugger banner.
        await context.pages()[0]?.bringToFront().catch(() => {});
      }
    }

    for (const idx of [1, 2]) {
      const extraChevron = iframe.locator(".card-chevron").nth(idx);
      if (await extraChevron.isVisible().catch(() => false)) {
        console.log(`   Expanding card ${idx + 1}...`);
        await iClick(extraChevron, 14);
        await sleep(650);
        console.log(`   Collapsing card ${idx + 1}...`);
        await iClick(extraChevron, 14);
        await sleep(450);
      }
    }

    const srcTextarea = iframe.locator("#src-0");
    const errorBar = iframe.locator("#err-0");
    const saveBtn = iframe.locator("#save-0");
    const srcVisible = await srcTextarea.isVisible().catch(() => false);
    if (srcVisible) {
      console.log("   Modifying source...");
      const source = await srcTextarea.inputValue().catch(() => "");
      if (!source.length) throw new Error("Edit All source was empty.");
      const modified = buildEditAllFlowchart(source, `${runTag}-all`);

      await iClick(srcTextarea);
      await sleep(100);
      await srcTextarea.focus().catch(() => {});
      await sleep(60);
      let textareaState = await getTextareaState(srcTextarea);
      if (!textareaState.active) {
        await srcTextarea.evaluate((el: HTMLTextAreaElement) => el.focus());
        await sleep(60);
        textareaState = await getTextareaState(srcTextarea);
      }
      if (!textareaState.active)
        throw new Error("Edit All source textarea was not focused.");

      await srcTextarea.press("Meta+a");
      await sleep(100);
      await shot("11-editall-source-selected");
      await srcTextarea.press("Backspace");
      await sleep(120);
      let currentValue = await srcTextarea.inputValue().catch(() => "");
      if (currentValue.length > 0) {
        await srcTextarea.press("Meta+a");
        await sleep(80);
        await srcTextarea.press("Delete");
        await sleep(120);
        currentValue = await srcTextarea.inputValue().catch(() => "");
      }
      if (currentValue !== "")
        throw new Error("Edit All textarea did not clear.");
      await shot("12-editall-source-cleared");

      const modifiedLines = modified.split("\n");
      await typeCodeLines(srcTextarea, modifiedLines, 15, 35);

      const exactText = await poll(
        () =>
          srcTextarea
            .inputValue()
            .then((v) => v === modified)
            .catch(() => false),
        5000,
      );
      if (!exactText)
        throw new Error("Edit All retyped source did not match expected text.");
      await shot("13-editall-source-retyped");

      const previewPanel = iframe.locator("#pv-0");
      const previewReady = await poll(async () => {
        const hasPreview = await previewPanel
          .locator("img")
          .count()
          .then((c) => c > 0)
          .catch(() => false);
        const hasError = await errorBar
          .textContent()
          .then((t) => Boolean(t && t.trim()))
          .catch(() => false);
        const enabled = await saveBtn.isEnabled().catch(() => false);
        return hasPreview && !hasError && enabled;
      }, 12000);
      if (!previewReady)
        throw new Error("Edit All preview/save never became ready.");
      await shot("14-editall-preview-valid");

      await iframe
        .evaluate(() => {
          const btn = document.getElementById("save-0");
          if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });
        })
        .catch(() => {});
      await sleep(500);
      console.log("   Clicking Save & Replace...");
      await iClick(saveBtn, 20);
      const saved = await poll(
        () =>
          saveBtn
            .textContent()
            .then((t) => t?.includes("Saved"))
            .catch(() => false),
        15000,
      );
      if (!saved) throw new Error("Edit All save never reached saved state.");
      console.log("   ✓ Saved");
    }
    await closeDialog(page);

    if (isBatch) {
      console.log("   Waiting for Docs to repaint updated image...");
      await sleep(3000);
      await shot("15-editall-after-replace");

      console.log(
        "   Re-opening Edit All to verify exact current-run source...",
      );
      await openMenuItem(page, "Edit All Mermaid Diagrams");
      const verifyDialog = await enterDialog(page, (f) =>
        f.evaluate(() => {
          const s = document.getElementById("status");
          return Boolean(s?.textContent?.includes("found"));
        }),
      );
      if (!verifyDialog)
        throw new Error("Edit All verification dialog never became ready.");
      const { iframe: verifyFrame, iClick: verifyClick } = verifyDialog;
      const verifyChevron = verifyFrame.locator(".card-chevron").first();
      await verifyClick(verifyChevron);
      await poll(
        () =>
          verifyFrame
            .locator("#src-0")
            .isVisible()
            .catch(() => false),
        10000,
      );
      const reopenedValue = await verifyFrame.locator("#src-0").inputValue();
      console.log(
        `   Reopened source contains run tag: ${reopenedValue.includes(`${runTag}-all`)}`,
      );
      if (reopenedValue !== buildEditAllFlowchart("", `${runTag}-all`))
        throw new Error(
          "Edit All reopened source did not match the exact current-run text.",
        );
      await shot("16-editall-reopen-verified");
      await closeDialog(page);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(250);
};
