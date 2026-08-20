import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  CalendarCheck,
  Globe,
  type LucideIcon,
  MapPin,
  Pencil,
  ShoppingBag,
  WheatOff,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  emptyLinkFieldValues,
  type LinkFieldValues,
  ListingLinksFields,
} from "~/components/add-listing/ListingLinksFields";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { ListingLink } from "~/db/schema";
import {
  LINK_KIND_METADATA,
  LINK_KINDS,
  type LinkKind,
  listingLinkInputSchema,
} from "~/listings/links";
import { deleteListingLink, submitListingLink } from "~/server/listing-links/links.fn";
import { isHttpUrl } from "~/server/listings/url";

/**
 * TanStack Query key for a listing's typed links — shared by the detail-page
 * loader prefetch and the edit dialog's invalidation (mirrors
 * `incidentsQueryKey` in `IncidentReports`).
 */
export function listingLinksQueryKey(listingId: string) {
  return ["listing-links", listingId] as const;
}

/**
 * One distinct glyph per link kind, next to the visible text label (never colour/icon
 * alone). `BookOpenText` marks the menu link — never lucide's `Menu` hamburger, which
 * reads as app navigation. `WheatOff` marks the gluten-free menu link — a document
 * pointer, not the gluten-friendly safety state, so the `WheatStrike` safety glyph
 * contract (styling.md) does not apply here.
 */
const LINK_KIND_ICONS: Record<LinkKind, LucideIcon> = {
  menu: BookOpenText,
  gluten_free_menu: WheatOff,
  website: Globe,
  reservations: CalendarCheck,
  online_ordering: ShoppingBag,
};

/**
 * The listing-detail "Links" section: the Google Maps deep-link plus the listing's
 * typed links in `LINK_KINDS` order, and — for signed-in viewers — an edit dialog of
 * per-kind URL fields (the same `ListingLinksFields` the intake wizard uses).
 *
 * The deep-link stays alongside the embedded map (ADR-014): it is the mobile hand-off
 * to turn-by-turn in the native Maps app. The map embed renders as a sibling of this
 * region, never inside it, so the edit-listing-links E2E role assertions hold.
 *
 * Legacy fallback: a listing may carry only `listings.menu_url`. When there is no
 * `menu`-kind row, that legacy URL renders as the menu link. Both `links` and
 * `legacyMenuUrl` come from the one links query (`fetchListingLinks`), so invalidating
 * it after an edit refreshes the fallback too — the server nulls the legacy column
 * whenever a typed menu write supersedes it, and the refetch picks that up.
 *
 * Defence-in-depth: every anchor href in this section is `isHttpUrl`-guarded at the
 * render sink, so a dangerous-scheme URL is suppressed even if one reached the DB.
 * Writes are wiki-style (any signed-in user) and re-gated server-side — hiding the
 * edit button from anonymous viewers is UX, not access control.
 */
export function ListingLinks({
  listingId,
  mapsUrl,
  legacyMenuUrl,
  links,
  isSignedIn,
}: {
  listingId: string;
  mapsUrl: string;
  legacyMenuUrl: string | null;
  links: ListingLink[];
  isSignedIn: boolean;
}) {
  const linkByKind = new Map<LinkKind, ListingLink>(links.map((link) => [link.kind, link]));

  // Resolve what to render, in LINK_KINDS order, http(s)-guarded at the sink.
  const displayLinks = LINK_KINDS.flatMap((kind) => {
    const url = linkByKind.get(kind)?.url ?? (kind === "menu" ? legacyMenuUrl : null);
    return isHttpUrl(url) ? [{ kind, url }] : [];
  });

  return (
    <section
      aria-label="Links"
      className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-center"
    >
      {isHttpUrl(mapsUrl) ? (
        <Button asChild size="lg" className="w-full min-[480px]:w-auto">
          <a href={mapsUrl} target="_blank" rel="noreferrer noopener">
            <MapPin aria-hidden className="h-4 w-4" />
            Open in Google Maps
          </a>
        </Button>
      ) : null}

      {displayLinks.map(({ kind, url }) => {
        const Icon = LINK_KIND_ICONS[kind];
        return (
          <Button
            key={kind}
            asChild
            size="lg"
            variant="outline"
            className="w-full min-[480px]:w-auto"
          >
            <a href={url} target="_blank" rel="noreferrer noopener">
              <Icon aria-hidden className="h-4 w-4" />
              {LINK_KIND_METADATA[kind].label}
            </a>
          </Button>
        );
      })}

      {isSignedIn ? (
        <EditListingLinks
          listingId={listingId}
          legacyMenuUrl={legacyMenuUrl}
          linkByKind={linkByKind}
          hasAnyLink={displayLinks.length > 0}
        />
      ) : null}
    </section>
  );
}

