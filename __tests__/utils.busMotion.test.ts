import {
  nextHeading,
  glideDurationMs,
  shortestAngleDelta,
  DEFAULT_GLIDE_MS,
  shouldJumpToPosition,
} from '../src/utils/busMotion';

const origin = { latitude: 38.6, longitude: -89.8 };
// ~111 m north / east of origin
const north = { latitude: 38.601, longitude: -89.8 };
const east = { latitude: 38.6, longitude: -89.79885 };
// ~3 m away — GPS jitter
const jitter = { latitude: 38.60002, longitude: -89.80002 };

describe('shortestAngleDelta', () => {
  it('takes the short way round', () => {
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
    expect(shortestAngleDelta(0, 180)).toBe(180);
  });
});

describe('nextHeading', () => {
  it('keeps the old heading when the bus is parked or jittering', () => {
    expect(nextHeading(135, origin, jitter)).toBe(135);
    expect(nextHeading(135, origin, origin)).toBe(135);
  });

  it('does not invent a heading when there is no previous position', () => {
    expect(nextHeading(null, null, origin)).toBeNull();
    expect(nextHeading(90, null, origin)).toBe(90);
  });

  it('points along the movement on the first real move', () => {
    expect(nextHeading(null, origin, north)!).toBeCloseTo(0, 0);
    expect(nextHeading(null, origin, east)!).toBeCloseTo(90, 0);
  });

  it('turns part of the way toward a new direction', () => {
    const h = nextHeading(0, origin, east)!;
    expect(h).toBeGreaterThan(40);
    expect(h).toBeLessThan(90);
  });

  it('turns the short way across north', () => {
    // From 350° toward ~10°: should end up near 2°, not swing through 180°.
    const nearlyNorthEast = { latitude: 38.601, longitude: -89.79977 };
    const h = nextHeading(350, origin, nearlyNorthEast)!;
    expect(h < 20 || h > 340).toBe(true);
  });
});

describe('glideDurationMs', () => {
  it('matches the gap between updates', () => {
    expect(glideDurationMs(1000, 5000)).toBe(4000);
  });

  it('clamps very short and very long gaps', () => {
    expect(glideDurationMs(1000, 1100)).toBe(800);
    expect(glideDurationMs(1000, 60_000)).toBe(6000);
  });

  it('falls back to the default when there is no usable previous update', () => {
    expect(glideDurationMs(null, 5000)).toBe(DEFAULT_GLIDE_MS);
    expect(glideDurationMs(5000, 5000)).toBe(DEFAULT_GLIDE_MS);
  });
});

describe('shouldJumpToPosition', () => {
  const t0 = 1_700_000_000_000;
  // ~111 m apart
  const far = north;

  it('glides between regular updates, however far the bus went', () => {
    expect(shouldJumpToPosition(t0, t0 + 4_000, origin, far)).toBe(false);
  });

  it('jumps when catching up after a long gap', () => {
    expect(shouldJumpToPosition(t0, t0 + 5 * 60_000, origin, far)).toBe(true);
  });

  it('still glides after a long gap when the bus barely moved (pulling away after parking)', () => {
    expect(shouldJumpToPosition(t0, t0 + 5 * 60_000, origin, jitter)).toBe(false);
  });

  it('never jumps on the first fix', () => {
    expect(shouldJumpToPosition(null, t0, null, far)).toBe(false);
  });
});
