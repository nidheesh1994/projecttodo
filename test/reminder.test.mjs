// node --test: a due reminder reaches an open page once, and is stamped so it is not sent again.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("a due reminder is sent to an open page and stamped", { timeout: 15000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "projecttodo-"));
  const port = 3900 + Math.floor(Math.random() * 90);
  // a Claude folder with two sessions recorded with "HEAD": one working in a repository, one in a folder that only holds it
  await fs.mkdir(path.join(dir, "work", "api", ".git"), { recursive: true });
  await fs.writeFile(path.join(dir, "work", "api", ".git", "HEAD"), "ref: refs/heads/feature/x\n");
  await fs.mkdir(path.join(dir, "claude", "projects", "p"), { recursive: true });
  await fs.writeFile(path.join(dir, "claude", "projects", "p", "s1.jsonl"), JSON.stringify({ type: "user", cwd: path.join(dir, "work", "api"), gitBranch: "HEAD" }) + "\n" + JSON.stringify({ type: "ai-title", aiTitle: "In the repository" }) + "\n");
  await fs.writeFile(path.join(dir, "claude", "projects", "p", "s3.jsonl"), JSON.stringify({ type: "user", cwd: dir, turnOrigin: "scheduled" }) + "\n" + JSON.stringify({ type: "ai-title", aiTitle: "A scheduled run, not listed" }) + "\n");
  await fs.writeFile(path.join(dir, "claude", "projects", "p", "s2.jsonl"), JSON.stringify({ type: "user", cwd: path.join(dir, "work"), gitBranch: "HEAD" }) + "\n" + JSON.stringify({ type: "ai-title", aiTitle: "Above it" }) + "\n");
  const server = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", PROJECTTODO_DATA_DIR: dir, PROJECTTODO_CLAUDE_DIR: path.join(dir, "claude") }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/projects"); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
    const { project } = await post("/api/projects", { data: { name: "T" } });
    await post("/api/todos", { data: { id: "due", project_id: project.id, title: "Call back", remind_at: "2000-01-01T09:00" } });
    await post("/api/todos", { data: { id: "later", project_id: project.id, title: "Not yet", remind_at: "2999-01-01T09:00" } });
    const bad = await fetch(base + "/api/todos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { id: "bad", project_id: project.id, title: "x", remind_at: "tomorrow" } }) });
    assert.equal(bad.status, 400);
    // a reminder may go without a project; any other to-do may not
    const loose = await post("/api/todos", { data: { id: "loose", title: "Ring the bank", remind_at: "2999-01-01T09:00" } });
    assert.equal(loose.todo.project_id, null);
    assert.equal((await fetch(base + "/api/todos/loose", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ if_version: loose.todo.version, data: { remind_at: null } }) })).status, 400, "it cannot lose its time");
    assert.equal((await fetch(base + "/api/todos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { id: "orphan", title: "No project, no time" } }) })).status, 400);
    // the journal keeps the entries of real projects for a day
    const j = await post("/api/journal", { day: "2026-11-20", entries: [{ project_id: project.id, text: "Built the thing" }, { project_id: "nope", text: "dropped" }] });
    assert.deepEqual(j.entries, [{ project_id: project.id, text: "Built the thing" }]);
    const claude = await (await fetch(base + "/api/claude")).json();
    assert.deepEqual(claude.journal, { "2026-11-20": j.entries });
    assert.deepEqual(claude.sessions.map(s => [s.title, s.folder, s.branch]).sort(), [["Above it", "work", null], ["In the repository", "api", "feature/x"]]);
    // an open page gets the due one (not the future one); the server does not mark it sent by itself
    const listen = async ms => { const reader = (await fetch(base + "/api/events")).body.getReader(); let text = ""; const stop = Date.now() + ms; while (Date.now() < stop && !text.includes("event: reminder")) { const r = await Promise.race([reader.read(), new Promise(ok => setTimeout(() => ok(null), stop - Date.now()))]); if (!r || r.done) break; text += Buffer.from(r.value).toString(); } reader.cancel().catch(() => {}); return text.includes("event: reminder") ? JSON.parse(text.split("event: reminder\ndata: ")[1].split("\n")[0]) : null; };
    const sent = await listen(5000);
    assert.deepEqual(sent.map(r => r.id), ["due"]);
    let rows = (await (await fetch(base + "/api/todos")).json()).todos;
    assert.ok(!rows.find(r => r.id === "due").reminded_at, "a page that showed nothing leaves it unsent");
    assert.deepEqual((await listen(5000)).map(r => r.id), ["due"], "so the next page gets it again");
    // the page that showed the notification says so; after that it is not sent again
    await fetch(base + "/api/todos/due", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ if_version: sent[0].version, data: { reminded_at: new Date().toISOString() } }) });
    assert.equal(await listen(700), null);
  } finally { server.kill(); await fs.rm(dir, { recursive: true, force: true }); }
});
