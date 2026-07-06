import { describe, expect, it } from "vitest";
import { placePhotoProxyUrl } from "./place-photo-url";

describe("placePhotoProxyUrl", () => {
  it("builds the proxy URL with the token encoded (slashes must not split the path)", () => {
    expect(placePhotoProxyUrl("places/ChIJ_abc/photos/res-1", 960)).toBe(
      "/api/places/photo?name=places%2FChIJ_abc%2Fphotos%2Fres-1&maxWidthPx=960"
    );
  });

  it("encodes characters that would otherwise smuggle extra query params", () => {
    const url = placePhotoProxyUrl("places/a&b/photos/c=d", 640);
    expect(url).toContain("name=places%2Fa%26b%2Fphotos%2Fc%3Dd");
    expect(url.endsWith("&maxWidthPx=640")).toBe(true);
  });
});
