import { routePathKey, encodePath, decodePath, snapToPath } from '../src/utils/routePath';

// A straight east-west road ~500 m long.
const road = [
  { latitude: 38.6, longitude: -89.8 },
  { latitude: 38.6, longitude: -89.7942 },
];

describe('routePathKey', () => {
  it('changes when a stop moves or the order changes', () => {
    const a = { latitude: 38.6, longitude: -89.8 };
    const b = { latitude: 38.61, longitude: -89.79 };
    const moved = { latitude: 38.6005, longitude: -89.8 };
    expect(routePathKey([a, b])).toBe(routePathKey([{ ...a }, { ...b }]));
    expect(routePathKey([a, b])).not.toBe(routePathKey([b, a]));
    expect(routePathKey([a, b])).not.toBe(routePathKey([moved, b]));
  });
});

describe('encodePath / decodePath', () => {
  it('round-trips to ~1 m', () => {
    const out = decodePath(encodePath(road));
    expect(out).toHaveLength(2);
    expect(out[1].longitude).toBeCloseTo(-89.7942, 5);
  });

  it('returns an empty path for missing or bad input', () => {
    expect(decodePath(undefined)).toEqual([]);
    expect(decodePath('')).toEqual([]);
  });
});

describe('snapToPath', () => {
  it('pulls a fix ~20 m off the road onto it', () => {
    const off = { latitude: 38.60018, longitude: -89.797 };
    const snapped = snapToPath(off, road);
    expect(snapped.latitude).toBeCloseTo(38.6, 5);
    expect(snapped.longitude).toBeCloseTo(-89.797, 5);
  });

  it('leaves a bus far off the road alone (detour)', () => {
    const detour = { latitude: 38.602, longitude: -89.797 }; // ~220 m away
    expect(snapToPath(detour, road)).toEqual(detour);
  });

  it('clamps to the end of the road past the last point', () => {
    const past = { latitude: 38.6001, longitude: -89.794 };
    const snapped = snapToPath(past, road);
    expect(snapped.longitude).toBeCloseTo(-89.7942, 4);
  });

  it('does nothing without a usable path', () => {
    const p = { latitude: 38.6, longitude: -89.8 };
    expect(snapToPath(p, [])).toEqual(p);
    expect(snapToPath(p, [road[0]])).toEqual(p);
  });
});
