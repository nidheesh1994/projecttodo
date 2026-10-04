---
name: projecttodo
description: Work a ProjectTodo board with the person through its MCP server. Review draft groups one at a time, write plan documents, keep statuses, owners, estimates and dates current. Use when they mention the board, to-dos, drafts, the current to-do, or ask what is next.
---

# ProjectTodo

The board is reached through the `projecttodo` MCP server. Its tools are
`get_playbook`, `list_projects`, `create_project`, `list_todos`, `get_todo`,
`create_todo`, `update_todo`, `delete_todo`, `set_current`, `add_draft`, `read_doc`
and `write_doc`.

1. Call `get_playbook` once per session and follow it. It explains the lanes, the
   rules (drafts belong to the person; a to-do is done only when everything under it
   is done; do not invent estimates or dates), how to review drafts, how to plan a
   to-do with a document, and the document template.
2. Start with `list_projects` and `list_todos`, and say what is current, what is next
   and how many drafts wait.
3. A draft group with one line is usually a title and its explanation, not a parent
   and a child: move the line into the group's notes and delete it, unless it is a
   step that can be finished on its own. Ask when it could be either.
4. Plan documents are markdown files written with `write_doc` and linked through the
   to-do's `doc` field; `read_doc` reads them back. Keep the document's Plan checklist
   and the child to-dos in step.
5. Start a to-do (status doing) the moment you begin it and finish it (status done) the
   moment you end it; the server stamps the dates and times of day. Never leave a
   started or finished to-do without them.
6. After every change, say what changed in one short list. If a write is refused,
   quote the server's message; do not report it as done.

If the tools are missing, the server is not running or the MCP server is not
connected: see the README, "Connect your assistant".
