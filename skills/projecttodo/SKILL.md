---
name: projecttodo
description: Work a ProjectTodo board with the person through its MCP server. Review draft groups one at a time, write plan documents, keep statuses, owners, estimates and dates current. Use when they mention the board, to-dos, drafts, the current to-do, or ask what is next.
---

# ProjectTodo

The board is reached through the `projecttodo` MCP server. Its tools are
`get_playbook`, `list_projects`, `create_project`, `update_project`, `list_todos`, `get_todo`,
`create_todo`, `update_todo`, `delete_todo`, `move_todo` (into a module or back to the
project, with everything under it), `set_current`, `add_draft`, `read_doc` and `write_doc`.

1. Call `get_playbook` once per session and follow it. It explains the lanes, the
   rules (drafts belong to the person; a to-do is done only when everything under it
   is done; do not invent estimates or dates), how to review drafts, how to plan a
   to-do with a document, and the document template.
2. Start with `list_projects` and `list_todos`, and say what is current, what is next
   and how many drafts wait. A project may have modules (projects inside it, listed under
   it in `list_projects`): pass the module's id as `project_id` to work in it.
3. A draft group with one line is usually a title and its explanation, not a parent
   and a child: move the line into the group's notes and delete it, unless it is a
   step that can be finished on its own. Ask when it could be either. A draft with no
   title is a loose list: group its lines into to-dos and propose their titles first.
4. Decide for each draft line whether it is a step or an instruction. A step is work
   that can be finished and ticked on its own: it becomes a to-do with a title that
   names it. An instruction for the parent (how it should behave, a rule, a reason)
   is not a to-do: it goes into the parent's `notes` or its plan document, in the
   person's words. Ask when it could be either.
5. Plan documents are markdown files written with `write_doc` and linked through the
   to-do's `doc` field; `read_doc` reads them back. Pass `project_id` to both: each
   project can have its own documents folder (`list_projects` shows it under `paths`). Keep the document's Plan checklist
   and the child to-dos in step.
6. Start a to-do (status doing) the moment you begin it; the server stamps the date and
   time. Never set it done on your own: when your part is finished, say so, note the
   end time, and leave it in Current until the person has looked at it and says it is
   done or to move on; then set status done with the real `actual_done` and
   `actual_done_time`. Keep working on that one thing until then.
7. Not every ask is a to-do: a correction, a tweak or a small thing said while work is
   going on belongs to the to-do in progress (do it, note it there). Make a new to-do
   only when the ask is a task of its own, a task inside an existing one, or a draft
   the person added.
8. After every change, say what changed in one short list. If a write is refused,
   quote the server's message; do not report it as done.

If the tools are missing, the server is not running or the MCP server is not
connected: see the README, "Connect your assistant".
