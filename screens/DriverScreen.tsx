// DriverScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Modal, View, StyleSheet, TouchableOpacity, Animated, ScrollView, ActivityIndicator, Linking, TextInput } from 'react-native'
import { Text } from '../components/Text';
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
  updateDoc,
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
import { notifyStudentArrived, notifyStudentApproaching, notifyStudentCompleted, notifyStudentRequestCancelled } from '../src/utils/pushNotifications';
import { BACKGROUND_COLOR } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { STUDENT_REQUEST_TTL_MS, FRESHNESS_WINDOW_SECONDS } from '../src/constants/stops';
import { getPlanLimits } from '../src/constants/planLimits';
import { useOrg, Stop } from '../src/org/OrgContext';
import { isRouteActive, getTodayScheduleText, getNextOpenText } from '../src/utils/scheduleUtils';
import { useAuth } from '../src/auth/AuthProvider';
import { useFirstLoginOnboarding } from '../src/hooks/useFirstLoginOnboarding';

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
// "Bus on the way" heads-up: fires once when the bus crosses ~0.5 mi from a
// requested stop, so the rider has time to walk over before it arrives.
const APPROACH_RADIUS_FT = 2600;
const APPROACH_RADIUS_M = feetToMeters(APPROACH_RADIUS_FT);
// Average shuttle pace including stops (~15 km/h) — only used for the rough
// "about N min" estimate in the heads-up push, never shown as a precise ETA.
const SHUTTLE_PACE_M_PER_MIN = 250;
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
  const { isSharing, startSharing, stopSharing, isOnBreak, breakEndsAt, breaksTakenThisShift, startBreak, endBreak } = useLocationSharing();
  const [occupancy, setOccupancy] = useState<'open' | 'filling' | 'full'>('open');
  const { driverId, loading } = useDriver();
  const { org } = useOrg();
  const { role: authRole } = useAuth();
  const { primaryColor } = useOrgTheme();
  useFirstLoginOnboarding();
  const orgStops: Stop[] = org?.stops ?? [];
  const orgRoutes = org?.routes ?? [];
  const orgId = org?.orgId ?? '';

  const [isToggling, setIsToggling] = useState(false);
  const [showBreakSheet, setShowBreakSheet] = useState(false);
  const [breakCountdown, setBreakCountdown] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const manuallySelectedRoute = useRef(false);
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
  const [showShiftCard, setShowShiftCard] = useState(true);

  type OtherBusRaw = { id: string; latitude: number; longitude: number; routeId: string | null; isFresh: boolean };
  const [otherBusesRaw, setOtherBusesRaw] = useState<OtherBusRaw[]>([]);
  const [otherDriverNames, setOtherDriverNames] = useState<Record<string, string>>({});
  const otherNameInFlightRef = useRef<Set<string>>(new Set());
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
        approachWritten: boolean;
      }
    >
  >({});
  const arrivalWritesInFlightRef = useRef<Set<string>>(new Set());
  const approachWritesInFlightRef = useRef<Set<string>>(new Set());
  const completionWritesInFlightRef = useRef<Set<string>>(new Set());
  const expiryWritesInFlightRef = useRef<Set<string>>(new Set());
  const seenRequestIdsRef = useRef<Set<string>>(new Set());

  const driverCoords = driverId ? (busLocationsRef.current[driverId] ?? null) : null;

  // Break countdown tick
  useEffect(() => {
    if (!isOnBreak || !breakEndsAt) {
      setBreakCountdown(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, breakEndsAt.getTime() - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setBreakCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isOnBreak, breakEndsAt]);

  // Resolve the active route. Auto-selects the first route when routes are available.
  const activeRoute = useMemo(() => {
    if (orgRoutes.length === 0) return null;
    return orgRoutes.find((r) => r.id === selectedRouteId) ?? orgRoutes[0];
  }, [orgRoutes, selectedRouteId]);

  // Watch the driver's user doc for admin-assigned route changes + write public profile
  // once on mount so students see the driver's name when they tap the bus.
  const didWritePublicProfile = useRef(false);
  useEffect(() => {
    if (!driverId || !orgId) return;
    return onSnapshot(
      doc(db, 'orgs', orgId, 'users', driverId),
      (snap) => {
        if (!snap.exists()) return;

        // Write public display name once on first snapshot
        if (!didWritePublicProfile.current) {
          didWritePublicProfile.current = true;
          const storedName: string | null = snap.data()?.displayName ?? auth.currentUser?.displayName ?? null;
          if (storedName) {
            setDoc(
              doc(db, 'orgs', orgId, 'publicUsers', driverId),
              { displayName: storedName, updatedAt: serverTimestamp() },
              { merge: true },
            ).catch(() => {});
          }
        }

        // Apply admin-assigned default route only when the driver hasn't manually
        // picked a different route themselves.
        const defaultRouteId: string | undefined = snap.data()?.defaultRouteId;
        if (defaultRouteId && !manuallySelectedRoute.current) {
          setSelectedRouteId(defaultRouteId);
        }
      },
      () => {},
    );
  }, [driverId, orgId]);

  // If the selected route was deleted by an admin, clear the stale ID so the
  // route picker highlights the correct fallback (orgRoutes[0]).
  useEffect(() => {
    if (!selectedRouteId) return;
    if (!orgRoutes.find((r) => r.id === selectedRouteId)) {
      setSelectedRouteId(null);
    }
  }, [orgRoutes, selectedRouteId]);

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

  const otherBusesDisplay = useMemo(() => {
    const stopById = new Map(orgStops.map((s) => [s.id, s]));
    return otherBusesRaw.map((bus) => {
      const route = orgRoutes.find((r) => r.id === bus.routeId) ?? null;
      const routeStops: Stop[] = route
        ? route.stopIds.map((id) => stopById.get(id)).filter((s): s is Stop => s !== undefined)
        : orgStops;
      const nearest = routeStops.length > 0 ? getNearestStop(bus.latitude, bus.longitude, routeStops) : null;
      const next = nearest ? nextStopFromNearest(nearest.id, routeStops) : (routeStops[0] ?? null);
      return {
        id: bus.id,
        driverName: otherDriverNames[bus.id] ?? null,
        routeName: route?.name ?? null,
        currentStop: nearest?.name ?? null,
        nextStop: next?.name ?? null,
        isFresh: bus.isFresh,
      };
    });
  }, [otherBusesRaw, orgRoutes, orgStops, otherDriverNames]);

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
    const timer = setInterval(() => setClockTick(Date.now()), 30000);
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
                routeId: typeof data?.routeId === 'string' ? data.routeId : null,
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

          // Other online buses for the fleet overview tile
          const otherOnline = buses
            .filter((bus: any) => bus.id !== driverId && bus.secondsAgo < STALE_WINDOW_SECONDS)
            .map((bus: any) => ({
              id: bus.id as string,
              latitude: bus.latitude as number,
              longitude: bus.longitude as number,
              routeId: (bus.routeId as string | null) ?? null,
              isFresh: bus.secondsAgo < FRESHNESS_WINDOW_SECONDS,
            }));
          setOtherBusesRaw(otherOnline);
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
          if (snapshot.metadata.fromCache) return;
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

  // Keep the seats selector in sync with the bus doc (e.g. after an app restart
  // mid-shift, or when startSharing resets occupancy to 'open').
  useEffect(() => {
    if (!driverId || !orgId) return;
    const unsub = onSnapshot(doc(db, 'orgs', orgId, 'buses', driverId), (snap) => {
      const value = snap.data()?.occupancy;
      if (value === 'open' || value === 'filling' || value === 'full') setOccupancy(value);
    });
    return () => unsub();
  }, [driverId, orgId]);

  const setBusOccupancy = useCallback((value: 'open' | 'filling' | 'full') => {
    setOccupancy(value);
    if (!driverId || !orgId) return;
    setDoc(doc(db, 'orgs', orgId, 'buses', driverId), { occupancy: value }, { merge: true })
      .catch((err) => console.error('Failed to update bus occupancy', err));
  }, [driverId, orgId]);

  useEffect(() => {
    if (!isSharing || !driverId) return;

    const markArrivedIfNeeded = async (requestId: string) => {
      if (arrivalWritesInFlightRef.current.has(requestId)) return;
      arrivalWritesInFlightRef.current.add(requestId);

      try {
        let studentUid: string | null = null;
        let stopName: string | null = null;
        let stopId: string | null = null;

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
          stopId = current.stop?.id ?? current.stopId ?? null;
          tx.update(ref, { arrivedAt: serverTimestamp() });
        });

        if (studentUid) {
          void notifyStudentArrived(orgId, studentUid, stopName ?? 'your stop', stopId ?? undefined);
        }
      } catch (err) {
        console.error('Failed to set arrivedAt on stop request', err);
      } finally {
        arrivalWritesInFlightRef.current.delete(requestId);
      }
    };

    const markApproachingIfNeeded = async (requestId: string, distanceM: number) => {
      if (approachWritesInFlightRef.current.has(requestId)) return;
      approachWritesInFlightRef.current.add(requestId);

      try {
        let studentUid: string | null = null;
        let stopName: string | null = null;
        let stopId: string | null = null;

        await runTransaction(db, async (tx) => {
          const ref = doc(db, 'orgs', orgId, 'stopRequests', requestId);
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const current = snap.data() as any;
          if (!isActiveStopStatus(current?.status)) return;
          if (isExpiredRequestAt(current, Date.now())) return;
          if (current?.approachingAt || current?.arrivedAt) return;
          studentUid = current.studentUid ?? null;
          stopName = current.stop?.name ?? null;
          stopId = current.stop?.id ?? current.stopId ?? null;
          tx.update(ref, { approachingAt: serverTimestamp() });
        });

        if (studentUid) {
          const etaMinutes = Math.max(1, Math.round(distanceM / SHUTTLE_PACE_M_PER_MIN));
          void notifyStudentApproaching(orgId, studentUid, stopName ?? 'your stop', stopId ?? undefined, etaMinutes);
        }
      } catch (err) {
        console.error('Failed to set approachingAt on stop request', err);
      } finally {
        approachWritesInFlightRef.current.delete(requestId);
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
          {
            arrivalStartMs: null,
            lastOutsideMs: null,
            servicedReady: false,
            arrivedAtWritten: Boolean(req?.arrivedAt),
            approachWritten: Boolean(req?.approachingAt),
          };
        let nextState = { ...state };

        // Heads-up fires once per request, only outside the arrival radius
        // (inside it the "Bus Arriving" notification covers the rider).
        if (
          !withinArrive
          && distanceM <= APPROACH_RADIUS_M
          && !nextState.approachWritten
          && !req?.approachingAt
          && !req?.arrivedAt
        ) {
          nextState.approachWritten = true;
          void markApproachingIfNeeded(req.id, distanceM);
        }

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

  // Load first names for other drivers shown in the fleet overview tile
  useEffect(() => {
    if (!orgId) return;
    const toFetch = otherBusesRaw.filter(
      (b) => !otherDriverNames[b.id] && !otherNameInFlightRef.current.has(b.id),
    );
    toFetch.forEach((b) => {
      otherNameInFlightRef.current.add(b.id);
      void getDoc(doc(db, 'orgs', orgId, 'publicUsers', b.id))
        .then((snap) => {
          const name: string = snap.data()?.displayName ?? 'Driver';
          const firstName = name.split(' ')[0] || 'Driver';
          setOtherDriverNames((prev) => ({ ...prev, [b.id]: firstName }));
        })
        .catch(() => {})
        .finally(() => otherNameInFlightRef.current.delete(b.id));
    });
  }, [otherBusesRaw, orgId]);

  const handleSkipRequest = useCallback((reqId: string, studentUid: string | null, stopName: string) => {
    Alert.alert(
      "Can't reach this stop?",
      `The student at ${stopName} will be notified and can request again on the next pass.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: "Skip request",
          style: 'destructive',
          onPress: async () => {
            if (!orgId) return;
            try {
              await updateDoc(doc(db, 'orgs', orgId, 'stopRequests', reqId), {
                status: 'cancelled',
                cancelledReason: 'driver_skipped',
                cancelledAt: serverTimestamp(),
              });
              if (studentUid) {
                void notifyStudentRequestCancelled(orgId, studentUid, 'driver_skipped');
              }
            } catch (e) {
              console.error('[skip request]', e);
            }
          },
        },
      ],
    );
  }, [orgId]);

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
        if (req.studentUid) {
          // Rider has an account — ask them to confirm before marking completed
          batch.update(doc(db, 'orgs', orgId, 'stopRequests', req.id), {
            status: 'awaiting_confirmation',
            confirmationExpiresAtMs: Date.now() + 5 * 60 * 1000,
            driverUid: req?.driverUid ?? req?.driverId ?? driverId,
          });
        } else {
          batch.update(doc(db, 'orgs', orgId, 'stopRequests', req.id), {
            status: 'completed',
            completedAt: serverTimestamp(),
            completedReason: 'driver_boarding_save',
            driverUid: req?.driverUid ?? req?.driverId ?? driverId,
          });
        }
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

  const nearestStats = nearestStop ? oldestLatestByStopId[nearestStop.id] : undefined;
  const nextStats = nextStop ? oldestLatestByStopId[nextStop.id] : undefined;

  const breakSettings = org?.breakSettings;
  const canTakeBreak = isSharing && !isOnBreak && breakSettings?.enabled === true && breaksTakenThisShift < (breakSettings?.breaksPerShift ?? 0);
  const breakDurationOptions: number[] = [];
  if (breakSettings?.maxMinutes) {
    for (let m = 5; m <= breakSettings.maxMinutes; m += 5) breakDurationOptions.push(m);
  }
  const breakRowVisible = isSharing && (isOnBreak || canTakeBreak);
  const headerHeight = (breakRowVisible ? 112 : 74) + insets.top;

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.root}>
      {/* Break duration picker modal */}
      <Modal visible={showBreakSheet} transparent animationType="slide" onRequestClose={() => setShowBreakSheet(false)}>
        <TouchableOpacity style={styles.breakSheetOverlay} activeOpacity={1} onPress={() => setShowBreakSheet(false)}>
          <View style={styles.breakSheet}>
            <Text style={styles.breakSheetTitle}>How long is your break?</Text>
            <Text style={styles.breakSheetHint}>
              {breaksTakenThisShift > 0
                ? `${breaksTakenThisShift} of ${breakSettings?.breaksPerShift ?? 1} break${(breakSettings?.breaksPerShift ?? 1) > 1 ? 's' : ''} used this shift`
                : 'Pending stop requests will be cancelled.'}
            </Text>
            <View style={styles.breakDurationRow}>
              {breakDurationOptions.map((mins) => (
                <TouchableOpacity
                  key={mins}
                  style={[styles.breakDurationChip, { borderColor: primaryColor }]}
                  onPress={async () => {
                    setShowBreakSheet(false);
                    await startBreak(mins);
                  }}
                >
                  <Text style={[styles.breakDurationChipText, { color: primaryColor }]}>{mins} min</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.breakSheetCancel} onPress={() => setShowBreakSheet(false)}>
              <Text style={styles.breakSheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerTopRow}>
          <View>
            <Text style={styles.headerTitle}>{authRole === 'admin' ? 'Fleet Dashboard' : 'Driver Dashboard'}</Text>
            {activeRoute && (
              <Text style={styles.headerSubtitle}>
                <Icon name="route" size={12} color="#6b7280" /> {activeRoute.name}
              </Text>
            )}
          </View>
          <TouchableOpacity
          style={[styles.shareButton, { backgroundColor: primaryColor }, isToggling && styles.shareButtonDisabled]}
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
                    Alert.alert(
                      'Vehicle limit reached',
                      `Your ${limits.label} plan allows up to ${limits.maxVehicles} vehicles online at once. Upgrade your plan to put more vehicles on the road.`,
                      [
                        {
                          text: 'Manage Billing',
                          onPress: () => navigation.navigate('AdminOrgSetup', { initialTab: 'billing' }),
                        },
                        { text: 'OK', style: 'cancel' },
                      ],
                    );
                    return;
                  }
                }
                // Check route operating hours before going online
                const routeToCheck = orgRoutes.find((r) => r.id === (selectedRouteId ?? orgRoutes[0]?.id)) ?? orgRoutes[0] ?? null;
                if (routeToCheck?.schedule && !isRouteActive(routeToCheck, new Date(), org?.timezone)) {
                  const todayText = getTodayScheduleText(routeToCheck, new Date(), org?.timezone);
                  const nextOpen = getNextOpenText(routeToCheck, new Date(), org?.timezone);
                  await new Promise<void>((resolve, reject) => {
                    Alert.alert(
                      'Outside Service Hours',
                      [todayText, nextOpen].filter(Boolean).join('\n') || 'This route is currently closed.',
                      [
                        { text: 'Cancel', style: 'cancel', onPress: () => reject(new Error('cancelled')) },
                        { text: 'Go Online Anyway', onPress: () => resolve() },
                      ],
                    );
                  });
                }
                await startSharing(selectedRouteId ?? undefined);
              }
            } catch (err: any) {
              if (err?.message !== 'cancelled') {
                console.error(err);
                showAlert('Error toggling location sharing');
              }
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

        {/* Break row — shown only when sharing */}
        {isSharing && (
          <View style={styles.breakRow}>
            {isOnBreak ? (
              <>
                <View style={styles.breakBadge}>
                  <Icon name="free-breakfast" size={14} color="#b45309" />
                  <Text style={styles.breakBadgeText}>On Break {breakCountdown ? `· ${breakCountdown}` : ''}</Text>
                </View>
                <TouchableOpacity style={[styles.endBreakButton, { borderColor: primaryColor }]} onPress={endBreak}>
                  <Text style={[styles.endBreakButtonText, { color: primaryColor }]}>End Break</Text>
                </TouchableOpacity>
              </>
            ) : canTakeBreak ? (
              <TouchableOpacity style={[styles.breakButton, { backgroundColor: primaryColor + '18', borderColor: primaryColor + '60' }]} onPress={() => setShowBreakSheet(true)}>
                <Icon name="free-breakfast" size={15} color={primaryColor} />
                <Text style={[styles.breakButtonText, { color: primaryColor }]}>Take a Break</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Seats row — riders see this on the map, so they know before walking over */}
        {isSharing && (
          <View style={styles.occupancyRow}>
            <Text style={styles.occupancyLabel}>Seats</Text>
            {([
              { value: 'open', label: 'Available', color: '#16a34a' },
              { value: 'filling', label: 'Filling up', color: '#d97706' },
              { value: 'full', label: 'Full', color: '#dc2626' },
            ] as const).map((opt) => {
              const selected = occupancy === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.occupancyChip,
                    selected && { backgroundColor: `${opt.color}18`, borderColor: opt.color },
                  ]}
                  onPress={() => setBusOccupancy(opt.value)}
                >
                  <Text style={[styles.occupancyChipText, selected && { color: opt.color, fontWeight: '700' }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight + 12, paddingBottom: 140 }]}>
        {authRole === 'admin' && org?.reviewStatus === 'pending' && (
          <View style={styles.pendingBanner}>
            <Icon name="hourglass-empty" size={16} color="#92400e" />
            <Text style={styles.pendingBannerText}>
              Your Shuttler application is under review. You&apos;ll receive an email once it&apos;s approved.
            </Text>
          </View>
        )}

        {authRole === 'admin' && orgStops.length === 0 && (
          <TouchableOpacity
            style={styles.noStopsBanner}
            onPress={() => navigation.navigate('AdminOrgSetup')}
            activeOpacity={0.8}
          >
            <Icon name="add-location-alt" size={16} color="#7c3aed" />
            <Text style={styles.noStopsBannerText}>No stops configured yet. Tap to set up stops →</Text>
          </TouchableOpacity>
        )}

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
          <View style={styles.offlineBanner}>
            <Icon name="gps-off" size={16} color="#374151" />
            <Text style={styles.offlineBannerText}>{"You are offline — tap \"Start Sharing\" to go online."}</Text>
          </View>
        )}

        {isSharing && !activeBusIds.includes(driverId) && hasLocationPermission && (
          <View style={styles.waitingBanner}>
            <ActivityIndicator size="small" color="#92400e" />
            <Text style={styles.waitingBannerText}>Location sharing on — your position will appear on the map in a moment.</Text>
          </View>
        )}

        {!hasLocationPermission && (
          <View style={styles.permissionBanner}>
            <Icon name="location-off" size={16} color="#991b1b" />
            <View style={{ flex: 1 }}>
              <Text style={styles.permissionBannerText}>Location permission denied. Enable it to share your position.</Text>
              <TouchableOpacity onPress={() => Linking.openSettings()} style={{ marginTop: 4 }}>
                <Text style={styles.permissionBannerLink}>Open Settings →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.cardLarge}>
          <Text style={styles.cardTitle}>Current Stop</Text>
          <Text style={[styles.cardMainValue, { color: primaryColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
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
            style={[styles.actionButton, { backgroundColor: primaryColor }, (!isSharing || !nearestStop) && styles.actionButtonDisabled]}
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
            <Text style={styles.actionButtonText}>
              {!isSharing ? 'Go online first' : !nearestStop ? 'Drive to a stop' : 'Add Students'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next Stop</Text>
          <Text style={[styles.cardMainValue, { color: primaryColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>{nextStop?.name ?? '—'}</Text>
          <Text style={styles.cardMeta}>Active requests: {nextStop ? countsByStopId[nextStop.id] ?? 0 : 0}</Text>
          <Text style={styles.cardMeta}>Latest: {nextStats?.latestMs ? formatTimeAgo(nextStats.latestMs) : '—'}</Text>
        </View>

        {isSharing && (
          <TouchableOpacity
            style={styles.shiftCard}
            onPress={() => setShowShiftCard((v) => !v)}
            activeOpacity={0.8}
          >
            <View style={styles.shiftCardHeader}>
              <View style={styles.shiftCardTitleRow}>
                <Icon name="timer" size={18} color={primaryColor} />
                <Text style={styles.cardTitle}>My Shift</Text>
              </View>
              <View style={styles.shiftChevron}>
                <Icon name={showShiftCard ? 'expand-less' : 'expand-more'} size={20} color={primaryColor} />
              </View>
            </View>
            {showShiftCard && (
              <View style={styles.shiftStats}>
                <View style={styles.shiftStat}>
                  <Text style={[styles.shiftStatValue, { color: primaryColor }]}>{totalBoardedSession}</Text>
                  <Text style={styles.shiftStatLabel}>This session</Text>
                </View>
                <View style={styles.shiftStatDivider} />
                <View style={styles.shiftStat}>
                  <Text style={[styles.shiftStatValue, { color: primaryColor }]}>{todayBoardedTotal}</Text>
                  <Text style={styles.shiftStatLabel}>Today total</Text>
                </View>
                <View style={styles.shiftStatDivider} />
                <View style={styles.shiftStat}>
                  <Text style={[styles.shiftStatValue, { color: primaryColor }]}>
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

        {otherBusesDisplay.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fleet Overview</Text>
            {otherBusesDisplay.map((bus, idx) => (
              <View
                key={bus.id}
                style={[
                  styles.otherBusRow,
                  idx === otherBusesDisplay.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={styles.otherBusHeader}>
                  <Icon
                    name="directions-bus"
                    size={16}
                    color={bus.isFresh ? primaryColor : '#9ca3af'}
                  />
                  <Text style={styles.otherBusName}>{bus.driverName ?? 'Driver'}</Text>
                  {bus.routeName ? (
                    <View style={[styles.otherBusRouteBadge, { backgroundColor: primaryColor + '18' }]}>
                      <Text style={[styles.otherBusRouteBadgeText, { color: primaryColor }]}>{bus.routeName}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.otherBusStops}>
                  <Icon name="place" size={13} color="#9ca3af" />
                  <Text style={styles.otherBusStopLabel}>{bus.currentStop ?? 'En route'}</Text>
                  <Icon name="arrow-forward" size={13} color="#d1d5db" />
                  <Text style={styles.otherBusStopLabel}>{bus.nextStop ?? '—'}</Text>
                </View>
              </View>
            ))}
          </View>
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
                    <View style={styles.feedRowInfo}>
                      <Text style={styles.feedStop}>{stopName}</Text>
                      <Text style={styles.feedMeta}>Requested {formatTimeAgo(createdAtMs)}</Text>
                      <Text style={styles.feedStudent}>{studentLabel}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.feedSkipBtn}
                      onPress={() => handleSkipRequest(req.id, req.studentUid ?? null, stopName)}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                    >
                      <Text style={styles.feedSkipText}>Skip</Text>
                    </TouchableOpacity>
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
                    style={[styles.routeChip, { borderColor: primaryColor }, isSelected && { backgroundColor: primaryColor }]}
                    onPress={() => { manuallySelectedRoute.current = true; setSelectedRouteId(route.id); }}
                  >
                    <Text style={[styles.routeChipText, { color: primaryColor }, isSelected && styles.routeChipTextSelected]}>
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
                <View style={[styles.badge, { backgroundColor: primaryColor }]}>
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
            <TouchableOpacity style={[styles.counterButton, { backgroundColor: primaryColor }]} onPress={() => setBoardingCount(Math.max(0, boardingCount - 1))}>
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

            <TouchableOpacity style={[styles.counterButton, { backgroundColor: primaryColor }]} onPress={() => setBoardingCount(boardingCount + 1)}>
              <Text style={styles.counterButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: primaryColor }, isSavingBoarding && styles.actionButtonDisabled]}
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
    flexDirection: 'column',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#111' },
  headerSubtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 12,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
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
  pendingBanner: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingBannerText: { flex: 1, fontSize: 13, color: '#92400e', fontWeight: '500' },
  noStopsBanner: {
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#c4b5fd',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noStopsBannerText: { flex: 1, fontSize: 13, color: '#7c3aed', fontWeight: '600' },
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
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
  },
  offlineBannerText: { flex: 1, fontSize: 13, color: '#374151' },
  waitingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 12,
    padding: 14,
  },
  waitingBannerText: { flex: 1, fontSize: 13, color: '#92400e', fontWeight: '500' },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    padding: 14,
  },
  permissionBannerText: { fontSize: 13, color: '#991b1b' },
  permissionBannerLink: { fontSize: 13, color: '#dc2626', fontWeight: '700' },
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
  shiftCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#e0e7ff',
  },
  shiftCardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shiftChevron: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f4ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shiftCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shiftStats: { flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  shiftStat: { flex: 1, alignItems: 'center' },
  shiftStatValue: { fontSize: 22, fontWeight: '700' },
  shiftStatLabel: { fontSize: 11, color: '#9ca3af', marginTop: 3 },
  shiftStatDivider: { width: 1, backgroundColor: '#e5e7eb', marginVertical: 4 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6, color: '#111' },
  cardMainValue: { fontSize: 20, fontWeight: '700', marginBottom: 6 },
  cardMeta: { fontSize: 14, color: '#4d4d4d', marginBottom: 2 },
  actionButton: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  actionButtonDisabled: { opacity: 0.45 },
  feedWrap: {},
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 10,
  },
  feedRowInfo: { flex: 1 },
  feedStop: { fontSize: 15, fontWeight: '600', color: '#111' },
  feedMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  feedStudent: { fontSize: 13, color: '#444', marginTop: 2 },
  feedSkipBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  feedSkipText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  emptyText: { fontSize: 14, color: '#777', paddingVertical: 10 },
  routePickerScroll: { marginBottom: 10 },
  routePickerContent: { gap: 8, paddingBottom: 4 },
  routeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    backgroundColor: '#fff',
  },
  routeChipSelected: {},
  routeChipText: { fontSize: 13, fontWeight: '600' },
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

  otherBusRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  otherBusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  otherBusName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    flex: 1,
  },
  otherBusRouteBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  otherBusRouteBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  otherBusStops: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  otherBusStopLabel: {
    fontSize: 13,
    color: '#4b5563',
    fontWeight: '500',
  },

  // Break UI
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  occupancyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  occupancyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 2,
  },
  occupancyChip: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  occupancyChipText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '600',
  },
  breakButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  breakButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  breakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  breakBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#b45309',
  },
  endBreakButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  endBreakButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Break sheet modal
  breakSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  breakSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  breakSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 6,
  },
  breakSheetHint: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 20,
  },
  breakDurationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  breakDurationChip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  breakDurationChipText: {
    fontSize: 15,
    fontWeight: '600',
  },
  breakSheetCancel: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  breakSheetCancelText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
});
