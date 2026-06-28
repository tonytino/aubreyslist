/**
 * Optional menu-link URL field, shared by both intake modes (issue #26). No file
 * uploads in v1 (ADR-008) — just a link to an external menu. Controlled input so
 * the parent owns the value and submits it with the rest of the form.
 */
export function MenuUrlField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-body-sm font-medium text-foreground">
        Menu link <span className="text-muted-foreground">(optional)</span>
      </span>
      <input
        type="url"
        inputMode="url"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://example.com/menu"
        className="rounded-card border border-border bg-background px-3 py-2 text-body text-foreground"
      />
      <span className="text-caption text-muted-foreground">
        A link to the restaurant's menu. No uploads — paste a URL.
      </span>
    </label>
  );
}
