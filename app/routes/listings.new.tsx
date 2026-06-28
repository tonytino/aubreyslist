import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ManualIntakeForm } from "~/components/add-listing/ManualIntakeForm";
import { PlacesIntakeForm } from "~/components/add-listing/PlacesIntakeForm";
import { getCurrentUser } from "~/server/auth/current-user";
import type { CreateListingResult } from "~/server/listings/create";
import { type IntakeMode, getSetting } from "~/server/settings";

/**
 * Add-listing route (issue #26, ADR-008). An authenticated, end-to-end "add a
 * restaurant" flow whose intake surface is driven by the **active** intake mode:
 * `places` → Google Places search-and-pick; `manual` → name/address/lat/lng form.
 *
 * The route loader resolves both the active intake mode and whether the caller
 * is signed in (server-side), so the page renders the correct form — or a
 * sign-in prompt — on first paint with no flash. The write itself is gated again
 * server-side in `createListing` (`requireCurrentUser`), so the loader's auth
 * read is a UX convenience, not the security boundary.
 */

/**
 * Server-only loader data for the add-listing page: the active intake mode and
 * whether someone is signed in. `getSetting` + `getCurrentUser` both touch
 * server-only modules (DB / session), so they run here behind a server function.
 */
const getAddListingContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ intakeMode: IntakeMode; isSignedIn: boolean }> => {
    const [intakeMode, user] = await Promise.all([getSetting("intake_mode"), getCurrentUser()]);
    return { intakeMode, isSignedIn: user !== null };
  }
);

export const Route = createFileRoute("/listings/new")({
  loader: () => getAddListingContext(),
  component: AddListing,
});

function AddListing() {
  const { intakeMode, isSignedIn } = Route.useLoaderData();
  const navigate = useNavigate();

  /**
   * On a successful write, route to the listing detail page. A places-mode
   * duplicate resolves to the existing listing (`created: false`) and we route
   * there just the same — the user lands on the restaurant they were adding,
   * which is the graceful "already listed" path (ADR-008 / issue #25).
   */
  const handleCreated = (result: CreateListingResult) => {
    navigate({ to: "/listings/$id", params: { id: result.listing.id } });
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-section px-4 py-10 text-foreground sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-headline font-bold tracking-tight">Add a restaurant</h1>
        <p className="text-body text-muted-foreground">
          Help the community find gluten-free-safe places. Add a restaurant below — you can attest
          to how safe it is once it's listed.
        </p>
      </header>

      {!isSignedIn ? (
        <SignInPrompt />
      ) : intakeMode === "places" ? (
        <PlacesIntakeForm onCreated={handleCreated} />
      ) : (
        <ManualIntakeForm onCreated={handleCreated} />
      )}
    </main>
  );
}

/**
 * Shown to anonymous visitors. Adding a listing is a gated write (ADR-010), so
 * we surface the same "Continue with Google" entry point the header uses — a
 * plain anchor to the OAuth initiation route (a full-page redirect, not an RPC).
 */
function SignInPrompt() {
  return (
    // Labeled region so the "Continue with Google" link here is addressable
    // independently of the identical app-shell header link (E2E strict-mode).
    <section
      aria-label="Sign in to add a restaurant"
      className="flex flex-col items-start gap-4 rounded-card border border-border p-gutter"
    >
      <p className="text-body text-foreground">Please sign in to add a restaurant.</p>
      <a
        href="/api/auth/google"
        className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong"
      >
        Continue with Google
      </a>
      <Link to="/" className="text-body-sm underline underline-offset-4">
        Back to home
      </Link>
    </section>
  );
}
