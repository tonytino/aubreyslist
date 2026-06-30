import { ForkKnife, MagnifyingGlass, Plus } from "@phosphor-icons/react/dist/ssr";
import { Link, createFileRoute } from "@tanstack/react-router";
import { SAFETY_STATES, SafetySignal } from "~/components/SafetySignal";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { claimAttributeLabel } from "~/trust/summary";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <section className="flex flex-col items-start gap-6 py-16 sm:py-24">
        <Badge variant="secondary">Denver pilot</Badge>

        <h1 className="max-w-3xl text-headline font-bold tracking-tight sm:text-display">
          Find restaurants you can actually trust to be gluten-free.
        </h1>

        <p className="max-w-2xl text-lead text-muted-foreground">
          Aubrey's List is a community directory of how safe restaurants really are for people with
          a gluten-free or celiac need. Every listing is contributed, attested, and kept fresh by
          people who live with the same stakes — so you can tell celiac-safe from merely
          "gluten-friendly" before you order.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Browse list lands in #33; "Add a listing" target is #25's intake route. */}
          <Button asChild size="lg">
            <Link to="/listings">
              <MagnifyingGlass aria-hidden className="h-4 w-4" />
              Browse Denver listings
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/listings/new">
              <Plus aria-hidden className="h-4 w-4" />
              Add a listing
            </Link>
          </Button>
        </div>

        <Card className="w-full max-w-2xl">
          <CardContent className="flex flex-col gap-3">
            <p className="text-body-sm text-muted-foreground">
              Celiac-safe or just gluten-friendly? Dedicated fryer or shared oil? Know before you
              order.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* Headline trust verdicts. `stale` is a freshness meta-state, not a
                  headline tier, so it is intentionally omitted from this intro legend. */}
              {SAFETY_STATES.filter((state) => state !== "stale").map((state) => (
                <SafetySignal key={state} state={state} />
              ))}
              {/* An example GF taxonomy attribute (domain.md) — the concrete kitchen
                  accommodations the community tracks, distinct from the trust verdicts
                  above. Icon + text, never colour alone (styling.md). */}
              <Badge variant="outline" className="gap-1.5">
                <ForkKnife aria-hidden className="h-4 w-4" />
                {claimAttributeLabel("dedicated_fryer")}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
