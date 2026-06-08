// screens/AdminDashboardScreen.tsx
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, TextInput, Share } from 'react-native'
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
import { useAuth } from '../src/auth/AuthProvider';
import {
  CARD_BACKGROUND,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  DANGER_COLOR,
} from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import { FRESHNESS_WINDOW_SECONDS } from '../src/constants/stops';
import HeaderBar from '../components/HeaderBar';
import ScreenContainer from '../components/ScreenContainer';
import { useOrgTheme } from '../src/org/useOrgTheme';

const STALE_WINDOW_SECONDS = 180;
const GPS_LOST_SECONDS = 60;

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function sevenDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  d.setHours(0, 0, 0, 0);
  return d;
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
  return `${Math.round(seconds / 3600)}h ago`;
}

function getDayLabel(date: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

// ---- Driver Analytics Types & Helpers ----

type StopStat = { stopId: string; stopName: string; count: number; pct: number };
type DriverStatsData = {
  uid: string;
  name: string;
  totalAllTime: number;
  totalToday: number;
  todayVisits: number;
  activeDays: number;
  avgPerDay: number;
  avgPerVisit: number;
  topStop: string | null;
  stops: StopStat[];
};

async function fetchDriverStats(uid: string, orgId: string): Promise<DriverStatsData | null> {
  try {
    const snap = await getDocs(
      query(collection(db, 'orgs', orgId, 'boardingCounts'), where('driverUid', '==', uid)),
    );
    const docs = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));

    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const midnightMs = midnight.getTime();

    let totalAllTime = 0;
    let totalToday = 0;
    let todayVisits = 0;
    const daySet = new Set<string>();
    const stopCounts: Record<string, { name: string; count: number }> = {};

    for (const d of docs) {
      const count = d.count ?? 0;
      const ms = d.createdAt?.toMillis?.() ?? 0;
      totalAllTime += count;
      const dayKey = new Date(ms).toDateString();
      daySet.add(dayKey);
      if (ms >= midnightMs) { totalToday += count; todayVisits++; }
      const sid = d.stopId ?? d.stop?.id ?? 'unknown';
      const sname = d.stopName ?? d.stop?.name ?? 'Unknown stop';
      if (!stopCounts[sid]) stopCounts[sid] = { name: sname, count: 0 };
      stopCounts[sid].count += count;
    }

    const activeDays = daySet.size;
    const stops: StopStat[] = Object.entries(stopCounts)
      .map(([sid, { name, count }]) => ({ stopId: sid, stopName: name, count, pct: totalAllTime > 0 ? Math.round((count / totalAllTime) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    return {
      uid,
      name: '',
      totalAllTime,
      totalToday,
      todayVisits,
      activeDays,
      avgPerDay: activeDays > 0 ? Math.round(totalAllTime / activeDays) : 0,
      avgPerVisit: docs.length > 0 ? Math.round(totalAllTime / docs.length) : 0,
      topStop: stops[0]?.stopName ?? null,
      stops,
    };
  } catch (e) {
    console.error('fetchDriverStats error', e);
    return null;
  }
}

const DriverStatCard = memo(function DriverStatCard({ driver, orgId }: { driver: { uid: string; name: string }; orgId: string }) {
  const { primaryColor } = useOrgTheme();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<DriverStatsData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (stats) { setOpen(true); return; }
    setLoading(true);
    const s = await fetchDriverStats(driver.uid, orgId);
    if (s) { s.name = driver.name; setStats(s); }
    setLoading(false);
    setOpen(true);
  }, [driver, orgId, stats]);

  const maxStopCount = Math.max(...(stats?.stops.map((s) => s.count) ?? [1]), 1);

  return (
    <TouchableOpacity style={styles.card} onPress={open ? () => setOpen(false) : load} activeOpacity={0.85}>
      <View style={styles.analyticsCardHeader}>
        <View style={styles.analyticsIconWrap}>
          <Icon name="person" size={18} color={primaryColor} />
        </View>
        <Text style={styles.analyticsDriverName}>{driver.name}</Text>
        {loading
          ? <ActivityIndicator size="small" color={primaryColor} />
          : <Icon name={open ? 'expand-less' : 'bar-chart'} size={20} color="#9ca3af" />}
      </View>

      {open && stats && (
        <>
          <View style={styles.analyticsChips}>
            {[
              { label: 'All-time', value: stats.totalAllTime },
              { label: 'Today', value: stats.totalToday },
              { label: 'Active days', value: stats.activeDays },
              { label: 'Avg/day', value: stats.avgPerDay },
              { label: 'Avg/visit', value: stats.avgPerVisit },
            ].map((chip) => (
              <View key={chip.label} style={styles.analyticsChip}>
                <Text style={[styles.analyticsChipValue, { color: primaryColor }]}>{chip.value}</Text>
                <Text style={styles.analyticsChipLabel}>{chip.label}</Text>
              </View>
            ))}
          </View>

          {stats.stops.length > 0 && (
            <>
              <Text style={styles.analyticsStopTitle}>Stop breakdown</Text>
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
        </>
      )}
    </TouchableOpacity>
  );
});

export default function AdminDashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { org } = useOrg();
  const { orgId } = useAuth();
  const { primaryColor } = useOrgTheme();
  const orgRoutes = org?.routes ?? [];

  const [drivers, setDrivers] = useState<any[]>([]);
  const [buses, setBuses] = useState<Record<string, any>>({});
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [todayRequests, setTodayRequests] = useState<any[]>([]);
  const [weekBoardings, setWeekBoardings] = useState<any[]>([]);
  const [todaySessions, setTodaySessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(Date.now());
  const [analyticsQuery, setAnalyticsQuery] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

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

  // Currently active stop requests (any date — TTL is 15 min so set is small)
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'stopRequests'),
        where('status', 'in', ['pending', 'accepted']),
      ),
      (snap) => setActiveRequests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
    );
  }, [orgId]);

  // Today's stop requests (all statuses — for completed/cancelled/response-rate)
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'stopRequests'),
        where('createdAt', '>=', Timestamp.fromDate(todayStart())),
      ),
      (snap) => setTodayRequests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
    );
  }, [orgId]);

  // Today's driver sessions (for time-online stats)
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'driverSessions'),
        where('startedAt', '>=', Timestamp.fromDate(todayStart())),
      ),
      (snap) => setTodaySessions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => {},
    );
  }, [orgId]);

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
    );
  }, [orgId]);

  // --- Derived: per-driver stats ---
  const driverStats = useMemo(() => {
    const nowMs = tick;
    const todayMs = todayStart().getTime();

    return drivers
      .map((user) => {
        const uid = user.uid;
        const bus = buses[uid] ?? null;

        const lastMs: number | null =
          bus?.updatedAt?.toMillis?.() ?? bus?.lastSeen?.toMillis?.() ?? null;
        const secondsAgo = lastMs !== null ? (nowMs - lastMs) / 1000 : null;

        const isOnline =
          bus?.online === true &&
          secondsAgo !== null &&
          secondsAgo < STALE_WINDOW_SECONDS;
        const isGpsLost =
          isOnline && secondsAgo !== null && secondsAgo >= GPS_LOST_SECONDS;
        const isFresh =
          isOnline && secondsAgo !== null && secondsAgo < FRESHNESS_WINDOW_SECONDS;

        const sessionStartMs: number | null = bus?.sessionStartAt?.toMillis?.() ?? null;
        const onlineDurationMs =
          isOnline && sessionStartMs ? nowMs - sessionStartMs : null;

        const routeId = bus?.routeId ?? null;
        const routeName = orgRoutes.find((r) => r.id === routeId)?.name ?? null;

        const todayPickups = weekBoardings
          .filter((b) => b.driverUid === uid && (b.createdAt?.toMillis?.() ?? 0) >= todayMs)
          .reduce((sum, b) => sum + (b.count ?? 0), 0);

        // Active requests: assigned to this driver, or unassigned pending
        const activeCount = activeRequests.filter((r) => {
          const assigned = r.driverUid ?? r.driverId ?? null;
          return assigned === uid || (r.status === 'pending' && !assigned);
        }).length;

        const myToday = todayRequests.filter(
          (r) => (r.driverUid ?? r.driverId) === uid,
        );
        const completedToday = myToday.filter((r) => r.status === 'completed').length;
        const cancelledToday = myToday.filter((r) => r.status === 'cancelled').length;
        const totalClosed = completedToday + cancelledToday;
        const responseRate =
          totalClosed > 0 ? Math.round((completedToday / totalClosed) * 100) : null;

        // Sum up completed session durations today + current live session if online
        const completedSessionsToday = todaySessions.filter(
          (s) => s.driverUid === uid && s.durationMs != null,
        );
        const completedMs = completedSessionsToday.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
        const todayOnlineMs = completedMs + (onlineDurationMs ?? 0);

        return {
          uid,
          name: user.displayName ?? user.email ?? uid,
          isOnline,
          isGpsLost,
          isFresh,
          secondsAgo,
          onlineDurationMs,
          todayOnlineMs,
          routeName,
          todayPickups,
          activeCount,
          completedToday,
          cancelledToday,
          responseRate,
        };
      })
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [drivers, buses, activeRequests, todayRequests, weekBoardings, todaySessions, orgRoutes, tick]);

  // --- Derived: fleet summary ---
  const fleetSummary = useMemo(() => {
    const todayMs = todayStart().getTime();
    return {
      onlineCount: driverStats.filter((d) => d.isOnline).length,
      totalDrivers: driverStats.length,
      totalActive: activeRequests.length,
      todayPickups: weekBoardings
        .filter((b) => (b.createdAt?.toMillis?.() ?? 0) >= todayMs)
        .reduce((sum, b) => sum + (b.count ?? 0), 0),
    };
  }, [driverStats, activeRequests, weekBoardings]);

  // --- Derived: busiest stops today ---
  const busiestStops = useMemo(() => {
    const counts: Record<string, { name: string; count: number }> = {};
    [...activeRequests, ...todayRequests].forEach((r) => {
      const id = r.stop?.id ?? r.stopId;
      const name = r.stop?.name ?? id ?? 'Unknown';
      if (!id) return;
      if (!counts[id]) counts[id] = { name, count: 0 };
      counts[id].count++;
    });
    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [activeRequests, todayRequests]);

  // --- Derived: 7-day pickup trend ---
  const weekTrend = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
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
  }, [weekBoardings]);

  const maxTrend = useMemo(
    () => Math.max(...weekTrend.map((d) => d.count), 1),
    [weekTrend],
  );

  const filteredDriversForAnalytics = useMemo(() => {
    const q = analyticsQuery.toLowerCase().trim();
    return q ? drivers.filter((d) => (d.displayName ?? d.email ?? '').toLowerCase().includes(q)) : drivers;
  }, [analyticsQuery, drivers]);

  const handleExportCSV = useCallback(async () => {
    if (!orgId || isExporting) return;

    // All plans include basicExport. If entitlements haven't loaded yet (org
    // just provisioned), fall back to allowing the export rather than blocking.
    const canExport = org?.entitlements?.basicExport !== false;
    if (!canExport) {
      Alert.alert('Upgrade Required', 'Data export is not available on your current plan. Please upgrade in the Billing tab.');
      return;
    }

    // Extended retention (>90 days) requires the dataApi add-on.
    const extendedRetention = org?.entitlements?.extendedRetention ?? false;
    const BASIC_DAYS = 90;
    const cutoffMs = extendedRetention
      ? 0 // no cutoff — all historical data
      : Date.now() - BASIC_DAYS * 24 * 60 * 60 * 1000;

    setIsExporting(true);
    try {
      const boardingSnap = await getDocs(collection(db, 'orgs', orgId, 'boardingCounts'));
      const reqSnap = await getDocs(collection(db, 'orgs', orgId, 'stopRequests'));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();

      // Single pass over boarding docs to build all three derived structures at once.
      const boardingRows: string[] = [];
      const driverTotals: Record<string, { all: number; today: number }> = {};
      const stopSummary: Record<string, { name: string; count: number }> = {};

      boardingSnap.docs.forEach((d) => {
        const data = d.data() as any;
        const count: number = data.count ?? 0;
        const driverUid: string = data.driverUid ?? '';
        const stopId: string = data.stopId ?? data.stop?.id ?? 'unknown';
        const stopName: string = data.stopName ?? data.stop?.name ?? 'Unknown';
        const createdAtMs: number = data.createdAt?.toMillis?.() ?? 0;
        const createdAtIso: string = data.createdAt?.toDate?.()?.toISOString() ?? '';

        if (cutoffMs > 0 && createdAtMs < cutoffMs) return; // enforce retention window

        boardingRows.push([d.id, driverUid, stopName, count, createdAtIso].join(','));

        if (driverUid) {
          if (!driverTotals[driverUid]) driverTotals[driverUid] = { all: 0, today: 0 };
          driverTotals[driverUid].all += count;
          if (createdAtMs >= todayMs) driverTotals[driverUid].today += count;
        }

        if (!stopSummary[stopId]) stopSummary[stopId] = { name: stopName, count: 0 };
        stopSummary[stopId].count += count;
      });

      const driverSummary = drivers.map((driver) => {
        const totals = driverTotals[driver.uid] ?? { all: 0, today: 0 };
        return [driver.uid, (driver as any).displayName ?? (driver as any).email ?? '', totals.all, totals.today].join(',');
      });
      const stopRows = Object.entries(stopSummary)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([sid, { name, count }]) => [sid, name, count].join(','));

      const todayReqRows = reqSnap.docs
        .filter((d) => {
          const ms = (d.data() as any).createdAt?.toMillis?.() ?? 0;
          return ms >= todayMs && (cutoffMs === 0 || ms >= cutoffMs);
        })
        .map((d) => {
          const data = d.data() as any;
          return [d.id, data.studentEmail ?? '', data.stop?.name ?? '', data.status ?? '', data.createdAt?.toDate?.()?.toISOString() ?? ''].join(',');
        });

      const rangeNote = extendedRetention
        ? `# Data range: all-time (Data Add-on active)`
        : `# Data range: last ${BASIC_DAYS} days — upgrade to Data Add-on for full history`;

      const csv = [
        rangeNote,
        '',
        'BOARDING EVENTS',
        'id,driverUid,stopName,count,createdAt',
        ...boardingRows,
        '',
        'DRIVER SUMMARY',
        'uid,name,totalAllTime,totalToday',
        ...driverSummary,
        '',
        'STOP POPULARITY (ALL-TIME)',
        'stopId,stopName,totalBoarded',
        ...stopRows,
        '',
        "TODAY'S REQUESTS",
        'id,studentEmail,stopName,status,createdAt',
        ...todayReqRows,
      ].join('\n');

      await Share.share({ message: csv, title: 'Shuttler Export' });
    } catch (e) {
      console.error('CSV export failed', e);
    } finally {
      setIsExporting(false);
    }
  }, [orgId, drivers, isExporting]);

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
            <Text style={styles.summaryLabel}>Online</Text>
          </View>
          <View style={styles.summarySep} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{fleetSummary.todayPickups}</Text>
            <Text style={styles.summaryLabel}>Pickups today</Text>
          </View>
          <View style={styles.summarySep} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{fleetSummary.totalActive}</Text>
            <Text style={styles.summaryLabel}>Active requests</Text>
          </View>
        </View>

        {/* Drivers */}
        <Text style={styles.sectionTitle}>Drivers</Text>

        {driverStats.length === 0 && (
          <View style={styles.driversEmptyState}>
            <Icon name="directions-bus" size={40} color="#d1d5db" />
            <Text style={styles.driversEmptyTitle}>No drivers yet</Text>
            <Text style={styles.driversEmptyHint}>
              Invite drivers from Org Setup → Users, then ask them to sign in and go online.
            </Text>
            <TouchableOpacity
              style={[styles.driversEmptyBtn, { borderColor: primaryColor }]}
              onPress={() => navigation.navigate('AdminOrgSetup')}
            >
              <Icon name="person-add" size={16} color={primaryColor} />
              <Text style={[styles.driversEmptyBtnText, { color: primaryColor }]}>Go to Org Setup</Text>
            </TouchableOpacity>
          </View>
        )}

        {driverStats.map((driver) => (
          <View key={driver.uid} style={styles.card}>
            {/* Header row */}
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{driver.name}</Text>
                {driver.routeName ? (
                  <Text style={styles.routeLabel}>{driver.routeName}</Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.statusBadge,
                  driver.isGpsLost
                    ? styles.badgeWarn
                    : driver.isOnline
                    ? styles.badgeOnline
                    : styles.badgeOffline,
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    driver.isGpsLost
                      ? styles.dotWarn
                      : driver.isOnline
                      ? { backgroundColor: primaryColor }
                      : styles.dotOffline,
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    driver.isGpsLost
                      ? styles.textWarn
                      : driver.isOnline
                      ? { color: primaryColor }
                      : styles.textOffline,
                  ]}
                >
                  {driver.isGpsLost
                    ? 'GPS Lost'
                    : driver.isOnline
                    ? 'Online'
                    : 'Offline'}
                </Text>
              </View>
            </View>

            {/* Duration / last seen */}
            <Text style={styles.durationText}>
              {driver.isGpsLost && driver.secondsAgo !== null
                ? `Signal lost ${formatTimeAgo(driver.secondsAgo)}`
                : driver.isOnline && driver.onlineDurationMs !== null
                ? `Online for ${formatDuration(driver.onlineDurationMs)}`
                : driver.secondsAgo !== null
                ? `Last seen ${formatTimeAgo(driver.secondsAgo)}`
                : 'Never connected'}
            </Text>

            {/* Today's total online time */}
            {driver.todayOnlineMs > 0 && (
              <View style={styles.onlineTimeRow}>
                <Icon name="timer" size={13} color="#6b7280" />
                <Text style={styles.onlineTimeText}>
                  {formatDuration(driver.todayOnlineMs)} online today
                </Text>
              </View>
            )}

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{driver.todayPickups}</Text>
                <Text style={styles.statLabel}>Pickups</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{driver.activeCount}</Text>
                <Text style={styles.statLabel}>Active</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{driver.completedToday}</Text>
                <Text style={styles.statLabel}>Done</Text>
              </View>
              <View style={styles.statCell}>
                <Text
                  style={[
                    styles.statValue,
                    driver.cancelledToday > 0 && styles.statValueWarn,
                  ]}
                >
                  {driver.cancelledToday}
                </Text>
                <Text style={styles.statLabel}>Cancelled</Text>
              </View>
              {driver.responseRate !== null && (
                <View style={styles.statCell}>
                  <Text
                    style={[
                      styles.statValue,
                      driver.responseRate < 60 && styles.statValueWarn,
                    ]}
                  >
                    {driver.responseRate}%
                  </Text>
                  <Text style={styles.statLabel}>Rate</Text>
                </View>
              )}
            </View>
          </View>
        ))}

        {/* Busiest Stops */}
        {busiestStops.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Busiest Stops Today</Text>
            <View style={styles.card}>
              {busiestStops.map((stop, idx) => (
                <View
                  key={stop.name}
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
        <Text style={styles.sectionTitle}>Pickups — Last 7 Days</Text>
        <View style={styles.card}>
          <View style={styles.trendRow}>
            {weekTrend.map((day) => (
              <View key={day.label} style={styles.trendCol}>
                <Text style={styles.trendCount}>{day.count}</Text>
                <View style={styles.trendBarBg}>
                  <View
                    style={[
                      styles.trendBar,
                      { height: Math.max(4, (day.count / maxTrend) * 48), backgroundColor: primaryColor },
                    ]}
                  />
                </View>
                <Text style={styles.trendLabel}>{day.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Driver Analytics */}
        <Text style={styles.sectionTitle}>Driver Analytics</Text>
        <View style={styles.analyticsSearchRow}>
          <Icon name="search" size={18} color="#9ca3af" style={{ marginRight: 6 }} />
          <TextInput
            style={styles.analyticsSearchInput}
            placeholder="Search driver…"
            placeholderTextColor="#bbb"
            value={analyticsQuery}
            onChangeText={setAnalyticsQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        {filteredDriversForAnalytics.map((driver) => (
          <DriverStatCard
            key={driver.uid}
            driver={{ uid: driver.uid, name: driver.displayName ?? driver.email ?? driver.uid }}
            orgId={orgId ?? ''}
          />
        ))}

        {/* CSV Export */}
        <TouchableOpacity
          style={[styles.exportBtn, { backgroundColor: primaryColor }]}
          onPress={handleExportCSV}
          activeOpacity={0.8}
          disabled={isExporting}
        >
          {isExporting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Icon name="file-download" size={18} color="#fff" />}
          <Text style={styles.exportBtnText}>{isExporting ? 'Exporting…' : 'Export CSV'}</Text>
        </TouchableOpacity>
        <Text style={styles.exportHint}>
          {org?.entitlements?.extendedRetention
            ? 'Full history export (Data Add-on active)'
            : 'Last 90 days · Upgrade to Data Add-on for full history'}
        </Text>

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
  pastDueBannerLink: { fontSize: 13, color: '#dc2626', fontWeight: '700' },
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
  summaryValue: { fontSize: 22, fontWeight: '700', color: '#fff' },
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
    color: '#374151',
    marginTop: 8,
  },
  driversEmptyHint: {
    fontSize: 13,
    color: '#9ca3af',
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
    borderRadius: 20,
  },
  badgeOnline: { backgroundColor: '#dcfce7' },
  badgeOffline: { backgroundColor: '#f1f5f9' },
  badgeWarn: { backgroundColor: '#fef9c3' },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  dotOnline: {},
  dotOffline: { backgroundColor: '#94a3b8' },
  dotWarn: { backgroundColor: '#eab308' },
  statusText: { fontSize: 12, fontWeight: '600' },
  textOnline: {},
  textOffline: { color: '#64748b' },
  textWarn: { color: '#854d0e' },

  durationText: { fontSize: 12, color: TEXT_SECONDARY, marginBottom: 4 },
  onlineTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  onlineTimeText: { fontSize: 12, color: '#6b7280' },

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
  stopRowBorder: { borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
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
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 10,
  },
  analyticsSearchInput: { flex: 1, fontSize: 14, color: '#111' },
  analyticsCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  analyticsIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  analyticsDriverName: { flex: 1, fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  analyticsChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
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
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  analyticsBar: { height: '100%', borderRadius: 4 },
  analyticsStopCount: { width: 28, textAlign: 'right', fontSize: 12, fontWeight: '600', color: TEXT_PRIMARY },

  // CSV Export
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: borderRadius.lg,
    paddingVertical: 13,
    marginBottom: 14,
  },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  exportHint: { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 6, marginBottom: 4 },

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
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  trendBar: { width: '100%', borderRadius: 4 },
  trendLabel: { fontSize: 10, color: TEXT_SECONDARY, marginTop: 4 },
});
