import type { ClaimAttribute } from "~/db/schema";

/**
 * Curated Denver-metro gluten-free / celiac seed sources.
 *
 * The human-edited input to the seed pipeline: real Denver-proper (and
 * close-suburb) spots with a public gluten-free reputation. Each entry is a
 * Places Text Search `query` plus the GF-attribute labels the curator bot
 * ("Aubrey's Bot") should suggest for it.
 *
 * Pipeline: this file is the editable source of truth. `pnpm db:seed:refresh`
 * resolves each `query` against the Google Places API and bakes the resolved
 * entries into `scripts/seed-listings.generated.json`. The API-free
 * `pnpm db:seed` inserts that baked data — it never calls Places. Curate here,
 * then re-run the refresh to re-capture.
 *
 * Honest by construction: `suggestedAttributes` are grounded in each spot's
 * public GF reputation — community reports (findmeglutenfree, NCA Denver
 * Celiacs), local press, and official menus/allergen pages.
 * `celiac_safe` applies only to
 * genuinely dedicated or strongly celiac-reputed places; merely
 * gluten-friendly spots get the specific attributes instead. These are
 * suggestions, not verdicts — the community owns the truth. No incidents are
 * ever fabricated on a real business.
 *
 * The `query` is biased to Denver Union Station; anything unresolved (or
 * outside a 50-mile radius) is skipped and logged rather than guessed. The
 * seed is idempotent: dedup on Place ID, and a claim a real user has engaged
 * with is never re-suggested.
 */

/**
 * The curator-bot identity that authors every seed suggestion.
 *
 * Collision-proof with any real account on both unique `users` columns, so it
 * is safe to seed in every environment including production:
 * - `googleSub` is a non-numeric sentinel a real Google login can never
 *   produce (real Google subjects are numeric strings); and
 * - `email` uses the reserved `.invalid` TLD (RFC 2606) — un-routable, so a
 *   real sign-in can never collide with this row on the unique email
 *   constraint (which would throw in `upsertUserFromGoogle` and break that
 *   person's sign-in).
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
  /** Optional official menu / GF-info page, seeded as a `menu`-kind `listing_links` row. */
  menuUrl?: string;
  /**
   * The brand operates 2+ locations; this entry is its single flagship. Not
   * consumed by the base seed pipeline — it marks brands whose other locations
   * `pnpm db:seed:expand-chains` can enumerate.
   */
  chain?: true;
  /**
   * The subset of `suggestedAttributes` that is corporate policy or structural
   * brand design (a chain-wide printed GF menu, a fries-only fryer) rather
   * than one location's equipment or practice. `pnpm db:seed:expand-chains`
   * fans a `chain` brand out to its other in-radius locations with ONLY these
   * attributes; a chain without this field does not fan out — its other
   * locations wait for per-location verification. Must be a non-empty subset
   * of `suggestedAttributes` on a `chain: true` entry (the script enforces
   * both).
   */
  chainWideAttributes?: ClaimAttribute[];
}

