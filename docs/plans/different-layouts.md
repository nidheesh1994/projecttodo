# Different layouts

**Why:** the nine themes change colours only; the structure, density and spacing are the
same everywhere. The person wants layouts that are different in kind for the board and
the timeline, each with themes of its own.
**Owner:** both. **Estimate:** 2 days in all; the first layout below is 4 hours.
**Status:** current.

## Proposal

A **layout** is a per-viewer choice like the theme, kept in the browser
(`projecttodo-layout`) and switched from a menu in the header beside the theme menu. A
layout changes structure and density; a theme changes colours; any theme works with any
layout, and each layout names a default theme that is applied when the layout is first
chosen (the person can still pick another).

| Layout | Board | Timeline | Default theme | Size |
|---|---|---|---|---|
| **Classic** | as today: Drafts twice as wide, cards with facts rows and the lines inside | boxes per to-do, dates along the top | Auto | built |
| **Compact** | every lane one unit wide; tighter cards; the facts in one row; smaller type; lines closer | smaller boxes and rows, the same structure | Slate | 4 h |
| **Focus** | one column: a list grouped by lane with the current to-do first; the selected to-do's details docked on the right instead of a modal; fits a phone | an agenda: one row per day with the to-dos that touch it, times shown | Paper | 1 d |
| **Wall** | the board as a wall of equal cards in a grid, lane as a coloured label on each card instead of a column | a month calendar with to-dos on their days | Midnight | 1 d |

Compact first, because it is almost all CSS and proves the switch. Focus or Wall next,
whichever the person prefers.

## Plan

- [ ] The layout switch: a menu in the header, remembered per browser, applied before
      the page paints (like the theme), `data-layout` on the page
- [ ] Compact layout: board and chrome
- [ ] Compact layout: timeline sizes (the slot and box sizes follow the layout)
- [ ] Default theme per layout
- [ ] Second layout: Focus or Wall, by the person's choice
- [ ] README and screenshots

## Decisions

- 2026-10-04 (user): last of the four draft groups; do it after the others.
- 2026-10-04 (assistant): the layout is a viewer setting, not a project setting, like
  the theme; to be confirmed.

## Open questions

- Focus or Wall as the second layout? Or a different idea of "completely different"?
- Should a layout be a project setting (everyone sees the same) rather than a viewer one?

## Progress

- 2026-10-04: plan written; the switch and the Compact layout started.
- 2026-10-04: the layout switch and the Compact layout built (board, chrome, timeline sizes, default theme Slate); README and a screenshot added. The second layout waits for the choice between Focus and Wall.
- 2026-10-04: Focus and Wall built (the person said "do the different layouts" without choosing, so both): Focus = one column with Current first, details docked on the right, an agenda timeline; Wall = a grid of equal cards with the lane as a tag, a month calendar timeline. Each brings its default theme (Paper, Midnight). Four layouts in the switch. Open: should a layout be a project setting rather than a viewer one?
