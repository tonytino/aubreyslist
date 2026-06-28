import { describe, expect, it } from "vitest";
import {
  ADMIN_SECTION_ORDER,
  type AdminSectionId,
  canViewSection,
  visibleSections,
} from "./sections";

describe("canViewSection", () => {
  it("lets admins see every section", () => {
    for (const section of ADMIN_SECTION_ORDER) {
      expect(canViewSection("admin", section)).toBe(true);
    }
  });

  it("lets moderators see only the moderation queue", () => {
    expect(canViewSection("moderator", "moderation-queue")).toBe(true);
    expect(canViewSection("moderator", "roles")).toBe(false);
    expect(canViewSection("moderator", "settings")).toBe(false);
  });

  it("lets a plain user see nothing", () => {
    for (const section of ADMIN_SECTION_ORDER) {
      expect(canViewSection("user", section)).toBe(false);
    }
  });
});

describe("visibleSections", () => {
  it("gives admins all sections in the canonical order", () => {
    expect(visibleSections("admin")).toEqual(ADMIN_SECTION_ORDER);
  });

  it("gives moderators only the moderation queue", () => {
    expect(visibleSections("moderator")).toEqual<AdminSectionId[]>(["moderation-queue"]);
  });

  it("gives a plain user no sections", () => {
    expect(visibleSections("user")).toEqual([]);
  });
});
