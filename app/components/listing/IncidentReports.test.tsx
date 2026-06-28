import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Incident } from "~/db/schema";

/**
 * Component tests for the "Incident reports" body (#30): the signed-out gate and
 * the list-refresh-after-submit path. `submitIncident` is a server function, so
 * we mock the server-only module — the test only needs to assert the component's
 * behaviour (gate + query invalidation), not the real DB write.
 */
const submitIncidentMock = vi.fn((_args: unknown) => Promise.resolve({} as Incident));
vi.mock("~/server/incidents/incidents.fn", () => ({
  submitIncident: (args: unknown) => submitIncidentMock(args),
}));

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
    renderWithQuery(<IncidentReports listingId="listing-1" incidents={[]} isSignedIn={false} />);

    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Report an incident" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit report/i })).not.toBeInTheDocument();
  });

  it("shows the submission form when signed in", () => {
    renderWithQuery(<IncidentReports listingId="listing-1" incidents={[]} isSignedIn={true} />);

    expect(screen.getByRole("button", { name: /Submit report/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("lists incidents most-recent-first with date + severity + note", () => {
    renderWithQuery(
      <IncidentReports
        listingId="listing-1"
        incidents={[incident({ severity: "severe", note: "Sick for a day" })]}
        isSignedIn={false}
      />
    );

    expect(screen.getByText("Jun 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Severe")).toBeInTheDocument();
    expect(screen.getByText("Sick for a day")).toBeInTheDocument();
  });

  it("invalidates the incident list query after a successful submit", async () => {
    const queryClient = renderWithQuery(
      <IncidentReports listingId="listing-1" incidents={[]} isSignedIn={true} />
    );
    // Seed a cached list so we can observe it being invalidated.
    queryClient.setQueryData(incidentsQueryKey("listing-1"), []);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

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
  });
});
