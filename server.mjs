#!/usr/bin/env node
// ProjectTodo (README.md): one page, a small JSON store and an MCP endpoint, served locally.
// No dependencies. A person and their assistant edit the same rows: the page through
// this API, the assistant through MCP (mcp.mjs over stdio, or POST /mcp over HTTP).
//
//   PORT                       3004
//   HOST                       127.0.0.1
//   PROJECTTODO_DATA_DIR       where todos.json lives (default: ./data next to this file)
//   PROJECTTODO_DOCS_DIR       the folder a to-do's `doc` path is read from (default: the data dir's parent)
//   PROJECTTODO_DOC_WRITE_DIR  where the write_doc tool may create markdown files, inside the docs folder (default: todos)
//   PROJECTTODO_DEFAULT_PROJECT  the name of the project made for rows from before projects existed
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.PROJECTTODO_DATA_DIR || path.join(ROOT, "data"));
const DATA = path.join(DATA_DIR, "todos.json");
const DOCS_DIR = path.resolve(process.env.PROJECTTODO_DOCS_DIR || path.dirname(DATA_DIR));
const DOC_WRITE_DIR = path.resolve(DOCS_DIR, process.env.PROJECTTODO_DOC_WRITE_DIR || "todos");
// A project may keep its rows in its own folder (<data_dir>/todos.json) and read and write its documents in its own
// docs folder. Paths are absolute, ~/…, or relative to the server's data folder; empty means the server's defaults.
const resolveDir = p => { p = String(p).trim(); if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(1)); return path.isAbsolute(p) ? path.normalize(p) : path.resolve(DATA_DIR, p); };
const dataDirOf = project => (project && project.data_dir ? resolveDir(project.data_dir) : null);   // null: the rows live in the main file
const docsDirOf = project => (project && project.docs_dir ? resolveDir(project.docs_dir) : DOCS_DIR);
const writeDirOf = project => (project && project.docs_dir ? resolveDir(project.docs_dir) : DOC_WRITE_DIR);
const cleanDir = v => { if (v === null || v === undefined) return null; const s = String(v).trim(); if (!s) return null; if (s.includes("\0") || s.length > 500) throw new HttpError(400, "invalid_argument", "A folder path is a plain path of at most 500 characters."); return s; };
const retiredDirs = new Set();   // folders a project moved away from: written once more without its rows
const PLAYBOOK = path.join(ROOT, "PLAYBOOK.md");
const PUBLIC = path.join(ROOT, "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3004);
const STATUSES = new Set(["draft", "todo", "doing", "done", "deferred"]);
const TODO_KEYS = new Set(["id", "project_id", "title", "notes", "parent_id", "next_id", "order", "status", "owner", "doc", "docs", "estimate_days", "planned_start", "planned_end", "actual_start", "actual_start_time", "actual_done", "actual_done_time", "created_at", "updated_at", "version"]);
const OWNERS = new Set(["user", "assistant", "both"]);
const BOARD_ORDER = ["draft", "doing", "todo", "done", "deferred"];
// A project's board columns: their order and a colour each, as the person set them on the board page.
function cleanLanes(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "invalid_argument", "lanes is an object with order and colors, or null.");
  const out = {};
  if (Array.isArray(v.order)) {
    if (v.order.some(k => !STATUSES.has(k)) || new Set(v.order).size !== v.order.length) throw new HttpError(400, "invalid_argument", "lanes.order lists each status at most once: draft, doing, todo, done, deferred.");
    out.order = [...v.order, ...BOARD_ORDER.filter(k => !v.order.includes(k))];
  }
  if (v.colors && typeof v.colors === "object" && !Array.isArray(v.colors)) {
    out.colors = {};
    for (const [k, c] of Object.entries(v.colors)) {
      if (!STATUSES.has(k)) throw new HttpError(400, "invalid_argument", `${k} is not a status.`);
      if (c === null || c === undefined || c === "") continue;
      if (typeof c !== "string" || !/^#[0-9a-fA-F]{6}$/.test(c)) throw new HttpError(400, "invalid_argument", "A column colour is written #rrggbb.");
      out.colors[k] = c.toLowerCase();
    }
  }
  return out;
}
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const BOOT = Date.now().toString(36);   // changes on every start: pages reload when they see a new one
let store = { revision: 0, projects: [], todos: [] };
let chain = Promise.resolve();
const clients = new Set();

// ---------- the store ----------
async function load() {
  try {
    const parsed = JSON.parse(await fs.readFile(DATA, "utf8"));
    store = { revision: Number(parsed.revision) || 0, projects: Array.isArray(parsed.projects) ? parsed.projects : [], todos: Array.isArray(parsed.todos) ? parsed.todos : [] };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  // the rows of projects that keep their own file
  for (const project of store.projects) {
    const dir = dataDirOf(project);
    if (!dir) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, "todos.json"), "utf8"));
      for (const row of (Array.isArray(parsed.todos) ? parsed.todos : [])) if (!store.todos.some(r => r.id === row.id)) { row.project_id = project.id; store.todos.push(row); }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  // Rows from before projects existed go into one project; an owner called "claude" becomes "assistant".
  let changed = false;
  if (store.todos.length && !store.projects.length) {
    const name = process.env.PROJECTTODO_DEFAULT_PROJECT || "My project";
    const stamp = new Date().toISOString();
    store.projects.push({ id: slug(name), name, description: "", current_id: null, created_at: stamp, updated_at: stamp, version: 1 });
    changed = true;
  }
  for (const row of store.todos) {
    if (!row.project_id && store.projects[0]) { row.project_id = store.projects[0].id; changed = true; }
    if (row.owner === "claude") { row.owner = "assistant"; changed = true; }
  }
  if (changed || !(await exists(DATA))) await persist();
}
const exists = async p => { try { await fs.stat(p); return true; } catch { return false; } };

