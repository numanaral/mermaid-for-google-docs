import type { StepContext } from "../helpers";
import { isGoogleDocEditorReady, sleep } from "../helpers";

export const step00Reset = async (ctx: StepContext): Promise<void> => {
  const { page, shot } = ctx;
  console.log("\n[00] Resetting document: Tab 5 → Tab 1");

  if (!(await isGoogleDocEditorReady(page))) {
    throw new Error(
      "Google Doc editor not visible (login expired or wrong page). Run `yarn test:login`.",
    );
  }
  const tab5 = page.getByText("Tab 5", { exact: true }).first();
  const t5Box = await tab5.boundingBox().catch(() => null);
  if (t5Box) {
    await tab5.click({ force: true });
    await sleep(1500);
    const edArea = page.locator(".kix-appview-editor");
    const edRect = await edArea.boundingBox().catch(() => null);
    if (edRect) {
      await page.mouse.click(
        edRect.x + edRect.width / 2,
        edRect.y + edRect.height / 2,
      );
      await sleep(300);
    }
    await page.keyboard.press("Meta+a");
    await sleep(200);
    await page.keyboard.press("Meta+c");
    await sleep(200);
    console.log("   Tab 5 content copied");

    const tab1 = page.getByText("Tab 1", { exact: true }).first();
    await tab1.click({ force: true });
    await sleep(1500);
    if (edRect) {
      await page.mouse.click(
        edRect.x + edRect.width / 2,
        edRect.y + edRect.height / 2,
      );
      await sleep(300);
    }
    await page.keyboard.press("Meta+a");
    await sleep(200);
    await page.keyboard.press("Meta+v");
    await sleep(2000);
    console.log("   Tab 1 replaced with Tab 5 content");

    await page.keyboard.press("Meta+ArrowUp");
    await sleep(400);
    await page.keyboard.press("Meta+ArrowRight");
    await sleep(200);
    await page.keyboard.press("Enter");
    await sleep(400);
    console.log("   Cursor placed below title in Tab 1");
    await shot("00-reset-ready");
    await sleep(1800);
  } else {
    console.log("   ⚠ Tab 5 not found, skipping reset");
    console.log(
      "   (Playground doc needs tabs named Tab 1 and Tab 5, or reset manually.)",
    );
  }
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(250);
};
