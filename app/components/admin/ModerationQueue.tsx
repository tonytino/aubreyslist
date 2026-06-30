import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  dismissFlagAction,
  hideContentAction,
  removeContentAction,
} from "~/server/moderation/actions.fn";
import type { QueueItem, QueueTarget, QueueTargetType } from "~/server/moderation/queue.fn";
import { moderationQueueQueryKey, moderationQueueQueryOptions } from "./moderation-queue-query";

/**
 * The moderation-queue surface inside the admin panel (issue #40, ACTIONS #41).
 *
 * Lists OPEN flags for moderators/admins to triage — each with its target
 * (type + human label), the reporter, the reason, and the date filed. Data comes
 * from TanStack Query (the route loader prefetches it; this reads the hydrated
 * cache), per the API doc's "no useEffect + useState for data fetching" rule.
 *
 * Moderation ACTIONS (#41): each row now carries real Dismiss / Hide / Remove
 * controls wired through `*.fn.ts` server functions via TanStack Query
 * `useMutation`. The server re-gates every action to moderator+ (admins pass;
 * `user` 403; anon 401) and validates input, so the UI is convenience only — it
 * is never the access control. On success the queue is invalidated and refetched,
 * so the acted-on flag (now resolved/dismissed) drops out of the open-flags view.
 * (`restore` exists in the action layer for un-hiding content, but is not
 * surfaced HERE because the open-flags queue only ever shows still-visible,
 * un-acted content — there is nothing to restore in this view.)
 *
 * Accessibility: the per-item target type AND every action are conveyed by an
 * icon SHAPE plus a TEXT label (never colour alone), mirroring `SafetySignal`'s
 * contract.
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
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.id}>
          <QueueRow item={item} />
        </li>
      ))}
    </ul>
  );
}

/** One flagged item: target, reason, reporter, date, and the moderation actions. */
function QueueRow({ item }: { item: QueueItem }) {
  const { target } = item;
  return (
    <article className="flex flex-col gap-2 rounded-card border border-border bg-muted p-3">
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

      <QueueActions flagId={item.id} target={target} />
    </article>
  );
}

/** The exclusive-arc action payload (target + prompting flag) the server fns accept. */
type ActionPayload =
  | { target: "listing"; listingId: string; flagId: string }
  | { target: "claim"; claimId: string; flagId: string }
  | { target: "incident"; incidentId: string; flagId: string };

/**
 * Build the exclusive-arc action payload from the queue row's resolved target
 * (its `id` is the listing/claim/incident id, never the flag id) plus the
 * prompting `flagId`. Returning the discriminated union directly keeps the
 * payload's `target` literal in lockstep with its id field for the server fns.
 */
function buildActionPayload(target: QueueTarget, flagId: string): ActionPayload {
  switch (target.type) {
    case "listing":
      return { target: "listing", listingId: target.id, flagId };
    case "claim":
      return { target: "claim", claimId: target.id, flagId };
    case "incident":
      return { target: "incident", incidentId: target.id, flagId };
  }
}

/**
 * Dismiss / Hide / Remove controls for one open flag (#41).
 *
 * Each calls its `*.fn.ts` server function (which re-gates to moderator+ and
 * validates server-side) via `useMutation`, passing the prompting `flagId` and
 * the exclusive-arc target. On success the whole queue query is invalidated so
 * the now-resolved/dismissed flag drops out — a simple, always-correct refresh
 * (the acted-on row leaves the open-flags set). An inline alert surfaces any
 * error; controls disable while a mutation is in flight.
 *
 * Dismiss (which only clears the flag, leaving the content untouched) fires
 * directly. Hide and Remove DO change what the public sees, so they are gated
 * behind a confirmation `Dialog` that names the consequence before the existing
 * mutation fires — Remove uses the `destructive` confirm variant. The dialog
 * only gates the click; it is NOT the authorization (the server fn re-gates to
 * moderator+ either way).
 */
function QueueActions({ flagId, target }: { flagId: string; target: QueueTarget }) {
  const queryClient = useQueryClient();
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);

  const payload = buildActionPayload(target, flagId);
  const targetLabel = TARGET_CONFIG[target.type].label.toLowerCase();

  function onError(err: unknown) {
    setError(
      err instanceof Error ? err.message : "Could not complete the action. Please try again."
    );
  }

  function onSuccess() {
    setError(null);
    // Invalidate-on-success: refetch the queue so the acted-on flag leaves the
    // open-flags view (it is now resolved/dismissed).
    void queryClient.invalidateQueries({ queryKey: moderationQueueQueryKey });
  }

  const dismiss = useMutation({
    mutationFn: () => dismissFlagAction({ data: payload }),
    onSuccess,
    onError,
  });
  const hide = useMutation({
    mutationFn: () => hideContentAction({ data: payload }),
    onSuccess,
    onError,
  });
  const remove = useMutation({
    mutationFn: () => removeContentAction({ data: payload }),
    onSuccess,
    onError,
  });

  const pending = dismiss.isPending || hide.isPending || remove.isPending;

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => dismiss.mutate()}
        >
          <DismissIcon />
          <span>Dismiss</span>
        </Button>
        <ConfirmActionButton
          label="Hide"
          icon={<HideIcon />}
          disabled={pending}
          variant="outline"
          confirmVariant="default"
          title="Hide this content?"
          description={`This ${targetLabel} will be hidden from the public listing while it stays under review. You can restore it later. The flag will be marked resolved.`}
          onConfirm={() => hide.mutate()}
        />
        <ConfirmActionButton
          label="Remove"
          icon={<RemoveIcon />}
          disabled={pending}
          variant="destructive"
          confirmVariant="destructive"
          title="Remove this content?"
          description={`This ${targetLabel} will be removed and will no longer appear in the listing. This is the strongest moderation action — only use it for content that clearly violates the rules.`}
          onConfirm={() => remove.mutate()}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A moderation action whose click is gated behind a confirmation `Dialog` that
 * names the consequence (icon SHAPE + visible TEXT label, never colour alone).
 * The dialog only gates the click — the underlying mutation (and the server-side
 * moderator+ gate it re-runs) is unchanged. Destructive actions pass
 * `variant="destructive"` for both the trigger and the confirm button.
 */
function ConfirmActionButton({
  label,
  icon,
  disabled,
  variant,
  confirmVariant,
  title,
  description,
  onConfirm,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  variant: "outline" | "destructive";
  confirmVariant: "default" | "destructive";
  title: string;
  description: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  function handleConfirm() {
    onConfirm();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {icon}
        <span>{label}</span>
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant={confirmVariant} onClick={handleConfirm}>
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

/** Decorative glyph for "dismiss" (an X) — the adjacent label carries meaning. */
function DismissIcon() {
  return (
    <ActionIcon>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </ActionIcon>
  );
}

/** Decorative glyph for "hide" (an eye with a slash). */
function HideIcon() {
  return (
    <ActionIcon>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M3 3l18 18" />
    </ActionIcon>
  );
}

/** Decorative glyph for "remove" (a trash can). */
function RemoveIcon() {
  return (
    <ActionIcon>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </ActionIcon>
  );
}

/** Shared small inline action glyph. */
function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
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
    <Badge variant="secondary">
      {config.icon}
      <span>{config.label}</span>
    </Badge>
  );
}

/** Concise, locale-independent date for the row header. */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
