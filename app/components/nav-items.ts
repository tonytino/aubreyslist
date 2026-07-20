import { Info, Plus, Search } from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> | null;
}

/**
 * Primary navigation. Each item targets its real, existing route so the active
 * state is accurate. Single-sourced here because BOTH the desktop inline nav
 * (`SiteHeader`, `sm:`+) and the mobile combined menu's Navigate group
 * (`SiteMenu`, below `sm`) render this same list — keeping them from drifting.
 *
 * "Add a listing" is the primary call-to-action: inline it reads as a
 * brand-purple button; in the combined menu it's a Navigate row like the rest.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Browse", Icon: Search },
  { to: "/listings/new", label: "Add a listing", Icon: Plus },
  { to: "/about", label: "About", Icon: Info },
];

/** The route whose Navigate item is the primary CTA (brand button inline). */
export const CTA_NAV_TO = "/listings/new";
