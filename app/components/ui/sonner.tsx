import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App toast host (shadcn New-York Sonner, adapted to this repo's tokens).
 *
 * Colours are driven by our own design tokens via CSS custom properties, so
 * toasts re-theme automatically with the `.dark` class on <html> — no
 * `next-themes` / theme-sync needed. Mounted once in the root layout
 * (`app/routes/__root.tsx`); fire toasts anywhere with
 * `import { toast } from "sonner"`.
 *
 * Use `toast.success` / `toast.error` for state-bearing toasts: Sonner pairs an
 * icon with the message, so meaning is never carried by colour alone.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