function serial(fn) {
  const next = chain.then(fn);
  chain = next.catch(() => {});
  return next;
}

async function writeJson(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}
// The main file holds the projects and the rows of projects without a folder of their own; each other folder's
// todos.json holds the rows of the projects that point at it.
async function persist() {
  store.todos.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  store.projects.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const own = new Map();
  for (const project of store.projects) { const dir = dataDirOf(project); if (dir && !own.has(dir)) own.set(dir, []); }
  for (const dir of retiredDirs) if (!own.has(dir)) own.set(dir, []);
  const mainRows = [];
  for (const row of store.todos) { const dir = dataDirOf(findProject(row.project_id)); if (dir) own.get(dir).push(row); else mainRows.push(row); }
  await writeJson(DATA, { revision: store.revision, projects: store.projects, todos: mainRows });
  for (const [dir, rows] of own) { await fs.mkdir(dir, { recursive: true }); await writeJson(path.join(dir, "todos.json"), { revision: store.revision, todos: rows }); }
  retiredDirs.clear();
}
// A project that points at a folder whose todos.json already has rows takes them in (ids not already on the board).
async function adoptRows(project, dir) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, "todos.json"), "utf8"));
    for (const row of (Array.isArray(parsed.todos) ? parsed.todos : [])) if (!findTodo(row.id)) { row.project_id = project.id; store.todos.push(row); }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function commit() {
  store.revision += 1;
  await persist();
  const payload = `event: change\ndata: ${JSON.stringify({ revision: store.revision, boot: BOOT })}\n\n`;
  for (const client of clients) client.write(payload);
}

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const slug = text => (String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "item";
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const isDay = v => v === null || v === undefined || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
const isTime = v => v === null || v === undefined || (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
// Times of day ride with the actual dates: a write that sets a date to today without a time gets the time now; a date
// that changes without a time loses the old one; a status change to doing or done stamps the dates it needs.
function stampTimes(existing, patch) {
  const today = todayStr();
  const out = { ...patch };
  for (const [date, time] of [["actual_start", "actual_start_time"], ["actual_done", "actual_done_time"]]) {
    if (date in out && !(time in out) && out[date] !== (existing ? existing[date] : null)) out[time] = out[date] === today ? nowTime() : null;
    if (date in out && out[date] === null) out[time] = null;
  }
  const next = { ...(existing || {}), ...out };
  if (out.status === "doing" && !next.actual_start) { out.actual_start = today; out.actual_start_time = nowTime(); }
  if (out.status === "done") {
    if (!next.actual_done) { out.actual_done = today; out.actual_done_time = nowTime(); }
    if (!next.actual_start) { out.actual_start = today; out.actual_start_time = nowTime(); }
  }
  if (existing && existing.status === "done" && out.status && out.status !== "done" && !("actual_done" in out)) { out.actual_done = null; out.actual_done_time = null; }
  return out;
}
const findTodo = id => store.todos.find(row => row.id === id) || null;
const findProject = id => store.projects.find(row => row.id === id) || null;

function cleanTodo(data, { creating } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "invalid_argument", "The data must be an object.");
  const row = { ...data };
  delete row.version;
  const unknown = Object.keys(row).filter(k => !TODO_KEYS.has(k));
  if (unknown.length) throw new HttpError(400, "unknown_field", `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Give the fields themselves (title, status, …), not a wrapper object.`);
  if (creating) {
    const id = String(row.id || "").trim();
    if (!/^[A-Za-z0-9_.:+@~-]{1,120}$/.test(id)) throw new HttpError(400, "invalid_argument", "An id is required: letters, digits, dashes, dots or underscores.");
    row.id = id;
    if (!String(row.title || "").trim() && row.status !== "draft") throw new HttpError(400, "invalid_argument", "A title is required (only a draft may leave it empty).");
    if (!row.project_id || !findProject(String(row.project_id))) throw new HttpError(400, "invalid_argument", "A to-do belongs to a project: give an existing project_id.");
  } else {
    delete row.id;
    if ("project_id" in row && !findProject(String(row.project_id))) throw new HttpError(400, "invalid_argument", "There is no project with that id.");
  }
  if ("status" in row && !STATUSES.has(row.status)) throw new HttpError(400, "invalid_argument", "The status must be draft, todo, doing, done or deferred.");
  if ("owner" in row && row.owner !== null && !OWNERS.has(row.owner)) throw new HttpError(400, "invalid_argument", "The owner must be user, assistant, both or null.");
  for (const key of ["planned_start", "planned_end", "actual_start", "actual_done"]) if (key in row && !isDay(row[key])) throw new HttpError(400, "invalid_argument", `${key} must be a date as YYYY-MM-DD, or null.`);
  for (const key of ["actual_start_time", "actual_done_time"]) if (key in row && !isTime(row[key])) throw new HttpError(400, "invalid_argument", `${key} must be a time of day as HH:MM (24-hour), or null.`);
  if ("docs" in row && row.docs !== null) {
    if (!Array.isArray(row.docs) || row.docs.some(d => typeof d !== "string")) throw new HttpError(400, "invalid_argument", "docs is a list of paths, or null.");
    row.docs = [...new Set(row.docs.map(d => d.trim()).filter(Boolean))];
    if (!row.docs.length) row.docs = null;
  }
  return row;
}

// Every write names the version it read (if_version); a write to a row someone changed meanwhile is refused with the current version.
function plan(write) {
  const op = write.op;
  if (op === "set") {
    const row = cleanTodo(write.data, { creating: true });
    const existing = findTodo(row.id);
    if (existing && write.if_version === undefined) throw new HttpError(409, "already_exists", `A to-do with id ${row.id} already exists.`, { version: existing.version });
    if (existing && Number(write.if_version) !== existing.version) throw new HttpError(409, "version_mismatch", "This to-do was changed meanwhile; it was reloaded.", { version: existing.version });
    if (Array.isArray(row.docs) && row.doc) { row.docs = row.docs.filter(d => d !== row.doc); if (!row.docs.length) row.docs = null; }
    return () => {
      const next = { ...row, ...stampTimes(existing, row), version: existing ? existing.version + 1 : 1 };
      if (next.status === "done" && !(existing && existing.status === "done") && !("order" in row && existing)) {
        const doneSibs = store.todos.filter(r => r.id !== next.id && r.project_id === next.project_id && (r.parent_id || null) === (next.parent_id || null) && r.status === "done");
        if (doneSibs.length) next.order = Math.min(...doneSibs.map(r => Number(r.order) || 0)) - 10;
      }
      if (existing) store.todos[store.todos.indexOf(existing)] = next;
      else store.todos.push(next);
      return next;
    };
  }
  if (op === "update" || op === "delete") {
    const id = String(write.id || "");
    const existing = findTodo(id);
    if (!existing) throw new HttpError(404, "not_found", `There is no to-do with id ${id}.`);
    if (write.if_version === undefined) throw new HttpError(409, "version_required", "Say which version you read (if_version).", { version: existing.version });
    if (Number(write.if_version) !== existing.version) throw new HttpError(409, "version_mismatch", "This to-do was changed meanwhile; it was reloaded.", { version: existing.version });
    if (op === "delete") return () => { store.todos.splice(store.todos.indexOf(existing), 1); for (const p of store.projects) if (p.current_id === id) p.current_id = null; return { id, deleted: true }; };
    const patch = cleanTodo(write.data);
    const nextTitle = "title" in patch ? patch.title : existing.title, nextStatus = "status" in patch ? patch.status : existing.status;
    const nextDoc = "doc" in patch ? patch.doc : existing.doc, nextDocs = "docs" in patch ? patch.docs : existing.docs;
    if (Array.isArray(nextDocs) && nextDoc && nextDocs.includes(nextDoc)) patch.docs = nextDocs.filter(d => d !== nextDoc).length ? nextDocs.filter(d => d !== nextDoc) : null;
    if (nextStatus !== "draft" && !String(nextTitle || "").trim()) throw new HttpError(400, "invalid_argument", "A to-do needs a title before it leaves Drafts.");
    return () => {
      const next = { ...existing, ...stampTimes(existing, patch), version: existing.version + 1 };
      // a to-do that has just finished goes above its finished siblings: the latest done sits at the top (the person can move it later)
      if (next.status === "done" && existing.status !== "done" && !("order" in patch)) {
        const doneSibs = store.todos.filter(r => r.id !== existing.id && r.project_id === existing.project_id && (r.parent_id || null) === (next.parent_id || null) && r.status === "done");
        if (doneSibs.length) next.order = Math.min(...doneSibs.map(r => Number(r.order) || 0)) - 10;
      }
      store.todos[store.todos.indexOf(existing)] = next;
      return next;
    };
  }
  throw new HttpError(400, "invalid_argument", "The op must be set, update or delete.");
}

async function applyWrites(writes) {
  return serial(async () => {
    if (!Array.isArray(writes) || writes.length === 0 || writes.length > 200) throw new HttpError(400, "invalid_argument", "Give between 1 and 200 writes.");
    const seen = new Set();
    const steps = writes.map((write) => {
      const id = write.op === "set" ? String(write.data && write.data.id || "") : String(write.id || "");
      if (seen.has(id)) throw new HttpError(400, "invalid_argument", `The to-do ${id} appears twice in one batch.`);
      seen.add(id);
      return plan(write);
    });
    const todosBefore = store.todos.slice();
    const currentsBefore = store.projects.map(p => p.current_id);
    const results = steps.map((step) => step());
    try {
      checkDone(writes, results);
      // A child that has started starts its parents: an ancestor without an actual start takes the child's start (user, 2026-10-05).
      for (const row of results) {
        if (!row || row.deleted || !row.actual_start) continue;
        let p = row.parent_id ? findTodo(row.parent_id) : null;
        const seen = new Set([row.id]);
        while (p && !seen.has(p.id)) {
          seen.add(p.id);
          if (!p.actual_start) { const next = { ...p, actual_start: row.actual_start, actual_start_time: row.actual_start_time || null, updated_at: new Date().toISOString(), version: p.version + 1 }; store.todos[store.todos.indexOf(p)] = next; p = next; }
          p = p.parent_id ? findTodo(p.parent_id) : null;
        }
      }
      // The current to-do is the one in Current: finished or moved to another column, it is no longer the project's current one.
      for (const row of results) if (row && !row.deleted && row.status !== "doing") for (const p of store.projects) if (p.current_id === row.id) { p.current_id = null; p.updated_at = new Date().toISOString(); p.version += 1; }
    } catch (error) {
      store.todos = todosBefore;
      store.projects.forEach((p, i) => { p.current_id = currentsBefore[i]; });
      throw error;
    }
    await commit();
    return results;
  });
}

// A to-do is done only when everything under it is done: a write that marks one done while a descendant is open is refused as a whole.
function checkDone(writes, results) {
  const kids = new Map();
  for (const row of store.todos) { const p = row.parent_id || null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(row); }
  writes.forEach((write, i) => {
    const row = results[i];
    if (!write.data || write.data.status !== "done" || !row || row.deleted) return;
    const open = [], seen = new Set([row.id]);
    const walk = id => { for (const k of kids.get(id) || []) { if (seen.has(k.id)) continue; seen.add(k.id); if (k.status !== "done") open.push(k.id); walk(k.id); } };
    walk(row.id);
    if (open.length) throw new HttpError(409, "children_open", `"${row.title}" still has ${open.length === 1 ? "one open to-do" : `${open.length} open to-dos`} under it. Tick them done first.`, { open });
  });
}

// ---------- projects ----------
function projectView(project) {
  const rows = store.todos.filter(row => row.project_id === project.id);
  const current = project.current_id ? findTodo(project.current_id) : null;
  const count = status => rows.filter(row => row.status === status).length;
  const dir = dataDirOf(project);
  return { ...project, paths: { data: dir ? path.join(dir, "todos.json") : DATA, docs: docsDirOf(project), docs_write: writeDirOf(project) }, current: current ? { id: current.id, title: current.title, status: current.status } : null, counts: { total: rows.length, main: rows.filter(row => !row.parent_id && row.status !== "draft").length, draft: count("draft"), doing: count("doing"), todo: count("todo"), done: count("done"), deferred: count("deferred") } };
}

async function createProject(data) {
  return serial(async () => {
    const name = String(data && data.name || "").trim();
    if (!name) throw new HttpError(400, "invalid_argument", "A project needs a name.");
    let id = slug(name);
    for (let n = 2; findProject(id); n++) id = `${slug(name)}-${n}`;
    const stamp = new Date().toISOString();
    const project = { id, name, description: String(data.description || "").trim(), data_dir: cleanDir(data.data_dir), docs_dir: cleanDir(data.docs_dir), current_id: null, created_at: stamp, updated_at: stamp, version: 1 };
    store.projects.push(project);
    const dir = dataDirOf(project);
    if (dir) await adoptRows(project, dir);
    await commit();
    return project;
  });
}

async function updateProject(id, data, ifVersion) {
  return serial(async () => {
    const project = findProject(id);
    if (!project) throw new HttpError(404, "not_found", `There is no project with id ${id}.`);
    if (ifVersion === undefined) throw new HttpError(409, "version_required", "Say which version you read (if_version).", { version: project.version });
    if (Number(ifVersion) !== project.version) throw new HttpError(409, "version_mismatch", "This project was changed meanwhile; it was reloaded.", { version: project.version });
    const patch = {};
    if ("name" in data) { patch.name = String(data.name || "").trim(); if (!patch.name) throw new HttpError(400, "invalid_argument", "A project needs a name."); }
    if ("description" in data) patch.description = String(data.description || "").trim();
    if ("lanes" in data) patch.lanes = cleanLanes(data.lanes);
    for (const key of ["data_dir", "docs_dir"]) if (key in data) patch[key] = cleanDir(data[key]);
    const oldDir = dataDirOf(project);
    if ("current_id" in data) {
      if (data.current_id !== null) {
        const row = findTodo(String(data.current_id));
        if (!row || row.project_id !== id || row.parent_id) throw new HttpError(400, "invalid_argument", "The current to-do must be a main to-do of this project.");
        if (row.status === "done") throw new HttpError(400, "invalid_argument", "A finished to-do cannot be the current one.");
        // Taking a main to-do up: it is in progress from today, unless it already has a start date.
        const next = { ...row, status: row.status === "done" ? row.status : "doing", actual_start: row.actual_start || todayStr(), actual_start_time: row.actual_start ? (row.actual_start_time || null) : nowTime(), updated_at: new Date().toISOString(), version: row.version + 1 };
        store.todos[store.todos.indexOf(row)] = next;
      }
      patch.current_id = data.current_id === null ? null : String(data.current_id);
    }
    Object.assign(project, patch, { updated_at: new Date().toISOString(), version: project.version + 1 });
    const newDir = dataDirOf(project);
    if (oldDir !== newDir) {
      // the rows move with the project: the old file is written once more without them, the new one takes them (and any rows already there)
      if (oldDir) retiredDirs.add(oldDir);
      if (newDir) await adoptRows(project, newDir);
    }
    await commit();
    return project;
  });
}

async function deleteProject(id, ifVersion) {
  return serial(async () => {
    const project = findProject(id);
    if (!project) throw new HttpError(404, "not_found", `There is no project with id ${id}.`);
    if (Number(ifVersion) !== project.version) throw new HttpError(409, "version_mismatch", "This project was changed meanwhile; it was reloaded.", { version: project.version });
    const dir = dataDirOf(project);
    if (dir) retiredDirs.add(dir);
    store.todos = store.todos.filter(row => row.project_id !== id);
    store.projects.splice(store.projects.indexOf(project), 1);
    await commit();
    return { id, deleted: true };
  });
}

// ---------- the md file a to-do names: a markdown file inside the project's docs folder, read fresh each time ----------
function docFolders(projectId) {
  const project = projectId ? findProject(String(projectId)) : null;
  if (projectId && !project) throw new HttpError(404, "not_found", "There is no project with that id.");
  return { docsDir: docsDirOf(project), writeDir: writeDirOf(project) };
}
async function readDoc(relative, projectId) {
  const { docsDir } = docFolders(projectId);
  const clean = String(relative || "").replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || clean.split("/").includes("..") || !clean.toLowerCase().endsWith(".md")) {
    throw new HttpError(400, "invalid_argument", "Give a path to a markdown file, relative to the project's docs folder.");
  }
  const absolute = path.resolve(docsDir, clean);
  if (!absolute.startsWith(docsDir + path.sep)) throw new HttpError(400, "invalid_argument", "The path must stay inside the docs folder.");
  let stat;
  try { stat = await fs.stat(absolute); } catch { throw new HttpError(404, "not_found", `There is no file at ${clean}.`); }
  if (!stat.isFile()) throw new HttpError(404, "not_found", `${clean} is not a file.`);
  return { path: clean, modified: stat.mtime.toISOString(), content: await fs.readFile(absolute, "utf8") };
}

