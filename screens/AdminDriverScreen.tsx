// src/screens/AdminDriverScreen.tsx

import React, { useEffect, useState } from 'react';
import { Text, FlatList, StyleSheet, ActivityIndicator, View } from 'react-native';
import { db } from '../firebase/firebaseconfig';
import {
  collection,
  onSnapshot,
  doc,
  query,
  where,
  serverTimestamp,
  runTransaction,
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
      const myList = arr.filter((r) => {
        const assignedDriver = r.driverUid || r.driverId;
        return assignedDriver === driverId || (r.status === 'pending' && !assignedDriver);
      });
      setRequests(myList);
      setLoading(false);
    });

    return () => unsub();
  }, [driverId]);

  // Accept / Complete logic
  const updateStatus = async (id: string, newStatus: string) => {
    try {
      if (!driverId) throw new Error('Driver ID missing');

      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'stopRequests', id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Stop request not found');

        const curr = snap.data() as any;
        const assignedDriver = curr.driverUid || curr.driverId;

        if (newStatus === 'accepted') {
          if (curr.status !== 'pending') throw new Error('This stop is no longer pending.');
          if (assignedDriver && assignedDriver !== driverId) {
            throw new Error('This stop is already assigned to another driver.');
          }

          tx.update(ref, {
            status: 'accepted',
            driverUid: driverId,
            acceptedAt: serverTimestamp(),
            statusUpdatedAt: serverTimestamp(),
          });
          return;
        }

        if (newStatus === 'completed') {
          if (assignedDriver !== driverId) {
            throw new Error('Only the assigned driver can complete this stop.');
          }

          tx.update(ref, {
            status: 'completed',
            driverUid: driverId,
            completedAt: serverTimestamp(),
            statusUpdatedAt: serverTimestamp(),
          });
          return;
        }

        tx.update(ref, { status: newStatus, statusUpdatedAt: serverTimestamp() });
      });
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
