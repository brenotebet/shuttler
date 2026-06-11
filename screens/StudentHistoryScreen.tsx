// src/screens/StudentHistoryScreen.tsx

import React, { useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity } from 'react-native'
import { Text } from '../components/Text';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { auth, db } from '../firebase/firebaseconfig';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { CARD_BACKGROUND } from '../src/constants/theme';
import HeaderBar from '../components/HeaderBar';
import { useOrgTheme } from '../src/org/useOrgTheme';
import ScreenContainer from '../components/ScreenContainer';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import { useAuth } from '../src/auth/AuthProvider';
import type { RootStackParamList } from '../navigation/StackNavigator';

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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [stops, setStops] = useState<any[]>([]);
  const { orgId, role } = useAuth();
  const { primaryColor } = useOrgTheme();
  const [watchUid, setWatchUid] = useState<string | null>(null);

  useEffect(() => {
    const myUid = auth.currentUser?.uid;
    if (!myUid || !orgId) return;
    // Parents request stops under their own UID (childName is stored as metadata on the doc).
    // No separate linked-child UID lookup is needed.
    setWatchUid(myUid);
  }, [orgId, role]);

  useEffect(() => {
    if (!watchUid || !orgId) return;
    const q = query(
      collection(db, 'orgs', orgId, 'stopRequests'),
      where('studentUid', '==', watchUid),
      where('status', 'in', ['completed', 'cancelled']),
      orderBy('createdAt', 'desc'),
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

  const historyTitle = 'History';

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title={historyTitle} />
      <FlatList
        data={stops}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isCancelled = item.status === 'cancelled';
          const eventDate =
            (isCancelled
              ? item.cancelledAt?.toDate?.()
              : item.completedAt?.toDate?.() || item.completedTimestamp?.toDate?.()) ||
            item.createdAt?.toDate?.() ||
            null;

          const cancelReason = isCancelled
            ? item.cancelledReason === 'driver_offline'    ? 'Driver went offline'
            : item.cancelledReason === 'no_buses_online'   ? 'No buses available'
            : item.cancelledReason === 'ttl_expired_15m'   ? 'Request timed out'
            : item.cancelledReason === 'student_cancelled' ? 'Cancelled by you'
            : item.cancelledReason === 'driver_skipped'    ? "Driver couldn't reach stop"
            : 'Cancelled'
            : null;

          return (
            <View style={[styles.card, isCancelled && styles.cardCancelled]}>
              <View style={styles.cardHeader}>
                <View style={[styles.cardIconWrap, isCancelled && styles.cardIconWrapCancelled]}>
                  <Icon
                    name={isCancelled ? 'cancel' : 'place'}
                    size={18}
                    color={isCancelled ? '#9ca3af' : primaryColor}
                  />
                </View>
                <View style={styles.cardContent}>
                  <View style={styles.cardTitleRow}>
                    <Text style={[styles.cardTitle, isCancelled && styles.cardTitleCancelled]}>
                      {item.stop?.name ?? 'Unknown stop'}
                    </Text>
                    {isCancelled && (
                      <View style={styles.cancelledBadge}>
                        <Text style={styles.cancelledBadgeText}>Cancelled</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardDetail}>
                    {eventDate
                      ? `${formatRelativeTime(eventDate)}  ·  ${eventDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                      : 'Time unavailable'}
                    {cancelReason ? `  ·  ${cancelReason}` : ''}
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
                <Text style={styles.emptyHint}>Link your child's profile to see their ride history.</Text>
                <TouchableOpacity
                  style={[styles.emptyBtn, { borderColor: primaryColor }]}
                  onPress={() => navigation.navigate('ParentChildLink')}
                >
                  <Icon name="person-add" size={16} color={primaryColor} />
                  <Text style={[styles.emptyBtnText, { color: primaryColor }]}>Add Child Profile</Text>
                </TouchableOpacity>
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
  cardCancelled: {
    opacity: 0.75,
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
  cardIconWrapCancelled: {
    backgroundColor: '#f3f4f6',
  },
  cardContent: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  cardTitleCancelled: {
    color: '#6b7280',
  },
  cancelledBadge: {
    backgroundColor: '#f3f4f6',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cancelledBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9ca3af',
  },
  cardDetail: {
    fontSize: 13,
    color: '#6b7280',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginTop: 16,
  },
  emptyBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
});
