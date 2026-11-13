// How routes show up on the rider map: stop pin colors, which stops and buses
// pass the rider's "Now watching" route filter (one or more routes; an empty
// list means All routes), and a default color for new routes in Org Setup.

type RouteLike = { id: string; stopIds: string[]; color?: string };

export type StopMarkerStyle = {
  /** Main pin color (ring, center dot, stem, label accent). */
  color: string;
  /** Extra route dots for a stop on several routes; empty otherwise. */
  dots: string[];
  /** False when the rider is watching only routes this stop isn't on. */
  visible: boolean;
};

/** Most route dots drawn on one pin; the rest are summarized as "+N". */
export const MAX_STOP_DOTS = 3;

function routeColor(route: RouteLike, orgColor: string): string {
  return route.color ?? orgColor;
}

/**
 * The watched route ids in org route order; empty means "All routes". Ids of
 * deleted routes are dropped, filtering is off for orgs with one route, and
 * watching every route is the same as All routes.
 */
export function resolveWatchedRouteIds(
  storedIds: readonly string[] | null | undefined,
  routes: RouteLike[],
): string[] {
  if (!storedIds || storedIds.length === 0 || routes.length < 2) return [];
  const watched = routes.filter((r) => storedIds.includes(r.id)).map((r) => r.id);
  return watched.length === routes.length ? [] : watched;
}

/**
 * Reads the saved filter. Older app versions saved a single route id as a
 * plain string; newer ones save a JSON array.
 */
export function parseStoredWatchedRouteIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // Not JSON: a single id from an older version.
  }
  return [raw];
}

/** Adds or removes one route from the watched list. */
export function toggleWatchedRoute(watchedIds: readonly string[], routeId: string): string[] {
  return watchedIds.includes(routeId)
    ? watchedIds.filter((id) => id !== routeId)
    : [...watchedIds, routeId];
}

/** Pill text: "All routes", "North Loop", "North Loop, South Loop" or "North Loop +2". */
export function watchedRoutesLabel(watchedRoutes: { name: string }[]): string {
  if (watchedRoutes.length === 0) return 'All routes';
  if (watchedRoutes.length === 1) return watchedRoutes[0].name;
  if (watchedRoutes.length === 2) return `${watchedRoutes[0].name}, ${watchedRoutes[1].name}`;
  return `${watchedRoutes[0].name} +${watchedRoutes.length - 1}`;
}

/**
 * Pin style for a stop. Only the routes being watched count (all of them for
 * All routes):
 * - on none of them: hidden;
 * - on no route at all: hidden too once the org has routes — drivers only
 *   see their own route's stops, so nobody would serve a request there (e.g.
 *   a stop left behind when its route was deleted). In an org with no
 *   routes every stop is shown in the org color;
 * - on one (or several sharing a color): that route's color;
 * - on several: a neutral pin with one dot per route color.
 */
export function getStopMarkerStyle(
  stopId: string,
  routes: RouteLike[],
  orgColor: string,
  neutralColor: string,
  watchedRouteIds: readonly string[],
): StopMarkerStyle {
  const onRoutes = routes.filter((r) => r.stopIds.includes(stopId));
  if (onRoutes.length === 0) return { color: orgColor, dots: [], visible: routes.length === 0 };

  const counted = watchedRouteIds.length > 0
    ? onRoutes.filter((r) => watchedRouteIds.includes(r.id))
    : onRoutes;
  if (counted.length === 0) return { color: orgColor, dots: [], visible: false };

  const colors = Array.from(new Set(counted.map((r) => routeColor(r, orgColor))));
  if (colors.length === 1) return { color: colors[0], dots: [], visible: true };
  return { color: neutralColor, dots: colors, visible: true };
}

/**
 * Whether a bus is shown under the rider's route filter. Buses with no route
 * stay visible (they could serve any stop), and so does the rider's own ride.
 */
export function isBusShown(
  busRouteId: string | null | undefined,
  watchedRouteIds: readonly string[],
  isRidersBus: boolean,
): boolean {
  if (watchedRouteIds.length === 0 || isRidersBus || !busRouteId) return true;
  return watchedRouteIds.includes(busRouteId);
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

/**
 * Stops that are on none of the given routes. Once an org has routes these
 * can't be requested (no driver sees them), so the admin is warned before a
 * route deletion leaves any behind.
 */
export function stopsOnNoRoute<S extends { id: string }>(stops: S[], routes: RouteLike[]): S[] {
  return stops.filter((s) => !routes.some((r) => r.stopIds.includes(s.id)));
}
