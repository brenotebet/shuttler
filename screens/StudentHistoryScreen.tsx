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
import { useAuth } from '../src/auth/AuthProvider';
import { doc, getDoc } from 'firebase/firestore';

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function StudentHistoryScreen() {
  const [stops, setStops] = useState<any[]>([]);
  const { orgId, role } = useAuth();
  const [watchUid, setWatchUid] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);

  useEffect(() => {
    const myUid = auth.currentUser?.uid;
    if (!myUid || !orgId) return;

    if (role !== 'parent') {
      setWatchUid(myUid);
      return;
    }

    // For parents, resolve the first linked child's UID
    getDoc(doc(db, 'orgs', orgId, 'users', myUid)).then(async (snap) => {
      const linked: string[] = snap.data()?.linkedChildUids ?? [];
      if (linked.length === 0) { setWatchUid(null); return; }
      const childSnap = await getDoc(doc(db, 'orgs', orgId, 'users', linked[0]));
      setChildName(childSnap.data()?.displayName ?? null);
      setWatchUid(linked[0]);
    }).catch(() => setWatchUid(null));
  }, [orgId, role]);

  useEffect(() => {
    if (!watchUid || !orgId) return;
    const q = query(
      collection(db, 'orgs', orgId, 'stopRequests'),
      where('studentUid', '==', watchUid),
      where('status', '==', 'completed'),
      orderBy('completedAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setStops(data);
      },
      (err) => {
        console.error('Failed to fetch stop history', err);
      },
    );
    return () => unsub();
  }, [watchUid, orgId]);

  const historyTitle = role === 'parent' && childName ? `${childName}'s Rides` : 'History';

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title={historyTitle} />
      <FlatList
        data={stops}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const completedDate =
            item.completedAt?.toDate?.() ||
            item.completedTimestamp?.toDate?.() ||
            item.timestamp?.toDate?.() ||
            null;
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIconWrap}>
                  <Icon name="place" size={18} color={PRIMARY_COLOR} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{item.stop?.name ?? 'Unknown stop'}</Text>
                  <Text style={styles.cardDetail}>
                    {completedDate
                      ? `${formatRelativeTime(completedDate)}  ·  ${completedDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                      : 'Time unavailable'}
                  </Text>
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="history" size={48} color="#d1d5db" />
            {role === 'parent' && !watchUid ? (
              <>
                <Text style={styles.emptyText}>No child linked yet.</Text>
                <Text style={styles.emptyHint}>Go to My Children to link your child's account.</Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyText}>No completed rides yet.</Text>
                <Text style={styles.emptyHint}>
                  {role === 'parent' ? "Your child's completed pickups will appear here." : 'Your completed pickups will appear here.'}
                </Text>
              </>
            )}
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
  card: {
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    padding: spacing.section,
    marginBottom: spacing.item / 2,
    ...cardShadow,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f4ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.item,
    flexShrink: 0,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
    marginBottom: 2,
  },
  cardDetail: {
    fontSize: 13,
    color: '#6b7280',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
});
