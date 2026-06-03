// src/screens/DriverHistoryScreen.tsx

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Dimensions } from 'react-native';
import { PieChart, BarChart } from 'react-native-chart-kit';
import { CARD_BACKGROUND } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import HeaderBar from '../components/HeaderBar';
import { db } from '../firebase/firebaseconfig';
import {
  collection, doc, getDoc, query, where, onSnapshot, orderBy, limit,
} from 'firebase/firestore';
import { useDriver } from '../drivercontext/DriverContext';
import { useAuth } from '../src/auth/AuthProvider';
import ScreenContainer from '../components/ScreenContainer';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalMins = Math.round(ms / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDate(date: Date): string {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function DriverHistoryScreen() {
  const [stops, setStops] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [userNameByUid, setUserNameByUid] = useState<Record<string, string>>({});
  const lookupInFlightRef = useRef<Set<string>>(new Set());
  const { driverId } = useDriver();
  const { orgId } = useAuth();
  const { primaryColor } = useOrgTheme();
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = screenWidth - spacing.screenPadding * 2 - spacing.section * 2;

  // Stop requests history — same 30-day window as driver sessions so both
  // sections cover the same period and the data is consistent.
  useEffect(() => {
    if (!driverId || !orgId) return;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'stopRequests'),
        where('driverUid', '==', driverId),
        where('status', '==', 'completed'),
        where('completedAt', '>=', thirtyDaysAgo),
        orderBy('completedAt', 'desc'),
      ),
      (snapshot) => setStops(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Failed to fetch stop history', err),
    );
  }, [driverId, orgId]);

  // Driver sessions (last 30 days)
  useEffect(() => {
    if (!driverId || !orgId) return;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return onSnapshot(
      query(
        collection(db, 'orgs', orgId, 'driverSessions'),
        where('driverUid', '==', driverId),
        where('startedAt', '>=', thirtyDaysAgo),
        orderBy('startedAt', 'desc'),
        limit(100),
      ),
      (snapshot) => setSessions(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    );
  }, [driverId, orgId]);

  // Fetch display names for student UIDs
  useEffect(() => {
    if (!orgId) return;
    const missingUids = stops
      .map((r) => r?.studentUid)
      .filter((uid): uid is string => Boolean(uid) && !userNameByUid[uid] && !lookupInFlightRef.current.has(uid));
    missingUids.forEach((uid) => {
      lookupInFlightRef.current.add(uid);
      void getDoc(doc(db, 'orgs', orgId, 'publicUsers', uid))
        .then((snap) => {
          if (!snap.exists()) return;
          const displayName = (snap.data() as any)?.displayName;
          if (typeof displayName === 'string') {
            setUserNameByUid((prev) => ({ ...prev, [uid]: displayName }));
          }
        })
        .catch(() => {})
        .finally(() => lookupInFlightRef.current.delete(uid));
    });
  }, [stops, userNameByUid, orgId]);

  // Derived session stats
  const completedSessions = sessions.filter((s) => s.durationMs != null);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekSessions = completedSessions.filter(
    (s) => (s.startedAt?.toMillis?.() ?? 0) >= weekAgo,
  );
  const weekTotalMs = weekSessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  const avgSessionMs = weekSessions.length > 0 ? weekTotalMs / weekSessions.length : 0;

  const totalStops = stops.length;
  const totalDistance = stops.reduce((acc, r) => acc + (r.distance || 0), 0);

  const destinationCounts: Record<string, number> = {};
  const hourlyCounts = Array(12).fill(0);
  stops.forEach((r) => {
    const dest = r.stop?.name || 'Unknown';
    destinationCounts[dest] = (destinationCounts[dest] || 0) + 1;
    const ts = r.completedAt?.toDate?.() || r.completedTimestamp?.toDate?.() || r.timestamp?.toDate?.();
    if (ts) {
      const hr = ts.getHours();
      if (hr >= 7 && hr <= 18) hourlyCounts[hr - 7] += 1;
    }
  });

  const colors = ['#4B2E83', '#7E57C2', '#9575CD', '#B39DDB', '#D1C4E9'];
  const destinationData = Object.keys(destinationCounts).map((dest, i) => ({
    name: dest,
    count: destinationCounts[dest],
    color: colors[i % colors.length],
    legendFontColor: '#333',
    legendFontSize: 12,
  }));

  const barData = {
    labels: Array.from({ length: 12 }, (_, i) => (i + 7).toString()),
    datasets: [{ data: hourlyCounts }],
  };

  const chartConfig = {
    backgroundGradientFrom: '#fff',
    backgroundGradientTo: '#fff',
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(75,46,131, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(0,0,0, ${opacity})`,
    propsForLabels: { fontSize: 12 },
  };

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="History" />
      <FlatList
        data={stops}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const displayName = item.studentUid ? userNameByUid[item.studentUid] : null;
          const studentLabel = displayName ?? item.studentEmail ?? item.studentUid ?? 'Unknown student';
          return (
            <View style={styles.card}>
              <Text style={styles.cardStudent}>Student: {studentLabel}</Text>
              <Text style={styles.cardText}>Stop: {item.stop?.name}</Text>
              <Text style={styles.cardTimestamp}>
                {(
                  item.completedAt?.toDate?.() ||
                  item.completedTimestamp?.toDate?.() ||
                  item.timestamp?.toDate?.()
                )?.toLocaleString() || 'No timestamp'}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>No completed rides yet.</Text>}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <Text style={[styles.heading, { color: primaryColor }]}>Driver Dashboard</Text>

            {/* Stop metrics */}
            <View style={styles.metricsCard}>
              <View style={[styles.metricItem, styles.metricItemLeft]}>
                <Text style={styles.metricLabel}>Total Stops</Text>
                <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{totalStops}</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Total Distance</Text>
                <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{totalDistance.toFixed(2)} km</Text>
              </View>
            </View>

            {/* Time online metrics */}
            <Text style={[styles.sectionTitle, { color: primaryColor }]}>Time Online (7 days)</Text>
            <View style={styles.metricsCard}>
              <View style={[styles.metricItem, styles.metricItemLeft]}>
                <Text style={styles.metricLabel}>Total Online</Text>
                <Text style={[styles.metricValue, { color: primaryColor }]}>
                  {weekTotalMs > 0 ? fmtDuration(weekTotalMs) : '—'}
                </Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={[styles.metricItem, styles.metricItemLeft]}>
                <Text style={styles.metricLabel}>Sessions</Text>
                <Text style={styles.metricValue}>{weekSessions.length}</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Avg Length</Text>
                <Text style={styles.metricValue}>
                  {avgSessionMs > 0 ? fmtDuration(avgSessionMs) : '—'}
                </Text>
              </View>
            </View>

            {/* Sessions list */}
            {completedSessions.length > 0 && (
              <View style={styles.sessionsCard}>
                <Text style={styles.chartTitle}>Recent Sessions</Text>
                {completedSessions.slice(0, 10).map((s) => {
                  const startDate: Date | null = s.startedAt?.toDate?.() ?? null;
                  const endDate: Date | null = s.endedAt?.toDate?.() ?? null;
                  return (
                    <View key={s.id} style={styles.sessionRow}>
                      <View style={styles.sessionLeft}>
                        <Text style={styles.sessionDate}>
                          {startDate ? fmtDate(startDate) : '—'}
                        </Text>
                        <Text style={styles.sessionTime}>
                          {startDate ? fmtTime(startDate) : '?'}
                          {' → '}
                          {endDate ? fmtTime(endDate) : '?'}
                        </Text>
                      </View>
                      <View style={[styles.sessionDurationBadge, { backgroundColor: `${primaryColor}15` }]}>
                        <Text style={[styles.sessionDuration, { color: primaryColor }]}>
                          {s.durationMs ? fmtDuration(s.durationMs) : '—'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {destinationData.length > 0 && (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Stops by Destination</Text>
                <PieChart
                  data={destinationData}
                  width={chartWidth}
                  height={220}
                  accessor="count"
                  chartConfig={chartConfig}
                  backgroundColor="transparent"
                  paddingLeft="15"
                />
              </View>
            )}

            {hourlyCounts.some((v) => v > 0) && (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Stops by Hour (7am–6pm)</Text>
                <BarChart
                  data={barData}
                  width={chartWidth}
                  height={220}
                  fromZero
                  chartConfig={chartConfig}
                  yAxisLabel=""
                  yAxisSuffix=""
                  style={styles.barChart}
                />
              </View>
            )}

            <Text style={[styles.heading, styles.sectionHeading, { color: primaryColor }]}>Recent Stops</Text>
          </View>
        }
        contentContainerStyle={[
          styles.listContent,
          stops.length === 0 && styles.emptyContainer,
        ]}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: spacing.section,
    flexGrow: 1,
  },
  headerContent: { marginBottom: spacing.section },
  heading: { fontSize: 26, fontWeight: '700', textAlign: 'center', marginBottom: spacing.section },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, marginTop: 4 },
  sectionHeading: { marginTop: spacing.section },
  metricsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  metricItem: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  metricItemLeft: {},
  metricDivider: { width: 1, backgroundColor: '#e5e7eb', alignSelf: 'stretch' },
  metricLabel: { fontSize: 12, color: '#4b5563', marginBottom: 4, textAlign: 'center' },
  metricValue: { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center' },
  sessionsCard: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.section,
    paddingHorizontal: spacing.section,
    marginBottom: spacing.section,
    overflow: 'hidden',
    ...cardShadow,
  },
  chartTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: spacing.item, textAlign: 'center' },
  barChart: { marginTop: spacing.item },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  sessionLeft: { flex: 1 },
  sessionDate: { fontSize: 13, fontWeight: '700', color: '#111827' },
  sessionTime: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  sessionDurationBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  sessionDuration: { fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    padding: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  cardStudent: { fontSize: 16, fontWeight: '500', marginBottom: 4, color: '#333', flexWrap: 'wrap' },
  cardText: { fontSize: 14, color: '#555', marginBottom: 4, flexWrap: 'wrap' },
  cardTimestamp: { fontSize: 12, color: '#777', flexWrap: 'wrap' },
  emptyText: { fontSize: 16, color: '#6b7280', textAlign: 'center' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
});
