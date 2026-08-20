# Preview Feedback Loop (Vercel Toolbar Comments)

> **Decision rule:** when a task changes anything visual or responsive, check
> the **Vercel Toolbar comment threads** for the preview *before* declaring the
> work done. The human leaves viewport-anchored feedback there; agents read it,
> fix, reply, and resolve.

The Vercel MCP (`mcp__Vercel__*`) exposes the comment threads a human pins on a
preview deployment, with page path and viewport attached. If the tools aren't
loaded, pull schemas with `ToolSearch`
(query `select:mcp__Vercel__list_toolbar_threads,...`).

## Project identifiers

Stable and not secret (they appear in dashboard URLs). Team slug or ID work
interchangeably. Re-derive with `list_teams` then `list_projects` if they drift.

| Field        | Value                                   |
| ------------ | --------------------------------------- |
| Team slug    | `brbcoding`                             |
| Team ID      | `team_NsS5tKvwFH9LeAtebnHjthA7`         |
| Project name | `aubreyslist`                           |
| Project ID   | `prj_uNDgfqDJkHApOFQqWPO6ADNIHQft`      |

## The loop (pull-based)

There is **no webhook** for Vercel comments — check for feedback yourself (when
told to, or on a poll) in any task that touches UI.

1. **List unresolved threads for your branch:**

   ```
   mcp__Vercel__list_toolbar_threads
     teamId:    brbcoding
     projectId: prj_uNDgfqDJkHApOFQqWPO6ADNIHQft
     branch:    <your-working-branch>
     status:    unresolved
   ```

   Also filterable by `page` (path or glob, e.g. `/browse*`) and `search` (text).

2. **Read full context per thread.** `get_toolbar_thread` returns all messages
   plus the page path and viewport the feedback is about.

3. **Fix it** against the specific viewport/page the comment names.

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

## Etiquette

- **Never resolve a thread you didn't address.** Resolve signals "done, re-check
  me," not "seen."
- **One reply per thread, concrete.** Say what changed and on which viewport.
- **Batch by page.** Read all threads on a page before editing so one pass
  covers them.
- **Don't auto-file issues from comments.** Promote a comment to Linear
  (`docs/agents/linear.md`) only if it's real scope that outlives the session —
  and mind the free-tier issue cap.

## Where this fits

- **Vercel toolbar comments** = visual/responsive feedback ("on tablet this
  wraps wrong").
- **Linear** = tracked, structured work (`docs/agents/linear.md`).
- **GitHub PRs** = code review, CI, merge. The reply/resolve above references
  the PR; it doesn't replace it.

Pin visual notes in Vercel, not as retyped prose in a PR comment.
