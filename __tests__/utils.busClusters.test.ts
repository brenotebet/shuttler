import { groupOverlappingBuses, sameGroups } from '../src/utils/busClusters';

const screen = { width: 400, height: 800 };
const campus = { latitudeDelta: 0.03, longitudeDelta: 0.03 };
const close = { latitudeDelta: 0.0005, longitudeDelta: 0.0005 };
const at = (id: string, lat: number, lng: number) => ({ id, latitude: lat, longitude: lng });
const ptLng = campus.longitudeDelta / screen.width;

describe('groupOverlappingBuses', () => {
  it('returns no groups for a single bus', () => {
    expect(groupOverlappingBuses([at('a', 38.6, -89.8)], campus, screen)).toEqual({});
  });

  it('leaves buses that are visibly apart ungrouped', () => {
    const buses = [at('a', 38.6, -89.8), at('b', 38.6, -89.8 + 38 * ptLng)];
    expect(groupOverlappingBuses(buses, campus, screen)).toEqual({});
  });

  it('groups two parked buses with a stable lead', () => {
    const g = groupOverlappingBuses([at('b', 38.6, -89.8), at('a', 38.60001, -89.8)], campus, screen);
    expect(g.a).toEqual({ lead: 'a', members: ['a', 'b'] });
    expect(g.b).toEqual({ lead: 'a', members: ['a', 'b'] });
  });

  it('chains overlaps into one group', () => {
    const buses = [at('a', 38.6, -89.8), at('b', 38.6, -89.8 + 20 * ptLng), at('c', 38.6, -89.8 + 40 * ptLng)];
    const g = groupOverlappingBuses(buses, campus, screen);
    expect(g.c.members).toEqual(['a', 'b', 'c']);
  });

  it('separates once zoomed in far enough', () => {
    const buses = [at('a', 38.6, -89.8), at('b', 38.6, -89.79988)]; // ~10 m apart
    expect(Object.keys(groupOverlappingBuses(buses, campus, screen))).toHaveLength(2);
    expect(groupOverlappingBuses(buses, close, screen)).toEqual({});
  });
});

describe('sameGroups', () => {
  it('compares group membership', () => {
    const a = groupOverlappingBuses([at('a', 38.6, -89.8), at('b', 38.6, -89.8)], campus, screen);
    expect(sameGroups(a, { ...a })).toBe(true);
    expect(sameGroups(a, {})).toBe(false);
  });
});
