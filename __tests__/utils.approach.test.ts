// __tests__/utils.approach.test.ts
// Tests for the "bus on the way" heads-up logic in DriverScreen and the
// bus occupancy value handling shown to riders in MapScreen.

// --- Approach gating (mirrors the proximity tick in DriverScreen) ---

const ARRIVE_RADIUS_M = 75 * 0.3048;
const APPROACH_RADIUS_M = 2600 * 0.3048;
const SHUTTLE_PACE_M_PER_MIN = 250;

function shouldSendApproachHeadsUp(args: {
  distanceM: number;
  approachWritten: boolean;
  approachingAt?: unknown;
  arrivedAt?: unknown;
}): boolean {
  const withinArrive = args.distanceM <= ARRIVE_RADIUS_M;
  return (
    !withinArrive
    && args.distanceM <= APPROACH_RADIUS_M
    && !args.approachWritten
    && !args.approachingAt
    && !args.arrivedAt
  );
}

function approachEtaMinutes(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / SHUTTLE_PACE_M_PER_MIN));
}

describe('bus approach heads-up gating', () => {
  it('fires when the bus crosses the approach radius', () => {
    expect(shouldSendApproachHeadsUp({ distanceM: 700, approachWritten: false })).toBe(true);
  });

  it('does not fire outside the approach radius', () => {
    expect(shouldSendApproachHeadsUp({ distanceM: 900, approachWritten: false })).toBe(false);
  });

  it('does not fire inside the arrival radius (arrival notification covers it)', () => {
    expect(shouldSendApproachHeadsUp({ distanceM: 10, approachWritten: false })).toBe(false);
  });

  it('fires at most once per request', () => {
    expect(shouldSendApproachHeadsUp({ distanceM: 700, approachWritten: true })).toBe(false);
    expect(shouldSendApproachHeadsUp({ distanceM: 700, approachWritten: false, approachingAt: {} })).toBe(false);
  });

  it('does not fire after the bus has already arrived', () => {
    expect(shouldSendApproachHeadsUp({ distanceM: 700, approachWritten: false, arrivedAt: {} })).toBe(false);
  });
});

describe('approach ETA estimate', () => {
  it('estimates minutes from distance at average shuttle pace', () => {
    expect(approachEtaMinutes(750)).toBe(3);
    expect(approachEtaMinutes(500)).toBe(2);
  });

  it('never reports less than one minute', () => {
    expect(approachEtaMinutes(50)).toBe(1);
    expect(approachEtaMinutes(0)).toBe(1);
  });
});

// --- Occupancy value handling (mirrors MapScreen's bus doc parsing) ---

function parseOccupancy(value: unknown): 'open' | 'filling' | 'full' | null {
  return value === 'open' || value === 'filling' || value === 'full' ? value : null;
}

describe('bus occupancy parsing', () => {
  it('accepts the three known states', () => {
    expect(parseOccupancy('open')).toBe('open');
    expect(parseOccupancy('filling')).toBe('filling');
    expect(parseOccupancy('full')).toBe('full');
  });

  it('treats anything else as unknown (no badge shown)', () => {
    expect(parseOccupancy(undefined)).toBeNull();
    expect(parseOccupancy(null)).toBeNull();
    expect(parseOccupancy('packed')).toBeNull();
    expect(parseOccupancy(3)).toBeNull();
  });
});
