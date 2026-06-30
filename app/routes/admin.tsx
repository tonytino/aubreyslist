import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { AdminPanel } from "~/components/admin/AdminPanel";
import { moderationQueueQueryOptions } from "~/components/admin/moderation-queue-query";
import { Button } from "~/components/ui/button";
import { fetchAdminView } from "~/server/admin/admin-view.fn";

/**
 * Admin panel shell (issue #38).
 *
 * Access is gated SERVER-SIDE in the loader via {@link fetchAdminView} (which
 * reads the authoritative `users` row) — ADR-010 requires server-side
 * enforcement, never UI-only checks. The loader maps the server's `access`
 * verdict to one of three outcomes:
 *
 * - `anonymous` → redirect to the Google sign-in (full-page OAuth route),
 * - `forbidden` (signed-in `user`) → render the not-authorised UI,
 * - `granted` → render the shell; {@link AdminPanel} then shows only the
 *   sections the role may see (admin: everything; moderator: the queue).
 *
 * Both moderators and admins see the moderation queue (#40), so when access is
 * granted the loader prefetches it into the dehydrated TanStack Query cache —
 * the queue's own server fn re-runs the SAME server-side moderator+ guard, so
 * this prefetch is a render-time convenience, never the access control. Role
 * management (#16) and app-settings write/toggle (#24) also live in this shell.
 */
export const Route = createFileRoute("/admin")({
  loader: async ({ context }) => {
    const view = await fetchAdminView();
    // Anonymous visitors are sent to sign in; the OAuth initiation route is a
    // plain server route (not a typed app route), so redirect by `href`.
    if (view.access === "anonymous") {
      throw redirect({ href: "/api/auth/google" });
    }
    // Prefetch the moderation queue for granted (moderator+) viewers so the
    // section hydrates without a loading flash. The fn re-checks access itself.
    if (view.access === "granted") {
      await context.queryClient.ensureQueryData(moderationQueueQueryOptions());
    }
    return { view };
  },
  component: AdminRoute,
});

function AdminRoute() {
  const { view } = Route.useLoaderData();

  if (view.access === "forbidden") {
    return <Forbidden />;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-section bg-background px-4 py-10 text-foreground sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-headline font-bold tracking-tight">Admin</h1>
        <p className="text-body text-muted-foreground">
          {view.role === "admin"
            ? "Manage roles and app settings, and review the moderation queue."
            : "Review the moderation queue."}
        </p>
      </header>

      <AdminPanel viewerRole={view.role} settings={view.settings} />
    </main>
  );
}

/** 403-style UI for a signed-in but under-privileged (non-moderator) visitor. */
function Forbidden() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-16 text-foreground sm:px-6">
      <h1 className="text-headline font-bold tracking-tight">Not authorised</h1>
      <p className="text-body text-muted-foreground">
        This area is for moderators and admins. If you think you should have access, contact an
        administrator.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Back to home</Link>
      </Button>
    </main>
  );
}
