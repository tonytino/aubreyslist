import { useId } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

/**
 * Optional menu-link URL field, shared by both intake modes (issue #26). No file
 * uploads in v1 (ADR-008) — just a link to an external menu. Controlled input so
 * the parent owns the value and submits it with the rest of the form.
 *
 * Built on the `Input`/`Label` primitives + semantic tokens so it reads
 * correctly in light and dark mode. A generated `id` ties the `Label`'s
 * `htmlFor` to the `Input` and to its `aria-describedby` hint.
 */
export function MenuUrlField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>
        Menu link <span className="text-muted-foreground">(optional)</span>
      </Label>
      <Input
        id={fieldId}
        type="url"
        inputMode="url"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://example.com/menu"
        aria-describedby={hintId}
      />
      <span id={hintId} className="text-caption text-muted-foreground">
        A link to the restaurant's menu. No uploads — paste a URL.
      </span>
    </div>
  );
}
