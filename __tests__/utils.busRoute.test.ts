import { getBusRouteProgress, RouteStopPoint } from '../src/utils/busRoute';

// Four stops roughly 500 m apart, laid out as a square loop.
const stops: RouteStopPoint[] = [
  { id: 'a', name: 'A', latitude: 38.6000, longitude: -89.8000 },
  { id: 'b', name: 'B', latitude: 38.6000, longitude: -89.7942 },
  { id: 'c', name: 'C', latitude: 38.6045, longitude: -89.7942 },
  { id: 'd', name: 'D', latitude: 38.6045, longitude: -89.8000 },
];

describe('getBusRouteProgress', () => {
  it('returns null for routes with fewer than 2 stops', () => {
    expect(getBusRouteProgress([stops[0]], { latitude: 38.6, longitude: -89.8 })).toBeNull();
  });

  it('treats a bus at a stop as being there, next is the following stop', () => {
    const r = getBusRouteProgress(stops, { latitude: 38.60001, longitude: -89.79421 })!;
    expect(r.atStop).toBe('B');
    expect(r.upcoming).toEqual(['C', 'D', 'A']);
    expect(r.nextPosition).toBe(3);
    expect(r.totalStops).toBe(4);
  });

  it('places a bus between stops on the right leg', () => {
    // Halfway along B → C.
    const r = getBusRouteProgress(stops, { latitude: 38.60225, longitude: -89.7942 })!;
    expect(r.atStop).toBeNull();
    expect(r.upcoming[0]).toBe('C');
  });

  it('wraps from the last stop back to the first', () => {
    // Halfway along D → A.
    const r = getBusRouteProgress(stops, { latitude: 38.60225, longitude: -89.8 })!;
    expect(r.upcoming).toEqual(['A', 'B', 'C']);
    expect(r.nextPosition).toBe(1);
  });

  it('never lists more stops than the route has besides the current one', () => {
    const two = stops.slice(0, 2);
    const r = getBusRouteProgress(two, { latitude: 38.6, longitude: -89.8 })!;
    expect(r.atStop).toBe('A');
    expect(r.upcoming).toEqual(['B']);
  });
});
