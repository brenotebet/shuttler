// Haptic feedback, kept to three moments on purpose so it stays meaningful:
//   - a rider's stop request is sent,
//   - the rider's bus arrives at their stop,
//   - a driver goes online.
// Before adding another, ask whether it's as important as these.

import * as Haptics from 'expo-haptics';

// Haptics are best-effort: no motor, a disabled setting or an unsupported
// platform must never surface as an error.
function play(effect: () => Promise<void>) {
  try {
    effect().catch(() => {});
  } catch {
    // Native module missing (e.g. an older build) — skip silently.
  }
}

/** Rider sent a stop request. */
export function hapticRequestSent() {
  play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** The rider's bus arrived at their stop. */
export function hapticBusArrived() {
  play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Driver is now online and sharing location. */
export function hapticDriverOnline() {
  play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
