# Preview Feedback Loop (Vercel Toolbar Comments)

> **Decision rule:** When a task changes anything visual or responsive, check
> the **Vercel Toolbar comment threads** for the preview *before* declaring the
> work done. The human leaves viewport-anchored feedback there (mobile / tablet
> / desktop); agents read it, fix, reply, and resolve — no screenshots to
> transcribe, no context to retype.

This is the machine-readable side of the comments a human pins on a preview
deployment via the Vercel Toolbar. The **Vercel MCP** (`mcp__Vercel__*`) exposes
those threads directly, so an agent can consume the exact feedback the human
left on the running page, with the page path and viewport attached.

> Web sessions have the Vercel MCP tools. If they aren't loaded, pull the
> schemas with `ToolSearch` (query `select:mcp__Vercel__list_toolbar_threads,...`).

---

## Project identifiers

These are stable and not secret (they appear in Vercel dashboard URLs). Pass the
team **slug** or ID interchangeably.

| Field        | Value                                   |
| ------------ | --------------------------------------- |
| Team slug    | `brbcoding`                             |
| Team ID      | `team_NsS5tKvwFH9LeAtebnHjthA7`         |
| Project name | `aubreyslist`                           |
| Project ID   | `prj_uNDgfqDJkHApOFQqWPO6ADNIHQft`      |

Re-derive them any time with `list_teams` then `list_projects` if they drift.

---

## The loop (pull-based)

There is **no webhook** for Vercel comments — nothing pings the agent when a new
comment lands. The loop is **pull**: the human leaves feedback, then the agent
checks for it (when told to, or on a poll). Build the habit into any task that
touches UI.

1. **List unresolved threads for your branch.** Filter to the branch you're
   working so you only see feedback for your preview:

   ```
   mcp__Vercel__list_toolbar_threads
     teamId:    brbcoding
     projectId: prj_uNDgfqDJkHApOFQqWPO6ADNIHQft
     branch:    <your-working-branch>
     status:    unresolved
   ```

   Also filterable by `page` (path or glob, e.g. `/browse*`) and `search` (text).

2. **Read full context per thread.** `get_toolbar_thread` returns all messages
   plus context — the page path and viewport tell you *which* experience the
   feedback is about (this is the whole point: "header overlaps on mobile" comes
   with the mobile viewport attached, not as prose you have to infer).

3. **Fix it.** Implement against the specific viewport/page the comment names.

4. **Reply on the thread** with what changed and where — link the commit or PR:

   ```
   mcp__Vercel__reply_to_toolbar_thread
     teamId:   brbcoding
     threadId: <thread id>
     markdown: "Fixed in <commit/PR>: <one line>. Live on the next preview build."
   ```

5. **Resolve the thread** once the fix is deployed to a preview the human can
   re-check — `change_toolbar_thread_resolve_status` with `resolved: true`.
   Leave it **unresolved** if it needs the human to confirm visually.

---

## Etiquette

- **Never resolve a thread you didn't address.** Resolve signals "done, re-check
  me," not "seen."
- **One reply per thread, concrete.** Say what changed and on which viewport;
  don't narrate every intermediate step.
- **Batch by page.** If several threads target the same page, read them all
  before editing so one pass covers them.
- **Don't auto-file issues from comments.** A toolbar comment is not a tracked
  work item. Only promote it to Linear (see `docs/agents/linear.md`) if it's real
  scope that outlives the current session — and mind the free-tier issue cap.

---

## Where this fits

- **Vercel toolbar comments** = visual / responsive feedback capture, consumed
  here. Best for "on tablet this wraps wrong."
- **Linear** = tracked, structured work (`docs/agents/linear.md`). Best for
  "build the feature."
- **GitHub PRs** = code review, CI, merge. The reply/resolve above references the
  PR; it doesn't replace it.

Keep feedback in the tool that fits: pin visual notes in Vercel, not as retyped
prose in a PR comment.
