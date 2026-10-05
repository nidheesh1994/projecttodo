# Timeline rows that stay put

## Goal

On the timeline, a main to-do sits where the person put it, and moving one never moves
another. The rows are the board's order, so the two pages agree, and a drag up or down is
how the order (or the lane) changes from the timeline.

## Context

Reported in chat on 2026-10-05 from the Compact timeline of the Specifi project: a box
could not be dropped into what looked like free space ("I think it is because that is a
child row for the previous item"), items on the same day could not be put in a chosen
order ("it is ordering its own way"), and moving one item made the others move ("only
change that item").

Cause: rows were packed first-fit by start time. A row was blocked invisibly by the
width a to-do's tree needs (wider than its box), so free-looking space was taken; the
packing decided the order within a day; and moving one box re-packed every other box.

## Plan

1. One row per main to-do. Rows are grouped by lane in the board's lane order (Current,
   Next, Later, Done, as the board has them), each lane in its order, with the lane's
   name and count at the left of its group (sticky, so it stays while scrolling the days).
2. Every main to-do can be dragged up or down. A drop line shows the row it goes before;
   the drop uses the board's own drop rules (`dropItem`): within a lane it only changes
   the order; into another lane it changes the status too, with the board's rules
   (Done needs everything under it done, Current from today, an empty Current makes it
   the current one). Nothing else moves.
3. A main to-do that has not started can still be dragged along the days or stretched at
   either end; a drag that changes both row and days writes both at once.
4. README and screenshots updated; checked on a sample board and on the live timeline.

## Decisions

- Rows follow `order`, not time. Moving dates never changes a row, which is what was
  asked; it means the Done group shows the latest finished first, as the board does.
- A lane with no main to-dos has no group, so a drop into it is done on the board.
- A tree wider than its box still widens the days under it so the tree fits; it no longer
  blocks anything, since nothing shares its row.

## Progress

- 2026-10-05: built; checks follow.

- 2026-10-05: checked on the sample board (reorder, lane change, refused Done drop, click) and on the live Specifi timeline (21 rows in four groups). Decision added: a drop re-links next chains, otherwise a drop between linked siblings did nothing visible; the lane labels sit above the chart's drawing (z-index), or the column shading hid them.

- 2026-10-05, second round: one row per main to-do left gaps, and a drop meant "before this one", so the neighbour moved down ("Still there are gaps, why these are not going to the top. … Since it is not interfering with the other one, it should be possible."). Changed: in a group the boxes pack to the top in the lane's order, each in the first row with room; a drop puts a box in the row it was dropped in when nothing there is in its way, and that row is kept in a new field `row` (null = first row with room; honoured when it has room, else the box takes the first row with room). A band shows the target row, red where there is no room, and the drop is refused with "Something is in the way there." A box can also be dropped under a group's last row for a new row. Day-adjacent boxes share a row (the gap is inside each box's width). Decision: rows are no longer the order; the order only decides who packs first.

- 2026-10-05, third round: "no need to split between done, next and later as row wise. Everything in one lane." The lane groups and their labels go; the boxes pack to the top in the board's order, all lanes together, with the same drop rules; `row` is now a row of the whole chart. A drop no longer changes a to-do's lane (that is the board's job).

- 2026-10-05, fourth round: "Why can't I put this over there": a row was as tall as the tallest tree in it, so the empty space under a childless box counted as taken. Rows are now one box tall; a main to-do takes as many rows as its tree is deep, only over its own days, so a box fits under another box whose tree does not reach there; the drop band is the box's own height, and `row` counts these one-box rows. Also: a to-do with an end time and no start time (started before times were kept) now ends at that time instead of the end of its day.
