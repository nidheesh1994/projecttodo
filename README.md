# ProjectTodo

A small to-do board for a person and their AI assistant, kept on your own machine. One
page, a JSON file, no dependencies, and an MCP server so the assistant you already use
(Claude Code, Claude Desktop, or anything that speaks MCP) can read and update the same
to-dos you see.

![The board: Drafts, Current and Next, with Done and Later off to the right](docs/screenshots/board.png)

- **Projects** on the first page, each a card. Open one for its board.
- **Board**: lanes for Drafts, Current, Next, Done and Later. Press **+** on Drafts (or
  "New draft") and type a title and a list like a notepad: Enter for the next line, Tab
  for a child, Shift+Tab back out. "Add" makes one draft card with those lines. You go
  through the drafts with your assistant; it fills in the details and moves them on.
  A card is a main to-do; everything under it is listed inside the card, ticked when
  done. Drag cards between lanes. Click a card's header to fold it to one row or open
  it again (Done and Later cards start folded); double-click the header to edit the
  main to-do, click a line to edit that to-do, and click its circle to tick it done.
  A card cannot go to Done until every line in it is ticked. Each lane's header has an
  arrow that folds or opens every card in it.
  Drafts is twice as wide as the other lanes; Done and Later sit past the right edge and
  scroll into view.
- **Timeline**: dates along the top. A main to-do (one without a parent) spans its days;
  its to-dos hang under it, siblings left to right, children below their parent, in as
  many columns as its days allow. A main to-do with no dates is placed after the one
  before it. The thin line under a main to-do is its estimate when the actual days
  differ. The project's **current** main to-do is outlined: setting it starts it today;
  when it is done, its end is the end of the last finished to-do under it. So by
  finishing things, every to-do ends up with its real dates.
  The timeline opens on today, a line walks across today's column with the time (hover it
  to read it), and the view zooms with the − and + buttons, Cmd and scroll, or Cmd and
  minus, plus and 0.
- **Live**: every change saves at once and shows up for everyone with the page open.
- **Themes**: Auto (follows the system), Day, Night, Midnight, Forest, Ember, Paper,
  Rose and Slate, from the menu in the header; remembered per browser.

| Projects | Draft pad |
|---|---|
| ![Projects](docs/screenshots/projects.png) | ![The draft pad](docs/screenshots/draft.png) |

![Timeline](docs/screenshots/timeline.png)

| Paper | Midnight |
|---|---|
| ![Paper theme](docs/screenshots/theme-paper.png) | ![Midnight theme](docs/screenshots/theme-midnight.png) |

## Run it

```bash
./start.sh                                        # http://localhost:3004
./start.sh --port 3010 --data ~/notes/todos --docs ~/notes
```

Needs Node 18 or newer. `./start.sh --help` lists the flags; each one sets the
environment variable of the same meaning, so `node server.mjs` with the variables set
does the same. `./start.sh --dev` restarts the server whenever `server.mjs` or anything
under `public/` changes, and every open page reloads itself, so editing needs no
restarts by hand:

| Variable | Default | What |
|---|---|---|
| `PORT` | `3004` | the port |
| `HOST` | `127.0.0.1` | the address; `0.0.0.0` to reach it from other machines |
| `PROJECTTODO_DATA_DIR` | `./data` | where `todos.json` lives (commit it to your own repo if you like) |
| `PROJECTTODO_DOCS_DIR` | the data dir's parent | a to-do's `doc` is a markdown file under this folder, shown in a drawer |
| `PROJECTTODO_DOC_WRITE_DIR` | `todos` (inside the docs dir) | where the assistant's `write_doc` may create markdown files (`--write-docs`) |
| `PROJECTTODO_DEFAULT_PROJECT` | `My project` | the project made for rows from before projects existed |
| `PROJECTTODO_DEV` | unset | `1` watches the files and restarts (the `--dev` flag) |

## Connect your assistant (MCP)

The server speaks MCP at `POST /mcp` (streamable HTTP, stateless), and `mcp.mjs` is a
stdio bridge for clients that start a command. The server has to be running.

Claude Code:

```bash
claude mcp add projecttodo -- node /path/to/projecttodo/mcp.mjs
# or over HTTP
claude mcp add --transport http projecttodo http://localhost:3004/mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "projecttodo": { "command": "node", "args": ["/path/to/projecttodo/mcp.mjs"] } } }
```

Any other MCP client: a stdio server `node mcp.mjs` (set `PROJECTTODO_URL` if the server
is not on `http://localhost:3004`), or the HTTP endpoint `http://localhost:3004/mcp`.
Clients that need a public HTTPS address (a hosted ChatGPT connector, for example) need
a tunnel in front of it; the server has no login, so keep it on your own machine or
behind one.

