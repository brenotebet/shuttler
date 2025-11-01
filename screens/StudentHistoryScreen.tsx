// src/screens/StudentHistoryScreen.tsx

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { auth, db } from '../firebase/firebaseconfig';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR, CARD_BACKGROUND } from '../src/constants/theme';
import HeaderBar from '../components/HeaderBar';
import ScreenContainer from '../components/ScreenContainer';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

export default function StudentHistoryScreen() {
  const [stops, setStops] = useState<any[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, 'stopRequests'),
      where('studentEmail', '==', auth.currentUser?.email),
      where('status', '==', 'completed'),
      orderBy('completedTimestamp', 'desc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setStops(data);
    });
    return () => unsub();
  }, []);

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="History" />
      <FlatList
        data={stops}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Icon name="place" size={20} color={PRIMARY_COLOR} style={styles.cardIcon} />
              <Text style={styles.cardTitle}>Stop: {item.stop?.name}</Text>
            </View>
            <Text style={styles.cardDetail}>
              Completed on:{' '}
              {(
                item.completedTimestamp?.toDate?.() || item.timestamp?.toDate?.()
              )?.toLocaleString()}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No stops completed yet.</Text>}
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
  card: {
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    padding: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardIcon: {
    marginRight: spacing.item,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  cardDetail: {
    fontSize: 14,
    color: '#555',
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
