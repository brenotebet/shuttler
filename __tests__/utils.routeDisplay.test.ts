import {
  getStopMarkerStyle,
  isBusShown,
  parseStoredWatchedRouteIds,
  pickDefaultRouteColor,
  resolveWatchedRouteIds,
  stopsOnNoRoute,
  routeHasServingBus,
  toggleWatchedRoute,
  watchedRoutesLabel,
} from '../src/utils/routeDisplay';

const ORG = '#16a34a';
const NEUTRAL = '#6b7280';

const routes = [
  { id: 'north', stopIds: ['a', 'b', 'shared', 'all3'], color: '#2563eb' },
  { id: 'south', stopIds: ['c', 'shared', 'all3'], color: '#dc2626' },
  { id: 'plain', stopIds: ['d', 'all3'] }, // no color set → org color
];

describe('resolveWatchedRouteIds', () => {
  it('keeps ids of existing routes, in route order', () => {
    expect(resolveWatchedRouteIds(['south', 'north'], routes)).toEqual(['north', 'south']);
  });

  it('drops deleted routes', () => {
    expect(resolveWatchedRouteIds(['gone', 'south'], routes)).toEqual(['south']);
    expect(resolveWatchedRouteIds(['gone'], routes)).toEqual([]);
  });

  it('treats watching every route as All routes', () => {
    expect(resolveWatchedRouteIds(['north', 'south', 'plain'], routes)).toEqual([]);
  });

  it('turns filtering off for an org with one route', () => {
    expect(resolveWatchedRouteIds(['north'], [routes[0]])).toEqual([]);
  });

  it('treats nothing saved as All routes', () => {
    expect(resolveWatchedRouteIds(null, routes)).toEqual([]);
    expect(resolveWatchedRouteIds(undefined, routes)).toEqual([]);
    expect(resolveWatchedRouteIds([], routes)).toEqual([]);
  });
});

describe('parseStoredWatchedRouteIds', () => {
  it('reads a saved list', () => {
    expect(parseStoredWatchedRouteIds('["north","south"]')).toEqual(['north', 'south']);
  });

  it('reads a single id saved by an older version', () => {
    expect(parseStoredWatchedRouteIds('route_abc123')).toEqual(['route_abc123']);
  });

  it('ignores non-string entries and empty values', () => {
    expect(parseStoredWatchedRouteIds('["north",3,null]')).toEqual(['north']);
    expect(parseStoredWatchedRouteIds(null)).toEqual([]);
    expect(parseStoredWatchedRouteIds('')).toEqual([]);
  });
});

describe('toggleWatchedRoute', () => {
  it('adds and removes a route', () => {
    expect(toggleWatchedRoute(['north'], 'south')).toEqual(['north', 'south']);
    expect(toggleWatchedRoute(['north', 'south'], 'north')).toEqual(['south']);
  });
});

describe('watchedRoutesLabel', () => {
  it('names up to two routes, then summarizes', () => {
    expect(watchedRoutesLabel([])).toBe('All routes');
    expect(watchedRoutesLabel([{ name: 'North' }])).toBe('North');
    expect(watchedRoutesLabel([{ name: 'North' }, { name: 'South' }])).toBe('North, South');
    expect(watchedRoutesLabel([{ name: 'North' }, { name: 'South' }, { name: 'East' }])).toBe('North +2');
  });
});

describe('getStopMarkerStyle — All routes', () => {
  it('colors a stop on one route with that route', () => {
    expect(getStopMarkerStyle('a', routes, ORG, NEUTRAL, [])).toEqual({ color: '#2563eb', dots: [], visible: true });
  });

  it('uses the org color for a route without a color', () => {
    expect(getStopMarkerStyle('d', routes, ORG, NEUTRAL, []).color).toBe(ORG);
  });

  it('gives a stop on several routes a neutral pin with a dot per route', () => {
    expect(getStopMarkerStyle('shared', routes, ORG, NEUTRAL, [])).toEqual({
      color: NEUTRAL,
      dots: ['#2563eb', '#dc2626'],
      visible: true,
    });
  });

  it('uses one color when all of a stop\'s routes share it', () => {
    const same = [
      { id: 'x', stopIds: ['s'], color: '#2563eb' },
      { id: 'y', stopIds: ['s'], color: '#2563eb' },
    ];
    expect(getStopMarkerStyle('s', same, ORG, NEUTRAL, [])).toEqual({ color: '#2563eb', dots: [], visible: true });
  });

  it('hides a stop on no route once the org has routes (no driver serves it)', () => {
    expect(getStopMarkerStyle('lonely', routes, ORG, NEUTRAL, [])).toEqual({ color: ORG, dots: [], visible: false });
  });

  it('shows every stop in the org color when the org has no routes', () => {
    expect(getStopMarkerStyle('lonely', [], ORG, NEUTRAL, [])).toEqual({ color: ORG, dots: [], visible: true });
  });
});

