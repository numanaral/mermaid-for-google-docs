import type { StepContext } from "../helpers";
import {
  sleep,
  poll,
  injectCursor,
  setCursor,
  setLastPos,
  lastPos,
  openMenuItemDirect,
  enterDialog,
  isDialogOpen,
  typeCodeLines,
  getTextareaState,
  waitForMermaidEditorReady,
  waitForValidPreview,
  imageToolbarVisible,
  dismissGasAlert,
  closeDialog,
  buildEditedFlowchart,
} from "../helpers";

export const step02EditSelected = async (ctx: StepContext): Promise<void> => {
  const { page, runTag, isBatch, shot } = ctx;
  console.log("\n[02] Edit Selected Mermaid Diagram");
  await sleep(800);
  await injectCursor(page);

  const attempts = [
    { x: 620, y: 300, label: "center-300" },
    { x: 620, y: 320, label: "center-320" },
    { x: 620, y: 280, label: "center-280" },
  ];
  let selectedAttempt: { x: number; y: number; label: string } | null = null;
  const alreadySelected = await imageToolbarVisible(page);
  console.log(
    `   inserted image already selected -> toolbar=${alreadySelected}`,
  );
  if (alreadySelected) {
    selectedAttempt = { x: 620, y: 300, label: "auto-selected" };
    await shot("03-image-already-selected");
  } else {
    console.log("   Image selection was not retained; falling back to click.");
    await page.keyboard.press("Meta+ArrowUp");
    await sleep(400);
    for (const attempt of attempts) {
      await page.mouse.move(attempt.x, attempt.y, { steps: 8 });
      await setCursor(page, attempt.x, attempt.y);
      await sleep(120);
      await page.mouse.click(attempt.x, attempt.y);
      await sleep(700);
      const visible = await imageToolbarVisible(page);
      console.log(
        `   ${attempt.label} @ (${attempt.x}, ${attempt.y}) -> toolbar=${visible}`,
      );
      await shot(`03-select-${attempt.label}`);
      if (visible) {
        selectedAttempt = attempt;
        break;
      }
    }
  }
  if (!selectedAttempt)
    throw new Error("Could not select the image for Edit Selected.");
  setLastPos(selectedAttempt.x, selectedAttempt.y);

  const opened = await openMenuItemDirect(
    page,
    "Edit Selected Mermaid Diagram",
  );
  if (!opened) throw new Error("Could not open Edit Selected Mermaid Diagram.");

  const gasAlertBtn = page.locator('[role="button"]:has-text("OK")').first();
  await poll(
    async () =>
      (await isDialogOpen(page)) ||
      (await gasAlertBtn.isVisible({ timeout: 200 }).catch(() => false)),
    8000,
  );
  if (await dismissGasAlert(page))
    throw new Error("Edit Selected still reported no selected diagram.");

  const d = await enterDialog(page, (f) =>
    f
      .locator("#source")
      .inputValue()
      .then((v) => v.trim().length > 0)
      .catch(() => false),
  );
  if (!d) throw new Error("Edit Selected dialog never became ready.");

  const { iframe, offset, iClick } = d;
  await shot("04-dialog-open");
  await waitForMermaidEditorReady(iframe);

  console.log("   Editing pre-filled source...");
  const srcArea = iframe.locator("#source");
  const replaceBtn = iframe.locator("#replace-btn");
  const source = await srcArea.inputValue().catch(() => "");
  const modified = buildEditedFlowchart(source, runTag);

  await iClick(srcArea);
  await sleep(100);
  await srcArea.focus().catch(() => {});
  await sleep(60);
  let textareaState = await getTextareaState(srcArea);
  if (!textareaState.active) {
    await srcArea.evaluate((el: HTMLTextAreaElement) => el.focus());
    await sleep(60);
    textareaState = await getTextareaState(srcArea);
  }
  if (!textareaState.active)
    throw new Error("Edit Selected source textarea was not focused.");

  await srcArea.press("Meta+a");
  await sleep(100);
  await shot("05-source-selected");
  await srcArea.press("Backspace");
  await sleep(120);
  let currentValue = await srcArea.inputValue().catch(() => "");
  if (currentValue.length > 0) {
    await srcArea.press("Meta+a");
    await sleep(80);
    await srcArea.press("Delete");
    await sleep(120);
    currentValue = await srcArea.inputValue().catch(() => "");
  }
  if (currentValue !== "")
    throw new Error("Edit Selected textarea did not clear.");
  await shot("06-source-cleared");

  const modifiedLines = modified.split("\n");
  await typeCodeLines(srcArea, modifiedLines, 15, 35);

  const exactText = await poll(
    () =>
      srcArea
        .inputValue()
        .then((v) => v === modified)
        .catch(() => false),
    5000,
  );
  if (!exactText)
    throw new Error(
      "Edit Selected retyped source did not match expected text.",
    );
  await shot("07-source-retyped");

  const previewReady = await waitForValidPreview(iframe);
  if (!previewReady)
    throw new Error("Edit Selected preview never became valid after edit.");
  await shot("08-preview-valid");

  const replaceEnabled = await poll(
    () => replaceBtn.isEnabled().catch(() => false),
    10000,
  );
  if (!replaceEnabled)
    throw new Error("Replace Diagram button never became enabled.");

  await injectCursor(iframe);
  const srcBox = await srcArea.boundingBox().catch(() => null);
  if (srcBox) {
    setLastPos(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await iframe
      .evaluate(
        ([lx, ly]: [number, number]) => {
          const el = document.getElementById("pw-cursor");
          if (el) {
            el.style.left = lx + "px";
            el.style.top = ly + "px";
          }
        },
        [lastPos.x - offset.x, lastPos.y - offset.y] as [number, number],
      )
      .catch(() => {});
    await page.mouse.move(lastPos.x, lastPos.y);
  }
  await sleep(300);

  console.log("   Replacing diagram...");
  await iClick(replaceBtn, 20);
  const replaceClosed = await poll(
    async () => !(await isDialogOpen(page)),
    15000,
  );
  if (!replaceClosed)
    throw new Error("Edit Selected dialog did not close after replace.");
  await sleep(3000);
  await shot("09-after-replace");
  console.log("   ✓ Diagram replaced");

  if (isBatch) {
    console.log("   Re-opening to verify exact current-run source...");
    await page.keyboard.press("Meta+ArrowUp");
    await sleep(400);
    await page.mouse.click(470, 165);
    await sleep(250);
    await page.mouse.move(selectedAttempt.x, selectedAttempt.y, { steps: 8 });
    await setCursor(page, selectedAttempt.x, selectedAttempt.y);
    await sleep(120);
    await page.mouse.click(selectedAttempt.x, selectedAttempt.y);
    await sleep(700);
    if (!(await imageToolbarVisible(page)))
      throw new Error("Could not reselect image after replace.");

    const reopened = await openMenuItemDirect(
      page,
      "Edit Selected Mermaid Diagram",
    );
    if (!reopened)
      throw new Error("Could not reopen Edit Selected for verification.");
    await poll(
      async () =>
        (await isDialogOpen(page)) ||
        (await gasAlertBtn.isVisible({ timeout: 200 }).catch(() => false)),
      8000,
    );
    if (await dismissGasAlert(page))
      throw new Error("Re-open verification hit no-selection alert.");

    const verifyDialog = await enterDialog(page, (f) =>
      f
        .locator("#source")
        .inputValue()
        .then((v) => v.trim().length > 0)
        .catch(() => false),
    );
    if (!verifyDialog)
      throw new Error("Verification dialog never became ready.");
    const reopenedValue = await verifyDialog.iframe
      .locator("#source")
      .inputValue();
    console.log(
      `   Reopened source contains run tag: ${reopenedValue.includes(runTag)}`,
    );
    if (reopenedValue !== modified)
      throw new Error(
        "Reopened source did not match the exact current-run text.",
      );
    await shot("10-reopen-verified");
    await closeDialog(page);
  }

  await page.keyboard.press("Escape").catch(() => {});
  await sleep(250);
};
