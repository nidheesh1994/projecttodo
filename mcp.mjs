#!/usr/bin/env node
// ProjectTodo over MCP on stdio: every JSON-RPC message from the client goes to the running
// server's POST /mcp, and the answer comes back on stdout. One line per message.
//   PROJECTTODO_URL   where the server is (default http://localhost:3004)
// Claude Code:  claude mcp add projecttodo -- node /path/to/projecttodo/mcp.mjs
import readline from "node:readline";

const BASE = (process.env.PROJECTTODO_URL || "http://localhost:3004").replace(/\/+$/, "");
const out = line => process.stdout.write(line + "\n");

const pending = new Set();
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", line => { const job = handle(line).finally(() => pending.delete(job)); pending.add(job); });
async function handle(line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { out(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })); return; }
  try {
    const res = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: line });
    if (res.status === 202) return;
    const text = await res.text();
    if (!res.ok) { if (msg && msg.id !== undefined) out(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: `ProjectTodo answered ${res.status}: ${text.slice(0, 200)}` } })); return; }
    out(text.trim());
  } catch (error) {
    if (msg && msg.id !== undefined) out(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: `ProjectTodo is not reachable at ${BASE} (${error.message}). Start it with: node server.mjs` } }));
  }
}
// When the client closes stdin, the answers still on their way are written first.
rl.on("close", async () => { await Promise.allSettled([...pending]); process.exit(0); });
