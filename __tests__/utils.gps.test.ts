// __tests__/utils.gps.test.ts
// Tests for GPS and stop-request utility functions used in DriverScreen / LocationContext.

// --- Inline the helpers under test (pure functions, no deps) ---

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const STUDENT_REQUEST_TTL_MS = 15 * 60 * 1000;

function isExpiredRequest(r: { expiresAtMs?: number; createdAt?: { toMillis: () => number } }): boolean {
  const expiresAtMs = typeof r?.expiresAtMs === 'number' ? r.expiresAtMs : null;
  if (expiresAtMs !== null) return Date.now() >= expiresAtMs;
  const createdAtMs = r?.createdAt?.toMillis?.() ?? null;
  if (!createdAtMs) return false;
  return Date.now() - createdAtMs >= STUDENT_REQUEST_TTL_MS;
}

function feetToMeters(feet: number): number {
  return feet * 0.3048;
}

function formatTimeAgo(inputMs: number): string {
  const diff = Math.max(0, Date.now() - inputMs);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// --- Tests ---

describe('distanceMeters', () => {
  it('returns ~0 for identical coordinates', () => {
    const coord = { latitude: 38.5, longitude: -89.7 };
    expect(distanceMeters(coord, coord)).toBeCloseTo(0, 1);
  });

  it('returns a positive value for different coordinates', () => {
    const a = { latitude: 38.5, longitude: -89.7 };
    const b = { latitude: 38.501, longitude: -89.701 };
    expect(distanceMeters(a, b)).toBeGreaterThan(0);
  });

  it('is symmetric', () => {
    const a = { latitude: 38.5, longitude: -89.7 };
    const b = { latitude: 38.52, longitude: -89.72 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 5);
  });

  it('returns ~111km for 1 degree latitude difference at the equator', () => {
    const a = { latitude: 0, longitude: 0 };
    const b = { latitude: 1, longitude: 0 };
    expect(distanceMeters(a, b)).toBeCloseTo(111195, -2); // within ~100m of expected
  });
});

describe('feetToMeters', () => {
  it('converts 0 feet to 0 meters', () => {
    expect(feetToMeters(0)).toBe(0);
  });

  it('converts 1 foot to ~0.3048 meters', () => {
    expect(feetToMeters(1)).toBeCloseTo(0.3048);
  });

  it('converts 75 feet (ARRIVE_RADIUS) to ~22.86 meters', () => {
    expect(feetToMeters(75)).toBeCloseTo(22.86, 1);
  });

  it('converts 180 feet (EXIT_RADIUS) to ~54.86 meters', () => {
    expect(feetToMeters(180)).toBeCloseTo(54.86, 1);
  });
});

describe('isExpiredRequest', () => {
  it('returns false for a fresh request with expiresAtMs in the future', () => {
    const r = { expiresAtMs: Date.now() + 60_000 };
    expect(isExpiredRequest(r)).toBe(false);
  });

  it('returns true for a request with expiresAtMs in the past', () => {
    const r = { expiresAtMs: Date.now() - 1 };
    expect(isExpiredRequest(r)).toBe(true);
  });

  it('returns false for a request created just now (no expiresAtMs)', () => {
    const r = { createdAt: { toMillis: () => Date.now() } };
    expect(isExpiredRequest(r)).toBe(false);
  });

  it('returns true for a request older than 15 minutes (no expiresAtMs)', () => {
    const r = { createdAt: { toMillis: () => Date.now() - 16 * 60 * 1000 } };
    expect(isExpiredRequest(r)).toBe(true);
  });

  it('returns false for a request with no timestamps', () => {
    expect(isExpiredRequest({})).toBe(false);
  });
});

describe('formatTimeAgo', () => {
  it('shows seconds for recent times', () => {
    expect(formatTimeAgo(Date.now() - 30_000)).toBe('30s ago');
  });

  it('shows minutes for times 1-60 minutes ago', () => {
    expect(formatTimeAgo(Date.now() - 5 * 60_000)).toBe('5m ago');
  });

  it('shows hours for times 1-24 hours ago', () => {
    expect(formatTimeAgo(Date.now() - 3 * 60 * 60_000)).toBe('3h ago');
  });

  it('shows days for times over 24 hours ago', () => {
    expect(formatTimeAgo(Date.now() - 2 * 24 * 60 * 60_000)).toBe('2d ago');
  });

  it('returns 0s ago for a future timestamp (clamps to 0)', () => {
    expect(formatTimeAgo(Date.now() + 5000)).toBe('0s ago');
  });
});
