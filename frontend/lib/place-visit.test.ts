import { describe, expect, it } from "vitest";
import { nextPlaceVisit } from "./place-visit";

describe("place visit", () => {
  it("records only the immediately previous place", () => {
    expect(nextPlaceVisit(null, "/location/garage", "/location/cabinet")).toEqual({
      placeId: "garage",
      previousPlaceId: "cabinet",
    });
  });

  it("does not infer a place from an item, collection or edit screen", () => {
    for (const from of ["/item/drill", "/locations", "/location/cabinet/edit", "/"]) {
      expect(nextPlaceVisit(null, "/location/garage", from)?.previousPlaceId).toBeNull();
    }
  });

  it("clears when leaving places and replaces an earlier visit on return", () => {
    const visit = nextPlaceVisit(null, "/location/garage", "/location/cabinet");
    expect(nextPlaceVisit(visit, "/items", "/location/garage")).toBeNull();
    expect(nextPlaceVisit(visit, "/location/garage", "/items")?.previousPlaceId).toBeNull();
    expect(nextPlaceVisit(null, "/location/garage", "")?.previousPlaceId).toBeNull();
  });

  it("preserves the marker for same-place query/hash changes", () => {
    const visit = nextPlaceVisit(null, "/location/garage", "/location/cabinet");
    expect(nextPlaceVisit(visit, "/location/garage", "/location/garage")).toBe(visit);
  });
});