/**
 * The signed-in edit affordance + dialog. Fields pre-fill from the current typed links;
 * with no `menu`-kind row the legacy `menu_url` pre-fills the menu field, so the dialog
 * shows exactly what the page renders.
 *
 * Save semantics per kind, diffed against the effective current value (typed row, or
 * the legacy menu fallback): a changed filled field upserts, a cleared field that had
 * a value removes — including a legacy-only menu value, since the server's menu-kind
 * remove also clears the legacy column. An unchanged field issues no write.
 *
 * The links query is invalidated in `onSettled`, not only on success: the mutation
 * runs up to five sequential server calls, so a mid-sequence failure has already
 * committed earlier writes — the page must refetch what actually landed.
 */
function EditListingLinks({
  listingId,
  legacyMenuUrl,
  linkByKind,
  hasAnyLink,
}: {
  listingId: string;
  legacyMenuUrl: string | null;
  linkByKind: Map<LinkKind, ListingLink>;
  hasAnyLink: boolean;
}) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [drafts, setDrafts] = useState<LinkFieldValues>(emptyLinkFieldValues());
  const [validationError, setValidationError] = useState<string | null>(null);

  const openEditor = () => {
    const initial = emptyLinkFieldValues();
    for (const kind of LINK_KINDS) {
      initial[kind] = linkByKind.get(kind)?.url ?? "";
    }
    if (!initial.menu && isHttpUrl(legacyMenuUrl)) {
      initial.menu = legacyMenuUrl;
    }
    setDrafts(initial);
    setValidationError(null);
    setIsOpen(true);
  };

  /**
   * The kind's effective current URL: its typed row, or — for the menu kind with no
   * typed row — the legacy `menu_url` fallback the page renders. The diff runs against
   * this, so the legacy value behaves like any other stored link.
   */
  const effectiveUrl = (kind: LinkKind): string | undefined => {
    const typed = linkByKind.get(kind)?.url;
    if (typed !== undefined) {
      return typed;
    }
    return kind === "menu" && isHttpUrl(legacyMenuUrl) ? legacyMenuUrl : undefined;
  };

  const save = useMutation({
    mutationFn: async (values: LinkFieldValues) => {
      for (const kind of LINK_KINDS) {
        const url = values[kind].trim();
        const existing = effectiveUrl(kind);
        if (url && url !== existing) {
          await submitListingLink({ data: { listingId, kind, url } });
        } else if (!url && existing !== undefined) {
          // Removes the typed row and (for menu) clears the legacy column
          // server-side — a legacy-only clear must not silently no-op.
          await deleteListingLink({ data: { listingId, kind } });
        }
      }
    },
    onSuccess: () => {
      setIsOpen(false);
      toast.success("Links saved");
    },
    onError: () => {
      toast.error("Could not save the links. Please try again.");
    },
    // Settled, not success: a mid-sequence failure has already committed the
    // earlier writes, so the page must refetch what actually landed.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listingLinksQueryKey(listingId) });
    },
  });

  const handleSubmit = () => {
    // Client-side pre-check so a bad URL gets an inline message instead of a
    // failed server round-trip. The server re-validates regardless.
    const invalid = LINK_KINDS.filter((kind) => {
      const url = drafts[kind].trim();
      return url !== "" && !listingLinkInputSchema.safeParse({ kind, url }).success;
    });
    if (invalid.length > 0) {
      setValidationError(
        `Check the ${invalid
          .map((kind) => LINK_KIND_METADATA[kind].label.toLowerCase())
          .join(", ")} link. Links must start with http:// or https://.`
      );
      return;
    }
    setValidationError(null);
    save.mutate(drafts);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="lg"
        onClick={openEditor}
        className="w-full gap-1.5 min-[480px]:w-auto"
      >
        <Pencil aria-hidden className="h-4 w-4" />
        {hasAnyLink ? "Edit links" : "Add links"}
      </Button>

      {/*
        Below sm: a full-screen takeover — the base classes override the primitive's
        centred positioning via tailwind-merge, filling the viewport (dvh, not vh, so
        mobile browser chrome never hides the footer). Header and action buttons stay
        pinned; only the fields area scrolls. At sm+ the overrides restore the centred
        dialog, capped at 85dvh with the same internal-scroll split.
      */}
      <Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : setIsOpen(false))}>
        <DialogContent className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[85dvh] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border">
          <DialogHeader className="border-b border-border px-6 pt-6 pb-4">
            <DialogTitle>{hasAnyLink ? "Edit links" : "Add links"}</DialogTitle>
            <DialogDescription>
              Add or fix this restaurant's links. Anyone signed in can edit them.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!save.isPending) {
                handleSubmit();
              }
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            {/* The only scrolling region — header/footer stay visible. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4">
                <ListingLinksFields
                  values={drafts}
                  onChange={(kind, value) => setDrafts((prev) => ({ ...prev, [kind]: value }))}
                />

                {validationError ? (
                  <p role="alert" className="text-body-sm text-incident">
                    {validationError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex gap-2 border-t border-border px-6 py-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={save.isPending}
                onClick={() => setIsOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save links"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
