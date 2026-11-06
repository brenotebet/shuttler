// src/utils/routePath.ts
// Road-following paths for routes. The path for a route's whole loop is
// fetched once when an admin saves the route (Org Setup) and stored on the
// route as an encoded polyline, so riders never pay a per-view API call.

import * as polyline from '@mapbox/polyline';

export type LatLng = { latitude: number; longitude: number };

/**
 * Identifies the stop sequence a stored path was computed for. If a stop is
 * moved, added, removed, or reordered, the key changes and the path is
 * refetched on the next save. Rounded to ~1 m so float noise doesn't count.
 */
export function routePathKey(routeStops: LatLng[]): string {
  return routeStops.map((s) => `${s.latitude.toFixed(5)},${s.longitude.toFixed(5)}`).join('|');
}

export function encodePath(coords: LatLng[]): string {
  return polyline.encode(coords.map((c) => [c.latitude, c.longitude]));
}

export function decodePath(encoded: string | null | undefined): LatLng[] {
  if (!encoded) return [];
  try {
    return (polyline.decode(encoded) as [number, number][]).map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
  } catch {
    return [];
  }
}

/** Default distance within which a GPS fix is pulled onto the route's road. */
export const SNAP_MAX_METERS = 35;

/**
 * Projects `point` onto the nearest segment of `path`. Returns the projected
 * point if it's within `maxMeters`, otherwise the original point (the bus is
 * off route — a detour — so don't pretend otherwise).
 */
export function snapToPath(point: LatLng, path: LatLng[], maxMeters = SNAP_MAX_METERS): LatLng {
  if (path.length < 2) return point;
  const R = 6371000;
  const rad = Math.PI / 180;
  const cosLat = Math.cos(point.latitude * rad);
  // Local equirectangular projection around the point (metres).
  const toXY = (p: LatLng) => ({
    x: (p.longitude - point.longitude) * rad * R * cosLat,
    y: (p.latitude - point.latitude) * rad * R,
  });
  let best: { d: number; x: number; y: number } | null = null;
  let prev = toXY(path[0]);
  for (let i = 1; i < path.length; i++) {
    const cur = toXY(path[i]);
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(prev.x * dx + prev.y * dy) / lenSq));
    const px = prev.x + t * dx;
    const py = prev.y + t * dy;
    const d = Math.hypot(px, py);
    if (!best || d < best.d) best = { d, x: px, y: py };
    prev = cur;
  }
  if (!best || best.d > maxMeters) return point;
  return {
    latitude: point.latitude + best.y / (rad * R),
    longitude: point.longitude + best.x / (rad * R * cosLat),
  };
}
