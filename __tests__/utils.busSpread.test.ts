import { spreadOffsets, sameOffsets, BUS_MIN_SEPARATION_PT } from '../src/utils/busSpread';

const screen = { width: 400, height: 800 };
// ~0.03° campus zoom: 1 pt ≈ 0.000075° lng ≈ 6.5 m.
const campus = { latitudeDelta: 0.03, longitudeDelta: 0.03 };
const close = { latitudeDelta: 0.0005, longitudeDelta: 0.0005 };

const at = (id: string, lat: number, lng: number) => ({ id, latitude: lat, longitude: lng });
const shown = (b: { latitude: number; longitude: number }, o: { dLat: number; dLng: number }) =>
  ({ latitude: b.latitude + o.dLat, longitude: b.longitude + o.dLng });
const ptDist = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }, r = campus) =>
  Math.hypot(
    (a.longitude - b.longitude) / (r.longitudeDelta / screen.width),
    (a.latitude - b.latitude) / (r.latitudeDelta / screen.height),
  );

describe('spreadOffsets', () => {
  it('leaves a single bus where it is', () => {
    const r = spreadOffsets([at('a', 38.6, -89.8)], campus, screen);
    expect(r.a).toEqual({ dLat: 0, dLng: 0 });
  });

  it('leaves buses alone when they do not overlap', () => {
    const buses = [at('a', 38.6, -89.8), at('b', 38.61, -89.79)];
    const r = spreadOffsets(buses, campus, screen);
    expect(r.a).toEqual({ dLat: 0, dLng: 0 });
    expect(r.b).toEqual({ dLat: 0, dLng: 0 });
  });

  it('pushes two parked buses apart by about one icon', () => {
    const buses = [at('a', 38.6, -89.8), at('b', 38.60002, -89.80001)]; // ~2 m apart
    const r = spreadOffsets(buses, campus, screen);
    const d = ptDist(shown(buses[0], r.a), shown(buses[1], r.b));
    expect(d).toBeCloseTo(BUS_MIN_SEPARATION_PT, 0);
  });

  it('spreads a group of three so every pair is at least one icon apart', () => {
    const buses = [at('a', 38.6, -89.8), at('b', 38.6, -89.8), at('c', 38.6, -89.8)];
    const r = spreadOffsets(buses, campus, screen);
    const s = buses.map((b) => shown(b, r[b.id]));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      expect(ptDist(s[i], s[j])).toBeGreaterThanOrEqual(BUS_MIN_SEPARATION_PT - 0.5);
    }
  });

  it('keeps the nudge tiny in metres once zoomed in', () => {
    // 10 m apart is fine at close zoom: no overlap, no offset.
    const buses = [at('a', 38.6, -89.8), at('b', 38.6, -89.79988)];
    const r = spreadOffsets(buses, close, screen);
    expect(r.a).toEqual({ dLat: 0, dLng: 0 });
  });

  it('gives each bus the same slot regardless of input order', () => {
    const a = at('a', 38.6, -89.8);
    const b = at('b', 38.60001, -89.8);
    expect(sameOffsets(spreadOffsets([a, b], campus, screen), spreadOffsets([b, a], campus, screen))).toBe(true);
  });
});
