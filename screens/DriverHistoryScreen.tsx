// src/screens/DriverHistoryScreen.tsx

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { db } from '../firebase/firebaseconfig';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { useDriver } from '../drivercontext/DriverContext';

export default function DriverHistoryScreen() {
  const [rides, setRides] = useState<any[]>([]);
  const { driverId } = useDriver();

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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Completed Rides</Text>
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
    </View>
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
});
