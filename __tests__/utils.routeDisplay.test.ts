import {
  getStopMarkerStyle,
  isBusShown,
  pickDefaultRouteColor,
  resolveWatchedRouteId,
} from '../src/utils/routeDisplay';

const ORG = '#16a34a';
const NEUTRAL = '#6b7280';

const routes = [
  { id: 'north', stopIds: ['a', 'b', 'shared'], color: '#2563eb' },
  { id: 'south', stopIds: ['c', 'shared'], color: '#dc2626' },
  { id: 'plain', stopIds: ['d'] }, // no color set → org color
];

describe('resolveWatchedRouteId', () => {
  it('keeps a stored id for an existing route', () => {
    expect(resolveWatchedRouteId('south', routes)).toBe('south');
  });

  it('falls back to All routes when the route was deleted', () => {
    expect(resolveWatchedRouteId('gone', routes)).toBeNull();
  });

  it('turns filtering off for an org with one route', () => {
    expect(resolveWatchedRouteId('north', [routes[0]])).toBeNull();
  });

  it('treats a missing id as All routes', () => {
    expect(resolveWatchedRouteId(null, routes)).toBeNull();
    expect(resolveWatchedRouteId(undefined, routes)).toBeNull();
  });
});

describe('getStopMarkerStyle — All routes', () => {
  it('colors a stop on one route with that route', () => {
    expect(getStopMarkerStyle('a', routes, ORG, NEUTRAL, null)).toEqual({ color: '#2563eb', dots: [], visible: true });
  });

  it('uses the org color for a route without a color', () => {
    expect(getStopMarkerStyle('d', routes, ORG, NEUTRAL, null).color).toBe(ORG);
  });

  it('gives a stop on several routes a neutral pin with a dot per route', () => {
    expect(getStopMarkerStyle('shared', routes, ORG, NEUTRAL, null)).toEqual({
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
    expect(getStopMarkerStyle('s', same, ORG, NEUTRAL, null)).toEqual({ color: '#2563eb', dots: [], visible: true });
  });

  it('keeps a stop on no route in the org color', () => {
    expect(getStopMarkerStyle('lonely', routes, ORG, NEUTRAL, null)).toEqual({ color: ORG, dots: [], visible: true });
  });
});

describe('getStopMarkerStyle — watching a route', () => {
  it('colors a shared stop with the watched route', () => {
    expect(getStopMarkerStyle('shared', routes, ORG, NEUTRAL, 'south')).toEqual({ color: '#dc2626', dots: [], visible: true });
  });

  it('hides stops on other routes', () => {
    expect(getStopMarkerStyle('a', routes, ORG, NEUTRAL, 'south').visible).toBe(false);
  });

  it('still shows stops on no route', () => {
    expect(getStopMarkerStyle('lonely', routes, ORG, NEUTRAL, 'south')).toEqual({ color: ORG, dots: [], visible: true });
  });
});

describe('isBusShown', () => {
  it('shows every bus with no filter', () => {
    expect(isBusShown('north', null, false)).toBe(true);
  });

  it('shows only buses on the watched route', () => {
    expect(isBusShown('north', 'north', false)).toBe(true);
    expect(isBusShown('south', 'north', false)).toBe(false);
  });

  it('always shows the rider\'s own bus', () => {
    expect(isBusShown('south', 'north', true)).toBe(true);
  });

  it('shows buses with no route', () => {
    expect(isBusShown(null, 'north', false)).toBe(true);
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
