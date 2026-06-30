import { Link, createFileRoute } from "@tanstack/react-router";

/**
 * About — a static content route explaining the mission, the trust model, the GF
 * attribute taxonomy, and how to contribute (issue #151). The header's "About"
 * nav item links here. Copy is kept accurate to `docs/product/overview.md` and
 * `docs/agents/domain.md`: trust IS the product, evidence is never a black box,
 * recent harm is never buried.
 *
 * Content-only: no data fetching, no auth. Reads are open, so this renders for
 * anonymous visitors. Uses the brand design tokens (styling.md) and semantic
 * headings for accessibility.
 */
export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About · Aubrey's List" },
      {
        name: "description",
        content:
          "Aubrey's List is a community-driven directory of how safe restaurants are for gluten-free and celiac needs. Learn how its transparent trust model works and how to contribute.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="text-body-sm font-semibold uppercase tracking-wide text-brand">
          About Aubrey's List
        </p>
        <h1 className="text-headline font-bold tracking-tight text-foreground">
          Restaurants you can actually trust to be gluten-free.
        </h1>
        <p className="text-lead text-muted-foreground">
          Aubrey's List is a community-driven directory of how safe restaurants really are for
          people with a gluten-free or celiac need — information that is contributed, attested,
          dated, and kept fresh by people who live with the same stakes.
        </p>
      </header>

      <section aria-labelledby="mission-heading" className="mt-section flex flex-col gap-3">
        <h2 id="mission-heading" className="text-title font-semibold text-foreground">
          Our mission
        </h2>
        <p className="text-body text-muted-foreground">
          Generic reviews and map listings bury the questions that actually matter to someone with a
          gluten allergy: does the kitchen use a dedicated fryer, will they prepare an off-menu dish
          gluten-free on request, and does the staff genuinely understand cross-contamination? That
          knowledge lives in the community, and it decays — a place that was safe last year may have
          changed its fryer, menu, or staff.
        </p>
        <p className="text-body text-muted-foreground">
          So we built a directory where people who share the need can record what they know, vouch
          for what others have reported, and keep it current. Trust is not a feature of this
          product. Trust <strong className="font-semibold text-foreground">is</strong> the product —
          every decision is judged against one question: does this help a person with a gluten
          allergy decide, with confidence, whether to eat here?
        </p>
        <p className="text-body text-muted-foreground">
          v1 is a focused public pilot seeded in Denver, Colorado. For a trust-driven product,
          density beats breadth — a handful of well-attested local listings is worth far more than a
          scattering of thin ones nationwide.
        </p>
      </section>

      <section aria-labelledby="trust-heading" className="mt-section flex flex-col gap-3">
        <h2 id="trust-heading" className="text-title font-semibold text-foreground">
          How trust works
        </h2>
        <p className="text-body text-muted-foreground">
          Every listing's trust summary is a transparent roll-up of evidence you can see for
          yourself — never a secret score. For each attribute we show the distribution and recency
          of community input, for example{" "}
          <span className="text-foreground">
            "Dedicated fryer — 8 confirm / 1 dispute · last confirmed 3 weeks ago."
          </span>{" "}
          The underlying evidence stays visible beneath the summary.
        </p>
        <ul className="flex flex-col gap-2 text-body text-muted-foreground">
          <li>
            <strong className="font-semibold text-foreground">Confirm or dispute, openly.</strong>{" "}
            Each GF attribute can be confirmed or disputed — one vote per person per claim, always
            changeable or retractable. No ballot-stuffing, no hidden formula.
          </li>
          <li>
            <strong className="font-semibold text-foreground">Recency is weighted.</strong> An old
            consensus is weaker than a fresh one. A claim not confirmed within the six-month
            staleness window is flagged "may be stale" — it is surfaced, not hidden.
          </li>
          <li>
            <strong className="font-semibold text-foreground">Recent harm is never buried.</strong>{" "}
            A recent "got glutened here" incident prominently flags a listing regardless of how many
            older confirmations it has. Fresh harm always rises to the top.
          </li>
        </ul>
        <p className="text-body text-muted-foreground">
          Safety signals never rely on color alone — the celiac-safe vs. gluten-friendly
          distinction, staleness, and recent incidents are each shown with a distinct icon and text
          label so the meaning survives color-vision differences and greyscale.
        </p>
      </section>

      <section aria-labelledby="taxonomy-heading" className="mt-section flex flex-col gap-3">
        <h2 id="taxonomy-heading" className="text-title font-semibold text-foreground">
          What the community attests
        </h2>
        <p className="text-body text-muted-foreground">
          The headline distinction is{" "}
          <strong className="font-semibold text-foreground">celiac-safe vs. gluten-friendly</strong>
          : does the restaurant take cross-contamination seriously (celiac-safe), or merely offer
          GF-ish options (gluten-friendly)? Conflating the two is the exact failure mode this
          product exists to prevent, so we surface it most prominently. Beneath it, every listing
          tracks the same fixed set of attributes so listings stay comparable and filterable:
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-muted-foreground">
          <li>Dedicated or separate fryer — yes, no, or shared oil.</li>
          <li>A dedicated, labeled gluten-free menu.</li>
          <li>Off-menu gluten-free on request — will adapt non-labeled dishes when asked.</li>
          <li>Gluten-free substitutes available — bread, buns, pizza crust, pasta, and more.</li>
        </ul>
      </section>

      <section aria-labelledby="contribute-heading" className="mt-section flex flex-col gap-3">
        <h2 id="contribute-heading" className="text-title font-semibold text-foreground">
          How to contribute
        </h2>
        <p className="text-body text-muted-foreground">
          Browsing and searching are open to everyone — no account needed. Every contribution is
          attributable, so adding to the record takes a quick sign-in with Google. Once you're in:
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body text-muted-foreground">
          <li>Sign in with Google.</li>
          <li>Add a listing for a restaurant the community should vet.</li>
          <li>Attest its GF attributes — confirm or dispute what others have reported.</li>
          <li>Report an incident if you got glutened, so recent harm is visible.</li>
        </ol>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            to="/listings"
            className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong"
          >
            Browse Denver listings
          </Link>
          <Link
            to="/listings/new"
            className="inline-flex items-center justify-center rounded-card border border-border px-5 py-2.5 text-body font-semibold text-foreground hover:bg-surface"
          >
            Add a listing
          </Link>
        </div>
      </section>
    </div>
  );
}
