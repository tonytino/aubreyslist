import type { ClaimAttribute } from "~/db/schema";

/**
 * Curated Denver-metro gluten-free / celiac seed SOURCES (AUB-31).
 *
 * WHAT THIS IS: the human-edited INPUT to the seed pipeline — a starter set of
 * real, currently-operating Denver-proper (and close-suburb) spots with a public
 * gluten-free reputation, so the directory has density before real users arrive.
 * Each entry is a Places Text Search `query` plus the GF-attribute "labels" the
 * curator bot ("Aubrey's Bot") should suggest for it.
 *
 * PIPELINE: this file is the editable source of truth. `pnpm db:seed:refresh`
 * (`scripts/refresh-seed-data.ts`) resolves each `query` against the Google Places
 * API ONCE and bakes the fully-resolved entries into
 * `scripts/seed-listings.generated.json`. The API-free `pnpm db:seed`
 * (`scripts/seed.ts`) then inserts that baked data — it never calls Places. Curate
 * here, then re-run the refresh to re-capture.
 *
 * HONEST BY CONSTRUCTION: `suggestedAttributes` are grounded in each spot's public
 * GF reputation (dedicated kitchens/fryers, labeled GF menus, celiac-owner
 * protocols). `celiac_safe_vs_gluten_friendly` is applied ONLY to genuinely
 * dedicated or strongly celiac-reputed places; merely gluten-friendly spots get
 * the specific attributes instead. These are SUGGESTIONS, not verdicts — the
 * community owns the truth. No incidents are ever fabricated on a real business.
 *
 * The `query` is fed to Google Places Text Search and biased to Denver Union
 * Station; anything that doesn't resolve (or resolves outside a 25-mile radius) is
 * skipped and logged rather than guessed. Add/curate freely and re-run the refresh
 * — the seed is idempotent (dedup on Place ID; a claim a real user has engaged with
 * is never re-suggested).
 */

/**
 * The curator-bot identity that authors every seed suggestion (AUB-31).
 *
 * Intrinsically collision-proof with any real account on BOTH unique `users`
 * columns, so it is safe to seed in every environment including production:
 * - `googleSub` is a NON-numeric sentinel a real Google login can never produce
 *   (real Google subjects are numeric strings); and
 * - `email` uses the reserved `.invalid` TLD (RFC 2606) — an un-routable address
 *   no real Google mailbox can ever equal, so a future real sign-in can never
 *   collide with this row on the UNIQUE email constraint (which would otherwise
 *   throw in `upsertUserFromGoogle` and break that person's sign-in).
 * Role is left to the DB default (`user`) — no standing privileged account.
 */
export const CURATOR_BOT = {
  googleSub: "seed:aubreys-bot",
  email: "aubreys-bot@seed.invalid",
  name: "Aubrey's Bot",
} as const;

/** One curated seed source: a Places query + the labels the bot suggests for it. */
export interface SeedSource {
  /** Google Places Text Search query — specific enough to resolve one place. */
  query: string;
  /** The GF-attribute labels the curator bot suggests (≥1). */
  suggestedAttributes: ClaimAttribute[];
  /** Optional official menu / GF-info page, seeded as a `menu`-kind `listing_links` row (AUB-220). */
  menuUrl?: string;
}

