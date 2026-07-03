import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import type { Listing } from "~/db/schema";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import type { ListingTrustGlance } from "~/trust/browse-glance";
import { ListingCard, RestaurantCard, type RestaurantCardVM, listingToCardVM } from "./ListingCard";

// The card now embeds the FavoriteButton island (F6, AUB-125), which imports the
// `favorites.fn` server seam. That seam transitively pulls in the db-touching
// implementation, so — exactly as FavoriteButton.test.tsx does — we mock it out;
// these tests only assert the heart RENDERS in the card, not its write behaviour.
vi.mock("~/server/favorites/favorites.fn", () => ({
  favoriteListing: vi.fn(() => Promise.resolve()),
  unfavoriteListing: vi.fn(() => Promise.resolve()),
}));

/**
 * Tests for the browse-list card (#33, AUB-61 redesign). Covers the trust-glance
 * render across states — celiac-safe, gluten-friendly, the honest "Not yet
 * attested" empty state, the recent-incident flag — plus the redesign's new
 * surface: the attributed (non-safety) Google rating pill, evidence counts, and
 * the photo placeholder vs `<img>`. The accessible signals (colour + icon + TEXT
 * label) are asserted via their visible text, never colour.
 *
 * The card uses TanStack Router's `Link`, so it must render inside a router. We
 * mount a tiny in-memory router whose tree includes the `/listings/$id` target so
 * `Link` can resolve its href without the full app route tree.
 */

const baseVm: RestaurantCardVM = {
  id: "listing-1",
  name: "Acme Gluten-Free",
  address: "123 Main St, Denver, CO",
  safetyState: "celiac-safe",
  suggestedByBot: false,
  hasRecentIncident: false,
  accent: "lavender",
};

const baseListing: Listing = {
  id: "listing-1",
  placeId: null,
  name: "Acme Gluten-Free",
  address: "123 Main St, Denver, CO",
  lat: 39.7392,
  lng: -104.9903,
  mapsUrl: "https://maps.google.com/?q=acme",
  menuUrl: null,
  moderationStatus: "visible",
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Mount `element` inside a minimal router that can resolve `/listings/$id`. */
function renderInRouter(element: ReactNode) {
  const rootRoute = createRootRoute();
  const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{element}</>,
  });
  // The link target must exist in the tree for `Link` to type/resolve.
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/listings/$id",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([browseRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // The embedded FavoriteButton reads the prefetched favorites + current-user
  // suspense queries; seed both (anonymous, no favorites) so it renders its empty
  // "Save …" heart synchronously without hitting the mocked server fns.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(favoriteIdsQuery.queryKey, []);
  queryClient.setQueryData(currentUserQuery.queryKey, null);
  // The concrete router type doesn't match the provider's generic default; this
  // is a test-only structural mismatch, safe to assert through unknown.
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as unknown as never} />
    </QueryClientProvider>
  );
}

function renderCard(overrides: Partial<RestaurantCardVM> = {}) {
  renderInRouter(<RestaurantCard vm={{ ...baseVm, ...overrides }} />);
}

