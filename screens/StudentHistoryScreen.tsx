// src/screens/StudentHistoryScreen.tsx

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { auth, db } from '../firebase/firebaseconfig';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR, BACKGROUND_COLOR, CARD_BACKGROUND } from '../src/constants/theme';
import HeaderBar from '../components/HeaderBar';

export default function StudentHistoryScreen() {
  const [rides, setRides] = useState<any[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, 'rideRequests'),
      where('studentEmail', '==', auth.currentUser?.email),
      where('status', '==', 'completed'),
      orderBy('timestamp', 'desc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setRides(data);
    });
    return () => unsub();
  }, []);

  return (
    <View style={styles.container}>
      <HeaderBar title="History" />
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Icon name="place" size={20} color={PRIMARY_COLOR} style={{ marginRight: 6 }} />
              <Text style={styles.cardTitle}>Drop-off: {item.dropoff?.name}</Text>
            </View>
            <Text style={styles.cardDetail}>Completed on: {item.timestamp?.toDate().toLocaleString()}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No rides completed yet.</Text>}
        contentContainerStyle={rides.length === 0 && { flex: 1, justifyContent: 'center', alignItems: 'center' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
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
});