export const SEED_SOURCES: SeedSource[] = [
  // --- Dedicated / 100% gluten-free facilities (highest-confidence celiac-safe)
  {
    query: "Moore Cafe and Bakery, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.moorebreadbakery.com/",
  },
  {
    query: "Just BE Kitchen, LoHi, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.justbekitchen.com/",
  },
  {
    query: "Vital Root, Tennyson Street, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://ediblebeats.com/restaurants/vital-root/",
  },
  {
    query: "Rivers and Roads Coffee, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.riversandroadscoffee.com/",
  },
  {
    query: "Whole Sol Blend Bar, LoDo, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu"],
  },
  {
    query: "Green Bus Cafe, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.greenbuscafe.com/locations-menus",
  },
  {
    query: "Quiero Arepas, Avanti, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu"],
    menuUrl: "https://quieroarepas.com/",
  },
  {
    query: "Teocalli Cocina, LoHi, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu"],
    menuUrl: "https://www.teocallicocina.com/",
  },
  {
    query: "Sweet Izzy, Cherry Creek North, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu"],
    menuUrl: "https://www.sweetizzy.co/",
  },
  {
    query: "Wave the Grain, Littleton, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://wavethegrain.com/",
  },
  {
    query: "Blue Hummingbird GF Foods, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://bluehummingbirdfoods.com/",
  },
  {
    query: "Gluten Free Things, Arvada, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://glutenfreethings.com/",
  },
  {
    query: "Crestone Bakery, Westminster, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu"],
    menuUrl: "https://crestonebakery.com/",
  },
  {
    query: "Rheinlander Bakery, Arvada, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "gf_substitutes"],
    menuUrl: "https://www.rheinlanderbakery.com/",
  },
  // --- Dedicated GF beverages (celiac-safe drinks; food cross-contact varies)
  {
    query: "Holidaily Brewing Company, Golden, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly"],
    menuUrl: "https://holidailybrewing.com/",
  },
  {
    query: "Stem Ciders, RiNo, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly"],
    menuUrl: "https://www.stemciders.com/",
  },
  {
    query: "Waldschanke Ciders and Coffee, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly"],
    menuUrl: "https://waldschankeciders.com/",
  },
  // --- Celiac-owner / dedicated-fryer restaurants (strong celiac reputation)
  {
    query: "Acova, Highland, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://acovarestaurant.com/menu/",
  },
  {
    query: "Federal Bar and Grill, Jefferson Park, Denver, CO",
    suggestedAttributes: [
      "celiac_safe_vs_gluten_friendly",
      "dedicated_fryer",
      "dedicated_gf_menu",
      "gf_substitutes",
    ],
    menuUrl: "https://www.thefedbar.com/",
  },
  {
    query: "GB Fish and Chips, South Broadway, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://gbfishandchips.com/",
  },
  {
    query: "Marco's Coal Fired, Ballpark, Denver, CO",
    suggestedAttributes: ["celiac_safe_vs_gluten_friendly", "dedicated_gf_menu"],
    menuUrl: "https://www.marcoscfp.com/gluten-free",
  },
  {
    query: "Panzano, Downtown Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://panzano-denver.com/menu",
  },
  {
    query: "Chook Charcoal Chicken, 8th Avenue, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.chookchicken.com/",
  },
  {
    query: "Abrusci's Fire and Vine, Wheat Ridge, CO",
    suggestedAttributes: ["dedicated_fryer", "dedicated_gf_menu", "gf_substitutes"],
  },
  {
    query: "The Post Chicken and Beer, LoHi, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
  },
  {
    query: "Birdcall, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://www.eatbirdcall.com/",
  },
  {
    query: "Root Down, Highland, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
  },
  {
    query: "Linger, LoHi, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://lingerdenver.com/",
  },
  {
    query: "Park Burger, Old South Pearl, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://www.parkburger.com/menu/",
  },
  {
    query: "Larkburger, Greenwood Village, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://www.larkburger.com/",
  },
  {
    query: "Illegal Pete's, South Broadway, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://illegalpetes.com/",
  },
  {
    query: "Adelitas Cocina y Cantina, South Broadway, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://adelitasco.com/",
  },
  {
    query: "Desert Donuts, Greenwood Village, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
  },
  // --- Labeled GF menu / GF substitutes (gluten-friendly, shared kitchen)
  {
    query: "Blue Pan Pizza, West Highland, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://bluepandenver.com/menu/",
  },
  {
    query: "Cattivella, Central Park, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.cattivelladenver.com/menu",
  },
  {
    query: "Mici Handcrafted Italian, 7th and Colorado, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.miciitalian.com/",
  },
  {
    query: "North Italia, Cherry Creek, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.northitalia.com/",
  },
  {
    query: "True Food Kitchen, Cherry Creek, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.truefoodkitchen.com/locations/denver/",
  },
  {
    query: "Beau Jo's Pizza, Olde Town Arvada, CO",
    suggestedAttributes: ["dedicated_gf_menu"],
    menuUrl: "https://www.beaujos.com/menu/",
  },
  {
    query: "Sushi Den, Old South Pearl, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.sushiden.net/",
  },
  {
    query: "Phatt Matt's, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://phattmatts.com/",
  },
  {
    query: "Dough Counter, University Hills, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.doughcounter.com/gluten-free",
  },
  {
    query: "Snooze an A.M. Eatery, Ballpark, Denver, CO",
    suggestedAttributes: ["gf_substitutes"],
    menuUrl: "https://www.snoozeeatery.com/",
  },
  {
    query: "Gold Mine Cupcakes, Golden, CO",
    suggestedAttributes: ["gf_substitutes"],
    menuUrl: "https://www.goldminecupcakes.com/",
  },
  {
    query: "Bella Macaron, Westminster, CO",
    suggestedAttributes: ["gf_substitutes"],
    menuUrl: "https://www.bellamacaron.com/",
  },
  {
    query: "Aung's Bangkok Cafe, Englewood, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://aungsbangkokcafe.com/",
  },
];