// The playbook (PLAYBOOK.md next to this file): how an assistant is meant to work the board.
async function readPlaybook() {
  try { return await fs.readFile(PLAYBOOK, "utf8"); } catch { throw new HttpError(404, "not_found", "PLAYBOOK.md is missing next to server.mjs."); }
}

// write_doc: a markdown file inside the project's write folder (its own docs folder, or the server's write folder).
// The path may be given relative to the docs folder or to the write folder; the answer gives the path to put in `doc`.
async function writeDoc(relative, content, mode = "create", projectId) {
  const { docsDir, writeDir } = docFolders(projectId);
  const clean = String(relative || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!clean || clean.startsWith("/") || clean.split("/").includes("..") || !clean.toLowerCase().endsWith(".md")) {
    throw new HttpError(400, "invalid_argument", "Give a path ending in .md, relative to the project's docs folder (or to its write folder).");
  }
  if (typeof content !== "string") throw new HttpError(400, "invalid_argument", "content must be a string of markdown.");
  if (Buffer.byteLength(content, "utf8") > 512 * 1024) throw new HttpError(413, "too_large", "The document is larger than 512 KB.");
  if (!["create", "replace", "append"].includes(mode)) throw new HttpError(400, "invalid_argument", "mode must be create, replace or append.");
  if (writeDir !== docsDir && !(writeDir + path.sep).startsWith(docsDir + path.sep)) throw new HttpError(500, "misconfigured", "The write folder must be inside the docs folder.");
  const inside = p => p === writeDir || p.startsWith(writeDir + path.sep);
  let absolute = path.resolve(docsDir, clean);
  if (!inside(absolute)) absolute = path.resolve(writeDir, clean);
  if (!inside(absolute)) throw new HttpError(400, "invalid_argument", `Documents are written inside ${path.relative(docsDir, writeDir) || "."} (the write folder); the path left it.`);
  const shown = path.relative(docsDir, absolute).split(path.sep).join("/");
  let exists = false;
  try { exists = (await fs.stat(absolute)).isFile(); } catch { /* new file */ }
  if (mode === "create" && exists) throw new HttpError(409, "exists", `${shown} already exists. Read it first, then use mode "append" to add to it or "replace" to rewrite it.`);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  if (mode === "append") await fs.appendFile(absolute, (exists && !content.startsWith("\n") ? "\n" : "") + content, "utf8");
  else await fs.writeFile(absolute, content, "utf8");
  const stat = await fs.stat(absolute);
  return { path: shown, bytes: stat.size, modified: stat.mtime.toISOString(), mode, created: !exists };
}

