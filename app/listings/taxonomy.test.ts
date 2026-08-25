import { describe, expect, it } from "vitest";
import { claimAttribute } from "~/db/schema";
import { CLAIM_ATTRIBUTES } from "./taxonomy";

describe("GF taxonomy constant", () => {
  it("declares the FIXED v1 taxonomy in order", () => {
    expect(CLAIM_ATTRIBUTES).toEqual([
      "celiac_safe",
      "dedicated_fryer",
      "dedicated_gf_menu",
      "off_menu_gf_on_request",
      "gf_substitutes",
    ]);
    // Guard against accidental drift in the taxonomy size.
    expect(CLAIM_ATTRIBUTES).toHaveLength(5);
  });

  it("is the single source of truth for the claim_attribute pgEnum", () => {
    // The DB enum must derive from (and stay identical to) this constant, so a
    // change here can never silently diverge from the persisted enum values.
    expect(claimAttribute.enumValues).toEqual([...CLAIM_ATTRIBUTES]);
  });
});
