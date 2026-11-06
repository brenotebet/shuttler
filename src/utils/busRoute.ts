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

// ---- Progress along the stored road path ----
//
// The straight-line method above guesses which leg a bus is on from straight
// chords between stops. Where a chord cuts across campus (McKendree's
// MPCC → Performance Center leg), a bus driving elsewhere can be matched to
// it. With the route's road path stored (see routePath.ts), progress is
// measured along the actual road instead.

/** A bus farther than this from the road path is treated as off route. */
export const OFF_PATH_METERS = 60;
/** Path segments within this much of the closest one count as tied. */
const TIE_METERS = 15;

function bearingXY(dx: number, dy: number): number {
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Like getBusRouteProgress, but locates the bus and every stop along `path`
 * (the route's full loop, starting at the first stop). Where the road passes
 * the same place twice (out-and-back streets), `headingDeg` picks the
 * direction the bus is actually travelling. Returns null if the path is
 * unusable or the bus is more than OFF_PATH_METERS from it — callers then
 * fall back to getBusRouteProgress.
 */
export function getBusRouteProgressOnPath(
  routeStops: RouteStopPoint[],
  path: { latitude: number; longitude: number }[],
  bus: { latitude: number; longitude: number },
  headingDeg: number | null = null,
  count = 3,
): BusRouteProgress | null {
  const n = routeStops.length;
  if (n < 2 || path.length < 2) return null;

  const refLat = bus.latitude;
  const pts = path.map((p) => toXY(p.latitude, p.longitude, refLat));
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }

  // Project point p onto segment k: distance to it and distance along path.
  const project = (p: { x: number; y: number }, k: number) => {
    const a = pts[k];
    const b = pts[k + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    return { d: Math.hypot(p.x - px, p.y - py), s: cum[k] + t * Math.sqrt(lenSq), bearing: bearingXY(dx, dy) };
  };

  // Stops along the path, in route order: each is searched for from the
  // previous stop onward, so a road that passes a stop twice still places it
  // at the right visit.
  const stopS: number[] = [];
  let fromSeg = 0;
  for (const st of routeStops) {
    const p = toXY(st.latitude, st.longitude, refLat);
    let best: { d: number; s: number; k: number } | null = null;
    for (let k = fromSeg; k < pts.length - 1; k++) {
      const r = project(p, k);
      if (!best || r.d < best.d) best = { d: r.d, s: r.s, k };
    }
    if (!best || best.d > OFF_PATH_METERS) return null; // path doesn't match these stops
    stopS.push(best.s);
    fromSeg = best.k;
  }

  // The bus on the path, using its heading to break ties on shared roads.
  const p = toXY(bus.latitude, bus.longitude, refLat);
  const cands: { d: number; s: number; bearing: number }[] = [];
  for (let k = 0; k < pts.length - 1; k++) cands.push(project(p, k));
  const minD = Math.min(...cands.map((c) => c.d));
  if (minD > OFF_PATH_METERS) return null;
  const tied = cands.filter((c) => c.d <= minD + TIE_METERS);
  let chosen = tied.reduce((a, c) => (c.d < a.d ? c : a));
  if (headingDeg !== null) {
    const aligned = tied.filter((c) => angleDiff(c.bearing, headingDeg) < 90);
    if (aligned.length) chosen = aligned.reduce((a, c) => (c.d < a.d ? c : a));
  }
  const busS = chosen.s;

  // At a stop? Same rule as the straight-line method.
  let atIdx = -1;
  let atDist = Infinity;
  routeStops.forEach((st, i) => {
    const q = toXY(st.latitude, st.longitude, refLat);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d <= AT_STOP_METERS && d < atDist) { atDist = d; atIdx = i; }
  });

  let nextIdx: number;
  if (atIdx >= 0) {
    nextIdx = (atIdx + 1) % n;
  } else {
    nextIdx = stopS.findIndex((s) => s > busS);
    if (nextIdx < 0) nextIdx = 0; // past the last stop: heading back to the first
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

/** Road-path progress when possible, otherwise the straight-line estimate. */
export function getBusProgress(
  routeStops: RouteStopPoint[],
  path: { latitude: number; longitude: number }[] | null | undefined,
  bus: { latitude: number; longitude: number },
  headingDeg: number | null = null,
  count = 3,
): BusRouteProgress | null {
  return (path && getBusRouteProgressOnPath(routeStops, path, bus, headingDeg, count))
    || getBusRouteProgress(routeStops, bus, count);
}
