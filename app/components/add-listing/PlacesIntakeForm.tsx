import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { CreateListingResult } from "~/listings/create-input";
import type { PlacePrediction } from "~/listings/places-input";
import { submitCreateListing } from "~/server/listings/create.fn";
import { autocompletePlaces } from "~/server/places.fn";
import { MenuUrlField } from "./MenuUrlField";

/**
 * Places intake (ADR-008 default): search Google Places, pick a result, confirm,
 * submit. The chosen Place ID is the only field sent to the create write — the
 * canonical name/address/coords are resolved server-side, so the client never
 * fabricates them.
 *
 * Built on the `Input`/`Label`/`Button`/`Card` primitives + semantic tokens so
 * the form reads correctly in light and dark mode, and is mobile-first.
 */
export function PlacesIntakeForm({
  onCreated,
}: { onCreated: (result: CreateListingResult) => void }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PlacePrediction | null>(null);
  const [menuUrl, setMenuUrl] = useState("");

  // Autocomplete runs as a query keyed on the (debounce-free, manually
  // triggered) submitted term. We trigger it on the search form submit rather
  // than per-keystroke to keep paid Places calls deliberate.
  //
  // `searchNonce` increments on every submit and is part of the query key so a
  // deliberate Search always re-fetches — even when the term is unchanged. The
  // app sets a 60s `staleTime` (app/router.tsx); without the nonce, re-submitting
  // the same term (e.g. retrying after a transient "Please try again" failure, or
  // re-running an empty result) would serve the cached result and never hit the
  // API, leaving the user stuck with no new results (issue #98).
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searchNonce, setSearchNonce] = useState(0);
  const suggestions = useQuery({
    queryKey: ["places-autocomplete", searchNonce, submittedQuery],
    queryFn: () => autocompletePlaces({ data: { query: submittedQuery } }),
    enabled: submittedQuery.trim().length > 0,
  });

  const create = useMutation({
    mutationFn: (placeId: string) =>
      submitCreateListing({ data: { mode: "places", placeId, menuUrl: menuUrl || undefined } }),
    onSuccess: (result) => {
      toast.success("Listing added");
      onCreated(result);
    },
    onError: () => {
      toast.error("Could not add the listing. Please try again.");
    },
  });

  const predictions = suggestions.data?.ok ? suggestions.data.data : [];
  // Two failure shapes: the server function *returns* a typed `ok:false` result
  // (key missing, upstream/network error it caught), or it *throws* before
  // returning one (transport failure, an uncaught server-side error). The latter
  // surfaces as `suggestions.isError` with no `data`; without handling it the UI
  // would fall through to the "No matches found" branch and show a silent empty
  // state instead of an error — the first-search "no results come back" of #98.
  const searchError =
    suggestions.data && !suggestions.data.ok
      ? suggestions.data.message
      : suggestions.isError
        ? "Place search is temporarily unavailable. Please try again."
        : undefined;

  return (
    <div className="flex flex-col gap-section">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected(null);
          setSubmittedQuery(query);
          setSearchNonce((nonce) => nonce + 1);
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={searchId}>Search for a restaurant</Label>
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. Sweet Action, Denver"
          />
        </div>
        <Button type="submit" disabled={query.trim().length === 0 || suggestions.isFetching}>
          {suggestions.isFetching ? "Searching…" : "Search"}
        </Button>
      </form>

      {searchError ? (
        <p role="alert" className="text-body-sm text-incident">
          {searchError}
        </p>
      ) : null}

      {submittedQuery && !suggestions.isFetching && predictions.length === 0 && !searchError ? (
        <p className="text-body-sm text-muted-foreground">
          No matches found. Try a different search.
        </p>
      ) : null}

      {predictions.length > 0 ? (
        <ul aria-label="Search results" className="flex flex-col gap-2">
          {predictions.map((prediction) => {
            const isSelected = selected?.placeId === prediction.placeId;
            return (
              <li key={prediction.placeId}>
                <button
                  type="button"
                  onClick={() => setSelected(prediction)}
                  aria-pressed={isSelected}
                  className={`w-full rounded-card border px-4 py-3 text-left text-body ${
                    isSelected
                      ? "border-brand bg-brand-soft text-foreground"
                      : "border-input bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  {prediction.description}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {selected ? (
        <form
          className="flex flex-col gap-4 rounded-card border border-border bg-card p-gutter text-card-foreground"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(selected.placeId);
          }}
        >
          <div className="flex flex-col gap-1">
            <span className="text-body-sm font-medium text-muted-foreground">Confirm listing</span>
            <p className="text-body font-semibold text-foreground">{selected.description}</p>
          </div>

          <MenuUrlField value={menuUrl} onChange={setMenuUrl} />

          {create.isError ? (
            <p role="alert" className="text-body-sm text-incident">
              {create.error instanceof Error
                ? create.error.message
                : "Could not add the listing. Please try again."}
            </p>
          ) : null}

          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Adding…" : "Add this listing"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
