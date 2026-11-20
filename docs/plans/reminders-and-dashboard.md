# Reminders, a dashboard, and Claude sessions

## Goal

A reminder on a main to-do that shows as a Chrome notification; a dashboard outside the
projects that says what is happening and what to do; and on it, the Claude Code sessions
running on this machine.

## Context

User (2026-11-20): "we need an option to set reminder on each main todo. And that reminder
needs to send notification in chrome. Also I want you to build a todo dashboard, which is
outside the projects. So that I can keep track of what is happening or what to do. Also
current running project with claude, an agent monitoring my activity with different claude
sessions things like that."

## Plan

- [ ] Reminder: `remind_at` (local `YYYY-MM-DDTHH:MM`) on a to-do, set in the editor of a
      main to-do and by MCP. The server is the clock: when one is due it stamps
      `reminded_at` and sends a `reminder` event to the open pages, which show a
      notification (one per to-do, however many tabs). Nothing open: it fires when a page
      next opens. Changing `remind_at` re-arms it.
- [ ] Dashboard on the first page, above the projects, from every project and module:
      In progress, Reminders, Up next. Each row opens its board.
- [ ] Claude sessions panel: the server reads the tails of the session files Claude Code
      keeps (title, folder, branch, last prompt, last activity); off unless
      `PROJECTTODO_CLAUDE_DIR` is set, since it shows prompts.
- [ ] A test for the reminder path; README; the service gets the new setting.

## Decisions

- 2026-11-20 (assistant): notifications come from the page (Web Notifications), so a
  ProjectTodo tab has to be open in Chrome; no push service, which would need keys and a
  dependency. A due reminder waits for the next open page instead of being lost.
- 2026-11-20 (assistant): "an agent monitoring my activity" is built as a read-only list
  from Claude Code's own files, not as a model that watches and summarises.

## Progress

- 2026-11-20: all four steps built. Differences from the plan: the reminder field shows
  for every to-do, not only main ones (less code, same result); the sessions list reads the
  last 128 KB of each file. Checked: `node --test` (due one sent once and stamped, future
  one left, bad value refused); in the browser the editor saved a reminder, the toast came,
  details showed "(sent)", a new time re-armed it. The notification itself could not be
  seen in the test browser, which blocks notifications.

- 2026-11-20, changed after the person's look: "I don't want the in progress and up next.
  This looks like kanban view." Those two boxes are gone. The first page now has, on top,
  **This week**: the main to-dos of one picked project (modules included) finished since
  Monday or in progress, titles only, for a Friday meeting; then boxes for Claude sessions,
  Reminders and **Claude limits**.
- Decision (assistant): the plan limits are not on disk for the desktop app (the CLI's
  cache in `~/.claude.json` was two months old), and reading them with the account token is
  not something the board should do. A Claude session reads them and posts them to
  `POST /api/claude/limits`; the box shows the last reading and its age. Keeping it fresh
  needs a scheduled Claude task, offered, not created.

- 2026-11-20, redesign asked ("completely redesign the dashboard, it doesn't look good"):
  the first page opens with the date and ISO week, then four cards that flow into as many
  columns as the window fits: This week (two big counts, a Mon–Sun strip with the days
  something finished, then the finished and running to-dos), Reminders, Claude limits (a
  ring per window, amber from 70%, red from 90%) and Claude sessions (a pulsing dot on the
  active ones). Checked in a dark and a light theme and at phone width.
- 2026-11-20: scheduled task `post-claude-limits-to-projecttodo` created in the Claude
  desktop app (09:00, 12:00, 15:00, 18:00 on weekdays). A test run from the session was
  refused by the permission system, so its first run is unconfirmed.

- 2026-11-20, after the next look: the dashboard is `/` and the projects have their own
  page at `/projects` again; the dashboard has a Projects card (a row per project to its
  board, the heading to the page). Reminders has a + for a reminder of its own: a to-do
  with a time and `project_id: null`, the one to-do allowed without a project; its ✓
  deletes it.
- The agent ("what about the agent I was talking about"): a second scheduled task,
  `log-claude-activity-to-projecttodo` (12:30 and 17:30 on weekdays), reads today's
  sessions from `GET /api/claude`, writes one to four lines per project and posts them to
  `POST /api/journal`; This week shows them under "From your Claude sessions". It reads
  titles and last prompts only, never the transcripts. First run unconfirmed.

- 2026-11-20 (user): the limits task runs every 10 minutes on Haiku (`model: haiku` in the
  task's SKILL.md; the next run was checked and used Haiku for every message). The board
  leaves scheduled runs out of the sessions list (they carry `turnOrigin: scheduled` near
  the start of the file), and reads a session's branch from the repository when Claude
  Code recorded "HEAD". Projects sit under Claude limits; the dashboard uses fixed columns.

- Correction, 2026-11-20: the Haiku setting took effect because the person chose Haiku in
  the app's scheduler, not because of the `model: haiku` line the assistant wrote into the
  task file; the app did not pick that edit up. The app now writes the same line itself.
  To change a task's model, use the scheduler screen.

- 2026-11-20 (user: "The reminder didn't sent a chrome notification"): the server marked a
  reminder sent as soon as any page was connected, including one that may not notify (the
  assistant's own test browser was connected). Now a due reminder is sent on every tick
  until a page says it showed the notification; the notification stays until dismissed;
  the Reminders card shows where notifications stand and has a test button.
- Same day: Snooze on a due reminder (10 minutes, 1 hour, 1 day); the + form sets the time
  on a clock with hands that can be dragged, opening on the time it is; a running clock in
  the middle of the dashboard's top row.

- 2026-11-20 (user): one reminder dialog, with Cancel and Remove, replaces the inline
  form: opened by + on the dashboard, by a reminder's time badge there, by a bell in the
  header of a to-do's view, and by a bell in the header of a draft's pad (an existing
  draft). Notifications are plain again: the kind that stays on screen goes through a
  second macOS permission and can be dropped unseen. The probe notification was confirmed
  by the person's Chrome but did not appear on screen: a macOS setting, not checked.

- 2026-11-20, cause found by the person: macOS had notifications turned off for Chrome.
  With that on, the test notification shows. The test button's fixed label (every press
  after the first replaced the old one silently) was a second, separate bug, fixed.
