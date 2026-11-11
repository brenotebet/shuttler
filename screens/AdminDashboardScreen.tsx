// screens/AdminDashboardScreen.tsx
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native'
import { Text } from '../components/Text';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';
import { useOrg } from '../src/org/OrgContext';
import { isTrialExpired } from '../src/constants/planLimits';
import { useAuth } from '../src/auth/AuthProvider';
import {
  CARD_BACKGROUND,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  DANGER_COLOR,
  WHITE,
  GRAY_100,
  GRAY_200,
  GRAY_300,
  GRAY_400,
  GRAY_500,
  GRAY_700,
  GRAY_900,
  BORDER_COLOR,
} from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import { FRESHNESS_WINDOW_SECONDS, STALE_WINDOW_SECONDS } from '../src/constants/stops';
import HeaderBar from '../components/HeaderBar';
import ScreenContainer from '../components/ScreenContainer';
import { useOrgTheme } from '../src/org/useOrgTheme';

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function todayStart(): Date {
  return new Date(startOfDay(Date.now()));
}

function sevenDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Same local-date format LocationContext writes to bus.breakShiftDate.
function localDateString(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

function formatTimeAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

function getDayLabel(date: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Within this distance the bus is "at" a stop; beyond it, "near" the closest one.
const AT_STOP_METERS = 75;

const OCCUPANCY_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'Seats open', color: '#166534', bg: '#dcfce7' },
  filling: { label: 'Filling up', color: '#854d0e', bg: '#fef9c3' },
  full: { label: 'Full', color: '#991b1b', bg: '#fee2e2' },
};

// ---- Driver Analytics Types & Helpers ----

type StopStat = { stopId: string; stopName: string; count: number; pct: number };
type DriverStatsData = {
  totalAllTime: number;
  activeDays: number;
  avgPerDay: number;
  avgPerVisit: number;
  stops: StopStat[];
};
type DriverShiftData = {
  shiftCount: number;
  totalMs: number;
  avgMs: number;
  longestMs: number;
  days: { label: string; ms: number }[];
};

type WaitingRequest = { id: string; stopName: string; createdAtMs: number };

type DriverRow = {
  uid: string;
  name: string;
  isAdmin: boolean;
  isOnline: boolean;
  isGpsLost: boolean;
  secondsAgo: number | null;
  onlineDurationMs: number | null;
  todayOnlineMs: number;
  routeName: string | null;
  todayPickups: number;
  waitingRequests: WaitingRequest[];
  completedToday: number;
  cancelledToday: number;
  onBreak: boolean;
  breakEndsAtMs: number | null;
  breaksToday: number;
  occupancy: string | null;
  nearestStop: { name: string; meters: number } | null;
};

// Stats window for the expandable driver cards. Bounded so the dashboard
// stays fast as boarding history grows — full history lives in CSV export.
const DRIVER_STATS_WINDOW_DAYS = 90;
const DRIVER_SHIFT_WINDOW_DAYS = 7;

