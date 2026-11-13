// How routes show up on the rider map: stop pin colors, which stops and buses
// pass the rider's "Now watching" route filter, and a default color for new
// routes in Org Setup.

type RouteLike = { id: string; stopIds: string[]; color?: string };

export type StopMarkerStyle = {
  /** Main pin color (ring, center dot, stem, label accent). */
  color: string;
  /** Extra route dots for a stop on several routes; empty otherwise. */
  dots: string[];
  /** False when the rider is watching a route this stop isn't on. */
  visible: boolean;
};

/** Most route dots drawn on one pin; the rest are summarized as "+N". */
export const MAX_STOP_DOTS = 3;

function routeColor(route: RouteLike, orgColor: string): string {
  return route.color ?? orgColor;
}

/**
 * The watched route id, or null for "All routes". A stored id is dropped when
 * the route no longer exists, and filtering is off for orgs with one route.
 */
export function resolveWatchedRouteId(
  storedId: string | null | undefined,
  routes: RouteLike[],
): string | null {
  if (!storedId || routes.length < 2) return null;
  return routes.some((r) => r.id === storedId) ? storedId : null;
}

/**
 * Pin style for a stop.
 * - Watching a route: stops on it take its color; stops on other routes are
 *   hidden; stops on no route stay visible in the org color.
 * - All routes: a stop on one route takes that route's color; a stop on
 *   several routes gets a neutral pin with one dot per route color; a stop on
 *   no route keeps the org color.
 */
export function getStopMarkerStyle(
  stopId: string,
  routes: RouteLike[],
  orgColor: string,
  neutralColor: string,
  watchedRouteId: string | null,
): StopMarkerStyle {
  const onRoutes = routes.filter((r) => r.stopIds.includes(stopId));
  if (onRoutes.length === 0) return { color: orgColor, dots: [], visible: true };

  if (watchedRouteId) {
    const watched = onRoutes.find((r) => r.id === watchedRouteId);
    return watched
      ? { color: routeColor(watched, orgColor), dots: [], visible: true }
      : { color: orgColor, dots: [], visible: false };
  }

  const colors = Array.from(new Set(onRoutes.map((r) => routeColor(r, orgColor))));
  if (colors.length === 1) return { color: colors[0], dots: [], visible: true };
  return { color: neutralColor, dots: colors, visible: true };
}

/**
 * Whether a bus is shown under the rider's route filter. Buses with no route
 * stay visible (they could serve any stop), and so does the rider's own ride.
 */
export function isBusShown(
  busRouteId: string | null | undefined,
  watchedRouteId: string | null,
  isRidersBus: boolean,
): boolean {
  if (!watchedRouteId || isRidersBus || !busRouteId) return true;
  return busRouteId === watchedRouteId;
}

/**
 * A color for a new route: the first palette color no existing route uses and
 * that differs from the org color, so routes are told apart on the map. When
 * every color is taken, cycles through the palette.
 */
export function pickDefaultRouteColor(
  existingRoutes: RouteLike[],
  palette: string[],
  orgColor: string,
): string {
  const taken = new Set(existingRoutes.map((r) => (r.color ?? orgColor).toLowerCase()));
  taken.add(orgColor.toLowerCase());
  const free = palette.find((c) => !taken.has(c.toLowerCase()));
  return free ?? palette[existingRoutes.length % palette.length];
}
