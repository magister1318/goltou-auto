import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
await page.route("https://**", (route) => route.abort());
await page.goto(pathToFileURL(resolve("docs/design/ux-v2.html")).href);
mkdirSync("tmp/wp16-mock", { recursive: true });
for (const screen of [
  "login",
  "home",
  "product",
  "progress",
  "done",
  "connect",
  "svc",
  "relogin",
  "fail",
  "history",
  "settings",
]) {
  await page.locator(`[data-jump="${screen}"]`).click();
  await page.screenshot({ path: `tmp/wp16-mock/${screen}.png` });
  console.log("Reviewed mock screen:", screen);
}
for (const sheet of ["draft", "publish", "confirm", "stop", "del"]) {
  await page
    .locator(
      `[data-jump="${sheet === "stop" ? "progress" : sheet === "del" ? "history" : "product"}"]`,
    )
    .click();
  if (sheet === "confirm") await page.locator('[data-sheet="publish"]').click();
  await page.locator(`[data-sheet="${sheet}"]`).click();
  await page.screenshot({ path: `tmp/wp16-mock/${sheet}.png` });
  console.log("Reviewed mock sheet:", sheet);
}
await browser.close();
