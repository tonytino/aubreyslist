import "@testing-library/jest-dom/vitest";

// jsdom ships no ResizeObserver, which Radix's positioned popper primitives
// (tooltip, popover, …) touch as soon as their content is open. Provide a no-op
// stub so component tests can render an open tooltip/popover instead of crashing.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