describe("RestaurantCard", () => {
  it("renders the listing name and address", async () => {
    renderCard();
    expect(await screen.findByRole("heading", { name: "Acme Gluten-Free" })).toBeInTheDocument();
    expect(screen.getByText(/123 Main St, Denver, CO/)).toBeInTheDocument();
  });

  it("appends the distance label to the location line when provided", async () => {
    renderCard({ distanceLabel: "0.4 mi" });
    expect(await screen.findByText("123 Main St, Denver, CO · 0.4 mi")).toBeInTheDocument();
  });

  it("links the whole card to the listing detail page", async () => {
    renderCard();
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/listings/listing-1");
  });

  it("renders the FavoriteButton as a sibling of the link, not nested in the anchor", async () => {
    renderCard();
    // The dead heart is now the wired FavoriteButton island (F6, AUB-125); its
    // accessible name is derived from the listing name ("Save <name>"). The
    // stretched-link pattern keeps a valid DOM: the <button> must NOT be a
    // descendant of the <a> (a button inside an anchor is invalid HTML + an a11y
    // defect). Both remain independently present.
    const link = await screen.findByRole("link");
    const saveButton = screen.getByRole("button", { name: "Save Acme Gluten-Free" });
    expect(saveButton).toBeInTheDocument();
    expect(link).not.toContainElement(saveButton);
    expect(saveButton).not.toContainElement(link);
  });

  it("shows the SafetySignal for a non-null state (text, not colour alone)", async () => {
    renderCard({ safetyState: "celiac-safe" });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
  });

  it("shows the gluten-friendly label", async () => {
    renderCard({ safetyState: "gluten-friendly" });
    expect(await screen.findByText("Gluten-friendly")).toBeInTheDocument();
  });

  it("renders an honest Not yet attested state when safetyState is null", async () => {
    renderCard({ safetyState: null });
    expect(await screen.findByText("Not yet attested")).toBeInTheDocument();
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
  });

  it("shows the 'Suggested by Aubrey's Bot' chip in place of Not-yet-attested when bot-suggested (AUB-31)", async () => {
    renderCard({ safetyState: null, suggestedByBot: true });
    expect(await screen.findByText("Suggested by Aubrey's Bot")).toBeInTheDocument();
    // The suggestion REPLACES the bare empty state — never a fabricated verdict.
    expect(screen.queryByText("Not yet attested")).not.toBeInTheDocument();
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
  });

  it("never shows the bot chip once a real verdict exists (suggestion is superseded)", async () => {
    renderCard({ safetyState: "celiac-safe", suggestedByBot: false });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
    expect(screen.queryByText("Suggested by Aubrey's Bot")).not.toBeInTheDocument();
  });

  it("shows the recent-incident warning when a recent incident exists", async () => {
    renderCard({ safetyState: "celiac-safe", hasRecentIncident: true });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
    expect(screen.getByText("Recent incident")).toBeInTheDocument();
  });

  it("does not show the incident warning when there is no recent incident", async () => {
    renderCard({ hasRecentIncident: false });
    await screen.findByText("Celiac-safe");
    expect(screen.queryByText("Recent incident")).not.toBeInTheDocument();
  });

  it("does not render a Google rating pill when googleRating is absent", async () => {
    renderCard({ googleRating: null });
    await screen.findByText("Celiac-safe");
    expect(screen.queryByTestId("google-rating")).not.toBeInTheDocument();
    expect(screen.queryByText("Google")).not.toBeInTheDocument();
  });

  it("renders an ATTRIBUTED Google rating pill only when googleRating is present", async () => {
    renderCard({ googleRating: { value: 4.8, count: 128 } });
    const pill = await screen.findByTestId("google-rating");
    // The value is shown AND explicitly attributed to Google...
    expect(pill).toHaveTextContent("4.8");
    expect(pill).toHaveTextContent("Google");
    // ...and it is NOT presented as a safety verdict (ADR-007): no safety label,
    // and it carries no SafetySignal state marker.
    expect(pill).not.toHaveTextContent(/celiac|safe|gluten/i);
    expect(pill).not.toHaveAttribute("data-safety-state");
  });

  it("does not render a save-count pill when saveCount is 0", async () => {
    renderCard({ saveCount: 0 });
    await screen.findByText("Celiac-safe");
    // Hidden at 0 (matches how googleRating hides when absent) — no fabricated
    // "0 saves" pill.
    expect(screen.queryByTestId("save-count")).not.toBeInTheDocument();
    expect(screen.queryByText("saves")).not.toBeInTheDocument();
  });

  it("does not render a save-count pill when saveCount is absent (undefined)", async () => {
    renderCard();
    await screen.findByText("Celiac-safe");
    expect(screen.queryByTestId("save-count")).not.toBeInTheDocument();
  });

  it("renders an ATTRIBUTED save-count pill only when saveCount > 0", async () => {
    // The count is a PLAIN NUMBER on the client-safe VM — no server-only import
    // reaches the card; it just renders the number it is handed.
    renderCard({ saveCount: 12 });
    const pill = await screen.findByTestId("save-count");
    // The count is shown AND explicitly attributed ("saves")...
    expect(pill).toHaveTextContent("12");
    expect(pill).toHaveTextContent("saves");
    // ...and it is NOT presented as a safety verdict (ADR-007): no safety label,
    // and it carries no SafetySignal state marker.
    expect(pill).not.toHaveTextContent(/celiac|safe|gluten/i);
    expect(pill).not.toHaveAttribute("data-safety-state");
  });

  it("keeps the save-count pill SEPARATE from the SafetySignal row (ADR-007)", async () => {
    renderCard({ saveCount: 8, safetyState: "celiac-safe" });
    const pill = await screen.findByTestId("save-count");
    // The SafetySignal chip carries a `data-safety-state` marker; the attributed
    // pill must never nest, be nested by, or share a row with it — safety meaning
    // stays exclusively in SafetySignal.
    const safety = document.querySelector('[data-safety-state="celiac-safe"]');
    expect(safety).not.toBeNull();
    // Neither element nests the other — they are structurally distinct.
    expect(pill).not.toContainElement(safety as HTMLElement);
    expect(safety as HTMLElement).not.toContainElement(pill);
    // Not siblings: the pill and the safety signal live in different containers.
    expect(pill.parentElement).not.toBe((safety as HTMLElement).parentElement);
  });

  it("renders the pills as real <button> tooltip triggers OUTSIDE the anchor (a11y)", async () => {
    renderCard({ saveCount: 8, googleRating: { value: 4.8, count: 128 } });
    const link = await screen.findByRole("link");
    const save = screen.getByTestId("save-count");
    const google = screen.getByTestId("google-rating");
    // Nesting a focusable/interactive element inside an <a> is invalid HTML + an
    // a11y defect, so the pills must be SIBLINGS of the link, not descendants.
    expect(link).not.toContainElement(save);
    expect(link).not.toContainElement(google);
    // They are honest, natively-focusable, non-submitting <button> triggers (not a
    // tabindex-hacked span) — giving keyboard users real trigger semantics for the
    // ADR-007 tooltip.
    expect(save.tagName).toBe("BUTTON");
    expect(google.tagName).toBe("BUTTON");
    expect(save).toHaveAttribute("type", "button");
    expect(google).toHaveAttribute("type", "button");
  });

  it("keeps BOTH pills IN-FLOW in the title row so they reflow and never overlap the name", async () => {
    // The both-pills path with a long name is the regression the review flagged:
    // an absolute overlay would let the name slide UNDER the pills at 375px. With
    // the pills in-flow in the SAME flex row as the name, flexbox reflows them
    // side-by-side — structurally impossible to overlap, and no magic offsets.
    renderCard({
      name: "The Extraordinarily Long Gluten-Free Bakery And Coffee House Name",
      saveCount: 8,
      googleRating: { value: 4.8, count: 128 },
    });
    const heading = await screen.findByRole("heading");
    const save = screen.getByTestId("save-count");
    const google = screen.getByTestId("google-rating");
    const titleRow = heading.parentElement as HTMLElement;
    // Name + both pills share ONE in-flow row container, never an absolute layer.
    expect(titleRow).toContainElement(heading);
    expect(titleRow).toContainElement(save);
    expect(titleRow).toContainElement(google);
    // ...and the pills stay OUT of the anchor even in the both-pills case.
    const link = screen.getByRole("link");
    expect(link).not.toContainElement(save);
    expect(link).not.toContainElement(google);
  });

  it("keeps the card ONE link with an accessible name after moving the body out", async () => {
    renderCard({ saveCount: 8, googleRating: { value: 4.8, count: 128 } });
    // Exactly one anchor, still pointing at the detail page. The <h3> is no longer
    // inside the anchor, so the link takes its accessible name from `aria-label`.
    const links = await screen.findAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0] as HTMLElement;
    expect(link).toHaveAttribute("href", "/listings/listing-1");
    expect(link).toHaveAccessibleName("Acme Gluten-Free");
  });

  it("exposes the Google-rating ADR-007 tooltip on keyboard focus (never colour/tooltip alone)", async () => {
    renderCard({ googleRating: { value: 4.8, count: 128 } });
    const pill = await screen.findByTestId("google-rating");
    // Resting state: the supplementary copy is portaled shut...
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    // ...the visible "Google" attribution is ALWAYS present (meaning never rests
    // on the tooltip alone)...
    expect(pill).toHaveTextContent("Google");
    // ...and focusing the pill (keyboard path) reveals the ADR-007 attribution.
    fireEvent.focus(pill);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Google rating — not an Aubrey's List safety score.");
    // The tooltip explicitly denies being a safety score.
    expect(tip).not.toHaveTextContent(/celiac-safe|gluten-friendly/i);
  });

  it("exposes the save-count ADR-007 tooltip on keyboard focus", async () => {
    renderCard({ saveCount: 12 });
    const pill = await screen.findByTestId("save-count");
    expect(pill).toHaveTextContent("saves");
    fireEvent.focus(pill);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Community saves — not a safety score.");
  });

  it("renders BOTH the save-count and Google rating pills together in one cluster", async () => {
    renderCard({ saveCount: 5, googleRating: { value: 4.8, count: 128 } });
    const save = await screen.findByTestId("save-count");
    const google = screen.getByTestId("google-rating");
    expect(save).toHaveTextContent("5");
    expect(google).toHaveTextContent("Google");
    // Both attributed pills share the lifted-out cluster, apart from any safety signal.
    expect(save.parentElement).toBe(google.parentElement);
  });

  it("renders evidence counts when present", async () => {
    renderCard({ evidence: { confirmations: 128, contributors: 41 } });
    expect(await screen.findByText("128 confirmations · 41 neighbors")).toBeInTheDocument();
  });

  it("renders a freshness cue with its label when present", async () => {
    renderCard({ freshness: { kind: "fresh", label: "Verified 3d ago" } });
    expect(await screen.findByText("Verified 3d ago")).toBeInTheDocument();
  });

  it("reserves the meta-row space with an invisible placeholder when freshness AND evidence are absent (AUB-194)", async () => {
    // A seeded/bot-suggested VM has no freshness cue and no evidence counts, but
    // its card must keep the same body height as a fully-attested card — the
    // meta row always renders, swapping in an invisible height-reserving line.
    renderCard({ safetyState: null, suggestedByBot: true });
    await screen.findByText("Suggested by Aubrey's Bot");

    const metaRow = screen.getByTestId("card-meta-row");
    expect(metaRow).toBeInTheDocument();
    const placeholder = screen.getByTestId("card-meta-placeholder");
    expect(metaRow).toContainElement(placeholder);
    // Hidden from paint AND the accessibility tree, but still occupying layout —
    // `invisible` (visibility: hidden) keeps the box, unlike `hidden`.
    expect(placeholder).toHaveClass("invisible");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    // The reserved row keeps the same vertical rhythm as the real one (top
    // margin + padding), with a transparent border so no stray divider shows.
    expect(metaRow).toHaveClass("mt-3", "pt-3", "border-t", "border-transparent");
  });

  it("renders the REAL meta row (no placeholder) when freshness or evidence is present", async () => {
    renderCard({
      freshness: { kind: "fresh", label: "Verified 3d ago" },
      evidence: { confirmations: 2, contributors: 3 },
    });
    expect(await screen.findByText("Verified 3d ago")).toBeInTheDocument();
    expect(screen.getByText("2 confirmations · 3 neighbors")).toBeInTheDocument();

    const metaRow = screen.getByTestId("card-meta-row");
    // The real row draws its divider; the invisible placeholder is not rendered.
    expect(metaRow).toHaveClass("border-border");
    expect(screen.queryByTestId("card-meta-placeholder")).not.toBeInTheDocument();
    // Same vertical-rhythm classes as the reserved variant, so both render the
    // same row height in a grid.
    expect(metaRow).toHaveClass("mt-3", "pt-3", "border-t");
  });

  it("stretches to fill its grid cell so cards equalize within a row (AUB-194)", async () => {
    renderCard();
    const link = await screen.findByRole("link");
    // The card shell (the link's parent) is a full-height flex column; the BODY
    // (the link's sibling, not the media-only link itself) stretches with
    // flex-1, so the mt-auto meta row pins to the bottom.
    const shell = link.parentElement as HTMLElement;
    expect(shell.className).toContain("h-full");
    expect(shell.className).toContain("flex-col");
    const body = screen.getByTestId("card-meta-row").closest("div.flex-1") as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.className).toContain("flex-col");
  });

  it("renders the accent placeholder tile when no photoUrl is given", async () => {
    renderCard({ photoUrl: null });
    expect(await screen.findByText("Food photo")).toBeInTheDocument();
    expect(screen.queryByTestId("food-photo")).not.toBeInTheDocument();
  });

  it("renders an <img> instead of the placeholder when photoUrl is set", async () => {
    renderCard({ photoUrl: "https://cdn.example.com/root-and-rye.jpg" });
    // The photo is decorative (alt=""), so it has no `img` role — assert on src.
    const img = await screen.findByTestId("food-photo");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/root-and-rye.jpg");
    expect(screen.queryByText("Food photo")).not.toBeInTheDocument();
  });
});

