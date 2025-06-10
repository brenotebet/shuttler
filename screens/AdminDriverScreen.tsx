// src/screens/AdminDriverScreen.tsx

import React, { useEffect, useState } from 'react';
import {
  Text,
  FlatList,
  Alert,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { db } from '../firebase/firebaseconfig';
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  query,
  where,
} from 'firebase/firestore';
import { useDriver } from '../drivercontext/DriverContext';
import RideRequestCard from '../components/RideRequestCard';

// Grayscale map style (shared)

export default function AdminDriverScreen() {
  const { driverId } = useDriver();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!driverId) {
      setRequests([]);
      setLoading(false);
      return;
    }

    // Fetch all “pending” & “accepted” & “in-transit” rides
    const q = query(
      collection(db, 'rideRequests'),
      where('status', 'in', ['pending', 'accepted', 'in-transit'])
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const arr: any[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        arr.push({
          id: docSnap.id,
          ...(d as any),
        });
      });

      // Filter: show rides that belong to this driver OR are pending
      const myList = arr.filter(
        (r) =>
          r.driverId === driverId ||
          (r.status === 'pending' && !r.driverId)
      );
      setRequests(myList);
      setLoading(false);
    });

    return () => unsub();
  }, [driverId]);

  // Accept / Picked Up / Dropped Off logic
  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const updateData: any = { status: newStatus };
      if (newStatus === 'accepted' && driverId) {
        updateData.driverId = driverId;
      }
      await updateDoc(doc(db, 'rideRequests', id), updateData);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <RideRequestCard item={item} driverId={driverId} updateStatus={updateStatus} />
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#4B2E83" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 , marginTop: 60}}>
      <Text style={styles.header}>Ride Requests</Text>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.noRequests}>No active requests</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    margin: 12,
    textAlign: 'center',
  },
  noRequests: {
    textAlign: 'center',
    color: '#555',
    marginTop: 20,
    fontSize: 16,
  },
});
