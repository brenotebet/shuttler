// src/constants/motion.ts
// One set of motion settings for the app, so every card, sheet and list
// opens and closes the same way. Riders who turn on Reduce Motion (in the
// app or in their phone's settings) get instant changes instead — see
// useAccessibility().motionReduced.

export const MOTION = {
  /** Cards popping in: bus card, stop card, "N buses here". */
  popIn: { speed: 18, bounciness: 6 },
  /** Smaller pop for a control changing state (the ride button). */
  pop: { speed: 16, bounciness: 8 },
  /** Lists and top-of-map controls fading in. */
  fadeInMs: 200,
  /** Anything closing: quicker than opening so it never feels sluggish. */
  exitMs: 160,
  /** Bottom sheets and the ride card sliding up. */
  sheetSpring: { damping: 28, stiffness: 280, mass: 0.8 },
  /** Sheets backdrop fade in / out. */
  backdropInMs: 220,
  backdropOutMs: 180,
  /** Sheets sliding down when closed. */
  sheetExitMs: 200,
  /** Text swapping in place (ride status). */
  crossfadeMs: 180,
} as const;
