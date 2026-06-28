import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { QueueItem, QueueTargetType } from "~/server/moderation/queue.fn";
import { moderationQueueQueryOptions } from "./moderation-queue-query";

/**
 * The moderation-queue surface inside the admin panel (issue #40).
 *
 * Lists OPEN flags for moderators/admins to triage — each with its target
 * (type + human label), the reporter, the reason, and the date filed. Data comes
 * from TanStack Query (the route loader prefetches it; this reads the hydrated
 * cache), per the API doc's "no useEffect + useState for data fetching" rule.
 *
 * Moderation ACTIONS (hide / remove / dismiss) land with #41; this surface only
 * renders the queue and a clearly-labelled, disabled "actions coming" affordance
 * so there is an obvious place for them without faking behaviour here.
 *
 * Accessibility: the per-item target type is conveyed by an icon SHAPE plus a
 * TEXT label (never colour alone), mirroring `SafetySignal`'s contract.
 */
export function ModerationQueue() {
  const { data } = useSuspenseQuery(moderationQueueQueryOptions());

  // The route gates access server-side; a non-granted verdict reaching this
  // component means the parent rendered it by mistake. Render an honest empty
  // state rather than fabricate a queue.
  if (data.access !== "granted") {
    return (
      <p className="text-body-sm text-muted-foreground">
        You do not have access to the moderation queue.
      </p>
    );
  }

  const { items } = data;

  if (items.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        No open flags. Nothing needs review right now.
      </p>
    );
  }

  return (
    <ul className="mt-2 flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.id}>
          <QueueRow item={item} />
        </li>
      ))}
    </ul>
  );
}

/** One flagged item: target, reason, reporter, date, and the (pending) actions. */
function QueueRow({ item }: { item: QueueItem }) {
  const { target } = item;
  return (
    <article className="flex flex-col gap-2 rounded-card border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TargetChip type={target.type} />
        <time
          className="text-caption text-muted-foreground"
          dateTime={item.createdAt.toISOString()}
        >
          {formatDate(item.createdAt)}
        </time>
      </div>

      <p className="text-body font-semibold text-foreground">
        {target.listingId ? (
          <Link
            to="/listings/$id"
            params={{ id: target.listingId }}
            className="underline underline-offset-4"
          >
            {target.label}
          </Link>
        ) : (
          target.label
        )}
      </p>

      <p className="text-body-sm text-muted-foreground">
        <span className="font-medium text-foreground">Reason:</span> {item.reason}
      </p>

      <p className="text-caption text-muted-foreground">
        Reported by {item.reporter.name} ({item.reporter.email})
      </p>

      {/* Moderation actions (hide / remove / dismiss) land with #41. A disabled,
          clearly-labelled control marks where they go without faking behaviour. */}
      <div className="mt-1">
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Moderation actions are coming soon (#41)."
          className="rounded-chip border border-border px-2.5 py-1 text-caption font-medium text-muted-foreground opacity-60"
        >
          Actions coming soon
        </button>
      </div>
    </article>
  );
}

/** Human label + distinct glyph per target type — shape carries meaning, not colour. */
const TARGET_CONFIG: Record<QueueTargetType, { label: string; icon: ReactNode }> = {
  listing: {
    label: "Listing",
    // storefront
    icon: (
      <TargetIcon>
        <path d="M4 9h16l-1-4H5L4 9z" />
        <path d="M5 9v10h14V9" />
        <path d="M9 19v-5h6v5" />
      </TargetIcon>
    ),
  },
  claim: {
    label: "Claim",
    // check badge — an attested statement
    icon: (
      <TargetIcon>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12l2.5 2.5L16 9" />
      </TargetIcon>
    ),
  },
  incident: {
    label: "Incident",
    // warning triangle — a "got glutened" report
    icon: (
      <TargetIcon>
        <path d="M12 4l9 16H3l9-16z" />
        <path d="M12 10v4" />
        <path d="M12 17h.01" />
      </TargetIcon>
    ),
  },
};

/** Small decorative inline glyph, mirroring `SafetySignal`'s icon contract. */
function TargetIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Target-type chip: icon SHAPE + visible TEXT label (never colour alone). */
function TargetChip({ type }: { type: QueueTargetType }) {
  const config = TARGET_CONFIG[type];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-chip bg-brand-soft px-2.5 py-1 text-caption font-medium text-brand">
      {config.icon}
      <span>{config.label}</span>
    </span>
  );
}

/** Concise, locale-independent date for the row header. */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
