// src/screens/DriverHistoryScreen.tsx

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Dimensions } from 'react-native';
import { PieChart, BarChart, StackedBarChart } from 'react-native-chart-kit';
import { PRIMARY_COLOR, BACKGROUND_COLOR, CARD_BACKGROUND } from '../src/constants/theme';
import HeaderBar from '../components/HeaderBar';
import { db } from '../firebase/firebaseconfig';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { useDriver } from '../drivercontext/DriverContext';

export default function DriverHistoryScreen() {
  const [stops, setStops] = useState<any[]>([]);
  const { driverId } = useDriver();
  const screenWidth = Dimensions.get('window').width;

  useEffect(() => {
    if (!driverId) return;

    const q = query(
      collection(db, 'stopRequests'),
      where('driverId', '==', driverId),
      where('status', '==', 'completed'),
      orderBy('timestamp', 'desc')
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
  }, [driverId]);

  const totalStops = stops.length;
  const totalDistance = stops.reduce((acc, r) => acc + (r.distance || 0), 0);

  const destinationCounts: { [key: string]: number } = {};
  const hourlyCounts = Array(12).fill(0); // 7am - 6pm
  stops.forEach((r) => {
    const dest = r.stop?.name || 'Unknown';
    destinationCounts[dest] = (destinationCounts[dest] || 0) + 1;
    const ts = r.completedTimestamp?.toDate?.() || r.timestamp?.toDate?.();
    if (ts) {
      const hr = ts.getHours();
      if (hr >= 7 && hr <= 18) {
        hourlyCounts[hr - 7] += 1;
      }
    }
  });

  const colors = [
    '#4B2E83',
    '#7E57C2',
    '#9575CD',
    '#B39DDB',
    '#D1C4E9',
  ];

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
  };

  return (
    <View style={styles.container}>
      <HeaderBar title="History" />
      <FlatList
        data={stops}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardStudent}>Student: {item.studentEmail}</Text>
            <Text style={styles.cardText}>Stop: {item.stop?.name}</Text>
            <Text style={styles.cardTimestamp}>
              {item.timestamp?.toDate
                ? item.timestamp.toDate().toLocaleString()
                : 'No timestamp'}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No completed rides yet.</Text>}
        ListHeaderComponent={
        <>
          <Text style={styles.title}>Driver Dashboard</Text>
          <View style={styles.metrics}>
            <Text style={styles.metricText}>Total Rides: {totalRides}</Text>
            <Text style={styles.metricText}>
              Total Distance: {totalDistance.toFixed(2)} km
            </Text>
          </View>

          {destinationData.length > 0 && (
            <>
              <Text style={styles.title}>Rides by Destination</Text>
              <PieChart
                data={destinationData}
                width={screenWidth - 32}
                height={220}
                accessor="count"
                chartConfig={chartConfig}
                backgroundColor="transparent"
              />
            </>
          )}

          {hourlyCounts.some((v) => v > 0) && (
            <>
              <Text style={styles.title}>Rides by Hour (7am-6pm)</Text>
              <BarChart
                data={barData}
                width={screenWidth - 64}
                height={220}
                fromZero
                chartConfig={chartConfig}
                yAxisLabel=""
                yAxisSuffix=""
              />
            </>
          )}

          <Text style={styles.title}>Recent Rides</Text>
        </>
      }
        contentContainerStyle={stops.length === 0 && styles.emptyContainer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: PRIMARY_COLOR,
    marginBottom: 12,
    textAlign: 'center',
  },
  card: {
    backgroundColor: CARD_BACKGROUND,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    textAlign: 'center'
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    color: '#333',
  },
  cardDetail: {
    fontSize: 14,
    color: '#555',
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
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
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  metrics: {
    marginBottom: 16,
  },
  metricText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 4,
    color: '#333',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: PRIMARY_COLOR,
    marginVertical: 12,
    textAlign: 'center',
  },
});
