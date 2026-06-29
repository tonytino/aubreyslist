import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { CreateListingResult } from "~/server/listings/create";
import { createListing } from "~/server/listings/create";
import { parseDuplicateListingError } from "~/server/listings/dedup";
import { MenuUrlField } from "./MenuUrlField";

/**
 * Manual intake (ADR-008 fallback): the always-present safety net when an admin
 * toggles intake away from Places, or Places is unavailable. The user types the
 * restaurant's name, address, and coordinates directly. These fields are sent
 * as-is to the create write (validated server-side with Zod).
 *
 * Lat/lng are required by the schema (`listings.lat` / `listings.lng` are
 * NOT NULL) and back the Maps deep-link, so they are collected here rather than
 * guessed. Mirrors the design-token conventions of `app/routes/listings.$id.tsx`.
 */
export function ManualIntakeForm({
  onCreated,
}: { onCreated: (result: CreateListingResult) => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [menuUrl, setMenuUrl] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createListing({
        data: {
          mode: "manual",
          name,
          address,
          lat: Number(lat),
          lng: Number(lng),
          menuUrl: menuUrl || undefined,
        },
      }),
    onSuccess: onCreated,
  });

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
          create.mutate();
        }
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-body-sm font-medium text-foreground">Restaurant name</span>
        <input
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded-card border border-border bg-background px-3 py-2 text-body text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-body-sm font-medium text-foreground">Address</span>
        <input
          type="text"
          required
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="rounded-card border border-border bg-background px-3 py-2 text-body text-foreground"
        />
      </label>

      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-body-sm font-medium text-foreground">Latitude</span>
          <input
            type="number"
            required
            step="any"
            min={-90}
            max={90}
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            placeholder="39.7392"
            className="rounded-card border border-border bg-background px-3 py-2 text-body text-foreground"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-body-sm font-medium text-foreground">Longitude</span>
          <input
            type="number"
            required
            step="any"
            min={-180}
            max={180}
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            placeholder="-104.9903"
            className="rounded-card border border-border bg-background px-3 py-2 text-body text-foreground"
          />
        </label>
      </div>

      <MenuUrlField value={menuUrl} onChange={setMenuUrl} />

      {create.isError ? <SubmitError error={create.error} /> : null}

      <button
        type="submit"
        disabled={!canSubmit || create.isPending}
        className="inline-flex items-center justify-center rounded-card bg-brand px-5 py-2.5 text-body font-semibold text-brand-foreground hover:bg-brand-strong disabled:opacity-50"
      >
        {create.isPending ? "Adding…" : "Add listing"}
      </button>
    </form>
  );
}

/**
 * Renders the post-submit error. A blocked-duplicate error (issue #25) is
 * special-cased: {@link parseDuplicateListingError} recovers the existing
 * listing's id from the error message (custom error fields don't survive the
 * server-fn RPC boundary, so the id rides in the message), letting us render a
 * link so the user can jump straight to the listing that already exists instead
 * of just reading that it does. Any other error falls back to plain text.
 */
function SubmitError({ error }: { error: unknown }) {
  const duplicate = parseDuplicateListingError(error);

  if (duplicate?.existingListingId) {
    return (
      <p role="alert" className="text-body-sm text-incident">
        {duplicate.message}{" "}
        <Link
          to="/listings/$id"
          params={{ id: duplicate.existingListingId }}
          className="underline underline-offset-4"
        >
          View the existing listing
        </Link>
      </p>
    );
  }

  return (
    <p role="alert" className="text-body-sm text-incident">
      {error instanceof Error ? error.message : "Could not add the listing. Please try again."}
    </p>
  );
}
