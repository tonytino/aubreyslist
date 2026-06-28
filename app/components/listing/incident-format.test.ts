import { describe, expect, it } from "vitest";
import { formatIncidentDate, formatSeverity, relativeIncidentDate } from "./incident-format";

describe("formatIncidentDate", () => {
  it("formats a calendar date in UTC with no timezone drift", () => {
    expect(formatIncidentDate("2026-06-01")).toBe("Jun 1, 2026");
  });

  it("returns the raw input for an unparseable date", () => {
    expect(formatIncidentDate("nope")).toBe("nope");
  });
});

describe("relativeIncidentDate", () => {
  const now = new Date("2026-06-28T12:00:00Z");

  it("reads 'today' for the same day", () => {
    expect(relativeIncidentDate("2026-06-28", now)).toBe("today");
  });

  it("reads 'yesterday' for one day ago", () => {
    expect(relativeIncidentDate("2026-06-27", now)).toBe("yesterday");
  });

  it("reads days for under a week", () => {
    expect(relativeIncidentDate("2026-06-25", now)).toBe("3 days ago");
  });

  it("reads weeks for under a month", () => {
    expect(relativeIncidentDate("2026-06-10", now)).toBe("2 weeks ago");
  });

  it("reads months for older dates", () => {
    expect(relativeIncidentDate("2026-03-01", now)).toBe("3 months ago");
  });
});

describe("formatSeverity", () => {
  it("capitalises the severity label", () => {
    expect(formatSeverity("mild")).toBe("Mild");
    expect(formatSeverity("severe")).toBe("Severe");
  });
});