export const SEED_SOURCES: SeedSource[] = [
  // --- Dedicated / 100% gluten-free facilities (highest-confidence celiac-safe)
  {
    query: "Moore Cafe and Bakery, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.moorebreadbakery.com/",
  },
  {
    query: "Just BE Kitchen, LoHi, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.justbekitchen.com/",
  },
  {
    query: "Vital Root, Tennyson Street, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://ediblebeats.com/restaurants/vital-root/",
  },
  {
    query: "Rivers and Roads Coffee, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.riversandroadscoffee.com/",
  },
  {
    query: "Green Bus Cafe, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.greenbuscafe.com/locations-menus",
  },
  {
    query: "Quiero Arepas, Avanti, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
    menuUrl: "https://quieroarepas.com/",
  },
  {
    query: "Teocalli Cocina, LoHi, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
    menuUrl: "https://www.teocallicocina.com/",
    chain: true,
  },
  {
    query: "Sweet Izzy, Cherry Creek North, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
    menuUrl: "https://www.sweetizzy.co/",
  },
  {
    query: "Wave the Grain, Littleton, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://wavethegrain.com/",
  },
  {
    query: "Blue Hummingbird GF Foods, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://bluehummingbirdfoods.com/",
  },
  {
    query: "Gluten Free Things, Arvada, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://glutenfreethings.com/",
  },
  {
    query: "Crestone Bakery, Westminster, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
    menuUrl: "https://crestonebakery.com/",
  },
  {
    query: "Rheinlander Bakery, Arvada, CO",
    suggestedAttributes: ["celiac_safe", "gf_substitutes"],
    menuUrl: "https://www.rheinlanderbakery.com/",
  },
  {
    query: "Denver Poke Company, LoHi, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
    menuUrl: "https://denverpokecompany.com/",
  },
  {
    query: "Sweet Sisters Bake Shop, Boulder, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
    menuUrl: "https://www.sweetsistersboulder.com/",
  },
  {
    query: "Dedicated Bistro and Bakery, Golden, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
  },
  {
    query: "Starfish Bakery, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
    menuUrl: "https://starfishbysarah.com/",
  },
  // --- Dedicated GF beverages (celiac-safe drinks; food cross-contact varies)
  {
    query: "Holidaily Brewing Company, Golden, CO",
    suggestedAttributes: ["celiac_safe"],
    menuUrl: "https://holidailybrewing.com/",
  },
  {
    query: "Stem Ciders, RiNo, Denver, CO",
    suggestedAttributes: ["celiac_safe"],
    menuUrl: "https://www.stemciders.com/",
    chain: true,
  },
  {
    query: "Waldschanke Ciders and Coffee, Denver, CO",
    suggestedAttributes: ["celiac_safe"],
    menuUrl: "https://waldschankeciders.com/",
  },
  // --- Celiac owners / strong celiac reputation (strict cross-contact protocols)
  {
    query: "Acova, Highland, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://acovarestaurant.com/menu/",
  },
  {
    query: "Federal Bar and Grill, Jefferson Park, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_fryer", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.thefedbar.com/",
  },
  {
    query: "GB Fish and Chips, South Broadway, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://gbfishandchips.com/",
    chain: true,
  },
  {
    query: "Marco's Coal Fired, Ballpark, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu"],
    menuUrl: "https://www.marcoscfp.com/gluten-free",
  },
  {
    query: "Bamboo Sushi, LoHi, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://bamboosushi.com/location/lohi/menu",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu"],
  },
  {
    query: "Urban Egg, Cherry Creek North, Denver, CO",
    suggestedAttributes: ["celiac_safe", "dedicated_gf_menu", "gf_substitutes"],
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu", "gf_substitutes"],
  },
  {
    query: "HashTAG Restaurant, Aurora, CO",
    suggestedAttributes: ["celiac_safe", "off_menu_gf_on_request"],
  },
  {
    query: "Cozobi Fonda Fina, Boulder, CO",
    suggestedAttributes: ["celiac_safe"],
  },
  {
    query: "Holy Crepe, Boulder, CO",
    suggestedAttributes: ["celiac_safe", "gf_substitutes"],
  },
  {
    query: "The Ginger Pig, Berkeley, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://www.gingerpig.com/denver-menus",
  },
  // --- Dedicated GF fryer (shared kitchen otherwise)
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
    chain: true,
  },
  {
    query: "Birdcall, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://www.eatbirdcall.com/",
    chain: true,
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
    chain: true,
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
    chain: true,
    chainWideAttributes: ["gf_substitutes"],
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
  {
    query: "West Main Taproom and Grill, Parker, CO",
    suggestedAttributes: ["dedicated_fryer", "dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://westmaintaproom.com/",
  },
  {
    query: "Hopdoddy Burger Bar, LoDo, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://www.hopdoddy.com/gluten-free-menu",
    chain: true,
    chainWideAttributes: ["gf_substitutes"],
  },
  {
    query: "CD's Wings, Aurora, CO",
    suggestedAttributes: ["dedicated_fryer"],
  },
  {
    query: "Grillin Wings and Things, Denver, CO",
    suggestedAttributes: ["dedicated_fryer"],
    chain: true,
  },
  {
    query: "Torchy's Tacos, Denver, CO",
    suggestedAttributes: ["dedicated_fryer"],
    menuUrl: "https://torchystacos.com/",
    chain: true,
  },
  {
    query: "Jax Fish House and Oyster Bar, LoDo, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "off_menu_gf_on_request"],
    menuUrl: "https://www.jaxfishhouse.com/",
    chain: true,
  },
  {
    query: "Stout Street Social, Downtown Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
  },
  {
    query: "Briar Common Brewery and Eatery, Highland, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://www.briarcommon.com/food",
  },
  {
    query: "TBirds Restaurant and Bar, Wheat Ridge, CO",
    suggestedAttributes: ["dedicated_fryer"],
  },
  {
    query: "Smashburger, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "gf_substitutes"],
    menuUrl: "https://smashburger.com/",
    chain: true,
  },
  {
    query: "Five Guys, Denver, CO",
    suggestedAttributes: ["dedicated_fryer"],
    menuUrl: "https://www.fiveguys.com/",
    chain: true,
    chainWideAttributes: ["dedicated_fryer"],
  },
  {
    query: "In-N-Out Burger, Aurora, CO",
    suggestedAttributes: ["dedicated_fryer"],
    menuUrl: "https://www.in-n-out.com/",
    chain: true,
    chainWideAttributes: ["dedicated_fryer"],
  },
  {
    query: "North Side Tavern, Broomfield, CO",
    suggestedAttributes: ["dedicated_fryer", "off_menu_gf_on_request"],
  },
  {
    query: "Rocky Mountain Tap and Garden, Broomfield, CO",
    suggestedAttributes: ["dedicated_fryer", "off_menu_gf_on_request"],
  },
  {
    query: "G's Tacos, Broomfield, CO",
    suggestedAttributes: ["dedicated_fryer"],
  },
  {
    query: "P.F. Chang's, Cherry Creek, Denver, CO",
    suggestedAttributes: ["dedicated_fryer", "dedicated_gf_menu"],
    menuUrl: "https://www.pfchangs.com/gluten-free.html",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu"],
  },
  // --- Gluten-friendly pizza & Italian (GF crusts/pastas, labeled menus)
  {
    query: "Blue Pan Pizza, West Highland, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://bluepandenver.com/menu/",
    chain: true,
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
    chain: true,
    chainWideAttributes: ["gf_substitutes"],
  },
  {
    query: "North Italia, Cherry Creek, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.northitalia.com/",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu", "gf_substitutes"],
  },
  {
    query: "Beau Jo's Pizza, Olde Town Arvada, CO",
    suggestedAttributes: ["dedicated_gf_menu"],
    menuUrl: "https://www.beaujos.com/menu/",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu"],
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
    query: "Angelo's Taverna, Speer, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://angelostaverna.com/denver/gluten-free-menu-options/",
    chain: true,
  },
  {
    query: "Odyssey Italian Restaurant, Speer, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://odysseyitalian.com/",
  },
  {
    query: "Osteria Marco, Larimer Square, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
  },
  {
    query: "Hops and Pie, Berkeley, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://www.hopsandpie.com/hops-and-pie-faqs",
  },
  {
    query: "Cart-Driver, RiNo, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    chain: true,
  },
  {
    query: "DiFranco's, Capitol Hill, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://www.difrancos.com/",
  },
  {
    query: "Barolo Grill, Cherry Creek, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
  },
  {
    query: "Tavernetta, LoDo, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
  },
  {
    query: "Shells and Sauce, Congress Park, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.shellsandsauce.net/menus/",
  },
  {
    query: "Homegrown Tap and Dough, Washington Park, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://www.tapanddough.com/menus/",
    chain: true,
  },
  {
    query: "Esters Neighborhood Pub, Virginia Village, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.estersdenver.com/menus/",
    chain: true,
  },
  {
    query: "Fat Sully's Pizza, Colfax, Denver, CO",
    suggestedAttributes: ["gf_substitutes"],
    menuUrl: "https://www.theatomiccowboy.com/fatsullys",
    chain: true,
  },
  {
    query: "Na Favola Trattoria, Greenwood Village, CO",
    suggestedAttributes: ["gf_substitutes"],
    menuUrl: "https://nafavolatrattoria.com/",
  },
  {
    query: "Saverina, Downtown Denver, CO",
    suggestedAttributes: ["gf_substitutes"],
  },
  {
    query: "Mellow Mushroom, Downtown Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    chain: true,
  },
  {
    query: "Pizzeria Locale, Boulder, CO",
    suggestedAttributes: ["gf_substitutes"],
    menuUrl: "https://www.pizzerialocale.com/bringing-you-gluten-free-choices/",
    chain: true,
  },
  {
    query: "Basta, Boulder, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
  },
  {
    query: "Lil Ricciotti's, Parker, CO",
    suggestedAttributes: ["gf_substitutes"],
  },
  {
    query: "Infinitus Pizza PIE, Broomfield, CO",
    suggestedAttributes: ["gf_substitutes"],
  },
  // --- Gluten-friendly Mexican, Latin American & Asian (GF-marked menus, tamari, corn-based)
  {
    query: "Sushi Den, Old South Pearl, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.sushiden.net/",
  },
  {
    query: "Aung's Bangkok Cafe, Englewood, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://aungsbangkokcafe.com/",
  },
  {
    query: "Pho Lang Co, Virginia Village, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://www.pholangco.com/",
  },
  {
    query: "Little India, Belmar, Lakewood, CO",
    suggestedAttributes: ["dedicated_gf_menu", "off_menu_gf_on_request"],
    menuUrl: "https://littleindiaofdenver.com/best-gluten-free-restaurant-in-denver/",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu"],
  },
  {
    query: "Spice Room, Highland, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu"],
    menuUrl: "https://denverspiceroom.com/gluten-free-indian-food-denver/",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu"],
  },
  {
    query: "Nozomi Sushi and Temaki Bar, Sunnyside, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://nozomisushidenver.com/",
  },
  {
    query: "Kawa Ni, LoHi, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "off_menu_gf_on_request"],
  },
  {
    query: "Pho-natic, Capitol Hill, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://phodenver.com/",
  },
  {
    query: "Pupusas Lover, University Hills, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://www.pupusasloverdenver.com/pupusas",
    chain: true,
  },
  {
    query: "Sushi-Rama, RiNo, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    chain: true,
  },
  {
    query: "Dae Gee Korean BBQ, Colorado Blvd, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://daegee.com/",
    chain: true,
  },
  {
    query: "Thai Monkey Club, Baker, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
    menuUrl: "https://www.thaimonkeyclubco.com/",
  },
  {
    query: "Little Gingko Asian Cafe, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
  },
  {
    query: "Sweet Ginger Asian Bistro, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu"],
  },
  {
    query: "Little Ollie's Asian Cafe, Cherry Creek, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "La Diabla Pozole y Mezcal, Ballpark, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    chain: true,
  },
  {
    query: "Indochine Cuisine, Parker, CO",
    suggestedAttributes: ["dedicated_gf_menu"],
  },
  {
    query: "Garbanzo Mediterranean Fresh, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://eatgarbanzo.com/",
    chain: true,
    chainWideAttributes: ["gf_substitutes"],
  },
  {
    query: "Ash'Kara, LoHi, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://www.ashkaradenver.com/menus/",
  },
  {
    query: "Safta, RiNo, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
    menuUrl: "https://www.eatwithsafta.com/safta-menu",
  },
  {
    query: "Ali Baba Grill, Golden, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "Bengal Tiger Indian Restaurant, Thornton, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "Kokoro Restaurant, Arvada, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
    chain: true,
  },
  {
    query: "Moose Hill Cantina, Lakewood, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  // --- Gluten-friendly breakfast, cafes & desserts (GF swaps, labeled options)
  {
    query: "Snooze an A.M. Eatery, Ballpark, Denver, CO",
    suggestedAttributes: ["gf_substitutes"],
    menuUrl: "https://www.snoozeeatery.com/",
    chain: true,
    chainWideAttributes: ["gf_substitutes"],
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
    query: "Olive and Finch, Union Station, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    menuUrl: "https://www.oliveandfinch.com/location/olive-finch-union-station/",
    chain: true,
  },
  {
    query: "Wendell's, Berkeley, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
  },
  {
    query: "The Universal, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
  },
  {
    query: "Parlor Doughnuts, Downtown Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    chain: true,
    chainWideAttributes: ["gf_substitutes"],
  },
  {
    query: "Legacy Pie Co, Tennyson Street, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://legacypie.co/menu/legacypieco",
  },
  {
    query: "Gelato Boy, Tennyson Street, Denver, CO",
    suggestedAttributes: ["gf_substitutes"],
    menuUrl: "https://gelatoboy.com/",
    chain: true,
  },
  {
    query: "Bonnie Brae Ice Cream, Denver, CO",
    suggestedAttributes: ["gf_substitutes"],
  },
  {
    query: "Campo Juice and Kitchen, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "off_menu_gf_on_request"],
  },
  {
    query: "Whole Nectar Smoothie Bar, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "Inside Scoop Creamery, Denver, CO",
    suggestedAttributes: ["gf_substitutes"],
  },
  {
    query: "Heaven Creamery, RiNo, Denver, CO",
    suggestedAttributes: ["gf_substitutes"],
  },
  {
    query: "Button Rock Bakery, Broomfield, CO",
    suggestedAttributes: ["gf_substitutes"],
  },
  {
    query: "Cafe Crepe, Broomfield, CO",
    suggestedAttributes: ["gf_substitutes"],
  },
  {
    query: "BLUEBIRD Cafe, Thornton, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "Blue Sky Cafe and Juice Bar, Lakewood, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  // --- Gluten-friendly American, pub & steakhouse (GF menus, buns, aware service)
  {
    query: "True Food Kitchen, Cherry Creek, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.truefoodkitchen.com/locations/denver/",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu", "gf_substitutes"],
  },
  {
    query: "Steuben's, Uptown, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://steubens.com/denver-uptown-steubens-food-menu",
  },
  {
    query: "Cherry Cricket, Ballpark, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request", "gf_substitutes"],
    chain: true,
  },
  {
    query: "Guard and Grace, Downtown Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "Work and Class, Five Points, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "Modern Market Eatery, Cherry Creek, Denver, CO",
    suggestedAttributes: ["dedicated_gf_menu", "gf_substitutes"],
    menuUrl: "https://www.modernmarket.com/",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu", "gf_substitutes"],
  },
  {
    query: "Lazy Dog Restaurant and Bar, Aurora, CO",
    suggestedAttributes: ["dedicated_gf_menu"],
    menuUrl: "https://www.lazydogrestaurants.com/menus/gluten-sensitive",
    chain: true,
    chainWideAttributes: ["dedicated_gf_menu"],
  },
  {
    query: "A5 Steakhouse, Downtown Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "EDGE Restaurant and Bar, Downtown Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "Shanahan's Steakhouse, Greenwood Village, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "801 Chophouse, Downtown Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
    chain: true,
  },
  {
    query: "Denver ChopHouse and Brewery, LoDo, Denver, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
    chain: true,
  },
  {
    query: "Parker Garage, Parker, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
  {
    query: "Windy Saddle Cafe, Golden, CO",
    suggestedAttributes: ["off_menu_gf_on_request"],
  },
];
