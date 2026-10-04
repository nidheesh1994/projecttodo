# Several documents on a to-do

**Why:** a to-do has one `doc`, the path of its plan. Work often has more than one file
worth opening from the card: the plan, a checklist, a decision record, a reference.
**Owner:** assistant. **Estimate:** 2 h. **Status:** next.

## Proposal

- The to-do keeps `doc` (the main document, as today) and gains `docs`: a list of
  further paths, each relative to the project's docs folder. Nothing changes for rows
  that have only `doc`.
- The card shows one Doc row per path; the first reads "Doc", the others "Doc 2", "Doc 3".
  Each opens the drawer. The details view lists them the same way.
- The editor's Doc field takes one path per line: the first line is `doc`, the rest
  `docs`.
- MCP: `docs` is an optional list in `create_todo` and `update_todo`; `write_doc`
  returns a path that can go into either. The playbook says to put the plan in `doc`
  and supporting files in `docs`.

## Decisions to take

- [ ] One field (`doc` as a list) or two (`doc` plus `docs`)? Two keeps every existing
      row, tool and skill valid; one is cleaner. Proposed: two.
- [ ] A cap on the number of documents (five?) so the card stays a card.

## Plan

- [ ] Server: the `docs` field, validated as a list of markdown paths
- [ ] Page: card rows, details view, editor field
- [ ] MCP fields and the playbook line
- [ ] README

## Decisions

- 2026-10-04 (user): wanted, as an untitled draft with the line "Ability to add
  multiple docs for a todo"; the title here is the assistant's.

## Progress

- 2026-10-04: plan written.
- 2026-10-04 (user): just files, paths saved, no cap; two fields kept (doc for the plan, docs for the rest).
- 2026-10-04: built. docs is a list on the to-do; the card and the details view show Doc, Doc 2, Doc 3…; the editor takes one path per line (the first is the plan); the MCP tools take the list; the server trims, de-duplicates and keeps the main document out of the list.
