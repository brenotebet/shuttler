// src/screens/AdminDriverScreen.tsx

import React, { useEffect, useState } from 'react';
import { Text, FlatList, StyleSheet, ActivityIndicator, View } from 'react-native';
import { db } from '../firebase/firebaseconfig';
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { useDriver } from '../drivercontext/DriverContext';
import StopRequestCard from '../components/StopRequestCard';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR } from '../src/constants/theme';
import HeaderBar from '../components/HeaderBar';
import ScreenContainer from '../components/ScreenContainer';
import { spacing } from '../src/styles/common';

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

    // Fetch all “pending” & “accepted” stop requests
    const q = query(
      collection(db, 'stopRequests'),
      where('status', 'in', ['pending', 'accepted'])
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

      // Filter: show requests that belong to this driver OR are pending
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

  // Accept / Complete logic
  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const updateData: any = { status: newStatus };
      if (newStatus === 'accepted' && driverId) {
        updateData.driverId = driverId;
      }
      if (newStatus === 'completed') {
        updateData.completedTimestamp = serverTimestamp();
      }
       await updateDoc(doc(db, 'stopRequests', id), updateData);
    } catch (err: any) {
      showAlert(err.message, 'Error');
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <StopRequestCard item={item} driverId={driverId} updateStatus={updateStatus} />
  );

  if (loading) {
    return (
      <ScreenContainer>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={PRIMARY_COLOR} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="Stop Requests" />
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.noRequests}>No active requests</Text>}
        contentContainerStyle={[styles.listContent, requests.length === 0 && styles.emptyState]}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  noRequests: {
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: spacing.section,
  },
  emptyState: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
