// DriverScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Animated, ScrollView, ActivityIndicator, Linking, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useLocationSharing } from '../location/LocationContext';
import { useDriver } from '../drivercontext/DriverContext';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  serverTimestamp,
  setDoc,
  limit,
  getDoc,
  getDocs,
  writeBatch,
  orderBy,
  runTransaction,
  increment,
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { showAlert } from '../src/utils/alerts';
import { notifyStudentArrived, notifyStudentCompleted } from '../src/utils/pushNotifications';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';
import { STUDENT_REQUEST_TTL_MS, FRESHNESS_WINDOW_SECONDS } from '../src/constants/stops';
import { getPlanLimits } from '../src/constants/planLimits';
import { useOrg, Stop } from '../src/org/OrgContext';
import { useAuth } from '../src/auth/AuthProvider';

const STALE_WINDOW_SECONDS = 180;
const ARRIVE_RADIUS_FT = 75;
const EXIT_RADIUS_FT = 180;
const DWELL_SECONDS = 30;
const PROXIMITY_POLL_MS = 5000;
const TTL_SWEEP_MS = 30000;

function feetToMeters(feet: number) {
  return feet * 0.3048;
}

const ARRIVE_RADIUS_M = feetToMeters(ARRIVE_RADIUS_FT);
const EXIT_RADIUS_M = feetToMeters(EXIT_RADIUS_FT);
const NEAREST_STOP_RADIUS_FT = 300;
const NEAREST_STOP_RADIUS_M = feetToMeters(NEAREST_STOP_RADIUS_FT);

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

