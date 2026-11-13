// src/utils/busMotion.ts
// Math for animating live bus markers on the rider map so they glide
// continuously and turn smoothly instead of jumping between GPS updates.

export type LatLng = { latitude: number; longitude: number };

/** Below this movement the bus is treated as parked and keeps its heading. */
export const HEADING_MIN_MOVE_M = 10;

/** How far each update turns the marker toward the new direction (0–1). */
export const HEADING_SMOOTHING = 0.6;

/** Driver phones write about every 4 s (WRITE_MIN_INTERVAL_MS in LocationContext). */
export const DEFAULT_GLIDE_MS = 4000;
const MIN_GLIDE_MS = 800;
const MAX_GLIDE_MS = 6000;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingDegrees(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(a.latitude);
  const φ2 = toRad(b.latitude);
  const Δλ = toRad(b.longitude - a.longitude);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed difference from `from` to `to`, taking the short way round (−180…180]. */
export function shortestAngleDelta(from: number, to: number): number {
  let d = ((to - from) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Heading for the marker after a position update.
 * - Parked or GPS jitter (moved < HEADING_MIN_MOVE_M): keep the old heading,
 *   instead of the old behavior of snapping to 0° (north).
 * - First fix with no previous heading: point along the movement.
 * - Otherwise turn part of the way toward the new direction, the short way
 *   round, so one noisy fix can't spin the bus.
 */
export function nextHeading(prevHeading: number | null, from: LatLng | null, to: LatLng): number | null {
  if (!from || distanceMeters(from, to) < HEADING_MIN_MOVE_M) return prevHeading;
  const target = bearingDegrees(from, to);
  if (prevHeading === null) return target;
  const turned = prevHeading + shortestAngleDelta(prevHeading, target) * HEADING_SMOOTHING;
  return (turned % 360 + 360) % 360;
}

/** Updates further apart than this are a "catch-up" (see shouldJumpToPosition). */
export const MAX_GLIDE_GAP_MS = 12_000;
/** A catch-up that moved at least this far jumps instead of gliding. */
export const JUMP_MIN_DISTANCE_M = 50;

/**
 * Whether the marker should jump to the new position instead of gliding.
 * Glides are straight lines, which is fine between regular updates (a few
 * seconds and tens of meters apart). But after a long gap — the rider's app
 * was in the background, or their connection dropped — the last known
 * position can be minutes old, and a straight glide to the current one cuts
 * across buildings and lawns. A bus that barely moved (e.g. pulling away
 * after being parked, when no updates were written) still glides.
 */
export function shouldJumpToPosition(
  prevUpdateMs: number | null,
  nextUpdateMs: number,
  from: LatLng | null,
  to: LatLng,
): boolean {
  if (prevUpdateMs === null || !from) return false;
  return nextUpdateMs - prevUpdateMs > MAX_GLIDE_GAP_MS && distanceMeters(from, to) >= JUMP_MIN_DISTANCE_M;
}

/**
 * How long to glide to a new position: the real gap between this update and
 * the last one, so the bus arrives just as the next update lands and never
 * sits still in between. Clamped so a long gap doesn't crawl and a burst
 * doesn't teleport.
 */
export function glideDurationMs(prevUpdateMs: number | null, nextUpdateMs: number): number {
  if (prevUpdateMs === null || !(nextUpdateMs > prevUpdateMs)) return DEFAULT_GLIDE_MS;
  return Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, nextUpdateMs - prevUpdateMs));
}
