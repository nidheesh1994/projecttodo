# Project paths: where a project's rows and documents live

**Why:** today the server has one data folder and one docs folder for every project
(`PROJECTTODO_DATA_DIR`, `PROJECTTODO_DOCS_DIR`). With two projects on one board, the
second project's documents have no right place: an assistant either writes them into the
first project's repository or cannot link them at all. The person wants to say, when a
project is made, where its data is kept and which folder holds its documents, and to
change that later.
**Owner:** assistant. **Estimate:** 4 h. **Status:** next.

## Scope

- In: two settings per project, `data_dir` and `docs_dir`, asked for when a project is
  made and editable afterwards; the rows of a project stored in its own file; document
  reading and writing resolved per project; the MCP tools and the playbook updated.
- Out: moving the server's own defaults; anything multi-user or remote.

## Proposal

1. **Two fields on the project.** `data_dir`: the folder whose `todos.json` holds the
   project's rows. `docs_dir`: the folder a to-do's `doc` path is read from and the
   assistant's `write_doc` writes into (with the write subfolder inside it, as today).
   Absolute paths, or paths relative to the server's data folder. Empty means the
   server's defaults, so existing projects do not change.
2. **Storage.** The main `todos.json` keeps the project registry and the rows of
   projects without a `data_dir`. A project with its own `data_dir` keeps its rows in
   `<data_dir>/todos.json`. The server loads every file at start and writes each change
   to the right file. Changing `data_dir` later moves the rows into the new file.
3. **Documents.** `/api/doc` and the drawer take the project; `read_doc` and
   `write_doc` take `project_id`; the write folder is `<docs_dir>/<write subfolder>`.
4. **The page.** The New project form asks for both paths with the defaults filled in
   and a line of help. A project's card on the projects page shows them, and a settings
   button opens the same form to change name, description and paths.
5. **MCP.** `create_project` takes the two paths; `list_projects` returns them, so an
   assistant knows where to write; the playbook says so.

## Decisions to take

- [ ] Relative paths resolved against the server's data folder, or absolute only?
- [ ] One file per project (`<data_dir>/todos.json`) as proposed, or one folder per
      project with the file inside?
- [ ] The AgentRow project: keep its rows where they are (`agentrow/projecttodo-data`)
      and point its docs at the agentrow repository, which is what happens today.
- [ ] The ProjectTodo project: rows in `projecttodo/data/todos.json` (git-ignored today;
      commit it?) and docs in `projecttodo/docs`.
- [ ] The server reads and writes whichever folders the person names. Fine on a
      personal machine; say so in the README.

## Plan

- [ ] Server: fields, validation, per-file load and save, moving rows on change
- [ ] Documents per project: API, drawer, read_doc, write_doc
- [ ] Page: New project form with paths; project settings; paths on the project card
- [ ] MCP and playbook
- [ ] README

## Decisions

- 2026-10-04 (user): wanted, as a draft group on the ProjectTodo project; order third of
  four, before Different Layouts.

## Progress

- 2026-10-04: plan written; waits for the decisions above.
- 2026-10-04 (assistant, on the user's "do the current"): built with these defaults. Paths
  are absolute, `~/…`, or relative to the server's data folder. One file per project,
  `<data_dir>/todos.json`, holding the rows of every project that points at it; the
  main file keeps the registry and the rows of projects without a folder. Changing a
  folder moves the rows (the old file is written once more without them; rows already
  in the new file are taken in). The documents folder is also the write folder for a
  project that has one. The AgentRow project keeps the server's defaults; the
  ProjectTodo project now points at `~/Documents/projecttodo/data` (git-ignored; commit
  it if you want the rows in the repository) and `~/Documents/projecttodo/docs`. The
  server reads and writes the folders you name; the README says so.