describe("ListingCard (mapping wrapper)", () => {
  /** A fully-derived glance; overrides tweak individual fields per test. */
  const baseGlance: ListingTrustGlance = {
    safetyState: "celiac-safe",
    suggestedByBot: false,
    hasRecentIncident: false,
    evidence: null,
    freshness: null,
  };

  function renderWrapper(glance: Partial<ListingTrustGlance> = {}, distanceLabel?: string) {
    renderInRouter(
      <ListingCard
        listing={baseListing}
        glance={{ ...baseGlance, ...glance }}
        distanceLabel={distanceLabel}
      />
    );
  }

  it("maps a Listing + glance onto the card and links to the detail page", async () => {
    renderWrapper();
    expect(await screen.findByRole("heading", { name: "Acme Gluten-Free" })).toBeInTheDocument();
    expect(screen.getByText(/123 Main St, Denver, CO/)).toBeInTheDocument();
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/listings/listing-1");
  });

  it("passes the null safetyState through to the honest Not yet attested chip", async () => {
    renderWrapper({ safetyState: null });
    expect(await screen.findByText("Not yet attested")).toBeInTheDocument();
  });

  it("passes the recent-incident flag through", async () => {
    renderWrapper({ hasRecentIncident: true });
    expect(await screen.findByText("Recent incident")).toBeInTheDocument();
  });

  it("maps the glance's evidence counts onto the card", async () => {
    renderWrapper({ evidence: { confirmations: 12, contributors: 5 } });
    expect(await screen.findByText("12 confirmations · 5 neighbors")).toBeInTheDocument();
  });

  it("maps the glance's freshness cue onto the card", async () => {
    renderWrapper({ freshness: { kind: "stale", label: "Updated 8mo ago" } });
    expect(await screen.findByText("Updated 8mo ago")).toBeInTheDocument();
  });

  it("maps the distanceLabel onto the card's location line", async () => {
    renderWrapper({}, "0.4 mi");
    expect(await screen.findByText("123 Main St, Denver, CO · 0.4 mi")).toBeInTheDocument();
  });

  it("omits evidence/freshness when the glance carries none", async () => {
    renderWrapper();
    await screen.findByText("Celiac-safe");
    expect(screen.queryByText(/confirmations/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });
});

describe("listingToCardVM (save-count threading)", () => {
  const glance: ListingTrustGlance = {
    safetyState: "celiac-safe",
    hasRecentIncident: false,
    evidence: null,
    freshness: null,
    suggestedByBot: false,
  };

  it("threads a provided save count onto the VM", () => {
    const vm = listingToCardVM(baseListing, glance, undefined, 9);
    expect(vm.saveCount).toBe(9);
  });

  it("leaves saveCount absent when not supplied (optional trailing param)", () => {
    // Callers that don't have a count (e.g. the map carousel) omit it and simply
    // render no pill — the prop stays truly absent, not `undefined`.
    const vm = listingToCardVM(baseListing, glance);
    expect("saveCount" in vm).toBe(false);
  });
});
