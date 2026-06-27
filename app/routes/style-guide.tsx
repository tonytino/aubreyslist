import { createFileRoute } from "@tanstack/react-router";
import { SAFETY_STATES, SafetySignal } from "~/components/SafetySignal";
import { Wordmark } from "~/components/Wordmark";

export const Route = createFileRoute("/style-guide")({
  component: StyleGuide,
});

const PALETTE: { name: string; className: string }[] = [
  { name: "brand", className: "bg-brand" },
  { name: "brand-strong", className: "bg-brand-strong" },
  { name: "brand-soft", className: "bg-brand-soft" },
  { name: "accent-lavender", className: "bg-accent-lavender" },
  { name: "accent-mint", className: "bg-accent-mint" },
  { name: "accent-peach", className: "bg-accent-peach" },
  { name: "accent-sky", className: "bg-accent-sky" },
];

const TYPE_SCALE: { name: string; className: string }[] = [
  { name: "display", className: "text-display" },
  { name: "headline", className: "text-headline" },
  { name: "title", className: "text-title" },
  { name: "lead", className: "text-lead" },
  { name: "body", className: "text-body" },
  { name: "body-sm", className: "text-body-sm" },
  { name: "caption", className: "text-caption" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-card">
      <h2 className="text-title">{title}</h2>
      {children}
    </section>
  );
}

function StyleGuide() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-section bg-background p-gutter text-foreground">
      <header className="flex flex-col gap-2">
        <Wordmark size="lg" />
        <p className="text-muted-foreground text-body-sm">
          Brand &amp; design-token reference. Safety signals always pair colour with an icon and a
          text label.
        </p>
      </header>

      <Section title="Brand &amp; pastel accents">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PALETTE.map((swatch) => (
            <div key={swatch.name} className="flex flex-col gap-1">
              <div className={`h-16 rounded-card border border-border ${swatch.className}`} />
              <span className="text-caption text-muted-foreground">{swatch.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <div className="flex flex-col gap-3">
          {TYPE_SCALE.map((row) => (
            <div key={row.name} className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-caption text-muted-foreground">{row.name}</span>
              <span className={row.className}>Aubrey's List</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Safety signals — soft">
        <div className="flex flex-wrap gap-3">
          {SAFETY_STATES.map((state) => (
            <SafetySignal key={state} state={state} variant="soft" />
          ))}
        </div>
      </Section>

      <Section title="Safety signals — solid">
        <div className="flex flex-wrap gap-3">
          {SAFETY_STATES.map((state) => (
            <SafetySignal key={state} state={state} variant="solid" />
          ))}
        </div>
      </Section>
    </main>
  );
}