describe('getStopMarkerStyle — watching routes', () => {
  it('colors a shared stop with the one watched route it is on', () => {
    expect(getStopMarkerStyle('shared', routes, ORG, NEUTRAL, ['south'])).toEqual({ color: '#dc2626', dots: [], visible: true });
  });

  it('shows dots only for the watched routes a stop is on', () => {
    expect(getStopMarkerStyle('all3', routes, ORG, NEUTRAL, ['north', 'south'])).toEqual({
      color: NEUTRAL,
      dots: ['#2563eb', '#dc2626'],
      visible: true,
    });
  });

  it('hides stops that are only on routes not being watched', () => {
    expect(getStopMarkerStyle('a', routes, ORG, NEUTRAL, ['south']).visible).toBe(false);
    expect(getStopMarkerStyle('d', routes, ORG, NEUTRAL, ['north', 'south']).visible).toBe(false);
  });

  it('hides stops on no route', () => {
    expect(getStopMarkerStyle('lonely', routes, ORG, NEUTRAL, ['south']).visible).toBe(false);
  });
});

describe('isBusShown', () => {
  it('shows every bus with no filter', () => {
    expect(isBusShown('north', [], false)).toBe(true);
  });

  it('shows only buses on the watched routes', () => {
    expect(isBusShown('north', ['north', 'south'], false)).toBe(true);
    expect(isBusShown('south', ['north', 'south'], false)).toBe(true);
    expect(isBusShown('plain', ['north', 'south'], false)).toBe(false);
  });

  it('always shows the rider\'s own bus', () => {
    expect(isBusShown('south', ['north'], true)).toBe(true);
  });

  it('shows buses with no route', () => {
    expect(isBusShown(null, ['north'], false)).toBe(true);
  });
});

describe('pickDefaultRouteColor', () => {
  const palette = ['#16a34a', '#2563eb', '#7c3aed', '#dc2626'];

  it('skips the org color and colors already in use', () => {
    expect(pickDefaultRouteColor([{ id: 'r', stopIds: [], color: '#2563EB' }], palette, ORG)).toBe('#7c3aed');
  });

  it('counts uncolored routes as using the org color', () => {
    expect(pickDefaultRouteColor([{ id: 'r', stopIds: [] }], palette, '#2563eb')).toBe('#16a34a');
  });

  it('cycles through the palette once every color is used', () => {
    const used = palette.map((c, i) => ({ id: `r${i}`, stopIds: [], color: c }));
    expect(pickDefaultRouteColor(used, palette, ORG)).toBe(palette[0]);
  });
});

describe('stopsOnNoRoute', () => {
  const stops = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('lists stops no route uses', () => {
    expect(stopsOnNoRoute(stops, [{ id: 'r', stopIds: ['a'] }])).toEqual([{ id: 'b' }, { id: 'c' }]);
  });
  it('is empty when every stop is on a route', () => {
    expect(stopsOnNoRoute(stops, [{ id: 'r', stopIds: ['a', 'b'] }, { id: 's', stopIds: ['c'] }])).toEqual([]);
  });
});

describe('routeHasServingBus', () => {
  const routes = { b1: 'terminal', b2: 'parking', b3: null };
  it('is true when a bus drives the route', () => {
    expect(routeHasServingBus('parking', ['b1', 'b2'], routes)).toBe(true);
  });
  it('is false when only other routes have buses', () => {
    expect(routeHasServingBus('hotel', ['b1', 'b2'], routes)).toBe(false);
  });
  it('counts a bus with no route as serving any route', () => {
    expect(routeHasServingBus('hotel', ['b1', 'b3'], routes)).toBe(true);
  });
  it('accepts any bus for a request with no route, and none when nothing is online', () => {
    expect(routeHasServingBus(null, ['b1'], routes)).toBe(true);
    expect(routeHasServingBus('parking', [], routes)).toBe(false);
  });
});
