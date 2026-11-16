// __tests__/utils.gpsWrite.test.ts
import {
  decideFixWrite,
  decideHeartbeatWrite,
  WRITE_MIN_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
} from '../src/utils/gpsWrite';

// ~11 m per 0.0001° of latitude
const A = { latitude: 38.6, longitude: -89.8 };
const north = (m: number) => ({ latitude: A.latitude + m / 111_195, longitude: A.longitude });

describe('decideFixWrite', () => {
  it('writes the first fix of a session', () => {
    expect(decideFixWrite(1_000, 0, null, A)).toBe('write');
  });

  it('holds a moving bus inside the write interval, however far it moved', () => {
    // The old rule wrote whenever the bus moved 8 m, i.e. ~every second at speed.
    expect(decideFixWrite(10_000 + 1_000, 10_000, A, north(15))).toBe('hold');
    expect(decideFixWrite(10_000 + WRITE_MIN_INTERVAL_MS - 1, 10_000, A, north(60))).toBe('hold');
  });

  it('writes a moving bus once the interval has passed', () => {
    expect(decideFixWrite(10_000 + WRITE_MIN_INTERVAL_MS, 10_000, A, north(40))).toBe('write');
  });

  it('skips parked-GPS noise near the last written position', () => {
    expect(decideFixWrite(60_000, 10_000, A, north(1))).toBe('skip');
  });

  it('writes a slow crawl of a few metres once the interval has passed', () => {
    expect(decideFixWrite(20_000, 10_000, A, north(5))).toBe('write');
  });

  it('caps a bus at 25 mph with 1 s GPS fixes to one write per interval', () => {
    let lastAt = 0;
    let last = A;
    let writes = 0;
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      const fix = north((t / 1000) * 11.2);
      if (decideFixWrite(t, lastAt, last, fix) === 'write') {
        writes += 1;
        lastAt = t;
        last = fix;
      }
    }
    expect(writes).toBe(60_000 / WRITE_MIN_INTERVAL_MS);
  });
});

describe('decideHeartbeatWrite', () => {
  it('flushes a held fix once the write interval has passed', () => {
    expect(decideHeartbeatWrite(10_000 + WRITE_MIN_INTERVAL_MS, 10_000, true)).toBe('pending');
  });

  it('waits for the interval before flushing a held fix', () => {
    expect(decideHeartbeatWrite(10_000 + 2_000, 10_000, true)).toBeNull();
  });

  it('re-sends the last position for a parked bus', () => {
    expect(decideHeartbeatWrite(10_000 + HEARTBEAT_INTERVAL_MS, 10_000, false)).toBe('refresh');
  });

  it('does nothing for a parked bus that wrote recently', () => {
    expect(decideHeartbeatWrite(10_000 + 5_000, 10_000, false)).toBeNull();
  });
});
