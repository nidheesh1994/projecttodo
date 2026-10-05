# Modules inside a project

## Goal

A project can be split into modules. Each module has its own board and timeline, its
own lanes, current to-do and documents. The projects page shows each project's modules
with a status, and the project's timeline shows the modules as bars.

## Context

Draft (user, 2026-10-05): "We need a modules that can create under project, so a
project have modules and modules have todos which will go to board and timeline. We
need to show that in the projects page only. So we need to update the project list. The
user can see the project and see the modules with current, later, done status. Clicking
on a module will take to it's todo board/timeline."

Answers (2026-10-05): a project may still hold to-dos of its own (the assistant's
call, asked by the user; it keeps the three existing projects as they are); a module's
status is derived from its to-dos; the project's timeline shows modules only, with an
option to show their to-dos.

## Scope

- A module is a project with a `parent_id`. Nothing else about a project changes, so
  the board, the timeline, the lanes, `current_id`, documents and every MCP tool work
  for a module as they do for a project, with the module's id as `project_id`.
- A module inherits its parent's data and documents folders unless it sets its own; its
  rows live in the parent's `todos.json` with the module's id.
- A module cannot hold modules. A project with modules cannot be deleted while they
  exist. A project with modules can still hold to-dos of its own.
- Modules appear on the projects page only (no new navigation).

## Plan

- [x] Server and MCP: `parent_id` on projects (validated: an existing project without a
      parent, never itself; a project that has modules cannot become one); folders
      inherited; delete refused while modules exist (409 `has_modules`); the project
      list carries `parent_id`, counts (with `main_done`) and the derived `status`;
      `list_projects` nests modules under their project; `create_project` takes
      `parent_id`; `GET /api/todos?project=&modules=1` adds the modules' rows.
- [x] Projects page: each card lists its modules (name, status chip, "x of y main done",
      the current to-do), a "+ Module" control opens the project form with the parent
      set; clicking a module opens its board.
- [x] Module status, derived: Current when a main to-do is in Current; Done when every
      main to-do is done and there is at least one; Later otherwise; Empty with none.
- [x] Module pages: the header reads "Project › Module", the project name linking to
      the project's timeline.
- [x] Project timeline: one bar per module (earliest start to latest end over its main
      to-dos, coloured by status, "x of y done"), beside the project's own main to-dos;
      a "Show to-dos" switch (remembered per browser) hangs each module's main to-dos
      under its bar; a bar opens the module's board, a to-do under it the module's
      timeline; bars are not draggable.
- [x] Checks on a sample board (a project with two modules), the live projects page;
      playbook, skill, README and two screenshots.

## Decisions

- 2026-10-05 (assistant, user asked for the call): a project with modules keeps its own
  to-dos and board. Simpler to build and nothing to migrate; the project's board shows
  only its direct to-dos.
- 2026-10-05 (user): module status is derived, not set by hand.
- 2026-10-05 (user): the project timeline shows modules only, with an option to show
  their to-dos.
- 2026-10-05 (assistant): the bars are built as rows of the timeline's own kind (a
  synthetic main to-do per module, its main to-dos as children when shown), so packing,
  zoom, the agenda and the calendar need no special case; clicks on them lead to the
  module instead of opening details here.
- 2026-10-05 (assistant): when a folder is read at start-up, a row keeps its project if
  that project shares the folder (a module); otherwise it belongs to the folder's
  project. Without this a restart would have handed module rows to the parent.

## Open questions

- None.

## Progress

- 2026-10-05: planned.
- 2026-10-05: built and checked, all six steps. Live projects page already shows a
  module the person added.

- 2026-10-05: follow-up (user: "add a move todo tool", "I am not see a module card in the board to drag"). `move_todo` (MCP) and `POST /api/todos/{id}/move` move a to-do with everything under it into a module or back to the project (a child becomes a main to-do there; lane kept; next links to left-behind siblings dropped; the old project's current pointer cleared; a to-do in progress becomes the target's current one when it has none). The board of a project with modules, and of a module, has a strip of drop targets above the lanes; the editor has an "In" field. Module status stays derived; an override was offered and not asked for.

- 2026-10-05: follow-up (user: the module "is showing in the timeline but not on the board"; "make the module card different"; "drop a todo … into the module card"; "the module card will get the status current, next, done or later"). A module is now a card on its project's board, in the lane its main to-dos put it in (Current, else Next, else Later, else Done; empty in Next), marked Module with a dashed outline; it opens the module's board, and a card dropped on it moves into the module. The drop strip went; the editor's In field stays. Module status values are now the lane keys (doing, todo, deferred, done, empty). Decision: "modules on the projects page only" from the draft is superseded by the person's later ask.

- 2026-10-05: decision (user): "No module have it's own status. Anything inside have it's own status. Don't complicate. You can make a module current without having anything in it." A module's status is its own, like a card's (doing, todo, deferred, done; new modules start as todo), set by dragging the card on the board or with the new `update_project` tool; nothing is derived from the to-dos inside it, and there is no Done guard. The earlier derived status and the "pinned or following" idea are gone.
