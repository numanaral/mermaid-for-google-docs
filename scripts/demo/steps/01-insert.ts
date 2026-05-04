import type { StepContext } from "../helpers";
import {
  sleep,
  poll,
  injectCursor,
  setLastPos,
  lastPos,
  openMenuItem,
  enterDialog,
  isDialogOpen,
  typeCodeLines,
  getTextareaState,
  waitForValidPreview,
  buildInsertFlowchartLines,
} from "../helpers";

export const step01Insert = async (ctx: StepContext): Promise<void> => {
  const { page, runTag, shot } = ctx;
  console.log("\n[01] Insert Mermaid Diagram");
  await openMenuItem(page, "Insert Mermaid Diagram");
  const d = await enterDialog(page, (f) =>
    f
      .locator("#tpl-btn")
      .count()
      .then((c) => c > 0),
  );
  if (!d)
    throw new Error("Insert Mermaid Diagram dialog did not become ready.");

  const { iframe, offset, iClick } = d;
  const CUSTOM_FLOWCHART = buildInsertFlowchartLines(runTag);

  console.log("   Opening templates...");
  await iClick(iframe.locator("#tpl-btn"));
  await sleep(400);
  const tplVis = await iframe
    .locator("#tpl-row.visible")
    .count()
    .then((c) => c > 0)
    .catch(() => false);
  if (!tplVis) {
    await iClick(iframe.locator("#tpl-btn"));
    await sleep(400);
  }

  for (const tpl of [
    "flowchart",
    "gantt",
    "mindmap",
    "xychart",
    "architecture",
    "radar",
  ]) {
    const btn = iframe.locator(`button[data-tpl="${tpl}"]`);
    if (await btn.isVisible().catch(() => false)) {
      console.log(`   -> ${tpl}`);
      await iClick(btn, 14);
      await sleep(400);
    }
  }

  console.log("   Typing custom code...");
  const srcArea = iframe.locator("#source");
  const insertBtn = iframe.locator("#insert-btn");
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
    throw new Error("Insert source textarea was not focused.");

  await srcArea.press("Meta+a");
  await sleep(100);
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
    throw new Error("Insert source textarea did not clear.");

  await typeCodeLines(srcArea, CUSTOM_FLOWCHART, 15, 35);

  const expectedSource = CUSTOM_FLOWCHART.join("\n");
  const exactText = await poll(
    () =>
      srcArea
        .inputValue()
        .then((v) => v === expectedSource)
        .catch(() => false),
    5000,
  );
  if (!exactText)
    throw new Error("Insert source did not match expected custom flowchart.");

  const previewReady = await waitForValidPreview(iframe);
  if (!previewReady) throw new Error("Insert preview never became valid.");
  const insertEnabled = await poll(
    () => insertBtn.isEnabled().catch(() => false),
    10000,
  );
  if (!insertEnabled) throw new Error("Insert button never became enabled.");
  await shot("01-insert-preview-valid");

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

  console.log("   Clicking Insert...");
  await iClick(insertBtn, 20);
  const insertClosed = await poll(
    async () => !(await isDialogOpen(page)),
    15000,
  );
  if (!insertClosed)
    throw new Error("Insert dialog did not close after insert.");
  await sleep(1200);
  await shot("02-after-insert");
  console.log("   ✓ Diagram inserted");
  await sleep(250);
};
