import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Incident } from "~/db/schema";

/**
 * Component tests for the "Incident reports" body (#30 + #32): the signed-out
 * gate, the list-refresh-after-submit path, and the OWNER-ONLY edit/retract
 * controls. The incident server functions are mocked — the test only asserts the
 * component's behaviour (gate + permission visibility + query invalidation), not
 * the real DB write.
 */
const submitIncidentMock = vi.fn((_args: unknown) => Promise.resolve({} as Incident));
const updateIncidentMock = vi.fn((_args: unknown) => Promise.resolve({} as Incident));
const removeIncidentMock = vi.fn((_args: unknown) => Promise.resolve());
vi.mock("~/server/incidents/incidents.fn", () => ({
  submitIncident: (args: unknown) => submitIncidentMock(args),
  updateIncident: (args: unknown) => updateIncidentMock(args),
  removeIncident: (args: unknown) => removeIncidentMock(args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from "sonner";

import { IncidentReports, incidentsQueryKey } from "./IncidentReports";

function renderWithQuery(ui: ReactElement): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return queryClient;
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "incident-1",
    listingId: "listing-1",
    userId: "user-1",
    occurredOn: "2026-06-01",
    severity: null,
    note: null,
    moderationStatus: "visible",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("IncidentReports", () => {
  it("shows a sign-in link and NO form when signed out", () => {
    renderWithQuery(<IncidentReports listingId="listing-1" incidents={[]} viewerId={null} />);

    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Report an incident" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit report/i })).not.toBeInTheDocument();
  });

  it("gates the submission form behind a modal trigger when signed in", () => {
    renderWithQuery(<IncidentReports listingId="listing-1" incidents={[]} viewerId="user-1" />);

    // The form is not expanded on the page — only the trigger button is shown.
    expect(screen.getByRole("button", { name: /Report an incident/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit report/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("opens the report form in a modal when the trigger is clicked", () => {
    renderWithQuery(<IncidentReports listingId="listing-1" incidents={[]} viewerId="user-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Report an incident/i }));

    expect(screen.getByRole("form", { name: "Report an incident" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit report/i })).toBeInTheDocument();
  });

  it("lists incidents most-recent-first with date + severity + note", () => {
    renderWithQuery(
      <IncidentReports
        listingId="listing-1"
        incidents={[incident({ severity: "severe", note: "Sick for a day" })]}
        viewerId={null}
      />
    );

    expect(screen.getByText("Jun 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Severe")).toBeInTheDocument();
    expect(screen.getByText("Sick for a day")).toBeInTheDocument();
  });

  it("invalidates the incident list query after a successful submit", async () => {
    const queryClient = renderWithQuery(
      <IncidentReports listingId="listing-1" incidents={[]} viewerId="user-1" />
    );
    // Seed a cached list so we can observe it being invalidated.
    queryClient.setQueryData(incidentsQueryKey("listing-1"), []);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: /Report an incident/i }));
    fireEvent.change(screen.getByLabelText(/Date it happened/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Submit report/i }));

    await waitFor(() => {
      expect(submitIncidentMock).toHaveBeenCalledTimes(1);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: incidentsQueryKey("listing-1"),
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Incident reported");
    });
  });

  it("shows an error toast when the submit fails", async () => {
    submitIncidentMock.mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(<IncidentReports listingId="listing-1" incidents={[]} viewerId="user-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Report an incident/i }));
    fireEvent.change(screen.getByLabelText(/Date it happened/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Submit report/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  describe("owner-only edit/retract controls (#32)", () => {
    it("shows Edit/Retract only on the viewer's OWN incident", () => {
      renderWithQuery(
        <IncidentReports
          listingId="listing-1"
          incidents={[
            incident({ id: "own", userId: "user-1" }),
            incident({ id: "other", userId: "user-2", occurredOn: "2026-05-01" }),
          ]}
          viewerId="user-1"
        />
      );
      // Exactly one Edit + one Retract — for the owned incident only.
      expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Retract" })).toHaveLength(1);
    });

    it("shows NO edit/retract controls for an anonymous viewer", () => {
      renderWithQuery(
        <IncidentReports
          listingId="listing-1"
          incidents={[incident({ id: "own", userId: "user-1" })]}
          viewerId={null}
        />
      );
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retract" })).not.toBeInTheDocument();
    });

    it("edits an own incident and invalidates the list", async () => {
      const queryClient = renderWithQuery(
        <IncidentReports
          listingId="listing-1"
          incidents={[incident({ id: "own", userId: "user-1" })]}
          viewerId="user-1"
        />
      );
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      // Scope to the inline edit form — the report form below also has a date.
      const editForm = screen.getByRole("form", { name: "Edit incident" });
      fireEvent.change(within(editForm).getByLabelText(/Date it happened/i), {
        target: { value: "2026-06-15" },
      });
      fireEvent.click(within(editForm).getByRole("button", { name: /Save changes/i }));

      await waitFor(() => {
        expect(updateIncidentMock).toHaveBeenCalledTimes(1);
      });
      expect(updateIncidentMock).toHaveBeenCalledWith({
        data: { id: "own", occurredOn: "2026-06-15", severity: undefined, note: undefined },
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: incidentsQueryKey("listing-1") });
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Report updated");
      });
    });

    it("requires confirmation before retracting, then invalidates the list", async () => {
      const queryClient = renderWithQuery(
        <IncidentReports
          listingId="listing-1"
          incidents={[incident({ id: "own", userId: "user-1" })]}
          viewerId="user-1"
        />
      );
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      // First click only reveals the confirm step — no delete yet.
      fireEvent.click(screen.getByRole("button", { name: "Retract" }));
      expect(removeIncidentMock).not.toHaveBeenCalled();
      expect(screen.getByText(/Retract this report\?/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Yes, retract/i }));

      await waitFor(() => {
        expect(removeIncidentMock).toHaveBeenCalledTimes(1);
      });
      expect(removeIncidentMock).toHaveBeenCalledWith({ data: { id: "own" } });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: incidentsQueryKey("listing-1") });
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Report retracted");
      });
    });
  });
});
