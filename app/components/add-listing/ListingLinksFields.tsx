import { useId } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { LINK_KIND_METADATA, LINK_KINDS, type LinkKind } from "~/listings/links";

/**
 * Per-kind values for the typed-link URL fields, keyed on the full taxonomy.
 * Raw field text (may be blank or mid-edit); the parent owns the state and
 * drops blank entries before submitting.
 */
export type LinkFieldValues = Record<LinkKind, string>;

/** An all-blank {@link LinkFieldValues}, for initialising parent state. */
export function emptyLinkFieldValues(): LinkFieldValues {
  return Object.fromEntries(LINK_KINDS.map((kind) => [kind, ""])) as LinkFieldValues;
}

/**
 * The typed-link URL fields: one labeled input per link kind (menu,
 * gluten-free menu, website, reservations, online ordering), all optional —
 * a fixed set of five, no dynamic add/remove. No file uploads in v1 (ADR-008),
 * just links.
 *
 * Shared by the add-listing wizard (collect at intake) and the detail page's
 * edit-links dialog (edit after creation). Controlled inputs so the parent
 * owns the values. Built on the `Input`/`Label` primitives + semantic tokens;
 * a generated `id` ties each `Label`'s `htmlFor` to its `Input` and to its
 * `aria-describedby` hint.
 */
export function ListingLinksFields({
  values,
  onChange,
}: {
  values: LinkFieldValues;
  onChange: (kind: LinkKind, value: string) => void;
}) {
  const baseId = useId();

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-body-sm font-medium text-foreground">
        Links <span className="font-normal text-muted-foreground">(all optional)</span>
      </legend>
      {LINK_KINDS.map((kind) => {
        const fieldId = `${baseId}-${kind}`;
        const hintId = `${fieldId}-hint`;
        const { label, hint } = LINK_KIND_METADATA[kind];
        return (
          <div key={kind} className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId}>{label}</Label>
            <Input
              id={fieldId}
              type="url"
              inputMode="url"
              value={values[kind]}
              onChange={(event) => onChange(kind, event.target.value)}
              placeholder="https://"
              aria-describedby={hintId}
            />
            <span id={hintId} className="text-caption text-muted-foreground">
              {hint}
            </span>
          </div>
        );
      })}
    </fieldset>
  );
}
