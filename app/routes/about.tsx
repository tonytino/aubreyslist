import { createFileRoute, Link } from "@tanstack/react-router";
import { Utensils } from "lucide-react";
import { SAFETY_STATES, SAFETY_TOOLTIP, SafetySignal } from "~/components/SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { canonicalLink, pageSeoMeta } from "~/lib/seo";
import { claimAttributeLabel } from "~/trust/summary";

/**
 * About — a static content route explaining the mission, the trust model, the
 * GF attribute taxonomy, and how to contribute. Copy must stay accurate to
 * `docs/product/overview.md` and `docs/agents/domain.md`: trust is the
 * product, evidence is never a black box, recent harm is never buried.
 *
 * Content-only: no data fetching, no auth. Reads are open, so this renders
 * for anonymous visitors.
 */
export const Route = createFileRoute("/about")({
  head: () => ({
    meta: pageSeoMeta({
      title: "About · Aubrey's List",
      description:
        "Aubrey's List is a community directory of gluten-free and celiac-safe restaurants. Learn how the trust model works and how to contribute.",
      path: "/about",
    }),
    links: [canonicalLink("/about")],
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
          A community directory of how safe restaurants really are for gluten-free and celiac
          diners, kept current by people who share the need.
        </p>
      </header>

      <section aria-labelledby="mission-heading" className="mt-section flex flex-col gap-3">
        <h2 id="mission-heading" className="text-title font-semibold text-foreground">
          Our mission
        </h2>
        <p className="text-body text-muted-foreground">
          Generic reviews bury the details that matter with a gluten allergy, like whether the fryer
          is dedicated or the staff understands cross-contamination. That knowledge lives in the
          community, and it goes stale: a kitchen that was safe last year may have changed.
        </p>
        <p className="text-body text-muted-foreground">
          So we built a directory where celiac and gluten-free diners record what they know and keep
          it current. Everything here exists to help you decide, with confidence, whether to eat
          somewhere.
        </p>
        <p className="text-body text-muted-foreground">
          We're starting with a public pilot in Denver, Colorado. A few well-attested local listings
          beat a thin national scattering.
        </p>
      </section>

      <section aria-labelledby="trust-heading" className="mt-section flex flex-col gap-3">
        <h2 id="trust-heading" className="text-title font-semibold text-foreground">
          How trust works
        </h2>
        <p className="text-body text-muted-foreground">
          A listing's trust summary is a roll-up of evidence you can see for yourself, never a
          hidden score. Each attribute shows the count and recency of community input, like{" "}
          <span className="text-foreground">
            "Dedicated fryer: 8 confirm / 1 dispute · last confirmed 3 weeks ago."
          </span>{" "}
          The evidence stays visible below the summary.
        </p>
        <ul className="flex flex-col gap-2 text-body text-muted-foreground">
          <li>
            <strong className="font-semibold text-foreground">Confirm or dispute, openly.</strong>{" "}
            One vote per person per claim, changeable or retractable anytime. No hidden formula.
          </li>
          <li>
            <strong className="font-semibold text-foreground">Recency counts.</strong> A claim not
            confirmed within six months is flagged "may be stale", not hidden.
          </li>
          <li>
            <strong className="font-semibold text-foreground">Recent harm is never buried.</strong>{" "}
            A recent "got glutened" report flags a listing no matter how many older confirmations it
            has.
          </li>
        </ul>
        <p className="text-body text-muted-foreground">
          Safety signals never rely on color alone. Each state gets its own icon and text label, so
          the meaning survives greyscale and color-vision differences.
        </p>
        {/* The concrete legend behind that claim: every surfaced safety state
            plus one neutral GF taxonomy-attribute example. Each is icon +
            text, never color alone (styling.md). `stale` is a freshness
            meta-state, not a headline verdict, so it is omitted here on
            purpose. Mapped from SAFETY_STATES, so retiring a state drops its
            chip here automatically. */}
        <div className="flex flex-wrap items-center gap-2">
          {SAFETY_STATES.filter((state) => state !== "stale").map((state) => (
            // The chip is the tooltip trigger (colour + icon + label already
            // carry the meaning); the tooltip adds the centralized
            // SAFETY_TOOLTIP explainer. `tabIndex={0}` makes it reachable on
            // keyboard focus as well as hover.
            <Tooltip key={state}>
              <TooltipTrigger asChild>
                <SafetySignal state={state} tabIndex={0} />
              </TooltipTrigger>
              <TooltipContent>{SAFETY_TOOLTIP[state]}</TooltipContent>
            </Tooltip>
          ))}
          {/* An example GF taxonomy attribute (domain.md) — matches the
              SafetySignal chip geometry but in a neutral tone so it never
              reads as a safety verdict. */}
          <span className="inline-flex items-center gap-1.5 rounded-chip border border-border bg-muted px-2.5 py-1 text-body-sm font-medium text-muted-foreground">
            <Utensils aria-hidden className="h-4 w-4 shrink-0" />
            {claimAttributeLabel("dedicated_fryer")}
          </span>
        </div>
      </section>

      <section aria-labelledby="taxonomy-heading" className="mt-section flex flex-col gap-3">
        <h2 id="taxonomy-heading" className="text-title font-semibold text-foreground">
          What the community attests
        </h2>
        <p className="text-body text-muted-foreground">
          The headline claim is{" "}
          <strong className="font-semibold text-foreground">celiac-safe</strong>: whether the
          kitchen takes cross-contamination seriously. Everything here is assumed to have
          gluten-free options, so celiac-safe is the only safety claim the community attests. Enough
          disputes remove the badge, and no lesser badge takes its place. Every listing also tracks
          the same fixed attributes, so listings stay comparable:
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-muted-foreground">
          <li>Dedicated or separate fryer (yes, no, or shared oil).</li>
          <li>A dedicated, labeled gluten-free menu.</li>
          <li>Off-menu gluten-free on request: they'll adapt dishes when asked.</li>
          <li>Gluten-free substitutes: bread, buns, pizza crust, pasta.</li>
        </ul>
      </section>

      <section aria-labelledby="contribute-heading" className="mt-section flex flex-col gap-3">
        <h2 id="contribute-heading" className="text-title font-semibold text-foreground">
          How to contribute
        </h2>
        <p className="text-body text-muted-foreground">
          Browsing is open to everyone, no account needed. Contributions carry a name, so adding to
          the record takes a quick sign-in. Once you're in:
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body text-muted-foreground">
          <li>Sign in with Google.</li>
          <li>Add a restaurant the community should vet.</li>
          <li>Attest its GF attributes: confirm or dispute what others report.</li>
          <li>Report it if you got glutened, so recent harm stays visible.</li>
        </ol>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            to="/"
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
