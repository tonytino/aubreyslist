import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

// Radix DropdownMenu drives open/close through pointer-capture and scrolls the
// focused item into view — both unimplemented in jsdom. Stub them so the menu
// opens on a fired pointer/keyboard event.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

describe("DropdownMenu", () => {
  it("renders the trigger and hides items until opened", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Profile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
  });

  it("opens on trigger click and renders its items", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuItem>Settings</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const trigger = screen.getByRole("button", { name: "Menu" });
    // Radix's pointer-open path relies on real PointerEvents (button/pointerType)
    // that jsdom's fireEvent can't fully synthesize, so open via the keyboard
    // path instead — focus the trigger and press Enter, which Radix treats as a
    // genuine open request.
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
  });

  it("bakes touch ergonomics into items and panel on coarse pointers", () => {
    // jsdom can't evaluate `(pointer: coarse)` media queries, so assert the
    // Tailwind `pointer-coarse:` utilities are present as a regression guard:
    // >= 44px item hit height (min-h-11), larger text, and panel padding are
    // what make both header menus usable on mobile (owner feedback).
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Profile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const trigger = screen.getByRole("button", { name: "Menu" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });

    const item = screen.getByRole("menuitem", { name: "Profile" });
    expect(item.className).toContain("pointer-coarse:min-h-11");
    expect(item.className).toContain("pointer-coarse:text-base");
    expect(item.className).toContain("pointer-coarse:gap-3");
    expect(screen.getByRole("menu").className).toContain("pointer-coarse:p-1.5");
  });
});
