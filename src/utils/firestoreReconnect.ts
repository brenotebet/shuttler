// src/utils/firestoreReconnect.ts
// Recovers the Firestore connection when its stream hangs without failing.
//
// Every onSnapshot listener in the app shares one Firestore connection. When
// that connection *fails* (Mac/phone sleep, network drop) the SDK notices and
// reconnects on its own. But it has been seen to hang silently instead: no
// error, the listener stays attached, and updates simply stop arriving —
// riders saw frozen buses, then "No buses online", until the app was killed.
// Re-subscribing doesn't help (it reuses the same stuck connection);
// disableNetwork() + enableNetwork() tears the connection down and opens a
// fresh one, and listeners resume from where they were.
//
// Restarts are cheap and harmless on a healthy connection (pending writes are
// queued and sent once the network is back), so they're triggered on simple
// signals: the app returning to the foreground, and a live feed going quiet.

/** Restart after the app was in the background at least this long. */
export const FOREGROUND_RESTART_AFTER_MS = 10_000;

/** A feed that normally updates every few seconds is stalled after this long. */
export const FEED_STALL_MS = 30_000;

/** Never restart more often than this, so a flapping signal can't loop. */
export const MIN_RESTART_INTERVAL_MS = 20_000;

export function shouldRestartAfterBackground(backgroundedMs: number | null): boolean {
  return backgroundedMs !== null && backgroundedMs >= FOREGROUND_RESTART_AFTER_MS;
}

/**
 * Whether a live feed looks stalled: it was showing data that updates
 * continuously (e.g. at least one online bus — drivers write every few
 * seconds), and nothing has arrived for FEED_STALL_MS.
 */
export function isFeedStalled(lastUpdateMs: number | null, expectingUpdates: boolean, nowMs: number): boolean {
  return expectingUpdates && lastUpdateMs !== null && nowMs - lastUpdateMs >= FEED_STALL_MS;
}

export type Reconnector = {
  /** Restarts the connection unless one ran recently. Resolves true if it ran. */
  restart: (reason: string) => Promise<boolean>;
};

export function createReconnector(deps: {
  disableNetwork: () => Promise<void>;
  enableNetwork: () => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}): Reconnector {
  const now = deps.now ?? Date.now;
  let lastRestartMs: number | null = null;
  let inFlight: Promise<boolean> | null = null;

  const restart = async (reason: string): Promise<boolean> => {
    if (inFlight) return inFlight;
    if (lastRestartMs !== null && now() - lastRestartMs < MIN_RESTART_INTERVAL_MS) return false;
    lastRestartMs = now();
    inFlight = (async () => {
      deps.log?.(`[firestore] restarting connection (${reason})`);
      try {
        await deps.disableNetwork();
      } finally {
        // Always re-enable, even if disable failed, so we never leave the
        // app offline.
        await deps.enableNetwork();
      }
      return true;
    })().finally(() => { inFlight = null; });
    return inFlight;
  };

  return { restart };
}
