---
name: projecttodo-draft-submission
description: Take a draft group from the ProjectTodo board and submit it as planned to-dos, with a plan document when one is warranted. Use when the user says to submit, process, plan or convert a draft, or names a draft group; the argument says which draft and anything else to apply.
argument-hint: [which draft, e.g. "the first draft", "Board page updates"; optional instructions]
---

# Submit a draft

The board is reached through the `projecttodo` MCP server. The argument is `$ARGUMENTS`:
which draft to take (a title, "the first", "the oldest", "all") and any instruction to
apply ("owner me", "after the marketplace work", "no document").

1. Call `get_playbook` once if you have not this session; its "Reviewing drafts" and
   "When a document is written" sections are the rules below in full.
2. `list_projects`, then `list_todos` with `status: draft` for the project the user
   works in (ask which if more than one has drafts and the argument does not say).
   Pick the group the argument names; "the first" is the first in board order; with no
   argument, take the first and say so.
3. Read the group back in one short paragraph. Then shape it:
   - a group with **one line** that only explains the title: the line's text goes into
     the group's `notes` and the line is deleted; it stays a child only when it is a step
     that can be finished on its own;
   - a group with **no title**: a loose list; group the lines into one or more to-dos,
     propose a title for each, and wait for the answer before writing anything;
   - lines that are questions or notes: into `notes`, not children;
   - a line that is an instruction for the parent (how it should behave, a rule, a
     reason) rather than work of its own: into the group's `notes` or the document, in
     the person's words, not a child; ask when it could be either;
   - a truncated or unclear title: tidy it, and say so;
   - lines that are steps (work that can be finished on its own): children with a title
     that names the step, `status: todo`, an owner, an estimate, chained with `next_id`
     in the order given.
4. Decide whether the group needs a plan document, by the playbook's rule: write one
   when the group has three or more steps, when its estimate is half a day or more,
   when a decision has to be recorded, or when the person asked for one; skip it for a
   small fix with one obvious step. When written, use `write_doc` with the playbook's
   template, and put the path in the group's `doc`.
5. Set the group's `owner`, `estimate_days` (your proposal, say it is one), and
   `status: todo`; `set_current` only when the argument says to start it now. Keep it
   after the main to-do before it unless the argument says where it goes.
6. Report in a short list: the title, what became children, what went into notes, the
   document path if any, the estimates, and the questions you still have. Never
   report a refused write as done.

Only the group named is touched; other drafts stay as they are. The person's words are
kept in `notes` when a line is folded, so nothing they wrote is lost.
