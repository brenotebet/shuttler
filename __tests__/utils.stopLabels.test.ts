import { pickVisibleStopLabels, sameIdSet, LabelStop } from '../src/utils/stopLabels';

const screen = { width: 400, height: 800 };
// Two stops ~30 m apart and one far away.
const stops: LabelStop[] = [
  { id: 'piper', name: 'Piper Academic Center', latitude: 38.6, longitude: -89.8 },
  { id: 'carnegie', name: 'Carnegie Hall', latitude: 38.60027, longitude: -89.8 },
  { id: 'west', name: 'West Apartments', latitude: 38.595, longitude: -89.81 },
];

describe('pickVisibleStopLabels', () => {
  it('drops a label that would overlap another when zoomed out', () => {
    const region = { latitude: 38.6, longitude: -89.8, latitudeDelta: 0.03, longitudeDelta: 0.03 };
    const shown = pickVisibleStopLabels(stops, region, screen);
    expect(shown.has('west')).toBe(true);
    expect(shown.has('piper') && shown.has('carnegie')).toBe(false);
    expect(shown.has('piper') || shown.has('carnegie')).toBe(true);
  });

  it('shows every label once zoomed in far enough', () => {
    const region = { latitude: 38.6, longitude: -89.8, latitudeDelta: 0.002, longitudeDelta: 0.002 };
    const shown = pickVisibleStopLabels(stops, region, screen);
    expect(shown.has('piper')).toBe(true);
    expect(shown.has('carnegie')).toBe(true);
  });

  it('lets a priority stop win a collision', () => {
    const region = { latitude: 38.6, longitude: -89.8, latitudeDelta: 0.03, longitudeDelta: 0.03 };
    const shown = pickVisibleStopLabels(stops, region, screen, ['carnegie']);
    expect(shown.has('carnegie')).toBe(true);
    expect(shown.has('piper')).toBe(false);
  });
});

describe('sameIdSet', () => {
  it('compares contents, not order', () => {
    expect(sameIdSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameIdSet(new Set(['a']), new Set(['a', 'b']))).toBe(false);
  });
});
