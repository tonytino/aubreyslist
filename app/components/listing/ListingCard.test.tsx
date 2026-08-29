import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import type { Listing } from "~/db/schema";
import { favoriteIdsQuery } from "~/favorites/favorites-query";
import type { PlacePhoto } from "~/server/places-photos";
import type { ListingTrustGlance } from "~/trust/browse-glance";
import { deriveListingActivityMeta } from "~/trust/summary";
import {
  CARD_PHOTO_MAX_WIDTH_PX,
  ListingCard,
  listingToCardVM,
  RestaurantCard,
  type RestaurantCardVM,
} from "./ListingCard";

// The card embeds the FavoriteButton island, which imports the `favorites.fn`
// server seam. That seam transitively pulls in the db-touching implementation, so
// it is mocked out (as in FavoriteButton.test.tsx); these tests only assert the
// heart renders in the card, not its write behaviour.
vi.mock("~/server/favorites/favorites.fn", () => ({
  favoriteListing: vi.fn(() => Promise.resolve()),
  unfavoriteListing: vi.fn(() => Promise.resolve()),
}));

/**
 * Tests for the browse-list card. Covers the trust-glance render across states —
 * celiac-safe, the null (unattested/disputed) state that renders no safety badge
 * at all, the recent-incident flag — plus the attributed (non-safety) save-count
 * pill, the city/distance location line, evidence counts, and the photo
 * placeholder vs `<img>`. The accessible signals (colour + icon + text label) are
 * asserted via their visible text, never colour.
 *
 * The card uses TanStack Router's `Link`, so it must render inside a router: a
 * tiny in-memory router whose tree includes the `/listings/$id` target lets `Link`
 * resolve its href without the full app route tree.
 */

/** An empty activity strip — the honest "nobody has attested this" reading. */
const noActivity = deriveListingActivityMeta(null);

/** An activity strip N days old with `happyPatrons` happy patrons. */
function activity(daysAgo: number, happyPatrons: number) {
  return deriveListingActivityMeta({
    lastActivityAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    happyPatrons,
  });
}

const baseVm: RestaurantCardVM = {
  id: "listing-1",
  name: "Acme Gluten-Free",
  city: "Denver",
  safetyState: "celiac-safe",
  suggestedByBot: false,
  suggestedAttributes: [],
  confirmedAttributes: [],
  hasRecentIncident: false,
  activity: noActivity,
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
  return router;
}

function renderCard(overrides: Partial<RestaurantCardVM> = {}) {
  return renderInRouter(<RestaurantCard vm={{ ...baseVm, ...overrides }} />);
}

/**
 * The VM of a listing whose free-form address carried no parseable city. `city`
 * is truly absent (not `undefined`) under `exactOptionalPropertyTypes`, so it is
 * built here rather than overridden on {@link baseVm}.
 */
const cityLessVm: RestaurantCardVM = {
  id: "listing-2",
  name: "Manual Entry Cafe",
  safetyState: "celiac-safe",
  suggestedByBot: false,
  suggestedAttributes: [],
  confirmedAttributes: [],
  hasRecentIncident: false,
  activity: noActivity,
  accent: "mint",
};

function renderCityLessCard(overrides: Partial<RestaurantCardVM> = {}) {
  return renderInRouter(<RestaurantCard vm={{ ...cityLessVm, ...overrides }} />);
}

