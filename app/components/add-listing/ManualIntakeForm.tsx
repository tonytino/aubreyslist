import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { CreateListingResult } from "~/listings/create-input";
import { parseDuplicateListingError } from "~/listings/dedup-error";
import { submitCreateListing } from "~/server/listings/create.fn";
import { MenuUrlField } from "./MenuUrlField";

/**
 * Manual intake (ADR-008 fallback): the always-present safety net when an admin
 * toggles intake away from Places, or Places is unavailable. The user types the
 * restaurant's name, address, and coordinates directly. These fields are sent
 * as-is to the create write (validated server-side with Zod).
 *
 * Lat/lng are required by the schema (`listings.lat` / `listings.lng` are
 * NOT NULL) and back the Maps deep-link, so they are collected here rather than
 * guessed. Built on the `Input`/`Label`/`Button` primitives + semantic tokens so
 * the form reads correctly in light and dark mode.
 */
export function ManualIntakeForm({
  onCreated,
}: { onCreated: (result: CreateListingResult) => void }) {
  const fieldId = useId();
  const nameId = `${fieldId}-name`;
  const addressId = `${fieldId}-address`;
  const latId = `${fieldId}-lat`;
  const lngId = `${fieldId}-lng`;

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [menuUrl, setMenuUrl] = useState("");

  const create = useMutation({
    mutationFn: () =>
      submitCreateListing({
        data: {
          mode: "manual",
          name,
          address,
          lat: Number(lat),
          lng: Number(lng),
          menuUrl: menuUrl || undefined,
        },
      }),
    onSuccess: (result) => {
      toast.success("Listing added");
      onCreated(result);
    },
    // A blocked duplicate still shows the inline link below (it's the graceful
    // "already listed" path); the toast complements that inline message rather
    // than replacing it.
    onError: (error) => {
      const duplicate = parseDuplicateListingError(error);
      toast.error(
        duplicate
          ? "This restaurant is already listed."
          : "Could not add the listing. Please try again."
      );
    },
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

      <MenuUrlField value={menuUrl} onChange={setMenuUrl} />

      {create.isError ? <SubmitError error={create.error} /> : null}

      <Button type="submit" disabled={!canSubmit || create.isPending}>
        {create.isPending ? "Adding…" : "Add listing"}
      </Button>
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
