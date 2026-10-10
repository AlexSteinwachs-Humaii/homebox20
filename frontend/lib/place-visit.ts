export type PlaceVisit = {
  placeId: string;
  previousPlaceId: string | null;
} | null;

function placeId(path: string) {
  return /^\/location\/([^/]+)\/?$/.exec(path)?.[1] ?? null;
}

// A visit is one arrival at a place, not a favorite or a browsing history.
export function nextPlaceVisit(current: PlaceVisit, toPath: string, fromPath: string): PlaceVisit {
  const to = placeId(toPath);
  if (!to) return null;
  const from = placeId(fromPath);
  // Query/hash changes within the same room do not start another visit.
  if (to === from) return current;
  return { placeId: to, previousPlaceId: from };
}
