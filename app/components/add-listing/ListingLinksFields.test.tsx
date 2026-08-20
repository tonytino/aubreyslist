import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LINK_KIND_METADATA, LINK_KINDS } from "~/listings/links";
import { emptyLinkFieldValues, ListingLinksFields } from "./ListingLinksFields";

/**
 * ListingLinksFields tests: the five static per-kind URL inputs the
 * intake wizard and the edit-links dialog share. Values are controlled by the
 * parent; each field is labeled and carries its hint via aria-describedby.
 */

describe("ListingLinksFields", () => {
  it("renders one labeled URL input per link kind (five, all optional)", () => {
    render(<ListingLinksFields values={emptyLinkFieldValues()} onChange={vi.fn()} />);

    for (const kind of LINK_KINDS) {
      expect(
        screen.getByLabelText(LINK_KIND_METADATA[kind].label, { exact: true })
      ).toBeInTheDocument();
    }
    expect(screen.getAllByRole("textbox")).toHaveLength(LINK_KINDS.length);
  });

  it("shows each kind's hint, keeping the menu field's 'No uploads.' promise", () => {
    render(<ListingLinksFields values={emptyLinkFieldValues()} onChange={vi.fn()} />);

    for (const kind of LINK_KINDS) {
      expect(screen.getByText(LINK_KIND_METADATA[kind].hint)).toBeInTheDocument();
    }
    const menuField = screen.getByLabelText("Menu", { exact: true });
    expect(menuField).toHaveAccessibleDescription(/No uploads\./);
  });

  it("displays the controlled values and reports edits per kind", () => {
    const onChange = vi.fn();
    const values = {
      ...emptyLinkFieldValues(),
      menu: "https://example.com/menu",
    };
    render(<ListingLinksFields values={values} onChange={onChange} />);

    expect(screen.getByLabelText("Menu", { exact: true })).toHaveValue("https://example.com/menu");

    fireEvent.change(screen.getByLabelText("Website", { exact: true }), {
      target: { value: "https://example.com" },
    });
    expect(onChange).toHaveBeenCalledWith("website", "https://example.com");
  });

  it("emptyLinkFieldValues covers every kind with a blank string", () => {
    const values = emptyLinkFieldValues();
    expect(Object.keys(values).sort()).toEqual([...LINK_KINDS].sort());
    for (const kind of LINK_KINDS) {
      expect(values[kind]).toBe("");
    }
  });
});
