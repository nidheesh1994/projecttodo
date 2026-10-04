#!/usr/bin/env node
// Takes the README screenshots with a headless Chrome, over the DevTools protocol. No dependencies.
//   node docs/screenshots/take.mjs [http://localhost:3005] [outDir]
// Point it at a ProjectTodo that serves sample data (a project "website" with a few to-dos), and have
// Google Chrome installed (or set CHROME=/path/to/chrome). Each shot is twice the pixel density.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.argv[2] || "http://localhost:3005").replace(/\/+$/, "");
const OUT = path.resolve(process.argv[3] || path.dirname(fileURLToPath(import.meta.url)));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DRAFT_PAD = `
  document.getElementById("add-root").click();
  document.getElementById("dm-name").value = "Ideas for the launch week";
  const dm = window.boardDebug.dm;
  dm.lines = [
    { key: "a", id: null, text: "Write the announcement post", depth: 0 },
    { key: "b", id: null, text: "Draft it", depth: 1 },
    { key: "c", id: null, text: "Pictures of the new pages", depth: 1 },
    { key: "d", id: null, text: "Tell the newsletter readers", depth: 0 },
    { key: "e", id: null, text: "Ask three customers for a quote", depth: 0 },
  ];
  const list = document.getElementById("dm-list");
  list.replaceChildren();
  for (const [i, line] of dm.lines.entries()) {
    const body = document.createElement("div"); body.className = "note-text"; body.contentEditable = "plaintext-only"; body.dataset.index = String(i); body.textContent = line.text;
    const check = document.createElement("span"); check.className = "note-check static";
    const main = document.createElement("div"); main.className = "note-main"; main.append(body);
    const row = document.createElement("div"); row.className = "note-line"; row.style.marginLeft = (line.depth * 22) + "px"; row.append(check, main);
    list.append(row);
  }
  document.activeElement && document.activeElement.blur();
`;
const SHOTS = [
  { file: "projects.png", url: "/", width: 1200, height: 300, theme: "dark" },
  { file: "board.png", url: "/p/website", width: 1200, height: 540, theme: "dark" },
  { file: "draft.png", url: "/p/website", width: 1200, height: 540, theme: "dark", setup: DRAFT_PAD },
  { file: "timeline.png", url: "/p/website/tree", width: 1200, height: 340, theme: "dark", setup: `document.getElementById("tl-wrap").scrollLeft = 0;` },
  { file: "theme-paper.png", url: "/p/website", width: 1200, height: 540, theme: "paper" },
  { file: "theme-midnight.png", url: "/p/website", width: 1200, height: 540, theme: "midnight" },
];

// ---- a tiny DevTools client
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let next = 1;
    ws.onopen = () => resolve({
      send(method, params = {}, sessionId) {
        const id = next++;
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((ok, no) => pending.set(id, { ok, no }));
      },
      close: () => ws.close(),
    });
    ws.onerror = e => reject(new Error(`DevTools socket: ${e.message || "failed"}`));
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
      }
    };
  });
}

const profile = await fs.mkdtemp(path.join(os.tmpdir(), "projecttodo-shots-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1400,900", "about:blank"], { stdio: "ignore" });
try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); }
  }
  if (!version) throw new Error("Chrome did not start (set CHROME to its path).");
  const browser = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => browser.send(method, params, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  const evaluate = async expression => (await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const waitFor = async (expression, ms = 15000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timed out waiting for: ${expression}`); };

  for (const shot of SHOTS) {
    await page("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: 2, mobile: false });
    await page("Page.navigate", { url: `${BASE}/` });
    await waitFor(`document.readyState === "complete"`);
    await evaluate(`localStorage.setItem("projecttodo-theme", ${JSON.stringify(shot.theme)}); localStorage.removeItem("projecttodo-fold"); localStorage.setItem("projecttodo-zoom", "1"); true`);
    await page("Page.navigate", { url: BASE + shot.url });
    await waitFor(`window.boardDebug && window.boardDebug.state.loaded && document.fonts.status === "loaded"`);
    if (shot.setup) await evaluate(`(() => { ${shot.setup} return true; })()`);
    await sleep(500);
    const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(path.join(OUT, shot.file), Buffer.from(data, "base64"));
    console.log("wrote", shot.file);
  }
  browser.close();
} finally {
  // Chrome keeps writing its profile for a moment after it is told to quit: wait for it before removing the folder.
  const gone = new Promise(resolve => { chrome.once("exit", resolve); setTimeout(resolve, 3000); });
  chrome.kill();
  await gone;
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
