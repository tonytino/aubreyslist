import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { autocompletePlaces } from "~/server/places.fn";
import type { IntakeMode } from "~/server/settings";
import type { WizardPlace } from "./AddListingWizard";
import { MenuUrlField } from "./MenuUrlField";

/**
 * Step 0 — find the place. Reuses the Places autocomplete search + manual-entry
 * UI of `PlacesIntakeForm` / `ManualIntakeForm`, but instead of calling
 * `submitCreateListing` it COLLECTS the choice into wizard state via `onSelect`.
 * The create is deferred to the wizard's final submit.
 *
 * Places is the default surface when it's the active intake mode (ADR-008), with
 * a visible "Enter manually instead" toggle; when the admin has switched intake
 * to manual (or Places is unavailable) the manual form stands alone, since the
 * paid Places search would only degrade.
 */
export function FindPlaceStep({
  intakeMode,
  place,
  menuUrl,
  onMenuUrlChange,
  onSelect,
  onClear,
  onContinue,
}: {
  intakeMode: IntakeMode;
  place: WizardPlace | null;
  menuUrl: string;
  onMenuUrlChange: (value: string) => void;
  onSelect: (place: WizardPlace) => void;
  onClear: () => void;
  onContinue: () => void;
}) {
  const placesEnabled = intakeMode === "places";

  // Once a place is collected, show the confirmation card (name/address, the
  // dedup line, the optional menu link) with a Change affordance + Continue.
  if (place !== null) {
    return (
      <SelectedPlaceCard
        place={place}
        menuUrl={menuUrl}
        onMenuUrlChange={onMenuUrlChange}
        onClear={onClear}
        onContinue={onContinue}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-title font-semibold">Find the place</h2>
        <p className="text-body text-muted-foreground">
          {placesEnabled
            ? "Search Google Places, or enter the restaurant manually."
            : "Enter the restaurant's details."}
        </p>
      </div>
      {placesEnabled ? <PlacesFinder onSelect={onSelect} /> : <ManualFinder onSelect={onSelect} />}
    </section>
  );
}

/** Places-first finder: search, pick a result → collect it (no create). */
function PlacesFinder({ onSelect }: { onSelect: (place: WizardPlace) => void }) {
  const searchId = useId();
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  // `searchNonce` is part of the query key so a deliberate re-Search re-fetches
  // even for an unchanged term (mirrors PlacesIntakeForm / issue #98).
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searchNonce, setSearchNonce] = useState(0);

  const suggestions = useQuery({
    queryKey: ["places-autocomplete", searchNonce, submittedQuery],
    queryFn: () => autocompletePlaces({ data: { query: submittedQuery } }),
    enabled: submittedQuery.trim().length > 0,
  });

  const predictions = suggestions.data?.ok ? suggestions.data.data : [];
  const searchError =
    suggestions.data && !suggestions.data.ok
      ? suggestions.data.message
      : suggestions.isError
        ? "Place search isn't working right now. Try again."
        : undefined;

  if (manual) {
    return (
      <div className="flex flex-col gap-4">
        <ManualFinder onSelect={onSelect} />
        <div>
          <Button type="button" variant="link" onClick={() => setManual(false)} className="px-0">
            Search Google Places instead
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
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
          {predictions.map((prediction) => (
            <li key={prediction.placeId}>
              <button
                type="button"
                onClick={() =>
                  onSelect({
                    mode: "places",
                    placeId: prediction.placeId,
                    description: prediction.description,
                  })
                }
                className="w-full rounded-card border border-input bg-card px-4 py-3 text-left text-body text-foreground hover:bg-muted"
              >
                {prediction.description}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <Button type="button" variant="link" onClick={() => setManual(true)} className="px-0">
          Enter manually instead
        </Button>
      </div>
    </div>
  );
}

/** Manual finder: name/address/lat/lng → collect it (no create). */
function ManualFinder({ onSelect }: { onSelect: (place: WizardPlace) => void }) {
  const fieldId = useId();
  const nameId = `${fieldId}-name`;
  const addressId = `${fieldId}-address`;
  const latId = `${fieldId}-lat`;
  const lngId = `${fieldId}-lng`;

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const coordsValid =
    lat.trim() !== "" &&
    lng.trim() !== "" &&
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    lngNum >= -180 &&
    lngNum <= 180;
  const canSubmit = name.trim() !== "" && address.trim() !== "" && coordsValid;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onSelect({ mode: "manual", name, address, lat: latNum, lng: lngNum });
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>Restaurant name</Label>
        <Input
          id={nameId}
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={addressId}>Address</Label>
        <Input
          id={addressId}
          type="text"
          required
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={latId}>Latitude</Label>
          <Input
            id={latId}
            type="number"
            required
            step="any"
            min={-90}
            max={90}
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            placeholder="39.7392"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={lngId}>Longitude</Label>
          <Input
            id={lngId}
            type="number"
            required
            step="any"
            min={-180}
            max={180}
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            placeholder="-104.9903"
          />
        </div>
      </div>

      <Button type="submit" disabled={!canSubmit}>
        Use this place
      </Button>
    </form>
  );
}

/** The "Selected place" confirmation card: dedup line, menu link, Change, Continue. */
function SelectedPlaceCard({
  place,
  menuUrl,
  onMenuUrlChange,
  onClear,
  onContinue,
}: {
  place: WizardPlace;
  menuUrl: string;
  onMenuUrlChange: (value: string) => void;
  onClear: () => void;
  onContinue: () => void;
}) {
  const name = place.mode === "places" ? place.description : place.name;
  const detail =
    place.mode === "places"
      ? "Google Place · dedup by Place ID"
      : `${place.address} · Manual entry`;

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-body-sm font-medium text-muted-foreground">
            Selected place
          </CardTitle>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="text-body font-semibold text-foreground">{name}</span>
              <span className="text-body-sm text-muted-foreground">{detail}</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onClear}>
              Change
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <MenuUrlField value={menuUrl} onChange={onMenuUrlChange} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </section>
  );
}