const TODO_FIELDS = {
  title: { type: "string" }, notes: { type: "string" }, parent_id: { type: ["string", "null"], description: "The parent to-do; null for a main to-do." },
  next_id: { type: ["string", "null"], description: "The sibling that comes after this one." }, status: { type: "string", enum: [...STATUSES] },
  owner: { type: ["string", "null"], enum: [...OWNERS, null] }, doc: { type: ["string", "null"], description: "The plan document: a markdown file, relative to the project's docs folder." }, docs: { type: ["array", "null"], items: { type: "string" }, description: "Further documents, as many as needed: paths relative to the project's docs folder." },
  estimate_days: { type: ["number", "null"], description: "Size in days; fractions are hours at 8 hours a day (0.375 = 3 h)." }, planned_start: { type: ["string", "null"], description: "Estimated start, YYYY-MM-DD." }, planned_end: { type: ["string", "null"], description: "Estimated end, YYYY-MM-DD." },
  actual_start: { type: ["string", "null"], description: "YYYY-MM-DD. Setting it to today without a time stamps the time now." }, actual_start_time: { type: ["string", "null"], description: "HH:MM, 24-hour local time; filled by the server when a status change stamps the date." },
  actual_done: { type: ["string", "null"], description: "Actual end, YYYY-MM-DD." }, actual_done_time: { type: ["string", "null"], description: "HH:MM, 24-hour local time." }, order: { type: "number", description: "Position among siblings; 10, 20, 30 …" },
};
const MCP_TOOLS = [
  { name: "get_playbook", description: "How this board is meant to be worked: lanes, rules, how to review drafts, how to plan a to-do with a document, the document template. Call it first.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_projects", description: "The projects, each with its counts and its current main to-do. Start a session here, then list_todos.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "create_project", description: "Make a project. data_dir: the folder whose todos.json holds its rows; docs_dir: the folder its documents are read from and written to; absolute, ~/…, or relative to the server's data folder; leave them out for the server's defaults.", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, data_dir: { type: ["string", "null"] }, docs_dir: { type: ["string", "null"] } }, required: ["name"], additionalProperties: false } },
  { name: "list_todos", description: "The to-dos of a project, in tree order (a child follows its parent), each with created_at (when it was added). Statuses: draft (jotted down, to discuss; review one group at a time), todo (next), doing (current), done, deferred (later). A to-do's doc is the path of its plan document (read_doc).", inputSchema: { type: "object", properties: { project_id: { type: "string" }, status: { type: "string", enum: [...STATUSES] } }, required: ["project_id"], additionalProperties: false } },
  { name: "get_todo", description: "One to-do with every field.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "create_todo", description: "Add a to-do to a project. Without a parent it is a main to-do.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, ...TODO_FIELDS }, required: ["project_id", "title"], additionalProperties: false } },
  { name: "update_todo", description: "Change fields of a to-do. Only the fields given change. After a draft is discussed: status todo (or set_current), owner, estimate_days, planned dates, doc. A to-do cannot be set done while anything under it is open (children_open).", inputSchema: { type: "object", properties: { id: { type: "string" }, ...TODO_FIELDS }, required: ["id"], additionalProperties: false } },
  { name: "delete_todo", description: "Delete a to-do; its children move up one level.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "set_current", description: "Make a main to-do the project's current one: it goes in progress from today. Pass null to clear.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, todo_id: { type: ["string", "null"] } }, required: ["project_id", "todo_id"], additionalProperties: false } },
  { name: "read_doc", description: "Read a to-do's plan document: a markdown file under the project's docs folder, by the path in its doc field. Give project_id so the right folder is used (list_projects shows each project's paths).", inputSchema: { type: "object", properties: { path: { type: "string" }, project_id: { type: "string" } }, required: ["path"], additionalProperties: false } },
  { name: "write_doc", description: "Write a plan document (markdown) inside the docs write folder and get the path to put in the to-do's doc field. mode: create (the default; refuses to overwrite), replace, or append (for Progress and Decisions lines). Follow the playbook's template.", inputSchema: { type: "object", properties: { path: { type: "string", description: "File name or path ending in .md, e.g. export-button.md" }, content: { type: "string" }, mode: { type: "string", enum: ["create", "replace", "append"] }, project_id: { type: "string", description: "The project whose docs folder receives the file; give it whenever the project has folders of its own." } }, required: ["path", "content"], additionalProperties: false } },
  { name: "add_draft", description: "Jot a draft group down: a title and lines (depth 0 for a line, 1 for a child of the line above, and so on), as the board's draft pad does.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, title: { type: "string" }, lines: { type: "array", items: { type: "object", properties: { title: { type: "string" }, depth: { type: "integer", minimum: 0 } }, required: ["title"] } } }, required: ["project_id", "title", "lines"], additionalProperties: false } },
];

// Prompts: ready-made asks a client can offer (Claude Desktop lists them as slash commands).
const MCP_PROMPTS = [
  { name: "review_drafts", description: "Go through a project's draft groups with the person, one at a time, and turn the agreed ones into planned to-dos.", arguments: [{ name: "project_id", description: "The project's id; leave it out to be asked.", required: false }] },
  { name: "plan_todo", description: "Write or update the plan document of one to-do and set its fields to match.", arguments: [{ name: "todo_id", description: "The to-do's id.", required: true }] },
  { name: "daily_review", description: "What finished, what is current, what is next, what slipped; update dates and the progress log.", arguments: [{ name: "project_id", description: "The project's id; leave it out to be asked.", required: false }] },
  { name: "submit_draft", description: "Take one draft group and submit it as planned to-dos, with a plan document when the playbook's rule calls for one.", arguments: [{ name: "which", description: "Which draft: its title, \"the first\", or \"all\"; plus any instruction to apply.", required: false }, { name: "project_id", description: "The project's id; leave it out to be asked.", required: false }] },
];
function promptText(name, args = {}) {
  const project = args.project_id ? `the project ${args.project_id}` : "the project we work in (ask me which if you do not know)";
  switch (name) {
    case "review_drafts": return `Call get_playbook and follow its "Reviewing drafts" section. Then call list_todos for ${project} with status draft. Take the draft groups one at a time, in board order: read the group back to me in your own words, ask what unclear lines mean and what done looks like, propose which lines stay, merge, split or go to Later, and wait for my answer before changing anything. For each agreed group: write its plan document with write_doc, set doc, owner, estimate_days and the planned dates on the group, move it to todo (or set_current if it starts now), give the children status todo with owners, estimates and a next_id chain. Do not delete any of my lines without asking. End each group with a short list of what you changed.`;
    case "plan_todo": return `Call get_playbook and follow its "Planning a to-do" section for the to-do ${args.todo_id || "(ask me which)"}. Read it with get_todo and, if it has a doc, read_doc. Ask me what is unclear, then write or update the plan document with write_doc following the template (Why, Scope, Plan as a checklist that mirrors the child to-dos, Decisions with dates, Open questions, Progress). Set the to-do's fields to match: doc, owner, estimate_days, planned dates. Propose the estimate with a reason and let me confirm it before you write it. Finish with a short list of what changed.`;
    case "submit_draft": return `Call get_playbook and follow its "Reviewing drafts" and "When a document is written" sections. In ${project}, call list_todos with status draft and take ${args.which ? `the draft ${args.which}` : "the first draft group in board order (say which)"}. Read it back to me in a short paragraph, then shape it: a draft with no title is a loose list, so group its lines into one or more to-dos and propose a title for each before anything is written; a single line that only explains the title goes into the group's notes and is deleted; questions and notes go into notes; steps become children with status todo, an owner, an estimate and a next_id chain in the order given. Write the plan document with write_doc when the group has three or more steps, an estimate of half a day or more, or a decision to record, and put its path in doc; otherwise say you skipped it. Set the group's owner, estimate_days and status todo; set_current only if I said to start it. Touch no other draft. End with a short list of what changed and the questions you still have.`;
    case "daily_review": return `Call get_playbook and follow its "Daily review" section for ${project}. Call list_todos and report in a few lines: what finished since yesterday, the current main to-do and how far it is, what is next, what slipped (planned end in the past and not done), and how many draft groups wait. Then ask me what changed and update statuses, owners and dates accordingly, adding dated Progress lines to the documents with write_doc in append mode. Offer to review the oldest draft group.`;
    default: return null;
  }
}

function treeOrder(rows) {
  const kids = new Map();
  for (const row of rows) { const p = row.parent_id || null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(row); }
  for (const list of kids.values()) list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const out = [], seen = new Set();
  const walk = (p, depth) => { for (const row of kids.get(p) || []) { if (seen.has(row.id)) continue; seen.add(row.id); out.push({ ...row, depth }); walk(row.id, depth + 1); } };
  walk(null, 0);
  for (const row of rows) if (!seen.has(row.id)) out.push({ ...row, depth: 0 });
  return out;
}

function newRow(data, stamp) {
  return { notes: "", parent_id: null, next_id: null, status: "todo", owner: null, doc: null, estimate_days: null, planned_start: null, planned_end: null, actual_start: null, actual_start_time: null, actual_done: null, actual_done_time: null, ...data, created_at: stamp, updated_at: stamp };
}

function uniqueId(base) {
  let id = base;
  for (let n = 2; findTodo(id); n++) id = `${base}-${n}`;
  return id;
}

async function mcpCall(name, args = {}) {
  const stamp = new Date().toISOString();
  switch (name) {
    case "get_playbook": return { playbook: await readPlaybook() };
    case "read_doc": return await readDoc(String(args.path || ""), args.project_id);
    case "write_doc": return await writeDoc(args.path, args.content, args.mode || "create", args.project_id);
    case "list_projects": return store.projects.map(projectView);
    case "create_project": return await createProject(args);
    case "list_todos": {
      if (!findProject(String(args.project_id))) throw new HttpError(404, "not_found", "There is no project with that id.");
      const rows = treeOrder(store.todos.filter(row => row.project_id === args.project_id));
      return (args.status ? rows.filter(row => row.status === args.status) : rows).map(({ notes, version, updated_at, ...rest }) => rest);
    }
    case "get_todo": { const row = findTodo(String(args.id)); if (!row) throw new HttpError(404, "not_found", "There is no to-do with that id."); return row; }
    case "create_todo": {
      const { project_id, ...fields } = args;
      const parent = fields.parent_id ? findTodo(String(fields.parent_id)) : null;
      if (fields.parent_id && !parent) throw new HttpError(404, "not_found", "There is no parent with that id.");
      const sibs = store.todos.filter(row => row.project_id === project_id && (row.parent_id || null) === (parent ? parent.id : null));
      const order = fields.order ?? (sibs.length ? Math.max(0, ...sibs.map(s => Number(s.order) || 0)) + 10 : 10);
      const [row] = await applyWrites([{ op: "set", data: newRow({ ...fields, id: uniqueId(slug(fields.title)), project_id, order }, stamp) }]);
      return row;
    }
    case "update_todo": {
      const { id, ...fields } = args;
      const row = findTodo(String(id));
      if (!row) throw new HttpError(404, "not_found", "There is no to-do with that id.");
      const [next] = await applyWrites([{ op: "update", id: row.id, if_version: row.version, data: { ...fields, updated_at: stamp } }]);
      return next;
    }
    case "delete_todo": {
      const row = findTodo(String(args.id));
      if (!row) throw new HttpError(404, "not_found", "There is no to-do with that id.");
      const kids = store.todos.filter(k => k.parent_id === row.id);
      await applyWrites([...kids.map(k => ({ op: "update", id: k.id, if_version: k.version, data: { parent_id: row.parent_id || null, updated_at: stamp } })), { op: "delete", id: row.id, if_version: row.version }]);
      return { id: row.id, deleted: true };
    }
    case "set_current": {
      const project = findProject(String(args.project_id));
      if (!project) throw new HttpError(404, "not_found", "There is no project with that id.");
      return projectView(await updateProject(project.id, { current_id: args.todo_id === null ? null : String(args.todo_id) }, project.version));
    }
    case "add_draft": {
      if (!findProject(String(args.project_id))) throw new HttpError(404, "not_found", "There is no project with that id.");
      const roots = store.todos.filter(row => row.project_id === args.project_id && !row.parent_id);
      const groupId = uniqueId(slug(args.title));
      const writes = [{ op: "set", data: newRow({ id: groupId, project_id: args.project_id, title: String(args.title), status: "draft", owner: "user", order: roots.length ? Math.max(0, ...roots.map(s => Number(s.order) || 0)) + 10 : 10 }, stamp) }];
      const stack = [groupId], counters = new Map(), taken = new Set([groupId]);
      for (const line of args.lines || []) {
        const title = String(line.title || "").trim();
        if (!title) continue;
        const depth = Math.min(Math.max(0, Number(line.depth) || 0), stack.length - 1);
        const parentId = stack[depth];
        const order = (counters.get(parentId) || 0) + 10;
        counters.set(parentId, order);
        let id = uniqueId(slug(title));
        for (let n = 2; taken.has(id); n++) id = `${slug(title)}-${n}`;
        taken.add(id);
        writes.push({ op: "set", data: newRow({ id, project_id: args.project_id, title, parent_id: parentId, order, status: "draft", owner: "user" }, stamp) });
        stack.length = depth + 1;
        stack.push(id);
      }
      const [group] = await applyWrites(writes);
      return { group, lines: writes.length - 1 };
    }
    default: throw new HttpError(404, "not_found", `Unknown tool: ${name}`);
  }
}

async function mcpMessage(msg) {
  const id = msg && msg.id;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Not a JSON-RPC 2.0 request.");
  if (id === undefined) return null;   // a notification: nothing to answer
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params && msg.params.protocolVersion;
      return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: "projecttodo", version: "0.2.0" }, instructions: "A to-do board shared with a person. Call get_playbook first: it says how the board is worked. In short: projects hold to-dos; a to-do without a parent is a main to-do and sits on the timeline by its dates. Lanes are statuses: draft (jotted down by the person, to discuss one group at a time), todo (Next), doing (Current), done, deferred (Later). After a draft is discussed, write its plan with write_doc, put the path in doc, set owner, estimate_days and planned dates, and move it on (set_current for the one that starts now). Setting status doing or done stamps the actual date and time of day; keep them current. Estimates are days, with fractions for hours (8 hours a day). A to-do is done only when everything under it is done. A draft group with a single line is usually a title and its explanation: put the line in the group's notes and delete it, unless it is a step that can be finished on its own. A draft with no title is a loose list: group its lines into one or more to-dos, propose a title for each, confirm, then create them. Never delete the person's other draft lines or invent estimates without asking. list_projects shows each project's folders under paths; pass project_id to read_doc and write_doc. Dates are YYYY-MM-DD." });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: MCP_TOOLS });
    case "prompts/list": return reply({ prompts: MCP_PROMPTS });
    case "prompts/get": {
      const name = msg.params && msg.params.name;
      const prompt = MCP_PROMPTS.find(p => p.name === name);
      const args = (msg.params && msg.params.arguments) || {};
      if (!prompt) return fail(-32602, `Unknown prompt: ${name}`);
      for (const a of prompt.arguments) if (a.required && !args[a.name]) return fail(-32602, `The prompt ${name} needs ${a.name}.`);
      return reply({ description: prompt.description, messages: [{ role: "user", content: { type: "text", text: promptText(name, args) } }] });
    }
    case "tools/call": {
      const name = msg.params && msg.params.name;
      try {
        const result = await mcpCall(name, (msg.params && msg.params.arguments) || {});
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: Array.isArray(result) ? { items: result } : result, isError: false });
      } catch (error) {
        if (error instanceof HttpError) return reply({ content: [{ type: "text", text: `${error.code}: ${error.message}` }], isError: true });
        throw error;
      }
    }
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}