describe("RestaurantCard", () => {
  it("renders the listing name", async () => {
    renderCard();
    expect(await screen.findByRole("heading", { name: "Acme Gluten-Free" })).toBeInTheDocument();
  });

  it("renders city and distance joined on the location line", async () => {
    renderCard({ distanceLabel: "1.2 mi" });
    expect(await screen.findByTestId("card-location")).toHaveTextContent("Denver · 1.2 mi");
  });

  it("truncates only the city, so the distance survives a narrow card", async () => {
    renderCard({ city: "Greenwood Village", distanceLabel: "12.4 mi" });
    const line = await screen.findByTestId("card-location");
    // A single joined string clips from the right and drops the distance —
    // the segment that matters most. Separate flex items, city-only truncation.
    const city = within(line).getByText("Greenwood Village");
    const distance = within(line).getByText("12.4 mi");
    expect(city.className).toContain("truncate");
    expect(city.className).toContain("min-w-0");
    expect(distance.className).toContain("shrink-0");
    expect(distance.className).not.toContain("truncate");
  });

  it("renders the city alone when there is no distance", async () => {
    renderCard();
    expect(await screen.findByTestId("card-location")).toHaveTextContent(/^Denver$/);
  });

  it("renders the distance alone when the address had no parseable city", async () => {
    renderCityLessCard({ distanceLabel: "12.4 mi" });
    expect(await screen.findByTestId("card-location")).toHaveTextContent(/^12\.4 mi$/);
  });

  it("keeps the location line's height with neither city nor distance", async () => {
    renderCityLessCard();
    const line = await screen.findByTestId("card-location");
    // No dangling separator, and the reserved line is hidden from AT as well as
    // from paint, so a card's height never depends on what it knows.
    expect(line).not.toHaveTextContent("·");
    expect(line.firstElementChild).toHaveClass("invisible");
    expect(line.firstElementChild).toHaveAttribute("aria-hidden", "true");
    // Value-shaped, not a stub label word: an unstyled render paints nothing
    // readable as content.
    expect(line.firstElementChild?.textContent?.trim()).toBe("");
  });

  it("never renders the full street address on a card", async () => {
    renderCard({ distanceLabel: "1.2 mi" });
    await screen.findByTestId("card-location");
    expect(screen.queryByText(/123 Main St/)).not.toBeInTheDocument();
  });

  it("folds the location into the card link's accessible name, comma-joined", async () => {
    renderCard({ distanceLabel: "1.2 mi" });
    const link = await screen.findByRole("link");
    // The anchor wraps only the media, so its name is the `aria-label` alone.
    // Two branches of one chain in one city are otherwise byte-identical to AT.
    // Commas, never the visual middot: a screen reader has no reading for "·".
    expect(link).toHaveAccessibleName("Acme Gluten-Free, Denver, 1.2 mi");
    expect(link).toHaveAccessibleName(/Denver/);
  });

  it("drops the location from the link name when the address had no parseable city", async () => {
    renderCityLessCard();
    expect(await screen.findByRole("link")).toHaveAccessibleName("Manual Entry Cafe");
  });

  it("links the whole card to the listing detail page", async () => {
    renderCard();
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/listings/listing-1");
  });

  it("renders the FavoriteButton as a sibling of the link, not nested in the anchor", async () => {
    renderCard();
    // The FavoriteButton's accessible name derives from the listing name
    // ("Save <name>"). The stretched-link pattern keeps a valid DOM: the <button>
    // must not be a descendant of the <a> (a button inside an anchor is invalid
    // HTML + an a11y defect). Both are independently present.
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

  it("renders NO safety badge when safetyState is null", async () => {
    renderCard({ safetyState: null });
    await screen.findByTestId("card-claim-row");
    expect(screen.queryByText("Not yet attested")).not.toBeInTheDocument();
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
    expect(document.querySelector("[data-safety-state]")).not.toBeInTheDocument();
  });

  it("labels a bot-suggested card 'Suggested by Aubrey's Bot' in the META ROW (owner nits 7+8)", async () => {
    renderCard({
      safetyState: null,
      suggestedByBot: true,
      suggestedAttributes: ["dedicated_fryer"],
    });
    const label = await screen.findByTestId("bot-provenance");
    expect(label).toHaveTextContent("Suggested by Aubrey's Bot");
    // The label lives in the meta row, not the safety row —
    // bot-suggested cards read uniformly with verified ones.
    expect(screen.getByTestId("card-meta-row")).toContainElement(label);
    // The suggestion replaces the (absent) safety badge — never a fabricated verdict.
    expect(screen.queryByText("Not yet attested")).not.toBeInTheDocument();
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
  });

  it("KEEPS the bot label when a real verdict exists (provenance, not gated on no-evidence — owner nit 7)", async () => {
    // A listing with community celiac evidence can still carry live suggestions
    // on other attributes; the provenance label stays visible alongside the
    // real verdict (the verdict itself derives from evidence only).
    renderCard({
      safetyState: "celiac-safe",
      suggestedByBot: true,
      suggestedAttributes: ["dedicated_fryer"],
    });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
    expect(screen.getByTestId("bot-provenance")).toHaveTextContent("Suggested by Aubrey's Bot");
  });

  it("gives the happy-patron count the meta-row slot over the bot label (evidence over provenance)", async () => {
    renderCard({
      safetyState: "celiac-safe",
      suggestedByBot: true,
      suggestedAttributes: ["dedicated_fryer"],
      activity: activity(4, 3),
    });
    expect(await screen.findByText("3 happy patrons")).toBeInTheDocument();
    // The count wins the slot; the per-claim suggested badge still carries the
    // provenance.
    expect(screen.queryByTestId("bot-provenance")).not.toBeInTheDocument();
    expect(screen.getByTestId("suggested-attribute")).toBeInTheDocument();
  });

  it("shows no bot label when nothing is suggested", async () => {
    renderCard({ safetyState: "celiac-safe", suggestedByBot: false });
    expect(await screen.findByText("Celiac-safe")).toBeInTheDocument();
    expect(screen.queryByText("Suggested by Aubrey's Bot")).not.toBeInTheDocument();
  });

  it("renders one shared ClaimBadge per suggested attribute (owner nit 7)", async () => {
    renderCard({
      safetyState: null,
      suggestedByBot: true,
      suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    });
    const badges = await screen.findAllByTestId("suggested-attribute");
    expect(badges).toHaveLength(2);
    // Clearly a suggestion, never a community-confirmed verdict (ADR-007): the
    // distinction rests on the attribute icon + gradient ring + "AI" marker +
    // tooltip, never colour alone; no SafetySignal state marker either.
    expect(badges[0]).toHaveTextContent("Dedicated fryer");
    expect(badges[1]).toHaveTextContent("GF substitutes");
    for (const badge of badges) {
      expect(badge).not.toHaveAttribute("data-safety-state");
    }
  });

  it("keeps even the suggested CELIAC badge structurally distinct from the real verdict chip (ADR-007)", async () => {
    // The celiac badge shares the verdict chip's attribute label — the attribute
    // icon + gradient ring + "AI" marker + tooltip are what keep it readable as a
    // suggestion, never resting on colour alone.
    renderCard({
      safetyState: null,
      suggestedByBot: true,
      suggestedAttributes: ["celiac_safe"],
    });
    const badge = await screen.findByTestId("suggested-attribute");
    expect(badge).toHaveTextContent("Celiac-safe");
    expect(badge).not.toHaveAttribute("data-safety-state");
  });

  it("keeps suggested-attribute badges structurally distinct from the SafetySignal verdict (ADR-007)", async () => {
    renderCard({
      safetyState: "celiac-safe",
      suggestedByBot: true,
      suggestedAttributes: ["dedicated_gf_menu"],
    });
    const badge = await screen.findByTestId("suggested-attribute");
    const safety = document.querySelector('[data-safety-state="celiac-safe"]');
    expect(safety).not.toBeNull();
    // Neither element nests the other — a suggestion never dresses as evidence.
    expect(badge).not.toContainElement(safety as HTMLElement);
    expect(safety as HTMLElement).not.toContainElement(badge);
  });

  it("renders no suggested-attribute badges when nothing is suggested", async () => {
    renderCard();
    await screen.findByText("Celiac-safe");
    expect(screen.queryByTestId("suggested-attribute")).not.toBeInTheDocument();
  });

  it("renders a CONFIRMED non-headline attribute as a NON-suggested ClaimBadge (AUB-226)", async () => {
    // Detail-page parity: a confirmed non-headline claim (e.g. "Off-menu GF on
    // request") shows on the card as the affirmed (non-suggested) ClaimBadge.
    renderCard({
      safetyState: "celiac-safe",
      confirmedAttributes: ["off_menu_gf_on_request"],
    });
    const badge = await screen.findByTestId("claim-badge");
    expect(badge).toHaveTextContent("Off-menu GF on request");
    // Real evidence, never the suggested/provenance variant, and never dressed as
    // the SafetySignal verdict (ADR-007).
    expect(screen.queryByTestId("suggested-attribute")).not.toBeInTheDocument();
    expect(badge).not.toHaveAttribute("data-safety-state");
  });

  it("renders CONFIRMED badges BEFORE suggested ones (evidence before provenance)", async () => {
    renderCard({
      safetyState: "celiac-safe",
      confirmedAttributes: ["off_menu_gf_on_request"],
      suggestedByBot: true,
      suggestedAttributes: ["gf_substitutes"],
    });
    const confirmed = await screen.findByTestId("claim-badge");
    const suggested = screen.getByTestId("suggested-attribute");
    // The confirmed (evidence) badge precedes the suggested (provenance) one.
    expect(
      confirmed.compareDocumentPosition(suggested) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders one confirmed ClaimBadge per attribute in taxonomy order", async () => {
    renderCard({
      safetyState: "celiac-safe",
      confirmedAttributes: ["dedicated_fryer", "off_menu_gf_on_request"],
    });
    const badges = await screen.findAllByTestId("claim-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("Dedicated fryer");
    expect(badges[1]).toHaveTextContent("Off-menu GF on request");
  });

  it("renders no confirmed ClaimBadge when confirmedAttributes is empty", async () => {
    renderCard({ safetyState: "celiac-safe", confirmedAttributes: [] });
    await screen.findByText("Celiac-safe");
    expect(screen.queryByTestId("claim-badge")).not.toBeInTheDocument();
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

  it("does not render a save-count pill when saveCount is 0", async () => {
    renderCard({ saveCount: 0 });
    await screen.findByText("Celiac-safe");
    // Hidden at 0 — no fabricated "0 saves" pill.
    expect(screen.queryByTestId("save-count")).not.toBeInTheDocument();
  });

  it("does not render a save-count pill when saveCount is absent (undefined)", async () => {
    renderCard();
    await screen.findByText("Celiac-safe");
    expect(screen.queryByTestId("save-count")).not.toBeInTheDocument();
  });

  it("renders a compact save-count pill — heart + count, NO visible 'saves' word (owner, PR #274)", async () => {
    renderCard({ saveCount: 12 });
    const pill = await screen.findByTestId("save-count");
    // The count renders...
    expect(pill).toHaveTextContent("12");
    // ...with no visible "saves" word — the pill is heart glyph + number only...
    expect(pill).not.toHaveTextContent("saves");
    expect(screen.queryByText("saves")).not.toBeInTheDocument();
    // ...with the meaning carried by an explicit accessible name instead
    // (styling.md/ADR-007: never the tooltip or colour alone).
    expect(pill).toHaveAccessibleName("12 saves");
    // And it is not presented as a safety verdict (ADR-007): no safety label,
    // no SafetySignal state marker.
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
    expect(pill).not.toContainElement(safety as HTMLElement);
    expect(safety as HTMLElement).not.toContainElement(pill);
    // Not siblings: the pill and the safety signal live in different containers.
    expect(pill.parentElement).not.toBe((safety as HTMLElement).parentElement);
  });

  it("renders the pill as a real <button> tooltip trigger OUTSIDE the anchor (a11y)", async () => {
    renderCard({ saveCount: 8 });
    const link = await screen.findByRole("link");
    const save = screen.getByTestId("save-count");
    // Nesting a focusable/interactive element inside an <a> is invalid HTML + an
    // a11y defect, so the pill must be a sibling of the link, not a descendant.
    expect(link).not.toContainElement(save);
    // It is an honest, natively-focusable, non-submitting <button> trigger (not a
    // tabindex-hacked span) — giving keyboard users real trigger semantics for the
    // ADR-007 tooltip.
    expect(save.tagName).toBe("BUTTON");
    expect(save).toHaveAttribute("type", "button");
  });

  it("keeps the pill IN-FLOW in the title row so it reflows and never overlaps the name", async () => {
    // An absolute overlay would let a long name slide under the pill at 375px.
    // With the pill in-flow in the same flex row as the name, flexbox reflows
    // them side-by-side — structurally impossible to overlap, no magic offsets.
    renderCard({
      name: "The Extraordinarily Long Gluten-Free Bakery And Coffee House Name",
      saveCount: 8,
    });
    const heading = await screen.findByRole("heading");
    const save = screen.getByTestId("save-count");
    const titleRow = heading.parentElement as HTMLElement;
    // Name + pill share one in-flow row container, never an absolute layer.
    expect(titleRow).toContainElement(heading);
    expect(titleRow).toContainElement(save);
    // ...and the pill stays out of the anchor.
    const link = screen.getByRole("link");
    expect(link).not.toContainElement(save);
  });

  it("exposes the save-count ADR-007 tooltip on keyboard focus", async () => {
    renderCard({ saveCount: 12 });
    const pill = await screen.findByTestId("save-count");
    fireEvent.focus(pill);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Community saves, not a safety score.");
  });

  it("keeps the card ONE link with an accessible name after moving the body out", async () => {
    renderCard({ saveCount: 8 });
    // Exactly one anchor, pointing at the detail page. The <h3> is not inside the
    // anchor, so the link takes its accessible name from `aria-label`.
    const links = await screen.findAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0] as HTMLElement;
    expect(link).toHaveAttribute("href", "/listings/listing-1");
    // With the street address gone from the card, the name alone can't tell two
    // branches of one chain apart — the location joins the accessible name.
    expect(link).toHaveAccessibleName("Acme Gluten-Free, Denver");
  });

  it("renders the activity line and the happy-patron count in the meta row", async () => {
    renderCard({ activity: activity(3, 128) });
    expect(await screen.findByText("Updated 3 days ago")).toBeInTheDocument();
    expect(screen.getByText("128 happy patrons")).toBeInTheDocument();
  });

  it("renders the count in the singular at one happy patron", async () => {
    renderCard({ activity: activity(3, 1) });
    expect(await screen.findByText("1 happy patron")).toBeInTheDocument();
  });

  it("hides the happy-patron count at zero rather than showing '0 happy patrons'", async () => {
    renderCard({ activity: activity(3, 0) });
    await screen.findByText("Updated 3 days ago");
    expect(screen.queryByTestId("happy-patrons")).not.toBeInTheDocument();
    expect(screen.queryByText(/happy patron/)).not.toBeInTheDocument();
  });

  it("gives EVERY card the same anatomy: a real divider + a real meta row (AUB-298)", async () => {
    // The uniform-anatomy rule: a card with nothing to report must not vary
    // structurally from a fully-attested one. It says "No activity yet" rather
    // than reserving an invisible line behind a transparent divider.
    renderCard({ safetyState: null, suggestedByBot: false });
    await screen.findByTestId("card-claim-row");

    const metaRow = screen.getByTestId("card-meta-row");
    expect(metaRow).toHaveClass("mt-3", "pt-3", "border-t", "border-border");
    expect(metaRow.className).not.toContain("border-transparent");
    expect(screen.queryByTestId("card-meta-placeholder")).not.toBeInTheDocument();
    // The honest empty state, visible (not `invisible`) and readable by AT.
    const line = screen.getByTestId("activity-line");
    expect(metaRow).toContainElement(line);
    expect(line).toHaveTextContent("No activity yet");
    expect(line.className).not.toContain("invisible");
    expect(line).not.toHaveAttribute("aria-hidden");
  });

  it("keeps that same anatomy for a bot-suggested card and an attested one", async () => {
    // Same row composition and vertical rhythm across the three cases the owner
    // screenshotted as structurally different.
    renderCard({
      safetyState: null,
      suggestedByBot: true,
      suggestedAttributes: ["gf_substitutes"],
    });
    await screen.findByTestId("bot-provenance");
    expect(screen.getByTestId("card-meta-row")).toHaveClass(
      "mt-3",
      "pt-3",
      "border-t",
      "border-border"
    );
    expect(screen.getByTestId("activity-line")).toHaveTextContent("No activity yet");
  });

  it("opens the activity clarifier on tap, so touch users can reach it", async () => {
    // A hover-only tooltip is unreachable on a phone, and this clarifier is the
    // only thing keeping "Updated …" from reading as a safety verification.
    renderCard({ activity: activity(3, 2) });
    const line = await screen.findByTestId("activity-line");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.pointerDown(line);

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(
      "Reflects recent claim activity on this listing, not a safety verification."
    );

    // A second tap closes it: Radix's own pointer-down close is suppressed
    // (preventDefault) so the two handlers cannot fight and leave it stuck open.
    fireEvent.pointerDown(line);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("exposes the activity clarifier on keyboard focus too", async () => {
    renderCard({ activity: activity(3, 2) });
    const line = await screen.findByTestId("activity-line");
    fireEvent.focus(line);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/not a safety verification/);
  });

  it("never phrases the activity line as a verification", async () => {
    // Activity is not safety. The word "Verified" belongs to the badge.
    renderCard({ activity: activity(3, 2) });
    const line = await screen.findByTestId("activity-line");
    expect(line.textContent ?? "").not.toMatch(/verif/i);
  });

  it("shows the activity line for a card with NO safety badge (activity is not a verdict)", async () => {
    // The deliberate difference from the badge/evidence suppression: a
    // contested or unattested listing still reports its activity.
    renderCard({ safetyState: null, activity: activity(2, 5) });
    expect(await screen.findByText("Updated 2 days ago")).toBeInTheDocument();
    expect(screen.getByText("5 happy patrons")).toBeInTheDocument();
    expect(document.querySelector("[data-safety-state]")).not.toBeInTheDocument();
  });

  it("scrolls the claim row sideways instead of wrapping, so badge count never changes card height", async () => {
    // Five badges is the taxonomy maximum; wrapped, they would stack the card
    // several rows taller than a one-badge neighbour. The row stays one line and
    // hands the overflow to a horizontal scroller instead.
    renderCard({
      confirmedAttributes: ["dedicated_fryer", "dedicated_gf_menu"],
      suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
      suggestedByBot: true,
      hasRecentIncident: true,
    });
    await screen.findByTestId("card-claim-row");

    const claimRow = screen.getByTestId("card-claim-row");
    expect(claimRow).toHaveClass("flex", "items-center", "overflow-x-auto", "min-w-0");
    // The wrap is what made the height vary — it must stay off at every width.
    expect(claimRow.className).not.toContain("flex-wrap");
    // A painted scrollbar would put height back on the badge count, so both
    // engines' scrollbars are hidden.
    expect(claimRow.className).toContain("[scrollbar-width:none]");
    expect(claimRow.className).toContain("[&::-webkit-scrollbar]:hidden");

    // Every chip in the row keeps its own width (never squeezed to fit), which is
    // what makes the row overflow instead of compressing its labels. The verdict
    // and incident chips are included on purpose: they are the ones a shrinking
    // row wrapped onto two lines, which is the height variance this row exists to
    // remove.
    const chips = [
      ...screen.getAllByTestId("claim-badge"),
      ...screen.getAllByTestId("suggested-attribute"),
      ...claimRow.querySelectorAll<HTMLElement>("[data-safety-state]"),
    ];
    expect(chips.length).toBe(6);
    for (const chip of chips) {
      expect(chip.className).toContain("shrink-0");
      expect(chip.className).toContain("whitespace-nowrap");
    }
  });

  it("stretches to fill its grid cell so cards equalize within a row (AUB-194)", async () => {
    renderCard();
    const link = await screen.findByRole("link");
    // The card shell (the link's parent) is a full-height flex column; the body
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

  it("the <img> is decorative and lazy (AUB-219)", async () => {
    renderCard({ photoUrl: "https://cdn.example.com/root-and-rye.jpg" });
    const img = await screen.findByTestId("food-photo");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("falls back to the gradient placeholder when the photo fails to load (AUB-219)", async () => {
    renderCard({ photoUrl: "https://cdn.example.com/root-and-rye.jpg" });
    const img = await screen.findByTestId("food-photo");

    fireEvent.error(img);

    expect(await screen.findByText("Food photo")).toBeInTheDocument();
    expect(screen.queryByTestId("food-photo")).not.toBeInTheDocument();
  });

  it("renders the compact author-attribution overlay as plain text (no nested link) with its contrast scrim when present (AUB-219)", async () => {
    renderCard({
      photoUrl: "https://cdn.example.com/root-and-rye.jpg",
      photoAttributions: [{ displayName: "A Diner" }, { displayName: "B Baker" }],
    });

    const credit = await screen.findByTestId("food-photo-attribution");
    expect(credit).toHaveTextContent("Photo: A Diner, B Baker");
    // Attribution sits inside the stretched-link media tile — an <a> there would
    // nest inside the card's own <a>, so it must render as plain text, not a link.
    expect(screen.queryByRole("link", { name: "A Diner" })).not.toBeInTheDocument();
    // AA contrast on light photos: a decorative bottom gradient scrim backs the
    // white credit text (matching the hero's scrim-assisted posture).
    const scrim = screen.getByTestId("food-photo-attribution-scrim");
    expect(scrim).toHaveAttribute("aria-hidden", "true");
    expect(scrim.className).toContain("bg-gradient-to-t");
  });

  it("omits the attribution overlay AND its scrim when the photo carries no attributions", async () => {
    renderCard({ photoUrl: "https://cdn.example.com/root-and-rye.jpg", photoAttributions: [] });
    await screen.findByTestId("food-photo");
    expect(screen.queryByTestId("food-photo-attribution")).not.toBeInTheDocument();
    expect(screen.queryByTestId("food-photo-attribution-scrim")).not.toBeInTheDocument();
  });

  it("hands the shown photo to the hero as router state on navigation, never the URL", async () => {
    const router = renderCard({ photoUrl: "https://cdn.example.com/root-and-rye.jpg" });
    const link = await screen.findByRole("link");

    fireEvent.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe("/listings/listing-1"));
    expect(router.state.location.search).toEqual({});
    expect(router.state.location.state.listingPreviewSrc).toBe(
      "https://cdn.example.com/root-and-rye.jpg"
    );
  });

  it("carries no preview state when the card has no photo (placeholder tile)", async () => {
    const router = renderCard({ photoUrl: null });
    const link = await screen.findByRole("link");

    fireEvent.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe("/listings/listing-1"));
    expect(router.state.location.state.listingPreviewSrc).toBeUndefined();
  });

  it("hands the shown photo's attribution names along with the preview src (for credit during the preview-only phase)", async () => {
    const router = renderCard({
      photoUrl: "https://cdn.example.com/root-and-rye.jpg",
      photoAttributions: [{ displayName: "A Diner" }, { displayName: "B Baker" }],
    });
    const link = await screen.findByRole("link");

    fireEvent.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe("/listings/listing-1"));
    expect(router.state.location.state.listingPreviewAttributionNames).toEqual([
      "A Diner",
      "B Baker",
    ]);
  });

  it("omits the attribution-names key when the shown photo carries no attributions", async () => {
    const router = renderCard({
      photoUrl: "https://cdn.example.com/root-and-rye.jpg",
      photoAttributions: [],
    });
    const link = await screen.findByRole("link");

    fireEvent.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe("/listings/listing-1"));
    expect(router.state.location.state.listingPreviewAttributionNames).toBeUndefined();
  });
});

describe("ListingCard (mapping wrapper)", () => {
  /** A fully-derived glance; overrides tweak individual fields per test. */
  const baseGlance: ListingTrustGlance = {
    safetyState: "celiac-safe",
    suggestedByBot: false,
    suggestedAttributes: [],
    confirmedAttributes: [],
    hasRecentIncident: false,
    evidence: null,
    freshness: null,
    activity: noActivity,
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
    expect(screen.getByTestId("card-location")).toHaveTextContent(/^Denver$/);
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/listings/listing-1");
  });

  it("passes the null safetyState through, rendering no safety badge", async () => {
    renderWrapper({ safetyState: null });
    await screen.findByTestId("card-claim-row");
    expect(screen.queryByText("Not yet attested")).not.toBeInTheDocument();
    expect(document.querySelector("[data-safety-state]")).not.toBeInTheDocument();
  });

  it("passes the recent-incident flag through", async () => {
    renderWrapper({ hasRecentIncident: true });
    expect(await screen.findByText("Recent incident")).toBeInTheDocument();
  });

  it("maps the glance's activity strip onto the card", async () => {
    renderWrapper({ activity: activity(5, 5) });
    expect(await screen.findByText("Updated 5 days ago")).toBeInTheDocument();
    expect(screen.getByText("5 happy patrons")).toBeInTheDocument();
  });

  it("maps the distanceLabel onto the card's location line", async () => {
    renderWrapper({}, "0.4 mi");
    expect(await screen.findByTestId("card-location")).toHaveTextContent("Denver · 0.4 mi");
  });

  it("falls back to the honest empty activity state when the glance has none", async () => {
    renderWrapper();
    await screen.findByText("Celiac-safe");
    expect(screen.getByTestId("activity-line")).toHaveTextContent("No activity yet");
    expect(screen.queryByTestId("happy-patrons")).not.toBeInTheDocument();
  });
});

describe("listingToCardVM (bot-provenance threading)", () => {
  const glance: ListingTrustGlance = {
    safetyState: "celiac-safe",
    hasRecentIncident: false,
    evidence: null,
    freshness: null,
    activity: noActivity,
    suggestedByBot: true,
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    confirmedAttributes: [],
  };

  it("threads the glance's suggested attributes + label flag onto the VM", () => {
    const vm = listingToCardVM(baseListing, glance);
    expect(vm.suggestedByBot).toBe(true);
    expect(vm.suggestedAttributes).toEqual(["dedicated_fryer", "gf_substitutes"]);
  });

  it("threads the glance's CONFIRMED non-headline attributes onto the VM (AUB-226)", () => {
    const vm = listingToCardVM(baseListing, {
      ...glance,
      confirmedAttributes: ["off_menu_gf_on_request"],
    });
    expect(vm.confirmedAttributes).toEqual(["off_menu_gf_on_request"]);
  });

  it("threads a provided save count onto the VM (trailing param)", () => {
    const vm = listingToCardVM(baseListing, glance, undefined, 9);
    expect(vm.saveCount).toBe(9);
  });

  it("leaves saveCount absent when not supplied (optional trailing param)", () => {
    // Callers that don't have a count (e.g. the map carousel) omit it and simply
    // render no pill — the prop stays truly absent, not `undefined`.
    const vm = listingToCardVM(baseListing, glance);
    expect("saveCount" in vm).toBe(false);
  });

  it("derives the city from the listing address at the single mapping site", () => {
    const vm = listingToCardVM(baseListing, glance);
    expect(vm.city).toBe("Denver");
  });

  it("leaves city absent for a free-form manual address, never the full address", () => {
    // The VM carries no address at all, so an unparseable one can only mean a
    // missing city segment — never a street address on a card.
    const vm = listingToCardVM({ ...baseListing, address: "The red barn on Highway 36" }, glance);
    expect("city" in vm).toBe(false);
    expect("address" in vm).toBe(false);
  });
});

describe("listingToCardVM (photo threading, AUB-219)", () => {
  const glance: ListingTrustGlance = {
    safetyState: "celiac-safe",
    hasRecentIncident: false,
    evidence: null,
    freshness: null,
    activity: noActivity,
    confirmedAttributes: [],
    suggestedByBot: false,
    suggestedAttributes: [],
  };

  const photo: PlacePhoto = {
    photoToken: "places/ChIJ_place/photos/resource-1",
    widthPx: 4032,
    heightPx: 3024,
    attributions: [{ displayName: "A Diner", uri: "https://maps.google.com/maps/contrib/123" }],
  };

  it("builds photoUrl through the SAME media-proxy helper the hero uses, at the card's width, and threads attributions", () => {
    const vm = listingToCardVM(baseListing, glance, undefined, undefined, photo);
    expect(vm.photoUrl).toBe(
      `/api/places/photo?name=${encodeURIComponent(photo.photoToken)}&maxWidthPx=${CARD_PHOTO_MAX_WIDTH_PX}`
    );
    expect(vm.photoAttributions).toEqual(photo.attributions);
  });

  it("leaves photoUrl/photoAttributions absent when no photo is supplied (optional trailing param)", () => {
    // Callers that haven't fetched photos (favorites, a caller mid-loading)
    // simply omit the arg — the props stay truly absent, not `undefined`, so
    // the card falls back to its existing gradient placeholder unchanged.
    const vm = listingToCardVM(baseListing, glance);
    expect("photoUrl" in vm).toBe(false);
    expect("photoAttributions" in vm).toBe(false);
  });

  it("omits photo fields when explicitly passed undefined (a batch miss for this listing)", () => {
    const vm = listingToCardVM(baseListing, glance, undefined, undefined, undefined);
    expect("photoUrl" in vm).toBe(false);
    expect("photoAttributions" in vm).toBe(false);
  });
});