async function fetchDriverStats(uid: string, orgId: string): Promise<DriverStatsData> {
  const windowStart = Timestamp.fromMillis(Date.now() - DRIVER_STATS_WINDOW_DAYS * 86_400_000);
  // Explicit DESC order so this matches the deployed composite index
  // (driverUid ASC, createdAt DESC). Without it Firestore orders createdAt
  // ASC implicitly, needs a different index, and the query fails.
  const snap = await getDocs(
    query(
      collection(db, 'orgs', orgId, 'boardingCounts'),
      where('driverUid', '==', uid),
      where('createdAt', '>=', windowStart),
      orderBy('createdAt', 'desc'),
    ),
  );

  let totalAllTime = 0;
  const daySet = new Set<string>();
  const stopCounts: Record<string, { name: string; count: number }> = {};

  snap.docs.forEach((doc) => {
    const d = doc.data() as any;
    const count = d.count ?? 0;
    totalAllTime += count;
    daySet.add(new Date(d.createdAt?.toMillis?.() ?? 0).toDateString());
    const sid = d.stopId ?? d.stop?.id ?? 'unknown';
    const sname = d.stopName ?? d.stop?.name ?? 'Unknown stop';
    if (!stopCounts[sid]) stopCounts[sid] = { name: sname, count: 0 };
    stopCounts[sid].count += count;
  });

  const activeDays = daySet.size;
  const stops: StopStat[] = Object.entries(stopCounts)
    .map(([sid, { name, count }]) => ({ stopId: sid, stopName: name, count, pct: totalAllTime > 0 ? Math.round((count / totalAllTime) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  return {
    totalAllTime,
    activeDays,
    avgPerDay: activeDays > 0 ? Math.round(totalAllTime / activeDays) : 0,
    avgPerVisit: snap.size > 0 ? Math.round(totalAllTime / snap.size) : 0,
    stops,
  };
}

async function fetchDriverShifts(uid: string, orgId: string): Promise<DriverShiftData> {
  // Step by calendar day, not 24h — days around a DST change are 23h or 25h,
  // and fixed 24h steps duplicate or skip a day label.
  const dayStarts = Array.from({ length: DRIVER_SHIFT_WINDOW_DAYS }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (DRIVER_SHIFT_WINDOW_DAYS - 1 - i));
    return d.getTime();
  });
  const windowStartMs = dayStarts[0];
  // Matches the (driverUid ASC, startedAt DESC) index.
  const snap = await getDocs(
    query(
      collection(db, 'orgs', orgId, 'driverSessions'),
      where('driverUid', '==', uid),
      where('startedAt', '>=', Timestamp.fromMillis(windowStartMs)),
      orderBy('startedAt', 'desc'),
    ),
  );

  const days = dayStarts.map((startMs) => ({
    label: getDayLabel(new Date(startMs)),
    startMs,
    ms: 0,
  }));

  let shiftCount = 0;
  let totalMs = 0;
  let longestMs = 0;
  snap.docs.forEach((doc) => {
    const d = doc.data() as any;
    // Open sessions have no durationMs yet — the live card covers the current one.
    if (typeof d.durationMs !== 'number') return;
    shiftCount += 1;
    totalMs += d.durationMs;
    longestMs = Math.max(longestMs, d.durationMs);
    const startedMs = d.startedAt?.toMillis?.() ?? 0;
    const day = days.find((x) => x.startMs === startOfDay(startedMs));
    if (day) day.ms += d.durationMs;
  });

  return {
    shiftCount,
    totalMs,
    avgMs: shiftCount > 0 ? Math.round(totalMs / shiftCount) : 0,
    longestMs,
    days: days.map(({ label, ms }) => ({ label, ms })),
  };
}

function StatusBadge({ driver, primaryColor }: { driver: DriverRow; primaryColor: string }) {
  const variant = driver.isGpsLost
    ? { badge: styles.badgeWarn, dot: styles.dotWarn, text: styles.textWarn, label: 'GPS Lost' }
    : driver.isOnline && driver.onBreak
    ? { badge: styles.badgeBreak, dot: styles.dotBreak, text: styles.textBreak, label: 'On break' }
    : driver.isOnline
    ? { badge: styles.badgeOnline, dot: { backgroundColor: primaryColor }, text: { color: primaryColor }, label: 'Online' }
    : { badge: styles.badgeOffline, dot: styles.dotOffline, text: styles.textOffline, label: 'Offline' };
  return (
    <View style={[styles.statusBadge, variant.badge]}>
      <View style={[styles.statusDot, variant.dot]} />
      <Text style={[styles.statusText, variant.text]}>{variant.label}</Text>
    </View>
  );
}

function statusLine(driver: DriverRow, nowMs: number): string {
  if (driver.isGpsLost && driver.secondsAgo !== null) return `Signal lost ${formatTimeAgo(driver.secondsAgo)}`;
  if (driver.isOnline && driver.onBreak) {
    if (driver.breakEndsAtMs) {
      const remainingMs = driver.breakEndsAtMs - nowMs;
      return remainingMs > 0
        ? `Break ends in ${formatDuration(remainingMs)}`
        : `Break ran over by ${formatDuration(-remainingMs)}`;
    }
    return 'On break';
  }
  if (driver.isOnline && driver.onlineDurationMs !== null) {
    const updated = driver.secondsAgo !== null ? ` · GPS ${formatTimeAgo(driver.secondsAgo)}` : '';
    return `Online for ${formatDuration(driver.onlineDurationMs)}${updated}`;
  }
  if (driver.secondsAgo !== null) return `Last seen ${formatTimeAgo(driver.secondsAgo)}`;
  return 'Never connected';
}

const DriverCard = memo(function DriverCard({
  driver,
  orgId,
  nowMs,
}: {
  driver: DriverRow;
  orgId: string;
  nowMs: number;
}) {
  const { primaryColor } = useOrgTheme();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<DriverStatsData | null>(null);
  const [shifts, setShifts] = useState<DriverShiftData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (loading) return;
    setOpen(true);
    if (stats && shifts) return;
    setLoading(true);
    setFailed(false);
    try {
      const [s, sh] = await Promise.all([
        fetchDriverStats(driver.uid, orgId),
        fetchDriverShifts(driver.uid, orgId),
      ]);
      setStats(s);
      setShifts(sh);
    } catch (e) {
      console.error('Driver details load failed', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [driver.uid, orgId, stats, shifts, loading]);

  const expanded = open && !!stats && !!shifts;
  const maxStopCount = Math.max(...(stats?.stops.map((s) => s.count) ?? [1]), 1);
  const maxShiftDay = Math.max(...(shifts?.days.map((d) => d.ms) ?? [1]), 1);
  const occupancy = driver.isOnline && driver.occupancy ? OCCUPANCY_LABEL[driver.occupancy] : null;
  // "Online for X" already covers today when this is the only shift, so only
  // show the daily total when it differs (earlier shifts, or now offline).
  const showTodayOnline =
    driver.todayOnlineMs > 0 &&
    (driver.onlineDurationMs === null || driver.todayOnlineMs - driver.onlineDurationMs >= 60_000);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={open && !failed ? () => setOpen(false) : load}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityHint={open ? 'Hides driver details' : 'Shows shift history and stats'}
      accessibilityState={{ expanded, busy: loading }}
    >
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.driverName}>{driver.name}</Text>
          {driver.routeName || driver.isAdmin ? (
            <Text style={styles.routeLabel}>
              {[driver.isAdmin ? 'Admin' : null, driver.routeName].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
        <StatusBadge driver={driver} primaryColor={primaryColor} />
        {loading
          ? <ActivityIndicator size="small" color={primaryColor} style={styles.chevron} />
          : <Icon name={expanded ? 'expand-less' : 'expand-more'} size={22} color={GRAY_400} style={styles.chevron} />}
      </View>

      <Text style={styles.durationText}>{statusLine(driver, nowMs)}</Text>

      {/* Live details — only meaningful while the bus is online */}
      {driver.isOnline && (driver.nearestStop || occupancy) && (
        <View style={styles.liveRow}>
          {driver.nearestStop && (
            <View style={styles.liveItem}>
              <Icon name="place" size={13} color={GRAY_500} />
              <Text style={styles.liveText} numberOfLines={1}>
                {driver.nearestStop.meters <= AT_STOP_METERS
                  ? `At ${driver.nearestStop.name}`
                  : `Near ${driver.nearestStop.name} · ${Math.round(driver.nearestStop.meters)} m`}
              </Text>
            </View>
          )}
          {occupancy && (
            <View style={[styles.occupancyChip, { backgroundColor: occupancy.bg }]}>
              <Text style={[styles.occupancyText, { color: occupancy.color }]}>{occupancy.label}</Text>
            </View>
          )}
        </View>
      )}

      {(showTodayOnline || driver.breaksToday > 0) && (
        <View style={styles.onlineTimeRow}>
          {showTodayOnline && (
            <>
              <Icon name="timer" size={13} color={GRAY_500} />
              <Text style={styles.onlineTimeText}>{formatDuration(driver.todayOnlineMs)} online today</Text>
            </>
          )}
          {driver.breaksToday > 0 && (
            <>
              <Icon name="free-breakfast" size={13} color={GRAY_500} style={showTodayOnline ? { marginLeft: 8 } : undefined} />
              <Text style={styles.onlineTimeText}>
                {driver.breaksToday} break{driver.breaksToday === 1 ? '' : 's'}
              </Text>
            </>
          )}
        </View>
      )}

      {/* Today stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{driver.todayPickups}</Text>
          <Text style={styles.statLabel}>Riders boarded</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{driver.waitingRequests.length}</Text>
          <Text style={styles.statLabel}>Waiting</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{driver.completedToday}</Text>
          <Text style={styles.statLabel}>Requests done</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={[styles.statValue, driver.cancelledToday > 0 && styles.statValueWarn]}>
            {driver.cancelledToday}
          </Text>
          <Text style={styles.statLabel}>Cancelled</Text>
        </View>
      </View>

      {open && failed && (
        <Text style={styles.analyticsError}>Couldn't load driver details. Tap to retry.</Text>
      )}

      {expanded && stats && shifts && (
        <View style={styles.expandedSection}>
          {/* Waiting requests */}
          {driver.waitingRequests.length > 0 && (
            <>
              <Text style={styles.analyticsStopTitle}>Riders waiting{driver.routeName ? ' on this route' : ''}</Text>
              {driver.waitingRequests.slice(0, 6).map((r) => (
                <View key={r.id} style={styles.waitingRow}>
                  <Text style={styles.waitingStop} numberOfLines={1}>{r.stopName}</Text>
                  <Text style={styles.waitingAge}>
                    {r.createdAtMs ? `waiting ${formatTimeAgo((nowMs - r.createdAtMs) / 1000).replace(' ago', '')}` : ''}
                  </Text>
                </View>
              ))}
              {driver.waitingRequests.length > 6 && (
                <Text style={styles.moreText}>+{driver.waitingRequests.length - 6} more</Text>
              )}
            </>
          )}

          {/* Shift history */}
          <Text style={styles.analyticsStopTitle}>Shifts — last {DRIVER_SHIFT_WINDOW_DAYS} days</Text>
          {shifts.shiftCount === 0 ? (
            <Text style={styles.analyticsEmpty}>No completed shifts in the last {DRIVER_SHIFT_WINDOW_DAYS} days.</Text>
          ) : (
            <>
              <View style={styles.analyticsChipsTight}>
                {[
                  { label: 'Shifts', value: String(shifts.shiftCount) },
                  { label: 'Hours online', value: formatDuration(shifts.totalMs) },
                  { label: 'Avg shift', value: formatDuration(shifts.avgMs) },
                  { label: 'Longest', value: formatDuration(shifts.longestMs) },
                ].map((chip) => (
                  <View key={chip.label} style={styles.analyticsChip}>
                    <Text style={[styles.analyticsChipValueSm, { color: primaryColor }]}>{chip.value}</Text>
                    <Text style={styles.analyticsChipLabel}>{chip.label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.shiftBarsRow}>
                {shifts.days.map((d, i) => (
                  <View key={`${d.label}-${i}`} style={styles.trendCol}>
                    <View style={styles.shiftBarBg}>
                      <View
                        style={[
                          styles.trendBar,
                          { height: d.ms > 0 ? Math.max(3, (d.ms / maxShiftDay) * 32) : 0, backgroundColor: primaryColor },
                        ]}
                      />
                    </View>
                    <Text style={styles.trendLabel}>{d.label}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* 90-day boarding stats */}
          <Text style={styles.analyticsStopTitle}>Boardings — last {DRIVER_STATS_WINDOW_DAYS} days</Text>
          {stats.totalAllTime === 0 ? (
            <Text style={styles.analyticsEmpty}>No boardings logged in the last {DRIVER_STATS_WINDOW_DAYS} days.</Text>
          ) : (
            <>
              <View style={styles.analyticsChipsTight}>
                {[
                  { label: 'Boarded', value: stats.totalAllTime },
                  { label: 'Active days', value: stats.activeDays },
                  { label: 'Avg/day', value: stats.avgPerDay },
                  { label: 'Avg/stop', value: stats.avgPerVisit },
                ].map((chip) => (
                  <View key={chip.label} style={styles.analyticsChip}>
                    <Text style={[styles.analyticsChipValue, { color: primaryColor }]}>{chip.value}</Text>
                    <Text style={styles.analyticsChipLabel}>{chip.label}</Text>
                  </View>
                ))}
              </View>
              {stats.stops.slice(0, 8).map((s) => (
                <View key={s.stopId} style={styles.analyticsStopRow}>
                  <Text style={styles.analyticsStopName} numberOfLines={1}>{s.stopName}</Text>
                  <View style={styles.analyticsBarBg}>
                    <View style={[styles.analyticsBar, { width: `${Math.max(4, (s.count / maxStopCount) * 100)}%` as any, backgroundColor: primaryColor }]} />
                  </View>
                  <Text style={styles.analyticsStopCount}>{s.count}</Text>
                </View>
              ))}
            </>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
});

export default function AdminDashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { org } = useOrg();
  const { orgId } = useAuth();
  const { primaryColor } = useOrgTheme();
  // Memoized: a fresh `[]` each render would invalidate the driverRows memo.
  const orgRoutes = useMemo(() => org?.routes ?? [], [org?.routes]);
  const orgStops = useMemo(() => org?.stops ?? [], [org?.stops]);

  const [drivers, setDrivers] = useState<any[]>([]);
  const [buses, setBuses] = useState<Record<string, any>>({});
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [todayRequests, setTodayRequests] = useState<any[]>([]);
  const [weekBoardings, setWeekBoardings] = useState<any[]>([]);
  const [todaySessions, setTodaySessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(Date.now());
  const [driverQuery, setDriverQuery] = useState('');

  useEffect(() => {
    // 30s keeps "online for" / break countdowns reasonably current.
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Changes at local midnight, which re-subscribes the "today" queries below.
  // Previously they kept their mount-time start and counted yesterday forever.
  const dayStartMs = startOfDay(tick);

  // All drivers/admins in the org
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      collection(db, 'orgs', orgId, 'users'),
      (snap) => {
        const all = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
        setDrivers(all.filter((u) => u.role === 'driver' || u.role === 'admin'));
        setLoading(false);
      },
      (err) => {
        console.error('AdminDashboard users snapshot error', err);
        setLoading(false);
      },
    );
  }, [orgId]);

  // Live bus docs
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      collection(db, 'orgs', orgId, 'buses'),
      (snap) => {
        const map: Record<string, any> = {};
        snap.docs.forEach((d) => {
          map[d.id] = { id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as any) };
        });
        setBuses(map);
      },
      (err) => console.error('AdminDashboard buses snapshot error', err),
    );
  }, [orgId]);

  // Currently open stop requests (any date — TTL is 15 min so set is small)
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'stopRequests'),
        where('status', 'in', ['pending', 'accepted']),
      ),
      (snap) => setActiveRequests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => console.error('AdminDashboard active requests snapshot error', err),
    );
  }, [orgId]);

  // Today's stop requests (all statuses — for completed/cancelled/completion rate)
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'stopRequests'),
        where('createdAt', '>=', Timestamp.fromMillis(dayStartMs)),
      ),
      (snap) => setTodayRequests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => console.error('AdminDashboard today requests snapshot error', err),
    );
  }, [orgId, dayStartMs]);

  // Today's driver sessions (for time-online stats)
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'driverSessions'),
        where('startedAt', '>=', Timestamp.fromMillis(dayStartMs)),
      ),
      (snap) => setTodaySessions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => console.error('AdminDashboard sessions snapshot error', err),
    );
  }, [orgId, dayStartMs]);

  // Last 7 days of boarding counts (pickups)
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'boardingCounts'),
        where('createdAt', '>=', Timestamp.fromDate(sevenDaysAgo())),
        orderBy('createdAt', 'asc'),
      ),
      (snap) => setWeekBoardings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => console.error('AdminDashboard boardings snapshot error', err),
    );
  }, [orgId, dayStartMs]);

  // --- Per-driver indexes (built once per data change, not once per driver) ---
  const todayPickupsByDriver = useMemo(() => {
    const map: Record<string, number> = {};
    weekBoardings.forEach((b) => {
      if (!b.driverUid || (b.createdAt?.toMillis?.() ?? 0) < dayStartMs) return;
      map[b.driverUid] = (map[b.driverUid] ?? 0) + (b.count ?? 0);
    });
    return map;
  }, [weekBoardings, dayStartMs]);

  const todayRequestsByDriver = useMemo(() => {
    const map: Record<string, { completed: number; cancelled: number }> = {};
    todayRequests.forEach((r) => {
      const uid = r.driverUid ?? r.driverId;
      if (!uid) return;
      if (!map[uid]) map[uid] = { completed: 0, cancelled: 0 };
      // awaiting_confirmation = driver logged the pickup, rider hasn't confirmed yet.
      if (r.status === 'completed' || r.status === 'awaiting_confirmation') map[uid].completed += 1;
      else if (r.status === 'cancelled') map[uid].cancelled += 1;
    });
    return map;
  }, [todayRequests]);

  // Admins only appear in the driver list if they actually drove recently;
  // otherwise every non-driving admin shows up as a row of zeros.
  const boardedThisWeek = useMemo(() => {
    const set = new Set<string>();
    weekBoardings.forEach((b) => { if (b.driverUid) set.add(b.driverUid); });
    return set;
  }, [weekBoardings]);

  const sessionMsByDriver = useMemo(() => {
    const map: Record<string, number> = {};
    todaySessions.forEach((s) => {
      if (!s.driverUid || s.durationMs == null) return;
      map[s.driverUid] = (map[s.driverUid] ?? 0) + s.durationMs;
    });
    return map;
  }, [todaySessions]);

  // --- Derived: per-driver rows ---
  const driverRows = useMemo<DriverRow[]>(() => {
    const nowMs = tick;
    const todayKey = localDateString(nowMs);

    const activeSinceMs = sevenDaysAgo().getTime();
    const isActiveAdmin = (uid: string) => {
      const bus = buses[uid];
      const lastMs: number = bus?.updatedAt?.toMillis?.() ?? bus?.lastSeen?.toMillis?.() ?? 0;
      // Not bus.online: it stays true when the app dies mid-shift, so an admin
      // who drove once weeks ago would show forever.
      return lastMs >= activeSinceMs || boardedThisWeek.has(uid);
    };

    return drivers
      .filter((user) => user.role === 'driver' || (user.role === 'admin' && isActiveAdmin(user.uid)))
      .map((user) => {
        const uid = user.uid;
        const bus = buses[uid] ?? null;

        const lastMs: number | null =
          bus?.updatedAt?.toMillis?.() ?? bus?.lastSeen?.toMillis?.() ?? null;
        const secondsAgo = lastMs !== null ? Math.max(0, (nowMs - lastMs) / 1000) : null;

        const isOnline =
          bus?.online === true &&
          secondsAgo !== null &&
          secondsAgo < STALE_WINDOW_SECONDS;
        const isFresh =
          isOnline && secondsAgo !== null && secondsAgo < FRESHNESS_WINDOW_SECONDS;
        const onBreak = isOnline && bus?.onBreak === true;
        // A driver on break may stop sending GPS — that's expected, not "lost".
        const isGpsLost = isOnline && !isFresh && !onBreak;

        const sessionStartMs: number | null = bus?.sessionStartAt?.toMillis?.() ?? null;
        const onlineDurationMs =
          isOnline && sessionStartMs ? Math.max(0, nowMs - sessionStartMs) : null;

        const routeId = bus?.routeId ?? null;
        const routeName = orgRoutes.find((r) => r.id === routeId)?.name ?? null;

        // Requests aren't assigned to a driver until pickup, so "waiting" is
        // every pending request on this driver's route (or all, if no route).
        const waitingRequests: WaitingRequest[] = isOnline
          ? activeRequests
              .filter((r) => {
                if (r.status !== 'pending' && r.status !== 'accepted') return false;
                const assigned = r.driverUid ?? r.driverId ?? null;
                if (assigned) return assigned === uid;
                return !routeId || !r.routeId || r.routeId === routeId;
              })
              .map((r) => ({
                id: r.id,
                stopName: r.stop?.name ?? 'Unknown stop',
                createdAtMs: r.createdAt?.toMillis?.() ?? 0,
              }))
              .sort((a, b) => a.createdAtMs - b.createdAtMs)
          : [];

        const reqs = todayRequestsByDriver[uid] ?? { completed: 0, cancelled: 0 };

        const todayOnlineMs = (sessionMsByDriver[uid] ?? 0) + (onlineDurationMs ?? 0);

        let nearestStop: DriverRow['nearestStop'] = null;
        if (isOnline && typeof bus?.latitude === 'number' && typeof bus?.longitude === 'number') {
          for (const stop of orgStops) {
            const meters = getDistanceInMeters(bus.latitude, bus.longitude, stop.latitude, stop.longitude);
            if (!nearestStop || meters < nearestStop.meters) nearestStop = { name: stop.name, meters };
          }
        }

        const breakEndsAtMs: number | null =
          bus?.breakEndsAt?.toMillis?.() ?? (bus?.breakEndsAt instanceof Date ? bus.breakEndsAt.getTime() : null);

        return {
          uid,
          name: user.displayName ?? user.email ?? uid,
          isAdmin: user.role === 'admin',
          isOnline,
          isGpsLost,
          secondsAgo,
          onlineDurationMs,
          todayOnlineMs,
          routeName,
          todayPickups: todayPickupsByDriver[uid] ?? 0,
          waitingRequests,
          completedToday: reqs.completed,
          cancelledToday: reqs.cancelled,
          onBreak,
          breakEndsAtMs: onBreak ? breakEndsAtMs : null,
          breaksToday: bus?.breakShiftDate === todayKey ? (bus?.breaksTakenThisShift ?? 0) : 0,
          occupancy: typeof bus?.occupancy === 'string' ? bus.occupancy : null,
          nearestStop,
        };
      })
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [drivers, buses, activeRequests, todayRequestsByDriver, todayPickupsByDriver, sessionMsByDriver, boardedThisWeek, orgRoutes, orgStops, tick]);

  const filteredDriverRows = useMemo(() => {
    const q = driverQuery.toLowerCase().trim();
    return q ? driverRows.filter((d) => d.name.toLowerCase().includes(q)) : driverRows;
  }, [driverQuery, driverRows]);

  // --- Derived: fleet summary ---
  const fleetSummary = useMemo(() => {
    let todayPickups = 0;
    Object.values(todayPickupsByDriver).forEach((n) => { todayPickups += n; });
    return {
      onlineCount: driverRows.filter((d) => d.isOnline).length,
      onBreakCount: driverRows.filter((d) => d.onBreak).length,
      totalDrivers: driverRows.length,
      totalActive: activeRequests.length,
      todayPickups,
    };
  }, [driverRows, activeRequests, todayPickupsByDriver]);

  // --- Derived: busiest stops today ---
  const busiestStops = useMemo(() => {
    // A request created today that's still open is in BOTH lists — dedupe by
    // id so it isn't counted twice.
    const byId = new Map<string, any>();
    todayRequests.forEach((r) => byId.set(r.id, r));
    activeRequests.forEach((r) => byId.set(r.id, r));
    const counts: Record<string, { name: string; count: number }> = {};
    byId.forEach((r) => {
      const id = r.stop?.id ?? r.stopId;
      const name = r.stop?.name ?? id ?? 'Unknown';
      if (!id) return;
      if (!counts[id]) counts[id] = { name, count: 0 };
      counts[id].count++;
    });
    return Object.entries(counts)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [activeRequests, todayRequests]);

  // --- Derived: 7-day pickup trend ---
  const weekTrend = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(dayStartMs);
      d.setDate(d.getDate() - (6 - i));
      return { label: getDayLabel(d), dateMs: d.getTime(), count: 0 };
    });
    weekBoardings.forEach((b) => {
      const ms = b.createdAt?.toMillis?.() ?? 0;
      for (let i = days.length - 1; i >= 0; i--) {
        if (ms >= days[i].dateMs) {
          days[i].count += b.count ?? 0;
          break;
        }
      }
    });
    return days;
  }, [weekBoardings, dayStartMs]);

  const maxTrend = useMemo(
    () => Math.max(...weekTrend.map((d) => d.count), 1),
    [weekTrend],
  );

  if (loading) {
    return (
      <ScreenContainer padded={false}>
        <HeaderBar title="Dashboard" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="Dashboard" />
      {org?.subscriptionStatus === 'past_due' && (
        <TouchableOpacity
          style={styles.pastDueBanner}
          onPress={() => navigation.navigate('AdminOrgSetup')}
          activeOpacity={0.8}
        >
          <Icon name="warning" size={16} color="#7c2d12" />
          <Text style={styles.pastDueBannerText}>Payment failed — subscription past due.</Text>
          <Text style={styles.pastDueBannerLink}>Fix billing →</Text>
        </TouchableOpacity>
      )}
      {isTrialExpired(org?.subscriptionStatus, org?.trialEndsAtMs) && (
        <TouchableOpacity
          style={styles.pastDueBanner}
          onPress={() => navigation.navigate('AdminOrgSetup')}
          activeOpacity={0.8}
        >
          <Icon name="warning" size={16} color="#7c2d12" />
          <Text style={styles.pastDueBannerText}>Free trial ended — buses and riders are paused.</Text>
          <Text style={styles.pastDueBannerLink}>Choose a plan →</Text>
        </TouchableOpacity>
      )}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Fleet Summary */}
        <View style={[styles.summaryRow, { backgroundColor: primaryColor }]}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>
              {fleetSummary.onlineCount}/{fleetSummary.totalDrivers}
            </Text>
            <Text style={styles.summaryLabel}>
              {fleetSummary.onBreakCount > 0 ? `Online · ${fleetSummary.onBreakCount} on break` : 'Online'}
            </Text>
          </View>
          <View style={styles.summarySep} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{fleetSummary.todayPickups}</Text>
            <Text style={styles.summaryLabel}>Boarded today</Text>
          </View>
          <View style={styles.summarySep} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{fleetSummary.totalActive}</Text>
            <Text style={styles.summaryLabel}>Riders waiting</Text>
          </View>
        </View>

        {/* Drivers */}
        <Text style={styles.sectionTitle}>Drivers</Text>

        {driverRows.length === 0 && (
          <View style={styles.driversEmptyState}>
            <Icon name="directions-bus" size={40} color={GRAY_300} />
            <Text style={styles.driversEmptyTitle}>No drivers yet</Text>
            <Text style={styles.driversEmptyHint}>
              Invite drivers from Org Setup → Users, then ask them to sign in and go online.
            </Text>
            <TouchableOpacity
              style={[styles.driversEmptyBtn, { borderColor: primaryColor }]}
              onPress={() => navigation.navigate('AdminOrgSetup', { initialTab: 'users' })}
            >
              <Icon name="person-add" size={16} color={primaryColor} />
              <Text style={[styles.driversEmptyBtnText, { color: primaryColor }]}>Go to Org Setup</Text>
            </TouchableOpacity>
          </View>
        )}

        {driverRows.length > 5 && (
          <View style={styles.analyticsSearchRow}>
            <Icon name="search" size={18} color={GRAY_400} style={{ marginRight: 6 }} />
            <TextInput
              style={styles.analyticsSearchInput}
              placeholder="Search drivers…"
              placeholderTextColor={GRAY_400}
              value={driverQuery}
              onChangeText={setDriverQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        {driverRows.length > 0 && (
          <Text style={styles.sectionHint}>Tap a driver for shift history and stats.</Text>
        )}

        {filteredDriverRows.map((driver) => (
          <DriverCard key={driver.uid} driver={driver} orgId={orgId ?? ''} nowMs={tick} />
        ))}

        {/* Busiest Stops */}
        {busiestStops.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Busiest Stops Today</Text>
            <View style={styles.card}>
              {busiestStops.map((stop, idx) => (
                <View
                  key={stop.id}
                  style={[
                    styles.stopRow,
                    idx < busiestStops.length - 1 && styles.stopRowBorder,
                  ]}
                >
                  <Text style={styles.stopRank}>{idx + 1}</Text>
                  <Text style={styles.stopName} numberOfLines={1}>
                    {stop.name}
                  </Text>
                  <Text style={[styles.stopCount, { color: primaryColor }]}>{stop.count}</Text>
                  <Text style={styles.stopCountLabel}> req</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* 7-Day Trend */}
        <Text style={styles.sectionTitle}>Boardings — Last 7 Days</Text>
        <View style={styles.card}>
          <View style={styles.trendRow}>
            {weekTrend.map((day) => (
              <View key={day.label} style={styles.trendCol}>
                <Text style={styles.trendCount}>{day.count}</Text>
                <View style={styles.trendBarBg}>
                  <View
                    style={[
                      styles.trendBar,
                      { height: day.count > 0 ? Math.max(4, (day.count / maxTrend) * 48) : 0, backgroundColor: primaryColor },
                    ]}
                  />
                </View>
                <Text style={styles.trendLabel}>{day.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={styles.analyticsLink}
          onPress={() => navigation.navigate('AdminAnalytics')}
          accessibilityRole="link"
        >
          <Text style={[styles.analyticsLinkText, { color: primaryColor }]}>
            Longer trends, AI insights, and data exports are in Analytics →
          </Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  pastDueBanner: {
    backgroundColor: '#fef2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#fca5a5',
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pastDueBannerText: { flex: 1, fontSize: 13, color: '#7c2d12', fontWeight: '500' },
  pastDueBannerLink: { fontSize: 13, color: DANGER_COLOR, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.section,
  },

  // Fleet summary bar
  summaryRow: {
    flexDirection: 'row',
    borderRadius: borderRadius.xl,
    paddingVertical: 18,
    marginBottom: 22,
    ...cardShadow,
  },
  summaryCell: { flex: 1, alignItems: 'center' },
  summarySep: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginVertical: 4,
  },
  summaryValue: { fontSize: 22, fontWeight: '700', color: WHITE },
  summaryLabel: { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 2 },

  // Section heading
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 8,
    marginTop: 2,
  },
  emptyText: { color: TEXT_SECONDARY, fontSize: 14, marginBottom: 16 },
  driversEmptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 8,
  },
  driversEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: GRAY_700,
    marginTop: 8,
  },
  driversEmptyHint: {
    fontSize: 13,
    color: GRAY_400,
    textAlign: 'center',
    lineHeight: 19,
  },
  driversEmptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  driversEmptyBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Generic card
  card: {
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    padding: 16,
    marginBottom: 14,
    ...cardShadow,
  },

  // Driver card
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  driverName: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY },
  routeLabel: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },

  // Status badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.xl,
  },
  badgeOnline: { backgroundColor: '#dcfce7' },
  badgeOffline: { backgroundColor: '#f1f5f9' },
  badgeWarn: { backgroundColor: '#fef9c3' },
  badgeBreak: { backgroundColor: '#e0f2fe' },
  dotBreak: { backgroundColor: '#0284c7' },
  textBreak: { color: '#075985' },
  chevron: { marginLeft: 6, marginTop: 2 },
  sectionHint: { fontSize: 12, color: GRAY_400, marginTop: -4, marginBottom: 8 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  liveItem: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  liveText: { fontSize: 12, color: GRAY_700, flexShrink: 1 },
  occupancyChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.xl },
  occupancyText: { fontSize: 11, fontWeight: '600' },
  expandedSection: { marginTop: 12, paddingTop: 2, borderTopWidth: 1, borderTopColor: GRAY_100 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  waitingStop: { flex: 1, fontSize: 13, color: TEXT_PRIMARY },
  waitingAge: { fontSize: 12, color: TEXT_SECONDARY },
  moreText: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  analyticsChipsTight: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  analyticsChipValueSm: { fontSize: 15, fontWeight: '700' },
  shiftBarsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', marginBottom: 4 },
  shiftBarBg: { width: 18, height: 32, justifyContent: 'flex-end', backgroundColor: BORDER_COLOR, borderRadius: 3, overflow: 'hidden' },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  dotOnline: {},
  dotOffline: { backgroundColor: '#94a3b8' },
  dotWarn: { backgroundColor: '#eab308' },
  statusText: { fontSize: 12, fontWeight: '600' },
  textOnline: {},
  textOffline: { color: TEXT_SECONDARY },
  textWarn: { color: '#854d0e' },

  durationText: { fontSize: 12, color: TEXT_SECONDARY, marginBottom: 4 },
  onlineTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  onlineTimeText: { fontSize: 12, color: GRAY_500 },

  // Driver stats row
  statsRow: { flexDirection: 'row' },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY },
  statValueWarn: { color: DANGER_COLOR },
  statLabel: { fontSize: 10, color: TEXT_SECONDARY, marginTop: 2 },

  // Busiest stops
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  stopRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER_COLOR },
  stopRank: {
    width: 22,
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_SECONDARY,
  },
  stopName: { flex: 1, fontSize: 14, fontWeight: '500', color: TEXT_PRIMARY },
  stopCount: { fontSize: 15, fontWeight: '700' },
  stopCountLabel: { fontSize: 12, color: TEXT_SECONDARY },

  // Driver Analytics
  analyticsSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: GRAY_200,
    marginBottom: 10,
  },
  analyticsSearchInput: { flex: 1, fontSize: 14, color: GRAY_900 },
  analyticsError: { marginTop: 12, fontSize: 13, color: DANGER_COLOR },
  analyticsEmpty: { marginTop: 12, fontSize: 13, color: TEXT_SECONDARY },
  analyticsChip: {
    backgroundColor: '#f8fafc',
    borderRadius: borderRadius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 70,
  },
  analyticsChipValue: { fontSize: 18, fontWeight: '700' },
  analyticsChipLabel: { fontSize: 10, color: TEXT_SECONDARY, marginTop: 2 },
  analyticsStopTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 8,
  },
  analyticsStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  analyticsStopName: { width: 100, fontSize: 12, color: TEXT_PRIMARY, fontWeight: '500' },
  analyticsBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: BORDER_COLOR,
    borderRadius: 4,
    overflow: 'hidden',
  },
  analyticsBar: { height: '100%', borderRadius: 4 },
  analyticsStopCount: { width: 28, textAlign: 'right', fontSize: 12, fontWeight: '600', color: TEXT_PRIMARY },

  analyticsLink: { alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  analyticsLinkText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },

  // 7-day bar chart
  trendRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
  },
  trendCol: { alignItems: 'center', flex: 1 },
  trendCount: {
    fontSize: 11,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  trendBarBg: {
    width: 24,
    height: 48,
    justifyContent: 'flex-end',
    backgroundColor: BORDER_COLOR,
    borderRadius: 4,
    overflow: 'hidden',
  },
  trendBar: { width: '100%', borderRadius: 4 },
  trendLabel: { fontSize: 10, color: TEXT_SECONDARY, marginTop: 4 },
});