// ---------- http ----------
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { reject(new HttpError(413, "too_large", "The request body is too large.")); req.destroy(); }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new HttpError(400, "invalid_json", "The body is not JSON.")); }
    });
    req.on("error", reject);
  });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

async function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const absolute = path.resolve(PUBLIC, relative);
  if (!absolute.startsWith(PUBLIC + path.sep)) throw new HttpError(404, "not_found", "Not found.");
  let content;
  try { content = await fs.readFile(absolute); } catch { throw new HttpError(404, "not_found", "Not found."); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(absolute)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;
  try {
    if (pathname === "/api/projects" && req.method === "GET") return send(res, 200, { revision: store.revision, projects: store.projects.map(projectView), defaults: { data_dir: DATA_DIR, docs_dir: DOCS_DIR, docs_write_dir: DOC_WRITE_DIR } });
    if (pathname === "/api/projects" && req.method === "POST") { const body = await readBody(req); return send(res, 201, { revision: store.revision, project: projectView(await createProject(body.data || body)) }); }
    const oneProject = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (oneProject && (req.method === "PATCH" || req.method === "PUT")) { const body = await readBody(req); return send(res, 200, { revision: store.revision, project: projectView(await updateProject(decodeURIComponent(oneProject[1]), body.data || {}, body.if_version)) }); }
    if (oneProject && req.method === "DELETE") { const body = await readBody(req); await deleteProject(decodeURIComponent(oneProject[1]), body.if_version ?? url.searchParams.get("if_version")); return send(res, 200, { revision: store.revision, deleted: decodeURIComponent(oneProject[1]) }); }
    if (pathname === "/api/todos" && req.method === "GET") {
      const project = url.searchParams.get("project");
      return send(res, 200, { revision: store.revision, todos: project ? store.todos.filter(row => row.project_id === project) : store.todos });
    }
    if (pathname === "/api/todos" && req.method === "POST") {
      const body = await readBody(req);
      const [row] = await applyWrites([{ op: "set", data: body.data || body, if_version: body.if_version }]);
      return send(res, 201, { revision: store.revision, todo: row });
    }
    const one = pathname.match(/^\/api\/todos\/([^/]+)$/);
    if (one && (req.method === "PATCH" || req.method === "PUT")) {
      const body = await readBody(req);
      const [row] = await applyWrites([{ op: "update", id: decodeURIComponent(one[1]), data: body.data || body, if_version: body.if_version ?? url.searchParams.get("if_version") ?? undefined }]);
      return send(res, 200, { revision: store.revision, todo: row });
    }
    if (one && req.method === "DELETE") {
      const body = await readBody(req);
      const ifVersion = body.if_version ?? url.searchParams.get("if_version") ?? undefined;
      await applyWrites([{ op: "delete", id: decodeURIComponent(one[1]), if_version: ifVersion === undefined || ifVersion === null ? undefined : Number(ifVersion) }]);
      return send(res, 200, { revision: store.revision, deleted: decodeURIComponent(one[1]) });
    }
    if (pathname === "/api/batch" && req.method === "POST") { const body = await readBody(req); const results = await applyWrites(body.writes); return send(res, 200, { revision: store.revision, results }); }
    if (pathname === "/api/doc" && req.method === "GET") return send(res, 200, await readDoc(url.searchParams.get("path"), url.searchParams.get("project") || undefined));
    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(`retry: 1000\nevent: change\ndata: ${JSON.stringify({ revision: store.revision, boot: BOOT })}\n\n`);
      clients.add(res);
      const beat = setInterval(() => res.write(": keep-alive\n\n"), 25000);
      req.on("close", () => { clearInterval(beat); clients.delete(res); });
      return;
    }
    if (pathname === "/mcp") {
      if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); return res.end(); }
      const body = await readBody(req);
      const messages = Array.isArray(body) ? body : [body];
      const answers = (await Promise.all(messages.map(mcpMessage))).filter(Boolean);
      if (!answers.length) { res.writeHead(202); return res.end(); }
      return send(res, 200, Array.isArray(body) ? answers : answers[0]);
    }
    if (pathname.startsWith("/api/")) throw new HttpError(404, "not_found", "No such route.");
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method_not_allowed", "Only GET here.");
    // One page: the projects at /, a project's board at /p/<id>, its timeline at /p/<id>/tree.
    return await serveStatic(res, /^\/p\/[^/]+(\/tree)?\/?$/.test(pathname) ? "/" : pathname);
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, { code: error.code, message: error.message, ...error.extra });
    console.error(error);
    return send(res, 500, { code: "error", message: error.message || "Something went wrong." });
  }
});

await load();
server.listen(PORT, HOST, () => {
  console.log(`ProjectTodo on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  data: ${DATA}  docs: ${DOCS_DIR}  mcp: POST /mcp`);
});
