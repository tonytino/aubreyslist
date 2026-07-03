import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { WheatStrike } from "./WheatStrike";

describe("WheatStrike", () => {
  it("renders an <svg> at the lucide 24×24 box", () => {
    const { container } = render(<WheatStrike />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
  });

  it("draws the wheat + diagonal-strike CUTOUT (a mask with a strike line)", () => {
    const { container } = render(<WheatStrike />);
    // The brand glyph is a masked cutout: a <mask> holding a diagonal <line>, and
    // the wheat paths grouped under `mask="url(#…)"`. This is what makes it read
    // as "gluten struck out" and keeps it distinct from the plain lucide glyphs.
    const mask = container.querySelector("mask");
    expect(mask).not.toBeNull();
    expect(mask?.querySelector("line")).not.toBeNull();
    const masked = container.querySelector("g[mask]");
    expect(masked).not.toBeNull();
    expect(masked?.querySelectorAll("path").length).toBeGreaterThan(1);
  });

  it("forwards className and aria-hidden like a lucide icon", () => {
    const { container } = render(<WheatStrike className="size-4 shrink-0" aria-hidden="true" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("size-4", "shrink-0");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("honors a custom strokeWidth", () => {
    const { container } = render(<WheatStrike strokeWidth={2.25} />);
    expect(container.querySelector("svg")).toHaveAttribute("stroke-width", "2.25");
  });

  it("forwards a ref to the <svg> element", () => {
    const ref = createRef<SVGSVGElement>();
    render(<WheatStrike ref={ref} />);
    expect(ref.current).toBeInstanceOf(SVGSVGElement);
  });

  it("gives each instance a UNIQUE mask id so multiple glyphs on a page don't collide", () => {
    const { container } = render(
      <>
        <WheatStrike />
        <WheatStrike />
      </>
    );
    const ids = Array.from(container.querySelectorAll("mask")).map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
