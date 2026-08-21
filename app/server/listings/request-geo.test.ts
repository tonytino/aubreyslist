import { describe, expect, it } from "vitest";
import { coarseCoordsFromHeaders } from "./request-geo";

/**
 * The coarse request anchor. It decides the default sort's behaviour for
 * every visitor who has not granted location, so a bad parse must degrade to
 * "no anchor" rather than to a wrong point on the map.
 */

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("coarseCoordsFromHeaders", () => {
  it("reads the Vercel IP coordinates", () => {
    expect(
      coarseCoordsFromHeaders(
        headers({ "x-vercel-ip-latitude": "39.7392", "x-vercel-ip-longitude": "-104.9903" })
      )
    ).toEqual({ lat: 39.7392, lng: -104.9903 });
  });

  it("is undefined without the headers (local dev, a non-Vercel host)", () => {
    expect(coarseCoordsFromHeaders(headers({}))).toBeUndefined();
  });

  it("is undefined when only one half of the pair is present", () => {
    expect(coarseCoordsFromHeaders(headers({ "x-vercel-ip-latitude": "39.7392" }))).toBeUndefined();
    expect(
      coarseCoordsFromHeaders(headers({ "x-vercel-ip-longitude": "-104.9903" }))
    ).toBeUndefined();
  });

  it("never reads an empty header as 0,0", () => {
    // `Number("")` is 0, a valid coordinate in the Gulf of Guinea. Anchoring
    // every headerless visitor there would look like a working sort.
    expect(
      coarseCoordsFromHeaders(headers({ "x-vercel-ip-latitude": "", "x-vercel-ip-longitude": "" }))
    ).toBeUndefined();
  });

  it("rejects unparseable or out-of-range values", () => {
    expect(
      coarseCoordsFromHeaders(
        headers({ "x-vercel-ip-latitude": "north", "x-vercel-ip-longitude": "-104.9903" })
      )
    ).toBeUndefined();
    expect(
      coarseCoordsFromHeaders(
        headers({ "x-vercel-ip-latitude": "999", "x-vercel-ip-longitude": "-104.9903" })
      )
    ).toBeUndefined();
  });

  it("keeps a genuine 0,0 reading when the headers really say so", () => {
    expect(
      coarseCoordsFromHeaders(
        headers({ "x-vercel-ip-latitude": "0", "x-vercel-ip-longitude": "0" })
      )
    ).toEqual({ lat: 0, lng: 0 });
  });
});
