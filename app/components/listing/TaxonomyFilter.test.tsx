import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { claimAttributes } from "~/db/schema";
import { claimAttributeLabel } from "~/trust/summary";
import { TaxonomyFilter } from "./TaxonomyFilter";

/**
 * Tests for the GF taxonomy filter UI (#35).
 *
 * Covers: it renders the full fixed taxonomy as labeled checkboxes, reflects the
 * selected set via the native checked state (not colour), calls back on toggle,
 * and only shows the "Clear" control when something is selected. The component is
 * presentational (URL state lives in the route), so we assert the callbacks
 * rather than navigation.
 */

describe("TaxonomyFilter", () => {
  it("exposes the legend as the fieldset's accessible group name", () => {
    render(<TaxonomyFilter selected={[]} onToggle={() => {}} onClear={() => {}} />);

    // The <legend> must be the fieldset's caption (its first child) so AT
    // announces it as the group name. getByRole("group", { name }) resolves the
    // name from the legend — this fails if the legend isn't a recognized caption.
    expect(
      screen.getByRole("group", { name: "Filter by gluten-free attributes" })
    ).toBeInTheDocument();
  });

  it("renders a labeled checkbox for every taxonomy attribute", () => {
    render(<TaxonomyFilter selected={[]} onToggle={() => {}} onClear={() => {}} />);

    for (const attribute of claimAttributes) {
      const checkbox = screen.getByRole("checkbox", { name: claimAttributeLabel(attribute) });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    }
  });

  it("reflects the selected set via the checked state (not colour)", () => {
    render(
      <TaxonomyFilter selected={["dedicated_fryer"]} onToggle={() => {}} onClear={() => {}} />
    );

    expect(
      screen.getByRole("checkbox", { name: claimAttributeLabel("dedicated_fryer") })
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: claimAttributeLabel("gf_substitutes") })
    ).not.toBeChecked();
  });

  it("calls onToggle with the attribute when a checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(<TaxonomyFilter selected={[]} onToggle={onToggle} onClear={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: claimAttributeLabel("dedicated_fryer") }));

    expect(onToggle).toHaveBeenCalledWith("dedicated_fryer");
  });

  it("hides the Clear control when nothing is selected", () => {
    render(<TaxonomyFilter selected={[]} onToggle={() => {}} onClear={() => {}} />);
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });

  it("shows a Clear control with the count and calls onClear", async () => {
    const onClear = vi.fn();
    render(
      <TaxonomyFilter
        selected={["dedicated_fryer", "gf_substitutes"]}
        onToggle={() => {}}
        onClear={onClear}
      />
    );

    const clear = screen.getByRole("button", { name: /clear \(2\)/i });
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
