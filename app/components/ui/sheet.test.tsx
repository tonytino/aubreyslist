import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";

describe("Sheet", () => {
  it("renders the trigger and hides content until opened", () => {
    render(
      <Sheet>
        <SheetTrigger>Open filters</SheetTrigger>
        <SheetContent>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the list</SheetDescription>
        </SheetContent>
      </Sheet>
    );

    expect(screen.getByRole("button", { name: "Open filters" })).toBeInTheDocument();
    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
  });

  it("opens on trigger click and shows the title, description, and content", () => {
    render(
      <Sheet>
        <SheetTrigger>Open filters</SheetTrigger>
        <SheetContent>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the list</SheetDescription>
          <p>Body content</p>
        </SheetContent>
      </Sheet>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open filters" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("Narrow the list")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("unmounts its content when closed (not force-mounted)", async () => {
    // Regression guard for the browse filter: the Sheet must NOT force-mount, so
    // a closed mobile Sheet adds nothing to the DOM. That mutual exclusivity is
    // what keeps exactly one "Dedicated fryer"/"Celiac-safe" checkbox present at
    // the desktop viewport, which the browse e2e selectors depend on.
    render(
      <Sheet>
        <SheetTrigger>Open filters</SheetTrigger>
        <SheetContent>
          <SheetTitle>Filters</SheetTitle>
          <p>Body content</p>
        </SheetContent>
      </Sheet>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open filters" }));
    expect(screen.getByText("Body content")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("Body content")).not.toBeInTheDocument());
  });

  it("renders a built-in close button", () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
