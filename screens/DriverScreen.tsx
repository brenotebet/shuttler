// DriverScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Animated, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { useLocationSharing } from '../location/LocationContext';
import { useDriver } from '../drivercontext/DriverContext';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  limit,
  getDoc,
  writeBatch,
  orderBy,
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';
import { LOCATIONS } from './RequestStopScreen';

const FRESHNESS_WINDOW_SECONDS = 30;
const STALE_WINDOW_SECONDS = 90;
const STUDENT_REQUEST_TTL_MS = 15 * 60 * 1000;

function isActiveStopStatus(status: unknown): status is 'pending' | 'accepted' {
  return status === 'pending' || status === 'accepted';
}

function isExpiredRequest(r: any) {
  const expiresAtMs = typeof r?.expiresAtMs === 'number' ? r.expiresAtMs : null;
  if (expiresAtMs !== null) return Date.now() >= expiresAtMs;

  const createdAtMs = r?.createdAt?.toMillis?.() ?? null;
  if (!createdAtMs) return false;
  return Date.now() - createdAtMs >= STUDENT_REQUEST_TTL_MS;
}

function formatTimeAgo(inputMs: number) {
  const diff = Math.max(0, Date.now() - inputMs);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function getMyRole(uid: string) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as any)?.role ?? null : null;
}

function isDriverRole(role: unknown) {
  return role === 'driver' || role === 'admin';
}

function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getNearestStop(lat: number, lon: number) {
  let nearest = LOCATIONS[0];
  let minDist = Infinity;

  LOCATIONS.forEach((stop) => {
    const dist = getDistanceInMeters(lat, lon, stop.latitude, stop.longitude);
    if (dist < minDist) {
      minDist = dist;
      nearest = stop;
    }
  });

  return nearest;
}

function nextStopFromNearest(nearestStopId: string | null) {
  if (!nearestStopId) return LOCATIONS[0] ?? null;
  const idx = LOCATIONS.findIndex((stop) => stop.id === nearestStopId);
  if (idx < 0) return LOCATIONS[0] ?? null;
  return LOCATIONS[(idx + 1) % LOCATIONS.length] ?? null;
}

