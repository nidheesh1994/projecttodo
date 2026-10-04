#!/usr/bin/env node
// ProjectTodo (README.md): one page, a small JSON store and an MCP endpoint, served locally.
// No dependencies. A person and their assistant edit the same rows: the page through
// this API, the assistant through MCP (mcp.mjs over stdio, or POST /mcp over HTTP).
//
//   PORT                       3004
//   HOST                       127.0.0.1
//   PROJECTTODO_DATA_DIR       where todos.json lives (default: ./data next to this file)
//   PROJECTTODO_DOCS_DIR       the folder a to-do's `doc` path is read from (default: the data dir's parent)
//   PROJECTTODO_DEFAULT_PROJECT  the name of the project made for rows from before projects existed
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.PROJECTTODO_DATA_DIR || path.join(ROOT, "data"));
const DATA = path.join(DATA_DIR, "todos.json");
const DOCS_DIR = path.resolve(process.env.PROJECTTODO_DOCS_DIR || path.dirname(DATA_DIR));
const PUBLIC = path.join(ROOT, "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3004);
const STATUSES = new Set(["draft", "todo", "doing", "done", "deferred"]);
const OWNERS = new Set(["user", "assistant", "both"]);
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

async function persist() {
  store.todos.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  store.projects.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const tmp = `${DATA}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  await fs.rename(tmp, DATA);
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
const findTodo = id => store.todos.find(row => row.id === id) || null;
const findProject = id => store.projects.find(row => row.id === id) || null;

function cleanTodo(data, { creating } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "invalid_argument", "The data must be an object.");
  const row = { ...data };
  delete row.version;
  if (creating) {
    const id = String(row.id || "").trim();
    if (!/^[A-Za-z0-9_.:+@~-]{1,120}$/.test(id)) throw new HttpError(400, "invalid_argument", "An id is required: letters, digits, dashes, dots or underscores.");
    row.id = id;
    if (!String(row.title || "").trim()) throw new HttpError(400, "invalid_argument", "A title is required.");
    if (!row.project_id || !findProject(String(row.project_id))) throw new HttpError(400, "invalid_argument", "A to-do belongs to a project: give an existing project_id.");
  } else {
    delete row.id;
    if ("project_id" in row && !findProject(String(row.project_id))) throw new HttpError(400, "invalid_argument", "There is no project with that id.");
  }
  if ("status" in row && !STATUSES.has(row.status)) throw new HttpError(400, "invalid_argument", "The status must be draft, todo, doing, done or deferred.");
  if ("owner" in row && row.owner !== null && !OWNERS.has(row.owner)) throw new HttpError(400, "invalid_argument", "The owner must be user, assistant, both or null.");
  for (const key of ["planned_start", "planned_end", "actual_start", "actual_done"]) if (key in row && !isDay(row[key])) throw new HttpError(400, "invalid_argument", `${key} must be a date as YYYY-MM-DD, or null.`);
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
    return () => {
      const next = { ...row, version: existing ? existing.version + 1 : 1 };
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
    return () => {
      const next = { ...existing, ...patch, version: existing.version + 1 };
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
    const results = steps.map((step) => step());
    await commit();
    return results;
  });
}

// ---------- projects ----------
function projectView(project) {
  const rows = store.todos.filter(row => row.project_id === project.id);
  const current = project.current_id ? findTodo(project.current_id) : null;
  const count = status => rows.filter(row => row.status === status).length;
  return { ...project, current: current ? { id: current.id, title: current.title, status: current.status } : null, counts: { total: rows.length, main: rows.filter(row => !row.parent_id && row.status !== "draft").length, draft: count("draft"), doing: count("doing"), todo: count("todo"), done: count("done"), deferred: count("deferred") } };
}

async function createProject(data) {
  return serial(async () => {
    const name = String(data && data.name || "").trim();
    if (!name) throw new HttpError(400, "invalid_argument", "A project needs a name.");
    let id = slug(name);
    for (let n = 2; findProject(id); n++) id = `${slug(name)}-${n}`;
    const stamp = new Date().toISOString();
    const project = { id, name, description: String(data.description || "").trim(), current_id: null, created_at: stamp, updated_at: stamp, version: 1 };
    store.projects.push(project);
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
    if ("current_id" in data) {
      if (data.current_id !== null) {
        const row = findTodo(String(data.current_id));
        if (!row || row.project_id !== id || row.parent_id) throw new HttpError(400, "invalid_argument", "The current to-do must be a main to-do of this project.");
        // Taking a main to-do up: it is in progress from today, unless it already has a start date.
        const next = { ...row, status: row.status === "done" ? row.status : "doing", actual_start: row.actual_start || todayStr(), updated_at: new Date().toISOString(), version: row.version + 1 };
        store.todos[store.todos.indexOf(row)] = next;
      }
      patch.current_id = data.current_id === null ? null : String(data.current_id);
    }
    Object.assign(project, patch, { updated_at: new Date().toISOString(), version: project.version + 1 });
    await commit();
    return project;
  });
}

async function deleteProject(id, ifVersion) {
  return serial(async () => {
    const project = findProject(id);
    if (!project) throw new HttpError(404, "not_found", `There is no project with id ${id}.`);
    if (Number(ifVersion) !== project.version) throw new HttpError(409, "version_mismatch", "This project was changed meanwhile; it was reloaded.", { version: project.version });
    store.todos = store.todos.filter(row => row.project_id !== id);
    store.projects.splice(store.projects.indexOf(project), 1);
    await commit();
    return { id, deleted: true };
  });
}

// ---------- the md file a to-do names: a markdown file inside the docs folder, read fresh each time ----------
async function readDoc(relative) {
  const clean = String(relative || "").replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || clean.split("/").includes("..") || !clean.toLowerCase().endsWith(".md")) {
    throw new HttpError(400, "invalid_argument", "Give a path to a markdown file, relative to the docs folder.");
  }
  const absolute = path.resolve(DOCS_DIR, clean);
  if (!absolute.startsWith(DOCS_DIR + path.sep)) throw new HttpError(400, "invalid_argument", "The path must stay inside the docs folder.");
  let stat;
  try { stat = await fs.stat(absolute); } catch { throw new HttpError(404, "not_found", `There is no file at ${clean}.`); }
  if (!stat.isFile()) throw new HttpError(404, "not_found", `${clean} is not a file.`);
  return { path: clean, modified: stat.mtime.toISOString(), content: await fs.readFile(absolute, "utf8") };
}

// ---------- MCP: the same store for an assistant (mcp.mjs forwards stdio here) ----------
const TODO_FIELDS = {
  title: { type: "string" }, notes: { type: "string" }, parent_id: { type: ["string", "null"], description: "The parent to-do; null for a main to-do." },
  next_id: { type: ["string", "null"], description: "The sibling that comes after this one." }, status: { type: "string", enum: [...STATUSES] },
  owner: { type: ["string", "null"], enum: [...OWNERS, null] }, doc: { type: ["string", "null"], description: "A markdown file, relative to the docs folder." },
  estimate_days: { type: ["number", "null"] }, planned_start: { type: ["string", "null"], description: "Estimated start, YYYY-MM-DD." }, planned_end: { type: ["string", "null"], description: "Estimated end, YYYY-MM-DD." },
  actual_start: { type: ["string", "null"], description: "YYYY-MM-DD." }, actual_done: { type: ["string", "null"], description: "Actual end, YYYY-MM-DD." }, order: { type: "number", description: "Position among siblings; 10, 20, 30 …" },
};
const MCP_TOOLS = [
  { name: "list_projects", description: "The projects, each with its counts and its current main to-do.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "create_project", description: "Make a project.", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name"], additionalProperties: false } },
  { name: "list_todos", description: "The to-dos of a project, in tree order (a child follows its parent). Statuses: draft (jotted down, to discuss), todo (next), doing (now), done, deferred (later).", inputSchema: { type: "object", properties: { project_id: { type: "string" }, status: { type: "string", enum: [...STATUSES] } }, required: ["project_id"], additionalProperties: false } },
  { name: "get_todo", description: "One to-do with every field.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "create_todo", description: "Add a to-do to a project. Without a parent it is a main to-do.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, ...TODO_FIELDS }, required: ["project_id", "title"], additionalProperties: false } },
  { name: "update_todo", description: "Change fields of a to-do. Only the fields given change.", inputSchema: { type: "object", properties: { id: { type: "string" }, ...TODO_FIELDS }, required: ["id"], additionalProperties: false } },
  { name: "delete_todo", description: "Delete a to-do; its children move up one level.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "set_current", description: "Make a main to-do the project's current one: it goes in progress from today. Pass null to clear.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, todo_id: { type: ["string", "null"] } }, required: ["project_id", "todo_id"], additionalProperties: false } },
  { name: "add_draft", description: "Jot a draft group down: a title and lines (depth 0 for a line, 1 for a child of the line above, and so on), as the board's draft pad does.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, title: { type: "string" }, lines: { type: "array", items: { type: "object", properties: { title: { type: "string" }, depth: { type: "integer", minimum: 0 } }, required: ["title"] } } }, required: ["project_id", "title", "lines"], additionalProperties: false } },
];

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
  return { notes: "", parent_id: null, next_id: null, status: "todo", owner: null, doc: null, estimate_days: null, planned_start: null, planned_end: null, actual_start: null, actual_done: null, ...data, created_at: stamp, updated_at: stamp };
}

function uniqueId(base) {
  let id = base;
  for (let n = 2; findTodo(id); n++) id = `${base}-${n}`;
  return id;
}

async function mcpCall(name, args = {}) {
  const stamp = new Date().toISOString();
  switch (name) {
    case "list_projects": return store.projects.map(projectView);
    case "create_project": return await createProject(args);
    case "list_todos": {
      if (!findProject(String(args.project_id))) throw new HttpError(404, "not_found", "There is no project with that id.");
      const rows = treeOrder(store.todos.filter(row => row.project_id === args.project_id));
      return (args.status ? rows.filter(row => row.status === args.status) : rows).map(({ notes, version, created_at, updated_at, ...rest }) => rest);
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
      return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "projecttodo", version: "0.1.0" }, instructions: "A to-do board shared with a person. Projects hold to-dos; a to-do without a parent is a main to-do. Drafts are what the person jotted down to discuss; fill in details and move them to todo or doing after the discussion. Dates are YYYY-MM-DD." });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: MCP_TOOLS });
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
    if (pathname === "/api/projects" && req.method === "GET") return send(res, 200, { revision: store.revision, projects: store.projects.map(projectView) });
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
    if (pathname === "/api/batch" && req.method === "POST") { const body = await readBody(req); return send(res, 200, { revision: store.revision, results: await applyWrites(body.writes) }); }
    if (pathname === "/api/doc" && req.method === "GET") return send(res, 200, await readDoc(url.searchParams.get("path")));
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
