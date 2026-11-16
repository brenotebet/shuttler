// src/utils/gpsWrite.ts
// When the driver's phone writes its position to the bus doc.
//
// Every bus-doc write is billed once per open listener on the buses
// collection (each rider map, driver screen and admin dashboard) plus the
// security-rule lookups, so the write rate drives most Firestore reads. The
// rider map is tuned for one fix about every 4 s (see busMotion.ts), so writes
// are capped at that rate regardless of speed. A fix that arrives inside the
// window is held, not dropped, and the heartbeat writes it once the window
// passes — otherwise a bus that stops right after a skipped fix stays recorded
// short of the stop (no new GPS callbacks while parked), which can keep it out
// of the driver's arrival radius.

import { distanceMeters, type LatLng } from './busMotion';

/** At most one position write per this interval while moving. */
export const WRITE_MIN_INTERVAL_MS = 4000;

/** Fixes this close to the last written position are parked-GPS noise. */
export const GPS_JITTER_M = 3;

/** A parked bus re-sends its position this often so riders see it as live. */
export const HEARTBEAT_INTERVAL_MS = 15 * 1000;

export type FixDecision = 'write' | 'hold' | 'skip';

/**
 * What to do with a new GPS fix:
 * - 'write' straight away when nothing has been written yet
 * - 'skip': within GPS_JITTER_M of the last written position (drop any held fix too)
 * - 'hold': moved, but a write went out less than WRITE_MIN_INTERVAL_MS ago
 * - 'write': moved, and the interval has passed
 */
export function decideFixWrite(
  nowMs: number,
  lastWrittenAtMs: number,
  lastWritten: LatLng | null,
  fix: LatLng,
): FixDecision {
  // Nothing written yet this session (e.g. the initial write failed): write now.
  if (!lastWritten) return 'write';
  if (distanceMeters(lastWritten, fix) < GPS_JITTER_M) return 'skip';
  if (nowMs - lastWrittenAtMs < WRITE_MIN_INTERVAL_MS) return 'hold';
  return 'write';
}

/**
 * What the periodic heartbeat should write, if anything:
 * - 'pending': a held fix is waiting and the write interval has passed
 * - 'refresh': nothing new, but the bus doc is getting old — re-send the last position
 * - null: nothing to do
 */
export function decideHeartbeatWrite(
  nowMs: number,
  lastWrittenAtMs: number,
  hasPendingFix: boolean,
): 'pending' | 'refresh' | null {
  const sinceLastMs = nowMs - lastWrittenAtMs;
  if (hasPendingFix && sinceLastMs >= WRITE_MIN_INTERVAL_MS) return 'pending';
  if (sinceLastMs >= HEARTBEAT_INTERVAL_MS) return 'refresh';
  return null;
}
