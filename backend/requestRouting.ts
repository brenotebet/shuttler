// backend/requestRouting.ts
// Who should hear about a new stop request. Mirrors requestMatchesBusRoute in
// src/utils/routeDisplay.ts (the app can't share code with the backend).

export type BusState = { online?: unknown; routeId?: unknown };

/**
 * Whether a user should get the "New Stop Request" push. Admins always do.
 * A driver does unless their bus is online on a *different* route than the
 * request's — at a stop shared by several routes (an airport terminal) only
 * the requested route's drivers should be alerted. Offline drivers keep
 * getting it, as before (they may be about to start a shift).
 */
export function shouldNotifyOfStopRequest(
  role: unknown,
  requestRouteId: unknown,
  bus: BusState | undefined,
): boolean {
  if (role === 'admin') return true;
  if (role !== 'driver') return false;
  if (typeof requestRouteId !== 'string' || !requestRouteId) return true;
  if (!bus || bus.online !== true) return true;
  return typeof bus.routeId !== 'string' || !bus.routeId || bus.routeId === requestRouteId;
}
