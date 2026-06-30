import { Plus } from "@phosphor-icons/react/dist/ssr";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SAFETY_STATES, SafetySignal } from "~/components/SafetySignal";
import { Wordmark } from "~/components/Wordmark";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";

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

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;

const BUTTON_SIZES = ["sm", "default", "lg"] as const;

const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline"] as const;

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {children}
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

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
  const [notifyOnClaims, setNotifyOnClaims] = useState(true);

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

      <Section title="Buttons">
        <div className="flex flex-col gap-card">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {BUTTON_VARIANTS.map((variant) => (
              <Labeled key={variant} label={variant}>
                <Button variant={variant}>Button</Button>
              </Labeled>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {BUTTON_SIZES.map((size) => (
              <Labeled key={size} label={`size=${size}`}>
                <Button size={size}>Button</Button>
              </Labeled>
            ))}
            <Labeled label="size=icon">
              <Button size="icon" aria-label="Add">
                <Plus weight="bold" />
              </Button>
            </Labeled>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Labeled label="disabled">
              <Button disabled>Button</Button>
            </Labeled>
            <Labeled label="leading icon">
              <Button>
                <Plus weight="bold" />
                Add listing
              </Button>
            </Labeled>
            <Labeled label="asChild anchor">
              <Button asChild>
                <a href="#buttons">Link button</a>
              </Button>
            </Labeled>
          </div>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-end gap-3">
          {BADGE_VARIANTS.map((variant) => (
            <Labeled key={variant} label={variant}>
              <Badge variant={variant}>Badge</Badge>
            </Labeled>
          ))}
        </div>
      </Section>

      <Section title="Card">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Sweetgreen</CardTitle>
            <CardDescription>Dedicated gluten-free prep area on site.</CardDescription>
          </CardHeader>
          <CardContent className="text-body-sm text-muted-foreground">
            A representative card composing the header, body, and footer slots from the primitive.
          </CardContent>
          <CardFooter>
            <Button variant="outline">View listing</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Form controls">
        <div className="flex max-w-sm flex-col gap-card">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-email">Email</Label>
            <Input id="demo-email" type="email" placeholder="you@example.com" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-disabled">Disabled</Label>
            <Input id="demo-disabled" type="text" placeholder="Unavailable" disabled />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-invalid">Invalid</Label>
            <Input
              id="demo-invalid"
              type="email"
              placeholder="you@example.com"
              defaultValue="not-an-email"
              aria-invalid="true"
            />
            <span className="text-caption text-muted-foreground">aria-invalid state</span>
          </div>
        </div>
      </Section>

      <Section title="Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Remove listing</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove this listing?</DialogTitle>
              <DialogDescription>
                This hides Sweetgreen from the directory. You can restore it later from the archive.
              </DialogDescription>
            </DialogHeader>
            <p className="text-body-sm text-muted-foreground">
              Community claims and incident history stay attached to the listing while it's
              archived.
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <Button>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Dropdown menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Listing actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Sweetgreen</DropdownMenuLabel>
            <DropdownMenuItem>View listing</DropdownMenuItem>
            <DropdownMenuItem>Add a claim</DropdownMenuItem>
            <DropdownMenuItem>Report an incident</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={notifyOnClaims} onCheckedChange={setNotifyOnClaims}>
              Notify me on new claims
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Tooltip">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">Safety score</Button>
            </TooltipTrigger>
            <TooltipContent>
              Aggregated from community claims and verified incidents.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="overview" className="max-w-md">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="claims">Community claims</TabsTrigger>
            <TabsTrigger value="incidents">Incidents</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-body-sm text-muted-foreground">
            A summary of the listing's safety signals, hours, and dedicated prep details.
          </TabsContent>
          <TabsContent value="claims" className="text-body-sm text-muted-foreground">
            What the community reports about cross-contact practices and staff awareness.
          </TabsContent>
          <TabsContent value="incidents" className="text-body-sm text-muted-foreground">
            A timeline of reported reactions, with severity and resolution notes.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Dark mode">
        <p className="text-body-sm text-muted-foreground">
          The palette adapts automatically via the theme toggle in the site header. Every token and
          component above reads from semantic CSS variables, so switching themes re-themes the
          entire gallery without per-component changes.
        </p>
      </Section>
    </main>
  );
}
