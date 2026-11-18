// src/utils/followCamera.ts
// Decides what the rider map's camera follows, so a tapped bus or the bus
// on the rider's ride stays in view as it moves instead of driving off screen.

/**
 * - free: the rider moved the map; the camera stays where they left it.
 * - followUser / overview: one-off framings (stops, all buses); no tracking.
 * - followBus: keep the tapped bus centered while its info card is open.
 * - followRide: keep the ride's bus and pickup stop in frame for the ride.
 */
export type CameraMode = 'free' | 'followUser' | 'overview' | 'followBus' | 'followRide';

export type FollowTarget = { kind: 'bus' | 'ride'; busId: string };

/** Camera moves for a newly chosen target (and after a bus jump) take this long. */
export const FOLLOW_RETARGET_MS = 600;
const MAX_FOLLOW_MS = 6000;

/**
 * The bus the camera should track right now, or null to leave it alone.
 * An open bus card wins: while it's open, only the tapped bus is followed,
 * and a ride doesn't pull the camera away from it.
 */
export function cameraFollowTarget(state: {
  mode: CameraMode;
  selectedBusId: string | null;
  rideActive: boolean;
  rideBusId: string | null;
}): FollowTarget | null {
  const { mode, selectedBusId, rideActive, rideBusId } = state;
  if (mode === 'followBus') return selectedBusId ? { kind: 'bus', busId: selectedBusId } : null;
  if (mode === 'followRide' && rideActive && rideBusId && !selectedBusId) {
    return { kind: 'ride', busId: rideBusId };
  }
  return null;
}

/** Camera mode once the bus card closes: back to the ride if there is one. */
export function cameraModeAfterBusCardClosed(mode: CameraMode, rideActive: boolean): CameraMode {
  if (mode !== 'followBus') return mode;
  return rideActive ? 'followRide' : 'free';
}

/**
 * How long the camera takes to reach a bus's new position. It matches the
 * marker's glide (see glideDurationMs) so the bus stays put on screen while
 * the map slides under it. A glide of 0 means the marker jumped (see
 * shouldJumpToPosition); the camera then catches up quickly.
 */
export function followAnimationMs(glideMs: number | undefined): number {
  if (!glideMs || glideMs <= 0) return FOLLOW_RETARGET_MS;
  return Math.min(MAX_FOLLOW_MS, Math.max(FOLLOW_RETARGET_MS, glideMs));
}
