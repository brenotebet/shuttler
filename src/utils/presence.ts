// src/utils/presence.ts
// Decisions behind usePresence: when a card should animate in, animate out,
// or replay, and what to show while it animates out (its last content,
// since by then the state that drove it is already cleared).

/** Whether a presented value counts as "shown". */
export function isPresent<T>(value: T | null | undefined | false): value is T {
  return value !== null && value !== undefined && value !== false;
}

export type PresenceAction = 'enter' | 'replay' | 'exit' | 'none';

/**
 * What to do when the presented value changes from `prev` to `next`.
 * With replayOnChange, switching straight from one value to another (one
 * stop's card to another's) replays the entrance so it reads as a new card.
 */
export function presenceAction<T>(
  prev: T | null | undefined | false,
  next: T | null | undefined | false,
  replayOnChange = false,
): PresenceAction {
  const had = isPresent(prev);
  const has = isPresent(next);
  if (has && !had) return 'enter';
  if (!has && had) return 'exit';
  if (has && had && replayOnChange && prev !== next) return 'replay';
  return 'none';
}

/** What to render: the live value, or the last one while it animates out. */
export function presenceDisplayValue<T>(
  value: T | null | undefined | false,
  last: T | null,
  mounted: boolean,
): T | null {
  if (isPresent(value)) return value;
  return mounted ? last : null;
}
