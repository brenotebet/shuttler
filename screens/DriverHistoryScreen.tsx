// src/screens/DriverHistoryScreen.tsx

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Dimensions } from 'react-native';
import { PieChart, BarChart } from 'react-native-chart-kit';
import { PRIMARY_COLOR, CARD_BACKGROUND } from '../src/constants/theme';
import HeaderBar from '../components/HeaderBar';
import { db } from '../firebase/firebaseconfig';
import { collection, doc, getDoc, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { useDriver } from '../drivercontext/DriverContext';
import { useAuth } from '../src/auth/AuthProvider';
import ScreenContainer from '../components/ScreenContainer';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

export default function DriverHistoryScreen() {
  const [stops, setStops] = useState<any[]>([]);
  const [userNameByUid, setUserNameByUid] = useState<Record<string, string>>({});
  const lookupInFlightRef = useRef<Set<string>>(new Set());
  const { driverId } = useDriver();
  const { orgId } = useAuth();
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = screenWidth - spacing.screenPadding * 2;

  useEffect(() => {
    if (!driverId || !orgId) return;

    const q = query(
      collection(db, 'orgs', orgId, 'stopRequests'),
      where('driverUid', '==', driverId),
      where('status', '==', 'completed'),
      orderBy('completedAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setStops(data);
      },
      (err) => {
        console.error('Failed to fetch stop history', err);
      }
    );

    return () => unsub();
  }, [driverId, orgId]);

  // Fetch display names for all unique student UIDs in the history list.
  useEffect(() => {
    if (!orgId) return;

    const missingUids = stops
      .map((r) => r?.studentUid)
      .filter(
        (uid): uid is string =>
          Boolean(uid) && !userNameByUid[uid] && !lookupInFlightRef.current.has(uid),
      );

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
        .catch((err) => console.error('Failed to load public user profile', err))
        .finally(() => lookupInFlightRef.current.delete(uid));
    });
  }, [stops, userNameByUid, orgId]);

  const totalStops = stops.length;
  const totalDistance = stops.reduce((acc, r) => acc + (r.distance || 0), 0);

  const destinationCounts: { [key: string]: number } = {};
  const hourlyCounts = Array(12).fill(0); // 7am - 6pm
  stops.forEach((r) => {
    const dest = r.stop?.name || 'Unknown';
    destinationCounts[dest] = (destinationCounts[dest] || 0) + 1;
    const ts =
      r.completedAt?.toDate?.() ||
      r.completedTimestamp?.toDate?.() ||
      r.timestamp?.toDate?.();
    if (ts) {
      const hr = ts.getHours();
      if (hr >= 7 && hr <= 18) {
        hourlyCounts[hr - 7] += 1;
      }
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
            <Text style={styles.heading}>Driver Dashboard</Text>
            <View style={styles.metricsCard}>
              <View style={[styles.metricItem, styles.metricItemLeft]}>
                <Text style={styles.metricLabel}>Total Stops</Text>
                <Text style={styles.metricValue}>{totalStops}</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Total Distance</Text>
                <Text style={styles.metricValue}>{totalDistance.toFixed(2)} km</Text>
              </View>
            </View>

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
                <Text style={styles.chartTitle}>Stops by Hour (7am-6pm)</Text>
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

            <Text style={[styles.heading, styles.sectionHeading]}>Recent Stops</Text>
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
  headerContent: {
    marginBottom: spacing.section,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: PRIMARY_COLOR,
    textAlign: 'center',
    marginBottom: spacing.section,
  },
  sectionHeading: {
    marginTop: spacing.section,
  },
  metricsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.item,
  },
  metricItemLeft: {
    marginRight: spacing.item,
  },
  metricLabel: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.section,
    paddingHorizontal: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: spacing.item,
    textAlign: 'center',
  },
  barChart: {
    marginTop: spacing.item,
  },
  card: {
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    padding: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  cardStudent: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
    color: '#333',
    flexWrap: 'wrap',
  },
  cardText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  cardTimestamp: {
    fontSize: 12,
    color: '#777',
    flexWrap: 'wrap',
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
