// WP16: app-only device inspection. No credential, cookie, service page or account text is read.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const { CdpConnection } = require("../dist/surface.cjs");
const adb = path.join(
  process.env.LOCALAPPDATA,
  "Android/Sdk/platform-tools/adb.exe",
);
const serial = "R3CX10HP9CB";
const run = (args) =>
  execFileSync(adb, ["-s", serial, ...args], {
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
function ready() {
  const awake = /mWakefulness=Awake/.test(
    run(["shell", "dumpsys", "power"]).toString(),
  );
  const windows = run(["shell", "dumpsys", "window"]).toString();
  const focus =
    /mCurrentFocus=Window\{[^\n]*kr\.goltou\.auto\/kr\.goltou\.auto\.MainActivity/.test(
      windows,
    );
  const activity = /mFocusedApp=[^\n]*kr\.goltou\.auto\/.MainActivity/.test(
    windows,
  );
  if (!awake || !focus || !activity) throw Error("DEVICE_CONDITIONS_LOST");
  return windows;
}
ready();
const pid = run(["shell", "pidof", "kr.goltou.auto"]).toString().trim();
if (!/^\d+$/.test(pid)) throw Error("APP_PROCESS_MISSING");
const port = Number(
  run(["forward", "tcp:0", `localabstract:webview_devtools_remote_${pid}`])
    .toString()
    .trim(),
);
const targets = await (
  await fetch(`http://127.0.0.1:${port}/json/list`)
).json();
const target = targets.filter((t) => {
  try {
    const u = new URL(t.url);
    return u.hostname === "127.0.0.1" && u.pathname.startsWith("/ui/");
  } catch {
    return false;
  }
});
if (target.length !== 1) throw Error("APP_UI_TARGET_AMBIGUOUS");
const endpoint = new URL(target[0].webSocketDebuggerUrl);
endpoint.host = `127.0.0.1:${port}`;
const cdp = await CdpConnection.connect(endpoint.href);
async function read(expression) {
  const reply = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    throwOnSideEffect: true,
  });
  if (reply.exceptionDetails) throw Error("APP_UI_READ_FAILED");
  return reply.result.value;
}
async function click(selector, text) {
  ready();
  const point = await read(
    `(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getBoundingClientRect().width>0&&!e.disabled${text ? `&&e.textContent.trim()===${JSON.stringify(text)}` : ""});if(nodes.length!==1)return null;const r=nodes[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  if (!point) throw Error("APP_UI_CONTROL_UNAVAILABLE");
  if (/발행하기|삭제/.test(text ?? "")) throw Error("DEVICE_MUTATION_REFUSED");
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point,
    button: "left",
    clickCount: 1,
  });
}
async function wait(expression, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    ready();
    if (await read(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw Error("APP_UI_WAIT_EXPIRED");
}
const privateDir = path.join(os.tmpdir(), "goltou-wp16-device");
mkdirSync(privateDir, { recursive: true });
async function capture(name, selectors = []) {
  const windows = ready();
  const rectangles = async values => read(`(()=>({width:innerWidth,height:innerHeight,rects:[...document.querySelectorAll(${JSON.stringify(values.join(',') || '.nonexistent')})].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]})}))()`);
  const geometry = await rectangles(selectors.filter(s => !s.startsWith('.sheet')));
  geometry.sheetRects = (await rectangles(selectors.filter(s => s.startsWith('.sheet')))).rects;
  geometry.overlays = (await rectangles(['.sheet','.bar','.bottom-nav'])).rects;
  geometry.topInset = Number(/type=statusBars frame=\[0,0\]\[\d+,(\d+)\]/.exec(windows)?.[1]);
  const nav = /type=navigationBars frame=\[0,(\d+)\]\[\d+,(\d+)\]/.exec(windows);
  geometry.bottomInset = nav ? Number(nav[2]) - Number(nav[1]) : NaN;
  if (!Number.isFinite(geometry.topInset) || !Number.isFinite(geometry.bottomInset)) throw Error('SCREEN_INSETS_UNAVAILABLE');
  // Raw screenshots and geometry remain outside the repository until opaque redaction.
  writeFileSync(
    path.join(privateDir, `${name}.png`),
    run(["exec-out", "screencap", "-p"]),
  );
  writeFileSync(
    path.join(privateDir, `${name}.json`),
    JSON.stringify(geometry),
  );
  console.log(`Captured device app screen: ${name}`);
}
try {
  const signedIn = await read(`!!document.querySelector('.screen-home')`);
  console.log(
    JSON.stringify({
      ready: true,
      signedIn,
      loginRequired: await read(
        `!!document.querySelector('input[type=password]')`,
      ),
    }),
  );
  if (!signedIn) throw Error("USER_LOGIN_REQUIRED");
  await wait(`document.querySelectorAll('.product-row').length>0`);
  await capture("01-products", [".brand-row>span:last-child", ".product-row"]);
  await click(".product-row:first-of-type");
  await wait(
    `!!document.querySelector('.converted-content')&&!document.querySelector('.bar .btn').disabled`,
  );
  await capture("02-preview", [".title", ".meta", ".converted-content"]);
  await click(".bar .secondary");
  await capture("03-draft-sheet", [
    ".title",
    ".converted-content",
    ".preview-content>.meta",
  ]);
  await click(".sheet button", "취소");
  await click(".bar .primary");
  await wait(`!!document.querySelector(".sheet")&&!document.body.textContent.includes("내 밴드를 확인하는 중")`);
  await capture("04-publish-sheet", [
    ".title",
    ".converted-content",
    ".preview-content>.meta",
    ".sheet .pick strong",
    ".sheet select",
  ]);
  await click(".sheet button", "취소");
  await click(".back");
  await click(".chip:first-child");
  await capture("05-connections");
  await click(".back");
  await click(".bottom-nav button", "등록 기록");
  await wait(
    `!!document.querySelector('.history-row')||!document.querySelector('.history-row')&&!document.body.textContent.includes('등록 기록을 불러오는 중')`,
  );
  await capture("06-history", [".history-row strong", ".history-row small"]);
  await click(".bottom-nav button", "설정");
  await capture("07-settings", [
    ".settings-content>.choice-row:first-of-type>span",
    ".settings-content textarea",
    ".settings-content input",
    ".settings-content .choice-row small:not(:has(.login-state))",
  ]);
  await click(".bottom-nav button", "상품");
  if (process.argv.includes("--draft-once")) {
    const latch = path.join(privateDir, "draft-attempted");
    if (existsSync(latch)) throw Error("DEVICE_DRAFT_ALREADY_ATTEMPTED");
    await click(".product-row:first-of-type");
    await wait(
      `!!document.querySelector('.converted-content')&&!document.querySelector('.bar .btn').disabled`,
    );
    await click(".bar .secondary");
    writeFileSync(
      latch,
      "Attempt reserved before input. Never retry this device run.",
    );
    await click(".sheet button", "블로그에 임시저장");
    await wait(`!!document.querySelector('.screen-progress')`, 60000);
    for (let n = 0; n < 600; n++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      ready();
      const live = await read(`!!document.querySelector('.live-progress')`);
      if (live && n % 8 === 0)
        await capture(`08-progress-${String(n).padStart(3, "0")}`, [
          ".paper-content",
          ".live-progress>.meta",
        ]);
      const done = await read(
        `[...document.querySelectorAll('h1')].some(e=>e.textContent==='블로그에 임시저장했습니다')`,
      );
      const paused = await read(`!document.querySelector('.live-progress')`);
      if (done || paused) {
        await capture(done ? "09-draft-complete" : "09-draft-stopped", [
          ".center>.meta",
          ".result-rows strong",
          ".result-rows small",
        ]);
        console.log(
          JSON.stringify({
            draftAttempted: true,
            draftVerified: done,
            paused: !done,
          }),
        );
        break;
      }
    }
  }
} finally {
  cdp.close();
  run(["forward", "--remove", `tcp:${port}`]);
}
