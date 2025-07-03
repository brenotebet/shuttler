// src/screens/DriverHistoryScreen.tsx

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { PieChart, BarChart } from 'react-native-chart-kit';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { db } from '../firebase/firebaseconfig';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { useDriver } from '../drivercontext/DriverContext';

export default function DriverHistoryScreen() {
  const [rides, setRides] = useState<any[]>([]);
  const { driverId } = useDriver();
  const screenWidth = Dimensions.get('window').width;

  useEffect(() => {
    if (!driverId) return;

    const q = query(
      collection(db, 'rideRequests'),
      where('driverId', '==', driverId),
      where('status', '==', 'completed'),
      orderBy('timestamp', 'desc')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setRides(data);
    });

    return () => unsub();
  }, [driverId]);

  const totalRides = rides.length;
  const totalDistance = rides.reduce(
    (acc, r) => acc + (r.distance || 0),
    0
  );

  const destinationCounts: { [key: string]: number } = {};
  const hourlyCounts = Array(24).fill(0);
  rides.forEach((r) => {
    const dest = r.dropoff?.name || 'Unknown';
    destinationCounts[dest] = (destinationCounts[dest] || 0) + 1;
    const ts = r.completedTimestamp?.toDate?.() || r.timestamp?.toDate?.();
    if (ts) {
      hourlyCounts[ts.getHours()] += 1;
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
    labels: hourlyCounts.map((_, i) => i.toString()),
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
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Driver Dashboard</Text>
      <View style={styles.metrics}>
        <Text style={styles.metricText}>Total Rides: {totalRides}</Text>
        <Text style={styles.metricText}>
          Total Distance: {totalDistance.toFixed(2)} km
        </Text>
      </View>

      {destinationData.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Rides by Destination</Text>
          <PieChart
            data={destinationData}
            width={screenWidth - 32}
            height={220}
            accessor="count"
            chartConfig={chartConfig}
            backgroundColor="transparent"
            paddingLeft="15"
          />
        </>
      )}

      {hourlyCounts.some((v) => v > 0) && (
        <>
          <Text style={styles.sectionTitle}>Rides by Hour</Text>
          <BarChart
            data={barData}
            width={screenWidth - 32}
            height={220}
            fromZero
            chartConfig={chartConfig}
            yAxisLabel=""
            yAxisSuffix=""
          />
        </>
      )}

      <Text style={styles.sectionTitle}>Recent Rides</Text>
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardStudent}>Student: {item.studentEmail}</Text>
            <Text style={styles.cardText}>Drop-off: {item.dropoff?.name}</Text>
            <Text style={styles.cardTimestamp}>
              {item.timestamp?.toDate
                ? item.timestamp.toDate().toLocaleString()
                : 'No timestamp'}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No completed rides yet.</Text>
        }
        contentContainerStyle={rides.length === 0 && styles.emptyContainer}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 16,
    marginTop: 60
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: PRIMARY_COLOR,
    marginBottom: 12,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#f0e6ff',
    padding: 14,
    marginBottom: 12,
    borderRadius: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardStudent: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
    color: '#333',
  },
  cardText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
  },
  cardTimestamp: {
    fontSize: 12,
    color: '#777',
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    marginTop: 40,
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
