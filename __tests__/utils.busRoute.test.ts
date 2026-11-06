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

// ---- Road-path progress ----
import { getBusRouteProgressOnPath, getBusProgress } from '../src/utils/busRoute';

// Local metres → lat/lng around a campus-like origin.
const LAT0 = 38.6;
const LNG0 = -89.8;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const at = (x: number, y: number) => ({ latitude: LAT0 + y / M_PER_DEG_LAT, longitude: LNG0 + x / M_PER_DEG_LNG });
const stop = (id: string, x: number, y: number) => ({ id, name: id, ...at(x, y) });

describe('getBusRouteProgressOnPath', () => {
  // Today's McKendree failure, in miniature: the straight line from C to D
  // cuts across the A→B road. The real road from C to D goes the long way
  // round, so a bus driving A→B must be heading to B.
  const crossStops = [stop('A', 0, 0), stop('B', 1000, 0), stop('C', 1000, 800), stop('D', 200, -200)];
  const crossPath = [
    at(0, 0), at(1000, 0),            // A → B
    at(1000, 800),                    // B → C
    at(-100, 800), at(-100, -200), at(200, -200), // C → D, around the outside
    at(0, -200), at(0, 0),            // D → back to A
  ];
  const busOnAB = at(360, 8); // 8 m off the A→B road, ~5 m from the C→D chord

  it('reproduces the straight-line mistake', () => {
    expect(getBusRouteProgress(crossStops, busOnAB)!.upcoming[0]).toBe('D');
  });

  it('follows the road instead', () => {
    expect(getBusRouteProgressOnPath(crossStops, crossPath, busOnAB)!.upcoming[0]).toBe('B');
  });

  // Out-and-back street: A → B → C east, then back west to A on the same road.
  const lineStops = [stop('A', 0, 0), stop('B', 200, 0), stop('C', 400, 0)];
  const linePath = [at(0, 0), at(400, 0), at(0, 0)];

  it('uses the bus heading on a shared road', () => {
    const bus = at(300, 2);
    expect(getBusRouteProgressOnPath(lineStops, linePath, bus, 90)!.upcoming[0]).toBe('C'); // eastbound
    expect(getBusRouteProgressOnPath(lineStops, linePath, bus, 270)!.upcoming[0]).toBe('A'); // westbound, back to start
  });

  it('still reports a bus parked at a stop', () => {
    const r = getBusRouteProgressOnPath(lineStops, linePath, at(200, 5), 90)!;
    expect(r.atStop).toBe('B');
    expect(r.upcoming[0]).toBe('C');
  });

  it('gives up for a bus far off the road (detour)', () => {
    expect(getBusRouteProgressOnPath(lineStops, linePath, at(200, 300))).toBeNull();
  });

  it('gives up when the path does not pass the stops', () => {
    const wrongPath = [at(0, 500), at(400, 500)];
    expect(getBusRouteProgressOnPath(lineStops, wrongPath, at(100, 500))).toBeNull();
  });
});

describe('getBusProgress', () => {
  const lineStops = [stop('A', 0, 0), stop('B', 200, 0), stop('C', 400, 0)];
  it('falls back to straight lines without a path', () => {
    expect(getBusProgress(lineStops, null, at(100, 0))).not.toBeNull();
  });
  it('falls back to straight lines when off the path', () => {
    const r = getBusProgress(lineStops, [at(0, 500), at(400, 500)], at(100, 3));
    expect(r!.upcoming[0]).toBe('B');
  });
});
