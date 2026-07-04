import { Link } from "@tanstack/react-router";
import { Wordmark } from "~/components/Wordmark";

interface FooterLink {
  to: string;
  label: string;
}

// Real, existing routes only (mirrors SiteHeader's NAV_ITEMS convention: every
// target must resolve or the active/route-tree typecheck would fail). Kept
// separate from the header's list because the footer's audience/ordering is
// different (e.g. Favorites belongs here, not in the primary nav).
const EXPLORE_LINKS: readonly FooterLink[] = [
  { to: "/", label: "Browse" },
  { to: "/listings/new", label: "Add a listing" },
  { to: "/favorites", label: "Favorites" },
  { to: "/about", label: "About" },
];

// AUB-142: the legal-links slot is reserved here structurally, but none of
// these routes exist yet — shipping them now would 404. Do NOT uncomment a
// link until its route lands; add the real route first (see "Adding a New
// Route" in docs/agents/routing.md), then move its entry into a live
// `readonly FooterLink[]` array declared the same way as `EXPLORE_LINKS`
// above, and render it as a second `<nav>` next to it.
//
// const LEGAL_LINKS: readonly FooterLink[] = [
//   { to: "/privacy", label: "Privacy policy" },
//   { to: "/terms", label: "Terms of service" },
//   { to: "/disclaimer", label: "Disclaimer" },
//   { to: "/moderation", label: "Moderation policy" },
//   { to: "/contact", label: "Contact" },
// ];

/**
 * Site footer (AUB-142). Mounted once in `AppShell` (`app/routes/__root.tsx`)
 * so it renders on every route, after `<main>`.
 *
 * Design mirrors `SiteHeader`: same `mx-auto max-w-[96rem]` content rail and
 * horizontal padding so the footer's content aligns with the header/page
 * content at every breakpoint, the same `border-border`/`bg-background`
 * surface, and the small `Wordmark` used for the header's centred brand mark.
 * Mobile-first per docs/agents/styling.md: a single stacked column on mobile,
 * widening to a row at `sm:`.
 *
 * The legal-links slot (privacy/terms/disclaimer/moderation/contact) is
 * intentionally reserved but unpopulated — those routes don't exist yet, and
 * linking them would 404. See the commented `LEGAL_LINKS` array above; wire it
 * up as those routes ship.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <Link to="/" aria-label="Aubrey's List home" className="whitespace-nowrap">
            <Wordmark size="sm" />
          </Link>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {EXPLORE_LINKS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-body-sm text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Legal-links slot (AUB-142): reserved for privacy/terms/disclaimer/
              moderation/contact once those routes exist. See LEGAL_LINKS above. */}
        </div>

        <p className="text-caption text-muted-foreground">
          © {year} Aubrey's List. Community-contributed, not medical advice.
        </p>
      </div>
    </footer>
  );
}
