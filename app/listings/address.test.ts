import { describe, expect, it } from "vitest";
import { cityFromAddress } from "./address";

/**
 * The browse card's location line derives its city here. A miss must stay
 * `null` so no surface can fall back to the full street address.
 */
describe("cityFromAddress", () => {
  it("reads the city from a Google-formatted Denver address", () => {
    expect(cityFromAddress("3331 N Downing St, Denver, CO 80205")).toBe("Denver");
  });

  it("reads a multi-word suburb", () => {
    expect(cityFromAddress("5910 S University Blvd, Greenwood Village, CO 80121")).toBe(
      "Greenwood Village"
    );
  });

  it("reads a city from an address with no ZIP", () => {
    expect(cityFromAddress("1 Test St, Denver, CO")).toBe("Denver");
  });

  it("reads a ZIP+4 address", () => {
    expect(cityFromAddress("2364 15th St, Denver, CO 80202-1234")).toBe("Denver");
  });

  it("ignores a unit segment before the city", () => {
    expect(cityFromAddress("1600 Pearl St, Suite 200, Boulder, CO 80302")).toBe("Boulder");
  });

  it("returns null for a free-form manual address", () => {
    expect(cityFromAddress("The red barn on Highway 36")).toBeNull();
  });

  it("returns null for an address with no city segment", () => {
    expect(cityFromAddress("Denver, CO 80205")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(cityFromAddress("")).toBeNull();
  });
});
