import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

// Radix Tabs activates triggers through the Roving Focus / pointer-capture
// pipeline, which calls Element.hasPointerCapture — unimplemented in jsdom.
// Stub it so a fireEvent click actually flips the active tab.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function Example() {
  return (
    <Tabs defaultValue="account">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="account">Account panel</TabsContent>
      <TabsContent value="password">Password panel</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders the triggers and the default panel", () => {
    render(<Example />);

    expect(screen.getByRole("tab", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Password" })).toBeInTheDocument();
    expect(screen.getByText("Account panel")).toBeInTheDocument();
    expect(screen.queryByText("Password panel")).not.toBeInTheDocument();
  });

  it("switches panels when another trigger is clicked", () => {
    render(<Example />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Password" }));

    expect(screen.getByText("Password panel")).toBeInTheDocument();
    expect(screen.queryByText("Account panel")).not.toBeInTheDocument();
  });
});
