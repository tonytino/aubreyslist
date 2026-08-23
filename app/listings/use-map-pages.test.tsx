import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMapExtraPages } from "./use-map-pages";

/**
 * The Map view's "Load more" accumulation state. Load-bearing behaviours: the
 * count only ever grows for one result-set identity, and any identity change
 * (the route passes the base page's serialized query key, so filters, sort,
 * search, radius, quick chips, coords, an area search, and the base page all
 * change it) resets the accumulation to zero in the same render.
 */
describe("useMapExtraPages", () => {
  it("starts at zero and appends one page per loadNextPage call", () => {
    const { result } = renderHook(() => useMapExtraPages("key-a"));
    expect(result.current.extraPages).toBe(0);
    act(() => result.current.loadNextPage());
    expect(result.current.extraPages).toBe(1);
    act(() => result.current.loadNextPage());
    expect(result.current.extraPages).toBe(2);
  });

  it("resets to zero the moment the result-set key changes (filter/sort/area change)", () => {
    const { result, rerender } = renderHook(({ key }) => useMapExtraPages(key), {
      initialProps: { key: "key-a" },
    });
    act(() => result.current.loadNextPage());
    act(() => result.current.loadNextPage());
    expect(result.current.extraPages).toBe(2);
    rerender({ key: "key-b" });
    // Derived during render — no effect tick where stale pages could flash.
    expect(result.current.extraPages).toBe(0);
  });

  it("starts a fresh count for the new result set after a reset", () => {
    const { result, rerender } = renderHook(({ key }) => useMapExtraPages(key), {
      initialProps: { key: "key-a" },
    });
    act(() => result.current.loadNextPage());
    rerender({ key: "key-b" });
    act(() => result.current.loadNextPage());
    expect(result.current.extraPages).toBe(1);
    // Returning to the old key is a new accumulation, not a resurrected one:
    // a fresh result set always starts at its base page.
    rerender({ key: "key-a" });
    expect(result.current.extraPages).toBe(0);
  });
});
