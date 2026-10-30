export const STUDENT_REQUEST_TTL_MS = 15 * 60 * 1000; // 15 minutes

// The three "how stale is too stale" windows used for bus GPS freshness.
// Kept distinct on purpose — they answer different questions — but centralized
// here so a future tweak to any one of them doesn't need to be hunted down
// across screens/DriverScreen.tsx, screens/AdminDashboardScreen.tsx,
// screens/MapScreen.tsx, and location/LocationContext.tsx.

// "Actively broadcasting right now" — the only buses riders see on the map,
// counts toward the "N buses online" chip, and gates whether a rider can
// request a pickup. Drivers heartbeat every ~15s, so this leaves room for a
// few missed writes; matches ONLINE_BUS_STALE_SECONDS.
export const FRESHNESS_WINDOW_SECONDS = 90;

// A visible bus whose last update is at least this old gets an "Updated Xs
// ago" label on the rider map — with the heartbeat, that only happens when
// something is actually wrong (signal, backgrounded app).
export const LATE_UPDATE_LABEL_SECONDS = 30;

// Marker stays visible (dimmed) on the map up to this age before being
// dropped entirely; also the cutoff for counting a bus toward the
// online-vehicle-limit check when a driver starts sharing.
export const STALE_WINDOW_SECONDS = 180;

// Used only when a driver goes offline: is there *another* bus recent enough
// to hand pending requests off to, before giving up and cancelling them.
export const ONLINE_BUS_STALE_SECONDS = 90;

export const LOCATIONS = [
  { id: 'stop1', name: 'MPCC', latitude: 38.61071, longitude: -89.81481 },
  { id: 'stop2', name: 'PAC', latitude: 38.6079, longitude: -89.81561 },
  { id: 'stop3', name: 'Performance Center', latitude: 38.59875, longitude: -89.82447 },
  { id: 'stop4', name: 'Carnegie Hall', latitude: 38.60699, longitude: -89.81709 },
  { id: 'stop5', name: 'McKendree West Clubhouse', latitude: 38.60573, longitude: -89.82468 },
];