Tools: `get_playbook`, `list_projects`, `create_project`, `list_todos`, `get_todo`,
`create_todo`, `update_todo`, `delete_todo`, `set_current`, `add_draft`, `read_doc`,
`write_doc`. Prompts (clients that list MCP prompts, such as Claude Desktop, offer them
as commands): `review_drafts`, `plan_todo`, `daily_review`.

## Teach your assistant the workflow

Connecting the server tells an assistant what the tools are, not how you want the board
worked. That lives in one file, [PLAYBOOK.md](PLAYBOOK.md): the lanes, the rules (drafts
belong to the person; a to-do is done only when everything under it is done; no invented
estimates), how to review draft groups one at a time, how to plan a to-do with a
document, and the document template. The server sends a summary when a client connects,
and the `get_playbook` tool returns the whole file, so every MCP client can read it.

- **Claude Code**: install the skill once, and Claude calls `get_playbook` whenever the
  board comes up:

  ```bash
  mkdir -p ~/.claude/skills && cp -r /path/to/projecttodo/skills/projecttodo ~/.claude/skills/
  ```

  (or copy it into a project's `.claude/skills/` to keep it per repository).
- **Claude Desktop**: the summary arrives with the connection; the prompts above appear
  as commands.
- **Anything else** (a ChatGPT connector, another agent): add one line to its
  instructions: *Before working on the to-do board, call the projecttodo tool
  `get_playbook` and follow it.*

Plan documents are markdown files the assistant writes with `write_doc` into the write
folder (`--write-docs`, default `todos/` under the docs folder) and links through the
to-do's `doc` field; the page shows them in the drawer, and `read_doc` reads them back.
Edit the playbook to fit how you work; the assistant reads it fresh each time.

## Rows

A project: `id, name, description, current_id, created_at, updated_at, version`.

A to-do:

```
id, project_id, title, notes, parent_id (null = main to-do), next_id (the sibling after it),
order (10, 20, …), status: draft | todo (Next) | doing (Current) | done | deferred (Later),
owner: user | assistant | both | null, doc, estimate_days,
planned_start, planned_end (estimated start and end), actual_start, actual_done (actual start and end),
actual_start_time, actual_done_time (HH:MM, local; stamped by the server with the dates),
created_at, updated_at (ISO 8601), version (kept by the server)
```

Estimates are days; under a day they show as hours at 8 hours a day, and the editor takes
"2 d", "3 h" or "90 m". A status change to Current or Done stamps the actual date and the
time of day, on the page and on the server, so a to-do that started at 12:43 and ended at
15:20 reads "4 Oct 12:43 to 15:20 · 2 h 37 m" on its card and sits by the hour on the
timeline. Dropping a card in Current sets `actual_start` when empty; in Done sets `actual_done` (for a
main to-do, the end of its last finished child) and `actual_start` when empty; leaving
Done clears `actual_done`. A to-do can be set done only when everything under it is done:
the page checks this on drops, in the editor and on the ticks, and the server refuses such
a write with 409 `children_open`.
A main to-do dropped in Next or Current with no estimated dates
gets them: the day after the estimated end of the main to-do before it, lasting its
estimate in days (one day if none). Deleting a parent moves its children up one level.

## API (JSON)

| Call | Body | Does |
|---|---|---|
| `GET /api/projects` | | `{projects}` with counts and the current main to-do |
| `POST /api/projects` | `{data: {name, description}}` | makes a project |
| `PATCH /api/projects/{id}` | `{if_version, data: {name, description, current_id}}` | changes it; setting `current_id` starts that main to-do today |
| `DELETE /api/projects/{id}` | `{if_version}` | removes it and its to-dos |
| `GET /api/todos?project={id}` | | `{todos}` |
| `POST /api/todos` | `{data: {id, project_id, title, …}}` | creates a row (409 if the id exists) |
| `PATCH /api/todos/{id}` | `{if_version, data: {…}}` | merges fields; 409 `version_mismatch` when the row changed meanwhile, 409 `children_open` when it would be done with open to-dos under it |
| `DELETE /api/todos/{id}` | `{if_version}` | removes a row |
| `POST /api/batch` | `{writes: [{op: set\|update\|delete, id, data, if_version}]}` | all or nothing |
| `GET /api/doc?path=docs/x.md` | | `{path, modified, content}` for a markdown file under the docs folder |
| `GET /api/events` | | server-sent `change` events |
| `POST /mcp` | JSON-RPC | the MCP endpoint |

## License

MIT.