function isExpiredRequestAt(r: any, nowMs: number) {
  const expiresAtMs = typeof r?.expiresAtMs === 'number' ? r.expiresAtMs : null;
  if (expiresAtMs !== null) return nowMs >= expiresAtMs;

  const createdAtMs = r?.createdAt?.toMillis?.() ?? null;
  if (!createdAtMs) return false;
  return nowMs - createdAtMs >= STUDENT_REQUEST_TTL_MS;
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

function getNearestStop(lat: number, lon: number, stops: Stop[]) {
  if (stops.length === 0) return null;
  let nearest = stops[0];
  let minDist = Infinity;
  stops.forEach((stop) => {
    const dist = getDistanceInMeters(lat, lon, stop.latitude, stop.longitude);
    if (dist < minDist) { minDist = dist; nearest = stop; }
  });
  return nearest;
}

function nextStopFromNearest(nearestStopId: string | null, stops: Stop[]) {
  if (stops.length === 0) return null;
  if (!nearestStopId) return stops[0];
  const idx = stops.findIndex((stop) => stop.id === nearestStopId);
  if (idx < 0) return stops[0];
  return stops[(idx + 1) % stops.length];
}

export default function DriverScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isSharing, startSharing, stopSharing } = useLocationSharing();
  const { driverId, loading } = useDriver();
  const { org } = useOrg();
  const { role: authRole } = useAuth();
  const orgStops: Stop[] = org?.stops ?? [];
  const orgRoutes = org?.routes ?? [];
  const orgId = org?.orgId ?? '';

  const [isToggling, setIsToggling] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(true);
  const [busOnline, setBusOnline] = useState(false);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [clockTick, setClockTick] = useState(Date.now());

  const [boardingCount, setBoardingCount] = useState(0);
  const [showBoardingCard, setShowBoardingCard] = useState(false);
  const [isSavingBoarding, setIsSavingBoarding] = useState(false);
  const [totalBoardedSession, setTotalBoardedSession] = useState(0);
  const [todayBoardedTotal, setTodayBoardedTotal] = useState(0);
  const [shiftStartMs, setShiftStartMs] = useState<number | null>(null);
  const [showShiftCard, setShowShiftCard] = useState(false);
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
  const proximityStateRef = useRef<
    Record<
      string,
      {
        arrivalStartMs: number | null;
        lastOutsideMs: number | null;
        servicedReady: boolean;
        arrivedAtWritten: boolean;
      }
    >
  >({});
  const arrivalWritesInFlightRef = useRef<Set<string>>(new Set());
  const completionWritesInFlightRef = useRef<Set<string>>(new Set());
  const expiryWritesInFlightRef = useRef<Set<string>>(new Set());
  const seenRequestIdsRef = useRef<Set<string>>(new Set());

  const driverCoords = driverId ? (busLocationsRef.current[driverId] ?? null) : null;

  // Resolve the active route. Auto-selects the first route when routes are available.
  const activeRoute = useMemo(() => {
    if (orgRoutes.length === 0) return null;
    return orgRoutes.find((r) => r.id === selectedRouteId) ?? orgRoutes[0];
  }, [orgRoutes, selectedRouteId]);

  // Pre-select the admin-assigned default route on mount + write public profile so
  // students see the driver's name when they tap the bus.
  useEffect(() => {
    if (!driverId || !orgId) return;
    getDoc(doc(db, 'orgs', orgId, 'users', driverId)).then((snap) => {
      if (!snap.exists()) return;
      const defaultRouteId: string | undefined = snap.data()?.defaultRouteId;
      if (defaultRouteId) setSelectedRouteId(defaultRouteId);

      const storedName: string | null = snap.data()?.displayName ?? auth.currentUser?.displayName ?? null;
      if (storedName) {
        setDoc(
          doc(db, 'orgs', orgId, 'publicUsers', driverId),
          { displayName: storedName, updatedAt: serverTimestamp() },
          { merge: true },
        ).catch(() => {});
      }
    }).catch(() => {});
  }, [driverId, orgId]);

  // Keep the bus doc's routeId field in sync so MapScreen can do route-aware bus matching.
  useEffect(() => {
    if (!driverId || !orgId) return;
    const routeId = activeRoute?.id ?? null;
    void setDoc(
      doc(db, 'orgs', orgId, 'buses', driverId),
      { routeId },
      { merge: true },
    );
  }, [activeRoute?.id, driverId, orgId]);

  // Ordered stop list: follows the active route's stopIds, falls back to orgStops if no routes.
  const routeOrderedStops: Stop[] = useMemo(() => {
    if (!activeRoute) return orgStops;
    const stopById = new Map(orgStops.map((s) => [s.id, s]));
    return activeRoute.stopIds
      .map((id) => stopById.get(id))
      .filter((s): s is Stop => s !== undefined);
  }, [activeRoute, orgStops]);

  const nearestStop = useMemo(() => {
    if (!driverCoords) return null;
    const stop = getNearestStop(driverCoords.latitude, driverCoords.longitude, routeOrderedStops);
    if (!stop) return null;
    const dist = getDistanceInMeters(driverCoords.latitude, driverCoords.longitude, stop.latitude, stop.longitude);
    return dist <= NEAREST_STOP_RADIUS_M ? stop : null;
  }, [driverCoords?.latitude, driverCoords?.longitude, routeOrderedStops]);

  const nextStop = useMemo(
    () => nextStopFromNearest(nearestStop?.id ?? null, routeOrderedStops),
    [nearestStop?.id, routeOrderedStops],
  );

  const activeRequests = useMemo(
    () => requests.filter((req) => isActiveStopStatus(req?.status)).filter((req) => !isExpiredRequest(req)),
    [requests, clockTick],
  );

  // Ref so interval callbacks always see the latest list without restarting every second.
  const activeRequestsRef = useRef(activeRequests);
  useEffect(() => {
    activeRequestsRef.current = activeRequests;
  }, [activeRequests]);

  const countsByStopId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const stop of orgStops) counts[stop.id] = 0;

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
    const timer = setInterval(() => setClockTick(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (loading || !driverId || !orgId) return;

    const uid = auth.currentUser?.uid;
    if (!uid || uid !== driverId) return;

    let cancelled = false;
    let unsubBus: (() => void) | undefined;
    let unsubRequests: (() => void) | undefined;

    (async () => {
      if (!isDriverRole(authRole) || cancelled) return;

      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(status === 'granted');

      unsubBus = onSnapshot(
        collection(db, 'orgs', orgId, 'buses'),
        (snapshot) => {
          const buses = snapshot.docs
            .map((docSnap) => {
              const data: any = docSnap.data({ serverTimestamps: 'estimate' });
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
        if (!item?.id || !isExpiredRequest(item) || expiryWritesInFlightRef.current.has(item.id)) return;

        expiryWritesInFlightRef.current.add(item.id);
        try {
          await runTransaction(db, async (tx) => {
            const ref = doc(db, 'orgs', orgId, 'stopRequests', item.id);
            const snap = await tx.get(ref);
            if (!snap.exists()) return;

            const current = snap.data() as any;
            if (!isActiveStopStatus(current?.status)) return;
            if (!isExpiredRequestAt(current, Date.now())) return;

            tx.update(ref, {
              status: 'cancelled',
              cancelledAt: serverTimestamp(),
              cancelledReason: 'ttl_expired_15m',
            });
          });
        } catch (err) {
          console.error('Failed to expire request on driver feed', err);
        } finally {
          expiryWritesInFlightRef.current.delete(item.id);
        }
      };

      unsubRequests = onSnapshot(
        query(
          collection(db, 'orgs', orgId, 'stopRequests'),
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
  }, [driverId, loading, authRole, orgId]);

  useEffect(() => {
    const activeIds = new Set(activeRequests.map((r) => r.id));
    Object.keys(proximityStateRef.current).forEach((id) => {
      if (!activeIds.has(id)) delete proximityStateRef.current[id];
    });
  }, [activeRequests]);

  useEffect(() => {
    if (!isSharing || !driverId) return;

    const markArrivedIfNeeded = async (requestId: string) => {
      if (arrivalWritesInFlightRef.current.has(requestId)) return;
      arrivalWritesInFlightRef.current.add(requestId);

      try {
        let studentUid: string | null = null;
        let stopName: string | null = null;

        await runTransaction(db, async (tx) => {
          const ref = doc(db, 'orgs', orgId, 'stopRequests', requestId);
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const current = snap.data() as any;
          if (!isActiveStopStatus(current?.status)) return;
          if (isExpiredRequestAt(current, Date.now())) return;
          if (current?.arrivedAt) return;
          studentUid = current.studentUid ?? null;
          stopName = current.stop?.name ?? null;
          tx.update(ref, { arrivedAt: serverTimestamp() });
        });

        if (studentUid) {
          void notifyStudentArrived(orgId, studentUid, stopName ?? 'your stop');
        }
      } catch (err) {
        console.error('Failed to set arrivedAt on stop request', err);
      } finally {
        arrivalWritesInFlightRef.current.delete(requestId);
      }
    };

    const completeRequestIfEligible = async (requestId: string, driverUid: string) => {
      if (completionWritesInFlightRef.current.has(requestId)) return;
      completionWritesInFlightRef.current.add(requestId);

      try {
        let studentUid: string | null = null;
        let stopName: string | null = null;

        await runTransaction(db, async (tx) => {
          const ref = doc(db, 'orgs', orgId, 'stopRequests', requestId);
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const current = snap.data() as any;
          if (!isActiveStopStatus(current?.status)) return;
          if (isExpiredRequestAt(current, Date.now())) return;
          studentUid = current.studentUid ?? null;
          stopName = current.stop?.name ?? null;

          tx.update(ref, {
            status: 'completed',
            completedAt: serverTimestamp(),
            completedReason: 'proximity_drive_by',
            driverUid: current?.driverUid ?? current?.driverId ?? driverUid,
          });
        });

        if (studentUid) {
          void notifyStudentCompleted(orgId, studentUid, stopName ?? 'your stop');
        }
      } catch (err) {
        console.error('Failed to complete stop request from proximity', err);
      } finally {
        completionWritesInFlightRef.current.delete(requestId);
      }
    };

    const tick = () => {
      const driverLoc = busLocationsRef.current[driverId] ?? lastCoords.current[driverId];
      if (!driverLoc) return;
      const nowMs = Date.now();

      activeRequestsRef.current.forEach((req) => {
        if (!req?.id || !isActiveStopStatus(req?.status)) return;

        if (isExpiredRequestAt(req, nowMs)) {
          if (!expiryWritesInFlightRef.current.has(req.id)) {
            expiryWritesInFlightRef.current.add(req.id);
            void runTransaction(db, async (tx) => {
              const ref = doc(db, 'orgs', orgId, 'stopRequests', req.id);
              const snap = await tx.get(ref);
              if (!snap.exists()) return;
              const current = snap.data() as any;
              if (!isActiveStopStatus(current?.status)) return;
              if (!isExpiredRequestAt(current, Date.now())) return;
              tx.update(ref, {
                status: 'cancelled',
                cancelledAt: serverTimestamp(),
                cancelledReason: 'ttl_expired_15m',
              });
            })
              .catch((err) => {
                console.error('Failed to expire request from proximity loop', err);
              })
              .finally(() => {
                expiryWritesInFlightRef.current.delete(req.id);
              });
          }
          delete proximityStateRef.current[req.id];
          return;
        }

        const stopLat = req?.stop?.latitude;
        const stopLon = req?.stop?.longitude;
        if (typeof stopLat !== 'number' || typeof stopLon !== 'number') return;

        const distanceM = getDistanceInMeters(driverLoc.latitude, driverLoc.longitude, stopLat, stopLon);
        const withinArrive = distanceM <= ARRIVE_RADIUS_M;
        const beyondExit = distanceM >= EXIT_RADIUS_M;

        const state =
          proximityStateRef.current[req.id] ??
          { arrivalStartMs: null, lastOutsideMs: null, servicedReady: false, arrivedAtWritten: Boolean(req?.arrivedAt) };
        let nextState = { ...state };

        if (withinArrive) {
          nextState.lastOutsideMs = null;
          if (nextState.arrivalStartMs === null) nextState.arrivalStartMs = nowMs;
          if (!nextState.arrivedAtWritten && !req?.arrivedAt) {
            nextState.arrivedAtWritten = true;
            void markArrivedIfNeeded(req.id);
          }

          if (nextState.arrivalStartMs !== null && nowMs - nextState.arrivalStartMs >= DWELL_SECONDS * 1000) {
            nextState.servicedReady = true;
          }
        } else if (nextState.arrivalStartMs !== null) {
          if (nextState.lastOutsideMs === null) {
            nextState.lastOutsideMs = nowMs;
          } else if (nowMs - nextState.lastOutsideMs >= PROXIMITY_POLL_MS * 2) {
            nextState.arrivalStartMs = null;
            nextState.lastOutsideMs = null;
          }
        }

        if (beyondExit && nextState.servicedReady) {
          void completeRequestIfEligible(req.id, driverId);
          delete proximityStateRef.current[req.id];
          return;
        }

        proximityStateRef.current[req.id] = nextState;
      });
    };

    tick();
    const interval = setInterval(tick, PROXIMITY_POLL_MS);
    return () => clearInterval(interval);
  }, [driverId, isSharing, orgId]);

  useEffect(() => {
    if (!driverId) return;
    const timer = setInterval(() => {
      activeRequestsRef.current.forEach((item) => {
        if (!item?.id || !isExpiredRequest(item) || expiryWritesInFlightRef.current.has(item.id)) return;
        expiryWritesInFlightRef.current.add(item.id);
        void runTransaction(db, async (tx) => {
          const ref = doc(db, 'orgs', orgId, 'stopRequests', item.id);
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const current = snap.data() as any;
          if (!isActiveStopStatus(current?.status)) return;
          if (!isExpiredRequestAt(current, Date.now())) return;
          tx.update(ref, {
            status: 'cancelled',
            cancelledAt: serverTimestamp(),
            cancelledReason: 'ttl_expired_15m',
          });
        })
          .catch((err) => {
            console.error('Failed to expire request from timer', err);
          })
          .finally(() => {
            expiryWritesInFlightRef.current.delete(item.id);
          });
      });
    }, TTL_SWEEP_MS);

    return () => clearInterval(timer);
  }, [driverId, orgId]);

  useEffect(() => {
    if (!showBoardingCard) {
      Animated.timing(boardingSlideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(boardingSlideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [showBoardingCard, boardingSlideAnim]);

  const refreshTodayBoardings = async () => {
    if (!driverId || !orgId) return;
    try {
      const snap = await getDocs(
        query(collection(db, 'orgs', orgId, 'boardingCounts'), where('driverUid', '==', driverId)),
      );
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const midnightMs = midnight.getTime();
      let total = 0;
      snap.docs.forEach((d) => {
        const ms = d.data()?.createdAt?.toMillis?.() ?? 0;
        if (ms >= midnightMs) total += d.data()?.count ?? 0;
      });
      setTodayBoardedTotal(total);
    } catch (e) {
      console.error('refreshTodayBoardings failed', e);
    }
  };

  useEffect(() => {
    if (isSharing) {
      setTotalBoardedSession(0);
      setShiftStartMs(Date.now());
      refreshTodayBoardings();
    } else {
      setShiftStartMs(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSharing]);

  useEffect(() => {
    if (!isSharing) return;
    const pending = requests.filter((r) => isActiveStopStatus(r?.status) && !isExpiredRequest(r));
    const newOnes = pending.filter((r) => !seenRequestIdsRef.current.has(r.id));
    if (newOnes.length > 0) {
      const stopName = newOnes[0].stop?.name ?? 'a stop';
      const body =
        newOnes.length === 1
          ? `New request at ${stopName}`
          : `${newOnes.length} new stop requests`;
      Notifications.scheduleNotificationAsync({
        content: { title: 'Shuttler', body, sound: true },
        trigger: null,
      });
    }
    pending.forEach((r) => seenRequestIdsRef.current.add(r.id));
    requests.forEach((r) => seenRequestIdsRef.current.add(r.id));
  }, [requests, isSharing]);

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

      void getDoc(doc(db, 'orgs', orgId, 'publicUsers', uid))
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
    if (!driverId || isSavingBoarding) return;
    setIsSavingBoarding(true);

    const loc = lastCoords.current[driverId] ?? busLocationsRef.current[driverId];
    if (!loc) {
      showAlert('Driver location unavailable');
      return;
    }

    const nearest = getNearestStop(loc.latitude, loc.longitude, orgStops);
    if (!nearest) {
      showAlert('No stops configured for this org.');
      return;
    }

    const requestsAtStop = activeRequests.filter((req) => {
      const stopId = req?.stop?.id ?? req?.stopId;
      return stopId === nearest.id;
    });

    try {
      const batch = writeBatch(db);

      const boardingRef = doc(collection(db, 'orgs', orgId, 'boardingCounts'));
      batch.set(boardingRef, {
        driverUid: driverId,
        stopId: nearest.id,
        stopName: nearest.name,
        stopLat: nearest.latitude,
        stopLng: nearest.longitude,
        count: boardingCount,
        completedRequestIds: requestsAtStop.map((r) => r.id),
        createdAt: serverTimestamp(),
      });

      requestsAtStop.forEach((req) => {
        batch.update(doc(db, 'orgs', orgId, 'stopRequests', req.id), {
          status: 'completed',
          completedAt: serverTimestamp(),
          completedReason: 'driver_boarding_save',
          driverUid: req?.driverUid ?? req?.driverId ?? driverId,
        });
      });

      batch.update(doc(db, 'orgs', orgId, 'buses', driverId), {
        totalStudentsBoarded: increment(boardingCount),
      });

      await batch.commit();

      requestsAtStop.forEach((req) => {
        if (req.studentUid) {
          void notifyStudentCompleted(orgId, req.studentUid, nearest.name);
        }
      });

      setTotalBoardedSession((prev) => prev + boardingCount);
      void refreshTodayBoardings();
      showAlert('Boarding count saved!');
      setShowBoardingCard(false);
      setBoardingCount(0);
    } catch (error) {
      console.error('Failed to save boarding count:', error);
      showAlert('Failed to save boarding count');
    } finally {
      setIsSavingBoarding(false);
    }
  };

  if (loading || !driverId) return null;

  const headerHeight = 74 + insets.top;
  const nearestStats = nearestStop ? oldestLatestByStopId[nearestStop.id] : undefined;
  const nextStats = nextStop ? oldestLatestByStopId[nextStop.id] : undefined;

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Driver Dashboard</Text>
        <TouchableOpacity
          style={[styles.shareButton, isToggling && styles.shareButtonDisabled]}
          disabled={isToggling}
          onPress={async () => {
            if (!driverId) {
              showAlert('Driver ID missing');
              return;
            }
            setIsToggling(true);
            try {
              if (isSharing) {
                await stopSharing();
              } else {
                // Check vehicle limit before going online
                const limits = getPlanLimits(org?.subscriptionPlan, org?.subscriptionStatus);
                if (limits.maxVehicles !== Infinity) {
                  const busSnap = await getDocs(
                    query(
                      collection(db, 'orgs', orgId, 'buses'),
                      where('online', '==', true),
                    ),
                  );
                  const now = Date.now();
                  const otherOnline = busSnap.docs.filter((d) => {
                    if (d.id === driverId) return false;
                    const data = d.data({ serverTimestamps: 'estimate' });
                    const tsMs = data?.updatedAt?.toMillis?.() ?? data?.lastSeen?.toMillis?.() ?? null;
                    if (tsMs === null) return false;
                    return (now - tsMs) / 1000 < STALE_WINDOW_SECONDS;
                  }).length;
                  if (otherOnline >= limits.maxVehicles) {
                    showAlert(
                      `Your ${limits.label} plan allows up to ${limits.maxVehicles} vehicles online at once. Upgrade to Campus to add more.`,
                      'Vehicle limit reached',
                    );
                    return;
                  }
                }
                await startSharing();
              }
            } catch (err) {
              console.error(err);
              showAlert('Error toggling location sharing');
            } finally {
              setIsToggling(false);
            }
          }}
        >
          {isToggling ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Icon name={isSharing ? 'gps-off' : 'gps-fixed'} size={22} color="#fff" />
          )}
          <Text style={styles.shareButtonText}>
            {isToggling ? (isSharing ? 'Stopping...' : 'Starting...') : isSharing ? 'Stop Sharing' : 'Start Sharing'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight + 12, paddingBottom: 140 }]}>
        {org?.subscriptionStatus === 'past_due' && (
          <View style={styles.pastDueBanner}>
            <Icon name="warning" size={16} color="#7c2d12" />
            <Text style={styles.pastDueBannerText}>
              {authRole === 'admin'
                ? 'Payment failed — subscription is past due.'
                : 'Service may be interrupted — contact your administrator.'}
            </Text>
            {authRole === 'admin' && (
              <TouchableOpacity onPress={() => navigation.navigate('AdminOrgSetup')}>
                <Text style={styles.pastDueBannerLink}>Fix billing →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

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
            <TouchableOpacity onPress={() => Linking.openSettings()} style={{ marginTop: 6 }}>
              <Text style={[styles.bannerText, { fontWeight: '700', textDecorationLine: 'underline' }]}>Open Settings →</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.cardLarge}>
          <Text style={styles.cardTitle}>Current Stop</Text>
          <Text style={styles.cardMainValue}>
            {nearestStop?.name ?? (driverCoords ? 'En route…' : 'Waiting for location...')}
          </Text>
          <Text style={styles.cardMeta}>Active requests: {nearestStop ? countsByStopId[nearestStop.id] ?? 0 : 0}</Text>
          <Text style={styles.cardMeta}>
            {nearestStats?.oldestMs
              ? `Oldest: ${formatTimeAgo(nearestStats.oldestMs)} • Latest: ${formatTimeAgo(nearestStats.latestMs ?? nearestStats.oldestMs)}`
              : 'Oldest: — • Latest: —'}
          </Text>
          {isSharing && totalBoardedSession > 0 && (
            <Text style={styles.cardMeta}>Session total: {totalBoardedSession} students boarded</Text>
          )}

          <TouchableOpacity
            style={[styles.actionButton, (!isSharing || !nearestStop) && styles.actionButtonDisabled]}
            onPress={() => {
              if (!isSharing) {
                showAlert('Turn on location sharing before adding students.', 'Location required');
                return;
              }
              if (!nearestStop) {
                showAlert('You must be within 300 ft of a stop to add students.', 'Not at a stop');
                return;
              }
              setShowBoardingCard(true);
            }}
          >
            <Text style={styles.actionButtonText}>Add Students</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next Stop</Text>
          <Text style={styles.cardMainValue}>{nextStop?.name ?? '—'}</Text>
          <Text style={styles.cardMeta}>Active requests: {nextStop ? countsByStopId[nextStop.id] ?? 0 : 0}</Text>
          <Text style={styles.cardMeta}>Latest: {nextStats?.latestMs ? formatTimeAgo(nextStats.latestMs) : '—'}</Text>
        </View>

        {isSharing && (
          <TouchableOpacity
            style={styles.card}
            onPress={() => setShowShiftCard((v) => !v)}
            activeOpacity={0.85}
          >
            <View style={styles.shiftCardHeader}>
              <Text style={styles.cardTitle}>My Shift</Text>
              <Icon name={showShiftCard ? 'expand-less' : 'expand-more'} size={20} color="#9ca3af" />
            </View>
            {showShiftCard && (
              <View style={styles.shiftStats}>
                <View style={styles.shiftStat}>
                  <Text style={styles.shiftStatValue}>{totalBoardedSession}</Text>
                  <Text style={styles.shiftStatLabel}>This session</Text>
                </View>
                <View style={styles.shiftStatDivider} />
                <View style={styles.shiftStat}>
                  <Text style={styles.shiftStatValue}>{todayBoardedTotal}</Text>
                  <Text style={styles.shiftStatLabel}>Today total</Text>
                </View>
                <View style={styles.shiftStatDivider} />
                <View style={styles.shiftStat}>
                  <Text style={styles.shiftStatValue}>
                    {shiftStartMs
                      ? (() => {
                          const mins = Math.floor((Date.now() - shiftStartMs) / 60000);
                          return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
                        })()
                      : '—'}
                  </Text>
                  <Text style={styles.shiftStatLabel}>Time online</Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        )}

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
                const studentLabel = displayName ?? req?.studentEmail?.split('@')[0] ?? 'Student';

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

          {orgRoutes.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.routePickerScroll}
              contentContainerStyle={styles.routePickerContent}
            >
              {orgRoutes.map((route) => {
                const isSelected = (selectedRouteId ?? orgRoutes[0]?.id) === route.id;
                return (
                  <TouchableOpacity
                    key={route.id}
                    style={[styles.routeChip, isSelected && styles.routeChipSelected]}
                    onPress={() => setSelectedRouteId(route.id)}
                  >
                    <Text style={[styles.routeChipText, isSelected && styles.routeChipTextSelected]}>
                      {route.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {activeRoute && orgRoutes.length === 1 && (
            <Text style={styles.routeSingleName}>{activeRoute.name}</Text>
          )}

          {routeOrderedStops.length === 0 && (
            <Text style={styles.emptyText}>No stops configured. Ask your admin to set up stops.</Text>
          )}
          {routeOrderedStops.map((stop, index) => {
            const isCurrent = stop.id === nearestStop?.id;
            const isNext = stop.id === nextStop?.id;
            return (
              <View key={stop.id} style={[styles.routeRow, isCurrent && styles.routeCurrent, isNext && styles.routeNext]}>
                <View style={styles.routeRowLeft}>
                  <Text style={styles.routeIndex}>{index + 1}</Text>
                  <View>
                    <Text style={styles.routeName}>{stop.name}</Text>
                    <Text style={styles.routeHint}>{isCurrent ? 'You are here' : isNext ? 'Next stop' : 'Upcoming'}</Text>
                  </View>
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
              <Text style={styles.counterButtonText}>−</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.countText}
              value={boardingCount > 0 ? String(boardingCount) : ''}
              onChangeText={(v) => {
                const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
                setBoardingCount(isNaN(n) ? 0 : Math.min(999, n));
              }}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#bbb"
              textAlign="center"
              selectTextOnFocus
            />

            <TouchableOpacity style={styles.counterButton} onPress={() => setBoardingCount(boardingCount + 1)}>
              <Text style={styles.counterButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.actionButton, isSavingBoarding && styles.actionButtonDisabled]}
            onPress={saveBoardingCount}
            disabled={isSavingBoarding}
          >
            <Text style={styles.actionButtonText}>{isSavingBoarding ? 'Saving…' : 'Save'}</Text>
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
  shareButtonDisabled: { opacity: 0.65 },
  shareButtonText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 6,
    fontWeight: '600',
  },
  pastDueBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  pastDueBannerText: { flex: 1, fontSize: 13, color: '#7c2d12', fontWeight: '500' },
  pastDueBannerLink: { fontSize: 13, color: '#dc2626', fontWeight: '700' },
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
  shiftCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shiftStats: { flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  shiftStat: { flex: 1, alignItems: 'center' },
  shiftStatValue: { fontSize: 22, fontWeight: '700', color: PRIMARY_COLOR },
  shiftStatLabel: { fontSize: 11, color: '#9ca3af', marginTop: 3 },
  shiftStatDivider: { width: 1, backgroundColor: '#e5e7eb', marginVertical: 4 },
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
  actionButtonDisabled: { opacity: 0.45 },
  feedWrap: {},
  feedRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  feedStop: { fontSize: 15, fontWeight: '600', color: '#111' },
  feedMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  feedStudent: { fontSize: 13, color: '#444', marginTop: 2 },
  emptyText: { fontSize: 14, color: '#777', paddingVertical: 10 },
  routePickerScroll: { marginBottom: 10 },
  routePickerContent: { gap: 8, paddingBottom: 4 },
  routeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: PRIMARY_COLOR,
    backgroundColor: '#fff',
  },
  routeChipSelected: { backgroundColor: PRIMARY_COLOR },
  routeChipText: { fontSize: 13, fontWeight: '600', color: PRIMARY_COLOR },
  routeChipTextSelected: { color: '#fff' },
  routeSingleName: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8 },
  routeRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  routeIndex: { fontSize: 13, fontWeight: '700', color: '#aaa', minWidth: 20, textAlign: 'center' },
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
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterButtonText: { color: '#fff', fontSize: 26, fontWeight: '600', lineHeight: 30 },
  countText: { fontSize: 32, marginHorizontal: 16, fontWeight: '700', color: '#111', minWidth: 64, textAlign: 'center' },
  cancelButton: {
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButtonText: { color: '#6b7280', fontSize: 16, fontWeight: '600' },
});
