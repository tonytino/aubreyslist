import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AddListingWizard } from "~/components/add-listing/AddListingWizard";
import { Button } from "~/components/ui/button";
import { canonicalLink, pageSeoMeta } from "~/lib/seo";
import { getCurrentUser } from "~/server/auth/current-user";
import { getSetting, type IntakeMode } from "~/server/settings";

/**
 * Add-listing route (ADR-008). An authenticated "add a restaurant" flow whose
 * intake surface is driven by the active intake mode: `places` → Google
 * Places search-and-pick; `manual` → name/address/lat/lng form.
 *
 * The loader resolves the active intake mode and whether the caller is signed
 * in (server-side), so the page renders the correct form — or a sign-in
 * prompt — on first paint with no flash. The write is gated again server-side
 * in `createListing` (`requireCurrentUser`), so the loader's auth read is a
 * UX convenience, not the security boundary.
 */

/**
 * Server-only loader data for the add-listing page: the active intake mode
 * and whether someone is signed in. `getSetting` + `getCurrentUser` touch
 * server-only modules (DB / session), so they run behind a server function.
 */
const getAddListingContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ intakeMode: IntakeMode; isSignedIn: boolean }> => {
    const [intakeMode, user] = await Promise.all([getSetting("intake_mode"), getCurrentUser()]);
    return { intakeMode, isSignedIn: user !== null };
  }
);

export const Route = createFileRoute("/listings/new")({
  head: () => ({
    meta: pageSeoMeta({
      title: "Add a restaurant · Aubrey's List",
      description:
        "Add a gluten-free or celiac-safe restaurant to Aubrey's List so the community can vet it.",
      path: "/listings/new",
    }),
    links: [canonicalLink("/listings/new")],
  }),
  loader: () => getAddListingContext(),
  component: AddListing,
});

function AddListing() {
  const { intakeMode, isSignedIn } = Route.useLoaderData();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-section px-4 py-10 text-foreground sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-headline font-bold tracking-tight">Add a restaurant</h1>
        <p className="text-body text-muted-foreground">
          Add a restaurant, then attest to what you know. Skip anything you're not sure of.
        </p>
      </header>

      {isSignedIn ? <AddListingWizard intakeMode={intakeMode} /> : <SignInPrompt />}
    </main>
  );
}

/**
 * Shown to anonymous visitors. Adding a listing is a gated write (ADR-010),
 * so this surfaces the same "Continue with Google" entry point the header
 * uses — a plain anchor to the OAuth initiation route (a full-page redirect,
 * not an RPC).
 */
function SignInPrompt() {
  return (
    // Labeled region so the "Continue with Google" link here is addressable
    // independently of the identical app-shell header link (E2E strict-mode).
    <section
      aria-label="Sign in to add a restaurant"
      className="flex flex-col items-start gap-4 rounded-card border border-border bg-card p-gutter text-card-foreground"
    >
      <p className="text-body text-foreground">Please sign in to add a restaurant.</p>
      <Button asChild>
        <a href="/api/auth/google">Continue with Google</a>
      </Button>
      <Link to="/" className="text-body-sm underline underline-offset-4">
        Back to home
      </Link>
    </section>
  );
}
