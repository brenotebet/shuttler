// Where a bus is along its route, for the rider-facing bus card.

export type RouteStopPoint = { id: string; name: string; latitude: number; longitude: number };

export type BusRouteProgress = {
  /** Stop the bus is currently at (within AT_STOP_METERS), if any. */
  atStop: string | null;
  /** The next stops in route order, soonest first (up to `count`). */
  upcoming: string[];
  /** 1-based position of the next stop in the route. */
  nextPosition: number;
  totalStops: number;
};

export const AT_STOP_METERS = 75;

// Equirectangular projection — accurate to well under a meter at campus scale,
// and much cheaper than haversine for the segment math below.
function toXY(lat: number, lng: number, refLat: number): { x: number; y: number } {
  const R = 6371000;
  const rad = Math.PI / 180;
  return { x: lng * rad * R * Math.cos(refLat * rad), y: lat * rad * R };
}

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Routes are loops: after the last stop the bus heads back to the first.
 * The bus is placed on the closest leg (stop i → stop i+1); the next stop is
 * the end of that leg. If it's sitting at a stop, the next stop is the one
 * after it. Returns null when the route has fewer than 2 stops.
 */
export function getBusRouteProgress(
  routeStops: RouteStopPoint[],
  bus: { latitude: number; longitude: number },
  count = 3,
): BusRouteProgress | null {
  const n = routeStops.length;
  if (n < 2) return null;

  const refLat = bus.latitude;
  const p = toXY(bus.latitude, bus.longitude, refLat);
  const pts = routeStops.map((s) => toXY(s.latitude, s.longitude, refLat));

  // At a stop?
  let atIdx = -1;
  let atDist = Infinity;
  pts.forEach((s, i) => {
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d <= AT_STOP_METERS && d < atDist) { atDist = d; atIdx = i; }
  });

  let nextIdx: number;
  if (atIdx >= 0) {
    nextIdx = (atIdx + 1) % n;
  } else {
    let bestLeg = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = distanceToSegment(p, pts[i], pts[(i + 1) % n]);
      if (d < bestDist) { bestDist = d; bestLeg = i; }
    }
    nextIdx = (bestLeg + 1) % n;
  }

  const upcoming: string[] = [];
  for (let k = 0; k < Math.min(count, n - (atIdx >= 0 ? 1 : 0)); k++) {
    upcoming.push(routeStops[(nextIdx + k) % n].name);
  }

  return {
    atStop: atIdx >= 0 ? routeStops[atIdx].name : null,
    upcoming,
    nextPosition: nextIdx + 1,
    totalStops: n,
  };
}
