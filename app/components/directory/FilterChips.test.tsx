import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { currentUserQuery } from "~/auth/current-user-query";
import type { SessionUser } from "~/server/auth/current-user.fn";
import { FilterChips } from "./FilterChips";

/**
 * Tests for the directory filter chip row (AUB-61, Phase 2b; extended for the
 * server-side "Saved" filter in AUB-129 / F11). The three quick chips are real
 * <button>s with `aria-pressed`, mutually exclusive, and toggle off on a second
 * click. The "Filters" chip is the entry point to the existing server-side
 * taxonomy filter (its sheet is Radix-portaled and only mounts on open, so we
 * assert on the trigger + its active-count badge here). The search leads the row
 * as a {@link SearchChip} (user feedback #5), wired to `search`/`onSearchChange`.
 * The "Saved" chip is sign-in-gated: it reads {@link currentUserQuery} (seeded
 * into the QueryClient below), so the whole row renders under a provider.
 */

const SIGNED_IN_USER: SessionUser = {
  id: "user-1",
  name: "Test Diner",
  email: "diner@example.com",
  avatarUrl: null,
  role: "user",
};

function renderChips(
  overrides: Partial<Parameters<typeof FilterChips>[0]> = {},
  { signedIn = false }: { signedIn?: boolean } = {}
) {
  const onQuickChange = vi.fn();
  const onToggleAttr = vi.fn();
  const onClearAttrs = vi.fn();
  const onSearchChange = vi.fn();
  const onSavedToggle = vi.fn();

  // Seed the current-user suspense source so `useSuspenseQuery(currentUserQuery)`
  // (inside the Saved chip) resolves synchronously without calling a server fn.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(currentUserQuery.queryKey, signedIn ? SIGNED_IN_USER : null);

  render(
    <QueryClientProvider client={queryClient}>
      <FilterChips
        attrs={[]}
        onToggleAttr={onToggleAttr}
        onClearAttrs={onClearAttrs}
        quick={null}
        onQuickChange={onQuickChange}
        search=""
        onSearchChange={onSearchChange}
        saved={false}
        onSavedToggle={onSavedToggle}
        {...overrides}
      />
    </QueryClientProvider>
  );
  return { onQuickChange, onToggleAttr, onClearAttrs, onSearchChange, onSavedToggle };
}

describe("FilterChips — quick chips", () => {
  it("renders the three quick chips plus the Filters trigger", () => {
    renderChips();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recently verified" })).toBeInTheDocument();
  });

  it("reflects the active quick chip via aria-pressed (state, not colour alone)", () => {
    renderChips({ quick: "celiac" });
    expect(screen.getByRole("button", { name: "Celiac-safe" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Mutual exclusivity: the others are not pressed.
    expect(screen.getByRole("button", { name: "Gluten-friendly" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Recently verified" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("selecting a chip requests that single quick value", () => {
    const { onQuickChange } = renderChips({ quick: null });
    fireEvent.click(screen.getByRole("button", { name: "Gluten-friendly" }));
    expect(onQuickChange).toHaveBeenCalledWith("friendly");
  });

  it("clicking the active chip toggles it back off (null)", () => {
    const { onQuickChange } = renderChips({ quick: "recent" });
    fireEvent.click(screen.getByRole("button", { name: "Recently verified" }));
    expect(onQuickChange).toHaveBeenCalledWith(null);
  });

  it("shows the active taxonomy-attribute count on the Filters chip", () => {
    renderChips({ attrs: ["dedicated_fryer", "celiac_safe_vs_gluten_friendly"] });
    const filters = screen.getByRole("button", { name: /Filters/ });
    expect(filters).toHaveTextContent("2");
  });
});

describe("FilterChips — search chip (user feedback #5)", () => {
  it("renders the search chip as the first control in the row", () => {
    renderChips();
    const search = screen.getByRole("button", { name: "Search restaurants" });
    expect(search).toBeInTheDocument();
    // The collapsed search chip leads the row, before the Filters trigger.
    const filters = screen.getByRole("button", { name: "Filters" });
    expect(search.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reflects an applied search value as the active chip", () => {
    renderChips({ search: "rooted" });
    expect(screen.getByRole("button", { name: "Search: rooted" })).toBeInTheDocument();
  });

  it("threads search edits through onSearchChange", () => {
    const { onSearchChange } = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "Search restaurants" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "root" } });
    expect(onSearchChange).toHaveBeenCalledWith("root");
  });
});

describe("FilterChips — Saved chip (AUB-129 / F11)", () => {
  it("ANONYMOUS: clicking Saved opens the sign-in dialog and does NOT navigate", async () => {
    const { onSavedToggle } = renderChips({}, { signedIn: false });

    fireEvent.click(screen.getByRole("button", { name: "Saved" }));

    // A sign-in dialog appears with a Google OAuth link carrying a `?saved=1`
    // returnTo — and crucially the toggle (the server-side navigation) is NOT
    // fired, so no `savedOnly` request is ever made for an anonymous viewer.
    const signInLink = await screen.findByRole("link", { name: /sign in/i });
    expect(signInLink).toHaveAttribute(
      "href",
      expect.stringContaining("/api/auth/google?returnTo=")
    );
    expect(decodeURIComponent(signInLink.getAttribute("href") ?? "")).toContain("saved=1");
    expect(onSavedToggle).not.toHaveBeenCalled();
  });

  it("SIGNED-IN: clicking Saved toggles the server-side filter (?saved=1) with no dialog", () => {
    const { onSavedToggle } = renderChips({}, { signedIn: true });

    fireEvent.click(screen.getByRole("button", { name: "Saved" }));

    // Signed-in click drives the server mode via onSavedToggle (the route
    // navigates to `?saved=1`), and no sign-in dialog is opened.
    expect(onSavedToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("SIGNED-IN + saved: reflects the active state via aria-pressed (not colour alone)", () => {
    renderChips({ saved: true }, { signedIn: true });
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");
  });

  it("ANONYMOUS is never pressed even if `saved` is somehow set", () => {
    // An anonymous viewer can't be in the saved MODE, so the chip stays unpressed
    // regardless of the URL param.
    renderChips({ saved: true }, { signedIn: false });
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "false");
  });
});
