# ProjectTodo playbook

How an assistant works the board with the person. The server hands this file to any
MCP client through the `get_playbook` tool; `skills/projecttodo/SKILL.md` points Claude
Code at it, and `skills/projecttodo-draft-submission/SKILL.md` is the
`/projecttodo-draft-submission` command that submits one draft group; for other
assistants, put one line in their instructions: *before working on the to-do board, call
`get_playbook` and follow it.*

## The board in one minute

- A **project** holds to-dos. `list_projects` shows each project's counts and its
  **current** main to-do.
- A **main to-do** has no parent. It sits on the timeline by its dates and is a card on
  the board. Everything under it (children, grandchildren) is listed inside the card.
- **Statuses** are lanes: `draft` (Drafts: jotted down, to discuss), `todo` (Next),
  `doing` (Current), `done`, `deferred` (Later).
- **Owner**: `user` (the person), `assistant` (you), `both`, or none.
- **Dates**: `planned_start` and `planned_end` are the estimate; `actual_start` and
  `actual_done` are what happened, each with a time of day beside it
  (`actual_start_time`, `actual_done_time`, `HH:MM` local). `estimate_days` is the
  size; under a day it is hours at 8 hours a day (0.375 = 3 h). Dates `YYYY-MM-DD`.
  Setting a status to `doing` or `done` makes the server stamp the date and time it
  needs, so the cheapest way to start or finish a to-do is the status change itself.
- **Order**: siblings are sorted by `order` (10, 20, 30); `next_id` names the sibling
  that follows, which the timeline draws as an arrow.
- **doc**: the path of a markdown file with the detailed plan, relative to the
  project's docs folder; **docs** lists further files, as many as needed. The page shows it in a drawer. `read_doc` and `write_doc` read
  and write it; give them `project_id`, since a project can have folders of its own
  (`list_projects` shows them under `paths`: where its rows file is, where its
  documents are read from, where new ones are written).
- **Current**: `set_current` makes one main to-do the project's current one. It goes to
  Current and starts today. When it is done, its end is the end of its last finished
  child.

## Rules

1. **Drafts belong to the person.** Never delete, rename or re-group a draft line
   without asking. Suggest; they decide.
2. **A to-do is done only when everything under it is done.** The server refuses
   anything else (`children_open`). Tick the children first.
3. **Do not invent sizes or dates.** Propose an estimate with a reason and ask; write
   what was agreed. A main to-do with no dates is shown at today on the timeline (a card
   moved on from Drafts gets the slot after the one before it), so dates can wait
   until the order is settled.
4. **One source of truth.** Decisions go into the to-do's document, dated, with who
   decided. The board holds state (status, owner, dates); the document holds the why
   and the how.
5. **Small writes.** Change the fields that changed. Read before you write when the
   row may have moved since you last saw it.
6. **A line is either a step or an instruction; decide which.** A step is work that can
   be finished and ticked on its own ("Add a left arrow to the calendar"): it becomes a
   to-do, with a title that names it. An instruction says how the parent should behave,
   what it must not do, or why ("the other items must not move", "keep the selected
   theme"): it is not a to-do of its own; it goes into the parent's `notes` or its plan
   document, in the person's words, so nothing is lost. Ask when a line could be
   either. Titles stay short because the how lives in the notes, not by a word count.

## Session start

1. `list_projects`, then `list_todos` for the project you work in.
2. Say in two or three lines: what is current, what is next, what finished since last
   time, how many drafts wait. Ask what the person wants to do if it is not obvious.

## Reviewing drafts

Take **one draft group at a time**, in board order.

1. Read the group's title and lines back in your own words. Ask what each unclear
   line means, what "done" looks like, and whether anything is missing.
2. Propose a shape: which lines stay, which merge, which split, which go to Later,
   which are not to-dos at all (notes, questions). Wait for the answer.
   **A group with a single line** is often a title and its explanation, not a parent
   and a child. If the line only explains or restates the title ("No option to edit
   the project" / "need a way to edit the name and description"), put its text in the
   group's `notes` and delete the line; keep it as a child only when it is a step
   that can be finished on its own. Ask when it could be either.
   **A draft with no title** is a loose list the person jotted down. Read the lines,
   group them into one or more to-dos, propose a title for each, and wait for the
   answer; then give the group the first title (or delete it once its lines have moved
   to the new to-dos). A to-do cannot leave Drafts without a title.
3. For the agreed group:
   - write the plan document with `write_doc` (template below) and put its path in
     the group's `doc`;
   - set `owner`, `estimate_days`, `planned_start` and `planned_end` (or leave the
     dates empty to place it after the previous main to-do);
   - move the group to `todo`, or `doing` through `set_current` if it starts now;
   - give each child a title that names its step (rule 6), `status: todo`, an
     `owner`, an `estimate_days`, and chain the order with `next_id`; children that
     wait go to `deferred`.
4. Lines the person wants dropped: ask once, then `delete_todo`.
5. Say what you changed, in one short list.

## When a document is written

Decide it yourself; the person should not have to ask each time. Write a plan document
(with `write_doc`, template below) when any of these holds: the group has three or more
steps; its estimate is half a day or more; a decision has to be recorded; the person
asked for one. Skip it for a small fix with one obvious step, and say that you skipped it.
Put the path in the to-do's `doc` so the board can open it.

## Planning a to-do

When a to-do needs a plan (any main to-do; a child when it is big):

1. `get_todo` for the fields, `read_doc` if it already has a document.
2. Write or update the document. Keep the Plan section as a checklist that mirrors the
   child to-dos, one line each, so the board and the document say the same thing.
   Instructions for the work (how it should behave, rules, reasons) are written here or
   in `notes`, not as children.
3. Record every decision under **Decisions** with the date and who decided.
4. Set the fields on the board to match (estimate, dates, owner, doc).

## While work happens

- Starting a main to-do: `set_current`. Starting a child: `status: doing`; the server
  stamps `actual_start` and its time, and gives its parents the same start if they had
  none. Do it the moment the work starts, not after.
- Finishing a child: `status: done`; the server stamps `actual_done` and its time. Do it
  the moment the work ends. Add a dated line to the
  document's **Progress** section when something notable happened (a decision, a
  surprise, a change of estimate).
- Finishing a main to-do: only after every child is done; then `status: done` and
  `actual_done`.
- Blocked or postponed: `deferred`, and a Progress line that says why and what would
  unblock it.
- Re-estimating: change `estimate_days` and `planned_end`, and say so in Progress.
  Keep the original estimate in the text so the drift stays visible.

## Daily review

1. `list_todos`. Report: finished yesterday, current and how far along, next up, what
   slipped (planned end in the past and not done), how many drafts wait.
2. Update what the person tells you: dates, statuses, owners.
3. Offer to review the oldest draft group if there are any.

## Writing style

- Titles: short, imperative, no trailing period ("Add the export button").
- `notes`: one or two sentences of context that belong on the card.
- Documents: plain markdown, short sections, dated entries. Say who decided what.
- Say what you changed after you change it. Never report a write that failed as done;
  quote the server's message instead.

## Document template

Use this for `write_doc`. Name the file after the to-do (`export-button.md`), lower
case, dashes for spaces.

```markdown
# <Title>

**Why:** one paragraph on the problem or the goal.
**Owner:** user | assistant | both. **Estimate:** N days. **Status:** as on the board.

## Scope
- In: …
- Out: …

## Plan
- [ ] Step one (child to-do)
- [ ] Step two (child to-do)

## Decisions
- YYYY-MM-DD (who): what was decided and why.

## Open questions
- …

## Progress
- YYYY-MM-DD: what happened.
```