export default function DriverScreen() {
  const insets = useSafeAreaInsets();
  const { isSharing, startSharing, stopSharing } = useLocationSharing();
  const { driverId, loading } = useDriver();

  const [hasLocationPermission, setHasLocationPermission] = useState(true);
  const [busOnline, setBusOnline] = useState(false);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [clockTick, setClockTick] = useState(Date.now());

  const [boardingCount, setBoardingCount] = useState(0);
  const [showBoardingCard, setShowBoardingCard] = useState(false);
  const boardingSlideAnim = useRef(new Animated.Value(0)).current;
  const [boardingCardHeight, setBoardingCardHeight] = useState(220);

  const [userNameByUid, setUserNameByUid] = useState<Record<string, string>>({});
  const userLookupInFlightRef = useRef<Set<string>>(new Set());

  const busLocationsRef = useRef<{
    [id: string]: {
      latitude: number;
      longitude: number;
      lastUpdated: Date;
      isFresh: boolean;
      secondsAgo: number;
    };
  }>({});
  const lastCoords = useRef<{ [id: string]: { latitude: number; longitude: number } }>({});

  const driverCoords = driverId ? (busLocationsRef.current[driverId] ?? null) : null;

  const nearestStop = useMemo(() => {
    if (!driverCoords) return null;
    return getNearestStop(driverCoords.latitude, driverCoords.longitude);
  }, [driverCoords?.latitude, driverCoords?.longitude]);

  const nextStop = useMemo(() => nextStopFromNearest(nearestStop?.id ?? null), [nearestStop?.id]);

  const activeRequests = useMemo(
    () => requests.filter((req) => isActiveStopStatus(req?.status)).filter((req) => !isExpiredRequest(req)),
    [requests, clockTick],
  );

  const countsByStopId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const stop of LOCATIONS) counts[stop.id] = 0;

    for (const req of activeRequests) {
      const stopId = req?.stop?.id ?? req?.stopId;
      if (!stopId) continue;
      counts[stopId] = (counts[stopId] ?? 0) + 1;
    }

    return counts;
  }, [activeRequests]);

  const oldestLatestByStopId = useMemo(() => {
    const byStop: Record<string, { oldestMs: number | null; latestMs: number | null }> = {};

    for (const req of activeRequests) {
      const stopId = req?.stop?.id ?? req?.stopId;
      const createdAtMs = req?.createdAt?.toMillis?.() ?? null;
      if (!stopId || !createdAtMs) continue;

      const existing = byStop[stopId] ?? { oldestMs: null, latestMs: null };
      byStop[stopId] = {
        oldestMs: existing.oldestMs === null ? createdAtMs : Math.min(existing.oldestMs, createdAtMs),
        latestMs: existing.latestMs === null ? createdAtMs : Math.max(existing.latestMs, createdAtMs),
      };
    }

    return byStop;
  }, [activeRequests]);

  const recentFeed = useMemo(() => {
    return [...activeRequests]
      .sort((a, b) => {
        const ta = a?.createdAt?.toMillis?.() ?? 0;
        const tb = b?.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      })
      .slice(0, 30);
  }, [activeRequests]);


  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (loading || !driverId) return;

    const uid = auth.currentUser?.uid;
    if (!uid || uid !== driverId) return;

    let cancelled = false;
    let unsubBus: (() => void) | undefined;
    let unsubRequests: (() => void) | undefined;

    (async () => {
      let role: unknown;
      try {
        role = await getMyRole(uid);
      } catch (e: any) {
        console.error('DriverScreen: failed to read /users role', e?.message);
        return;
      }

      if (!isDriverRole(role) || cancelled) return;

      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(status === 'granted');

      unsubBus = onSnapshot(
        collection(db, 'buses'),
        (snapshot) => {
          if (snapshot.metadata.hasPendingWrites) return;

          const buses = snapshot.docs
            .map((docSnap) => {
              const data: any = docSnap.data();
              const ts =
                data?.updatedAt?.toDate?.() ||
                data?.lastSeen?.toDate?.() ||
                (typeof data?.updatedAt === 'string' ? new Date(data.updatedAt) : null) ||
                (typeof data?.lastSeen === 'string' ? new Date(data.lastSeen) : null) ||
                null;

              if (!ts || Number.isNaN(ts.getTime())) return null;
              if (data?.online !== true) return null;
              if (typeof data?.latitude !== 'number' || typeof data?.longitude !== 'number') return null;

              return {
                id: docSnap.id,
                latitude: data.latitude as number,
                longitude: data.longitude as number,
                timestamp: ts as Date,
              };
            })
            .filter(Boolean)
            .map((bus: any) => {
              const secondsAgo = (Date.now() - bus.timestamp.getTime()) / 1000;
              return { ...bus, secondsAgo };
            });

          const freshBuses = buses.filter((bus) => bus.secondsAgo < FRESHNESS_WINDOW_SECONDS);
          const visibleBuses = buses
            .filter((bus) => bus.secondsAgo < STALE_WINDOW_SECONDS)
            .filter((bus) => bus.id === driverId);

          setBusOnline(freshBuses.some((bus) => bus.id === driverId));

          const nextLocations: {
            [id: string]: {
              latitude: number;
              longitude: number;
              lastUpdated: Date;
              isFresh: boolean;
              secondsAgo: number;
            };
          } = {};

          visibleBuses.forEach((bus) => {
            lastCoords.current[bus.id] = { latitude: bus.latitude, longitude: bus.longitude };
            nextLocations[bus.id] = {
              latitude: bus.latitude,
              longitude: bus.longitude,
              lastUpdated: bus.timestamp,
              isFresh: bus.secondsAgo < FRESHNESS_WINDOW_SECONDS,
              secondsAgo: bus.secondsAgo,
            };
          });

          busLocationsRef.current = nextLocations;
          setActiveBusIds(Object.keys(nextLocations));
        },
        (err) => {
          console.error('buses snapshot error', (err as any)?.message);
        },
      );

      const expireRequestIfNeeded = async (item: any) => {
        if (!item?.id || !isExpiredRequest(item)) return;

        try {
          await updateDoc(doc(db, 'stopRequests', item.id), {
            status: 'cancelled',
            cancelledAt: serverTimestamp(),
            cancelledReason: 'student_request_expired',
          });
        } catch (err) {
          console.error('Failed to expire request on driver feed', err);
        }
      };

      unsubRequests = onSnapshot(
        query(
          collection(db, 'stopRequests'),
          where('status', 'in', ['pending', 'accepted']),
          orderBy('createdAt', 'desc'),
          limit(200),
        ),
        (snapshot) => {
          const rows = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          rows.forEach((row) => {
            if (isExpiredRequest(row)) void expireRequestIfNeeded(row);
          });
          setRequests(rows);
        },
        (err) => {
          console.error('stopRequests snapshot error', (err as any)?.message);
        },
      );
    })();

    return () => {
      cancelled = true;
      if (unsubBus) unsubBus();
      if (unsubRequests) unsubRequests();
    };
  }, [driverId, loading]);

  useEffect(() => {
    if (!showBoardingCard) {
      Animated.timing(boardingSlideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(boardingSlideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [showBoardingCard, boardingSlideAnim]);

  // ✅ UPDATED: Load names from /publicUsers instead of /users
  useEffect(() => {
    const missingUids = recentFeed
      .map((req) => req?.studentUid)
      .filter(
        (uid): uid is string =>
          Boolean(uid) && !userNameByUid[uid] && !userLookupInFlightRef.current.has(uid),
      );

    missingUids.forEach((uid) => {
      userLookupInFlightRef.current.add(uid);

      void getDoc(doc(db, 'publicUsers', uid))
        .then((snap) => {
          if (!snap.exists()) return;
          const data = snap.data() as any;
          const displayName = typeof data?.displayName === 'string' ? data.displayName : null;
          if (!displayName) return;
          setUserNameByUid((prev) => ({ ...prev, [uid]: displayName }));
        })
        .catch((err) => {
          console.error('Failed to load public user profile for feed', err);
        })
        .finally(() => {
          userLookupInFlightRef.current.delete(uid);
        });
    });
  }, [recentFeed, userNameByUid]);

  const saveBoardingCount = async () => {
    if (!driverId) return;

    const loc = lastCoords.current[driverId] ?? busLocationsRef.current[driverId];
    if (!loc) {
      showAlert('Driver location unavailable');
      return;
    }

    const nearest = getNearestStop(loc.latitude, loc.longitude);

    const nearestStopRequest = activeRequests.find((req) => {
      const stopId = req?.stop?.id ?? req?.stopId;
      return stopId === nearest.id;
    });

    try {
      const batch = writeBatch(db);
      const boardingRef = doc(collection(db, 'boardingCounts'));
      batch.set(boardingRef, {
        driverUid: driverId,
        stopRequestId: nearestStopRequest?.id ?? null,
        studentUid: nearestStopRequest?.studentUid ?? null,
        stopId: nearest.id,
        stopName: nearest.name,
        stopLat: nearest.latitude,
        stopLng: nearest.longitude,
        count: boardingCount,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      showAlert('Boarding count saved!');
      setShowBoardingCard(false);
      setBoardingCount(0);
    } catch (error) {
      console.error('Failed to save boarding count:', error);
      showAlert('Failed to save boarding count');
    }
  };

  if (loading || !driverId) return null;

  const headerHeight = 74 + insets.top;
  const nearestStats = nearestStop ? oldestLatestByStopId[nearestStop.id] : undefined;
  const nextStats = nextStop ? oldestLatestByStopId[nextStop.id] : undefined;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Driver Dashboard</Text>
        <TouchableOpacity
          style={styles.shareButton}
          onPress={async () => {
            if (!driverId) {
              showAlert('Driver ID missing');
              return;
            }
            try {
              if (isSharing) await stopSharing();
              else await startSharing();
            } catch (err) {
              console.error(err);
              showAlert('Error toggling location sharing');
            }
          }}
        >
          <Icon name={isSharing ? 'gps-off' : 'gps-fixed'} size={22} color="#fff" />
          <Text style={styles.shareButtonText}>{isSharing ? 'Stop Sharing' : 'Start Sharing'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight + 12, paddingBottom: 140 }]}>
        {!isSharing && hasLocationPermission && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Not sharing location. Tap Start Sharing to go online.</Text>
          </View>
        )}

        {isSharing && !activeBusIds.includes(driverId) && hasLocationPermission && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Sharing is ON, but your location hasn’t updated yet.</Text>
          </View>
        )}

        {!hasLocationPermission && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Location permission denied. Enable location to share your position.</Text>
          </View>
        )}

        <View style={styles.cardLarge}>
          <Text style={styles.cardTitle}>Current Stop</Text>
          <Text style={styles.cardMainValue}>{nearestStop?.name ?? 'Waiting for location...'}</Text>
          <Text style={styles.cardMeta}>Active requests: {nearestStop ? countsByStopId[nearestStop.id] ?? 0 : 0}</Text>
          <Text style={styles.cardMeta}>
            {nearestStats?.oldestMs
              ? `Oldest: ${formatTimeAgo(nearestStats.oldestMs)} • Latest: ${formatTimeAgo(nearestStats.latestMs ?? nearestStats.oldestMs)}`
              : 'Oldest: — • Latest: —'}
          </Text>

          <TouchableOpacity style={styles.actionButton} onPress={() => setShowBoardingCard(true)}>
            <Text style={styles.actionButtonText}>Add Students</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next Stop</Text>
          <Text style={styles.cardMainValue}>{nextStop?.name ?? '—'}</Text>
          <Text style={styles.cardMeta}>Active requests: {nextStop ? countsByStopId[nextStop.id] ?? 0 : 0}</Text>
          <Text style={styles.cardMeta}>Latest: {nextStats?.latestMs ? formatTimeAgo(nextStats.latestMs) : '—'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent Requests Feed</Text>
          <View style={styles.feedWrap}>
            {recentFeed.length === 0 ? (
              <Text style={styles.emptyText}>No active requests.</Text>
            ) : (
              recentFeed.map((req) => {
                const stopName = req?.stop?.name ?? req?.stopId ?? 'Unknown stop';
                const createdAtMs = req?.createdAt?.toMillis?.() ?? Date.now();
                const displayName = req?.studentUid ? userNameByUid[req.studentUid] : null;
                const fallbackIdentifier = req?.studentEmail || req?.studentUid || 'Unknown student';
                const studentLabel = displayName ? `${displayName} (${fallbackIdentifier})` : fallbackIdentifier;

                return (
                  <View key={req.id} style={styles.feedRow}>
                    <Text style={styles.feedStop}>{stopName}</Text>
                    <Text style={styles.feedMeta}>Requested {formatTimeAgo(createdAtMs)}</Text>
                    <Text style={styles.feedStudent}>{studentLabel}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Route Progress</Text>
          {LOCATIONS.map((stop) => {
            const isCurrent = stop.id === nearestStop?.id;
            const isNext = stop.id === nextStop?.id;
            return (
              <View key={stop.id} style={[styles.routeRow, isCurrent && styles.routeCurrent, isNext && styles.routeNext]}>
                <View>
                  <Text style={styles.routeName}>{stop.name}</Text>
                  <Text style={styles.routeHint}>{isCurrent ? 'Current stop' : isNext ? 'Next stop' : 'Upcoming'}</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{countsByStopId[stop.id] ?? 0}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {isSharing && !busOnline && <Text style={styles.onlineHint}>Waiting for fresh driver GPS ping…</Text>}
      </ScrollView>

      {showBoardingCard && (
        <Animated.View
          onLayout={(e) => setBoardingCardHeight(e.nativeEvent.layout.height)}
          style={[
            styles.bottomCard,
            {
              transform: [
                {
                  translateY: boardingSlideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [boardingCardHeight, 0],
                  }),
                },
              ],
              opacity: boardingSlideAnim,
            },
          ]}
        >
          <Text style={styles.cardTitle}>Students Boarding</Text>

          <View style={styles.counterRow}>
            <TouchableOpacity style={styles.counterButton} onPress={() => setBoardingCount(Math.max(0, boardingCount - 1))}>
              <Text style={styles.counterButtonText}>-</Text>
            </TouchableOpacity>

            <Text style={styles.countText}>{boardingCount}</Text>

            <TouchableOpacity style={styles.counterButton} onPress={() => setBoardingCount(boardingCount + 1)}>
              <Text style={styles.counterButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.actionButton} onPress={saveBoardingCount}>
            <Text style={styles.actionButtonText}>Save</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              setShowBoardingCard(false);
              setBoardingCount(0);
            }}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BACKGROUND_COLOR },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    paddingBottom: 10,
    paddingHorizontal: 14,
    backgroundColor: BACKGROUND_COLOR,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#111' },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 12,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PRIMARY_COLOR,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 6,
    fontWeight: '600',
  },
  banner: {
    backgroundColor: 'rgba(255,165,0,0.9)',
    padding: 12,
    borderRadius: 10,
  },
  bannerText: { color: '#000', fontSize: 14, textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
  },
  cardLarge: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6, color: '#111' },
  cardMainValue: { fontSize: 20, fontWeight: '700', color: PRIMARY_COLOR, marginBottom: 6 },
  cardMeta: { fontSize: 14, color: '#4d4d4d', marginBottom: 2 },
  actionButton: {
    marginTop: 12,
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  feedWrap: {
    maxHeight: 280,
  },
  feedRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  feedStop: { fontSize: 15, fontWeight: '600', color: '#111' },
  feedMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  feedStudent: { fontSize: 13, color: '#444', marginTop: 2 },
  emptyText: { fontSize: 14, color: '#777', paddingVertical: 10 },
  routeRow: {
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e3e3e3',
  },
  routeCurrent: { backgroundColor: '#e9f5ff' },
  routeNext: { backgroundColor: '#f2fbf2' },
  routeName: { fontSize: 14, fontWeight: '600', color: '#222' },
  routeHint: { fontSize: 12, color: '#666', marginTop: 2 },
  badge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PRIMARY_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeText: { color: '#fff', fontWeight: '700' },
  onlineHint: { textAlign: 'center', color: '#777', fontSize: 12, marginTop: 4 },
  bottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BACKGROUND_COLOR,
    padding: 20,
    paddingBottom: 40,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 10,
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
  },
  counterButton: {
    backgroundColor: PRIMARY_COLOR,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterButtonText: { color: '#fff', fontSize: 24, fontWeight: '600' },
  countText: { fontSize: 24, marginHorizontal: 20, fontWeight: '500' },
  cancelButton: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});