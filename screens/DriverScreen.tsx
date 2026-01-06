// DriverScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
} from 'react-native';
import MapView, {
  PROVIDER_GOOGLE,
  MarkerAnimated,
  AnimatedRegion,
  Polyline,
  Region,
  Marker,
} from 'react-native-maps';
import {
  grayscaleMapStyle,
  MAX_LAT_DELTA,
  MAX_LON_DELTA,
} from '../src/constants/mapConfig';
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
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';
import MapMarker from '../components/MapMarker';
import { LOCATIONS } from './RequestStopScreen';
import { fetchDirections } from '../src/utils/directions';

function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1),
    φ2 = toRad(lat2),
    Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function quantizeBearing(bearing: number) {
  return (Math.round(bearing / 90) * 90) % 360;
}

const DEFAULT_REGION: Region = {
  latitude: 38.6073,
  longitude: -89.8119,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const FRESHNESS_WINDOW_SECONDS = 30;
const STALE_WINDOW_SECONDS = 90;

type StopRequestStatus = 'pending' | 'accepted' | 'completed' | 'cancelled';

async function getMyRole(uid: string) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as any)?.role ?? null : null;
}

function isDriverRole(role: any) {
  return role === 'driver' || role === 'admin';
}

/** ─────────────────────────────────────────────────────────────
 * Bounds helpers (stops-based) — with 25% padding
 * ───────────────────────────────────────────────────────────── */
type Bounds = { latMin: number; latMax: number; lonMin: number; lonMax: number };

function getStopsBounds(stops = LOCATIONS): Bounds {
  let latMin = Infinity,
    latMax = -Infinity,
    lonMin = Infinity,
    lonMax = -Infinity;

  stops.forEach((s) => {
    latMin = Math.min(latMin, s.latitude);
    latMax = Math.max(latMax, s.latitude);
    lonMin = Math.min(lonMin, s.longitude);
    lonMax = Math.max(lonMax, s.longitude);
  });

  if (
    !Number.isFinite(latMin) ||
    !Number.isFinite(latMax) ||
    !Number.isFinite(lonMin) ||
    !Number.isFinite(lonMax)
  ) {
    return { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 };
  }

  return { latMin, latMax, lonMin, lonMax };
}

function boundsRegion(bounds: Bounds, pad = 0.9): Region {
  const latCenter = (bounds.latMin + bounds.latMax) / 2;
  const lonCenter = (bounds.lonMin + bounds.lonMax) / 2;

  const latDelta = (bounds.latMax - bounds.latMin) * (1 + pad);
  const lonDelta = (bounds.lonMax - bounds.lonMin) * (1 + pad);

  return {
    latitude: latCenter,
    longitude: lonCenter,
    latitudeDelta: Math.min(Math.max(latDelta, 0.002), MAX_LAT_DELTA),
    longitudeDelta: Math.min(Math.max(lonDelta, 0.002), MAX_LON_DELTA),
  };
}

function clampToBounds(r: Region, b: Bounds): Region {
  return {
    latitude: Math.min(Math.max(r.latitude, b.latMin), b.latMax),
    longitude: Math.min(Math.max(r.longitude, b.lonMin), b.lonMax),
    latitudeDelta: Math.min(r.latitudeDelta, MAX_LAT_DELTA),
    longitudeDelta: Math.min(r.longitudeDelta, MAX_LON_DELTA),
  };
}

type CameraMode = 'free' | 'overview';

export default function DriverScreen() {
  const { isSharing, startSharing, stopSharing } = useLocationSharing();
  const { driverId, loading } = useDriver();
  if (loading) return null;
  if (!driverId) return null; // MUST be auth.uid

  const STOPS_BOUNDS = useMemo(() => getStopsBounds(LOCATIONS), []);
  const INITIAL_REGION = useMemo(() => boundsRegion(STOPS_BOUNDS, 0.25), [STOPS_BOUNDS]); // ✅ 25% padding

  // 1) Map region
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [hasLocationPermission, setHasLocationPermission] = useState(true);

  // ✅ Camera UX: fit once + don’t fight user
  const [cameraMode, setCameraMode] = useState<CameraMode>('overview');
  const didInitialFitRef = useRef(false);

  const userInteractingRef = useRef(false);
  const lastUserInteractionRef = useRef(0);
  const markUserInteraction = () => {
    lastUserInteractionRef.current = Date.now();
    userInteractingRef.current = true;
  };
  const recentlyInteracted = (ms = 2500) => Date.now() - lastUserInteractionRef.current < ms;

  const lastProgrammaticMoveRef = useRef(0);
  const markProgrammaticMove = () => {
    lastProgrammaticMoveRef.current = Date.now();
  };
  const isProgrammaticMove = () => Date.now() - lastProgrammaticMoveRef.current < 1200;

  const lastAutoFitRequestIdRef = useRef<string | null>(null);

  // 2) Current stop request assigned to this driver
  const [request, setRequest] = useState<any>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);

  // 3) Route polyline coordinates & ETA string
  const [routeCoords, setRouteCoords] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [eta, setEta] = useState<string | null>(null);
  const fullRouteRef = useRef<Array<{ latitude: number; longitude: number }>>([]);

  // 4) AnimatedRegion for each bus-ID
  const busRegions = useRef<{ [id: string]: AnimatedRegion }>({});
  const lastCoords = useRef<{ [id: string]: { latitude: number; longitude: number } }>({});
  const headings = useRef<{ [id: string]: number }>({});
  const [busLocations, setBusLocations] = useState<{
    [id: string]: {
      latitude: number;
      longitude: number;
      heading: number;
      lastUpdated: Date;
      isFresh: boolean;
      secondsAgo: number;
    };
  }>({});

  // 5) Slide-up bottom card
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [cardHeight, setCardHeight] = useState(300);

  // Boarding count card state
  const [boardingCount, setBoardingCount] = useState(0);
  const [showBoardingCard, setShowBoardingCard] = useState(false);
  const boardingSlideAnim = useRef(new Animated.Value(0)).current;
  const [boardingCardHeight, setBoardingCardHeight] = useState(200);
  const [completeAfterSave, setCompleteAfterSave] = useState(false);

  // 6) “Bus online” flag
  const [busOnline, setBusOnline] = useState(false);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);

  const mapRef = useRef<MapView | null>(null);

  // 7) “Heads-up” flag
  const notifiedRef = useRef(false);

  const busIcon = require('../assets/bus-icon.png');

  /** ─────────────────────────────────────────────────────────────
   * UI helpers: map buttons floating above BOTH bottom cards
   * ───────────────────────────────────────────────────────────── */
  const maxBottomCardHeight = Math.min(
    Math.max(cardHeight || 0, showBoardingCard ? boardingCardHeight || 0 : 0),
    340,
  );

  // Base is just above bottom nav / screen safe zone (driver has no tabs, but keep consistent)
  const baseFloatingBottom = 20 + (request ? maxBottomCardHeight + 10 : 0);

  // If Add Students button is visible (bottom-left), lift the map controls above it
  // (shareButton is ~44-50px tall; 70 gives comfortable clearance)
  const mapControlsBottom = baseFloatingBottom + (isSharing && !showBoardingCard ? 70 : 0);

  // Add Students visibility affects where we place map buttons
  const showAddStudents = isSharing && !showBoardingCard;
  const fabSideStyle = showAddStudents ? styles.fabWrapBottomRight : styles.fabWrapBottomLeft;

  const centerOnMe = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission denied');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const next = clampToBounds(
        {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        STOPS_BOUNDS,
      );

      setCameraMode('overview');
      markProgrammaticMove();
      setRegion(next);
      mapRef.current?.animateToRegion(next, 500);
    } catch (e) {
      console.error('centerOnMe error', e);
    }
  };

  const fitStops = () => {
    setCameraMode('overview');
    markProgrammaticMove();
    setRegion(INITIAL_REGION);
    mapRef.current?.animateToRegion(INITIAL_REGION, 550);
  };

  const fitActiveRide = () => {
    if (!request || request.status !== 'accepted' || !request.stop) return;

    const d = lastCoords.current[driverId] || busLocations[driverId];
    if (!d) return;

    const points = [
      { latitude: d.latitude, longitude: d.longitude },
      { latitude: request.stop.latitude, longitude: request.stop.longitude },
    ];

    // bottom padding accounts for whatever card is visible
    setCameraMode('overview');
    markProgrammaticMove();
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: { top: 120, right: 70, bottom: maxBottomCardHeight + 220, left: 70 },
      animated: true,
    });
  };

  // ───────────────────────────────────────────────────────────────────
  // Helper: update stop request status
  // ───────────────────────────────────────────────────────────────────
  const updateStatus = async (id: string, newStatus: StopRequestStatus) => {
    try {
      if (!driverId) throw new Error('Driver ID missing');

      const data: any = {
        status: newStatus,
        driverUid: driverId,
        statusUpdatedAt: serverTimestamp(),
      };

      if (newStatus === 'accepted') data.acceptedAt = serverTimestamp();
      if (newStatus === 'completed') data.completedAt = serverTimestamp();
      if (newStatus === 'cancelled') data.cancelledAt = serverTimestamp();

      await updateDoc(doc(db, 'stopRequests', id), data);
    } catch (err: any) {
      showAlert(err.message ?? 'Error updating status', 'Error');
    }
  };

  // ───────────────────────────────────────────────────────────────────
  // Save boarding count
  // ───────────────────────────────────────────────────────────────────
  const saveBoardingCount = async () => {
    if (!driverId) return;

    const loc = lastCoords.current[driverId];
    if (!loc) {
      showAlert('Driver location unavailable');
      return;
    }

    const nearest = getNearestStop(loc.latitude, loc.longitude);

    try {
      const batch = writeBatch(db);

      const boardingRef = doc(collection(db, 'boardingCounts'));
      batch.set(boardingRef, {
        driverUid: driverId,
        stopRequestId: requestId || null,
        studentUid: request?.studentUid || null,

        stopId: nearest.id,
        stopName: nearest.name,
        stopLat: nearest.latitude,
        stopLng: nearest.longitude,

        count: boardingCount,
        createdAt: serverTimestamp(),
      });

      if (completeAfterSave && request && requestId && request.status === 'accepted') {
        const reqRef = doc(db, 'stopRequests', requestId);
        batch.update(reqRef, {
          status: 'completed',
          driverUid: driverId,
          completedAt: serverTimestamp(),
          statusUpdatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      showAlert('Boarding saved');
    } catch (err: any) {
      showAlert(err?.message ?? 'Error saving boarding', 'Error saving boarding');
    }

    setBoardingCount(0);
    setShowBoardingCard(false);
    setCompleteAfterSave(false);
  };

  // ───────────────────────────────────────────────────────────────────
  // On mount: gated subscriptions
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      console.warn('DriverScreen: auth.currentUser is null - skipping subscriptions');
      return;
    }
    if (!driverId) {
      console.warn('DriverScreen: driverId missing - skipping subscriptions');
      return;
    }
    if (driverId !== uid) {
      console.warn('DriverScreen: driverId != auth.uid - skipping subscriptions', { driverId, uid });
      return;
    }

    let unsubBus: (() => void) | undefined;
    let unsubRide: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      // ✅ Role gate
      let role: any = null;
      try {
        role = await getMyRole(uid);
      } catch (e: any) {
        console.error('DriverScreen: failed to read /users role', {
          uid,
          code: e?.code,
          message: e?.message,
          err: e,
        });
        return;
      }

      if (!isDriverRole(role)) {
        console.warn('DriverScreen: role not driver/admin, skipping driver subscriptions', { uid, role });
        return;
      }

      if (cancelled) return;

      // Location permission / initial region
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setHasLocationPermission(false);

        // still show stops region even without location
        if (!didInitialFitRef.current) {
          didInitialFitRef.current = true;
          setCameraMode('overview');
          markProgrammaticMove();
          setRegion(INITIAL_REGION);
          mapRef.current?.animateToRegion(INITIAL_REGION, 450);
        }
        return;
      }
      setHasLocationPermission(true);

      // ✅ Start on stop-bounds view once (Uber/Lyft style “service area”)
      if (!didInitialFitRef.current) {
        didInitialFitRef.current = true;
        setCameraMode('overview');
        markProgrammaticMove();
        setRegion(INITIAL_REGION);
        setTimeout(() => mapRef.current?.animateToRegion(INITIAL_REGION, 450), 10);
      }

      // (b) Subscribe to “buses”
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

              if (!ts || isNaN(ts.getTime())) return null;

              const online = data?.online === true;
              if (!online) return null;
              if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return null;

              return {
                id: docSnap.id,
                latitude: data.latitude as number,
                longitude: data.longitude as number,
                timestamp: ts as Date,
                online,
              };
            })
            .filter(Boolean)
            .map((bus: any) => {
              const secondsAgo = (Date.now() - bus.timestamp.getTime()) / 1000;
              return { ...bus, secondsAgo };
            });

          const freshBuses = buses.filter((bus) => bus.secondsAgo < FRESHNESS_WINDOW_SECONDS);

          // ✅ Driver screen only animates THIS driver’s bus marker
          const visibleBuses = buses
            .filter((bus) => bus.secondsAgo < STALE_WINDOW_SECONDS)
            .filter((bus) => bus.id === driverId);

          setBusOnline(freshBuses.length > 0);

          const newLocations: {
            [id: string]: {
              latitude: number;
              longitude: number;
              heading: number;
              lastUpdated: Date;
              isFresh: boolean;
              secondsAgo: number;
            };
          } = {};

          visibleBuses.forEach((bus) => {
            const { id, latitude, longitude, secondsAgo, timestamp } = bus;

            const prev = lastCoords.current[id];
            if (prev) {
              const raw = computeBearing(prev.latitude, prev.longitude, latitude, longitude);
              headings.current[id] = quantizeBearing(raw);
            } else {
              headings.current[id] = 0;
            }

            lastCoords.current[id] = { latitude, longitude };
            newLocations[id] = {
              latitude,
              longitude,
              heading: headings.current[id],
              lastUpdated: timestamp,
              isFresh: secondsAgo < FRESHNESS_WINDOW_SECONDS,
              secondsAgo,
            };

            if (!busRegions.current[id]) {
              busRegions.current[id] = new AnimatedRegion({
                latitude,
                longitude,
                latitudeDelta: 0,
                longitudeDelta: 0,
              });
            } else {
              busRegions.current[id]
                .timing(
                  {
                    toValue: {
                      latitude,
                      longitude,
                      latitudeDelta: 0,
                      longitudeDelta: 0,
                    } as any,
                    duration: 2900,
                    useNativeDriver: false,
                  } as any,
                )
                .start();
            }
          });

          setBusLocations(newLocations);

          const recentIds = visibleBuses.map((b) => b.id);
          Object.keys(busRegions.current).forEach((key) => {
            if (!recentIds.includes(key)) delete busRegions.current[key];
          });
          Object.keys(lastCoords.current).forEach((key) => {
            if (!recentIds.includes(key)) delete lastCoords.current[key];
          });
          Object.keys(headings.current).forEach((key) => {
            if (!recentIds.includes(key)) delete headings.current[key];
          });

          setActiveBusIds(recentIds);
        },
        (err) => {
          console.error('buses snapshot error', {
            code: (err as any)?.code,
            message: (err as any)?.message,
          });
        },
      );

      // (c) Subscribe to stop requests (pending or accepted)
      unsubRide = onSnapshot(
        query(
          collection(db, 'stopRequests'),
          where('status', 'in', ['pending', 'accepted']),
          limit(50),
        ),
        (snapshot) => {
          const list = snapshot.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .sort((a, b) => {
              const ta = a.createdAt?.toMillis?.() ?? 0;
              const tb = b.createdAt?.toMillis?.() ?? 0;
              return tb - ta;
            });

          setRequests(list);

          const current = list.find((r) => r.driverUid === driverId && r.status !== 'completed');
          const pending = list.find((r) => r.status === 'pending' && !r.driverUid);

          const selected = current || pending || null;

          if (selected) {
            setRequest(selected);
            setRequestId(selected.id);
          } else {
            setRequest(null);
            setRequestId(null);
            setRouteCoords([]);
            fullRouteRef.current = [];
            setEta(null);
            notifiedRef.current = false;
          }
        },
        (err) => {
          console.error('❌ onSnapshot(stopRequests) permission error', {
            code: (err as any)?.code,
            message: (err as any)?.message,
            uid,
            role,
          });
        },
      );
    })();

    return () => {
      cancelled = true;
      if (unsubBus) unsubBus();
      if (unsubRide) unsubRide();
    };
  }, [driverId, INITIAL_REGION, STOPS_BOUNDS]);

  // ───────────────────────────────────────────────────────────────────
  // Fetch route & ETA (stores full route for progressive trimming)
  // ───────────────────────────────────────────────────────────────────
  const fetchRoute = async () => {
    if (!request || !driverId) {
      setRouteCoords([]);
      fullRouteRef.current = [];
      setEta(null);
      return;
    }

    // Prefer current state location, fallback to lastCoords ref
    const assigned = busLocations[driverId] || lastCoords.current[driverId];
    if (!assigned) {
      setRouteCoords([]);
      fullRouteRef.current = [];
      setEta(null);
      return;
    }

    if (request.status !== 'accepted') {
      setRouteCoords([]);
      fullRouteRef.current = [];
      setEta(null);
      return;
    }

    try {
      const { coords, eta: etaText } = await fetchDirections(assigned, request.stop);
      fullRouteRef.current = coords;
      setRouteCoords(coords);
      setEta(etaText);
    } catch (err) {
      console.error('DriverScreen fetchRoute error', err);
      setRouteCoords([]);
      fullRouteRef.current = [];
      setEta(null);
    }
  };

  // ✅ keep route refreshed while driver moves (this is what keeps the polyline alive)
  const fetchTimeout = useRef<NodeJS.Timeout | null>(null);
  const driverOnline = activeBusIds.includes(driverId || '');
  useEffect(() => {
    if (!driverId) return;

    if (fetchTimeout.current) clearTimeout(fetchTimeout.current);

    fetchTimeout.current = setTimeout(() => {
      fetchRoute();
    }, 1200);

    return () => {
      if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, request?.status, driverOnline, busLocations[driverId ?? '']]);

  // ✅ Progressive trimming based on fullRouteRef (NOT trimming the already-trimmed array)
  useEffect(() => {
    if (!driverId) return;
    if (!request || request.status !== 'accepted') return;

    const loc = busLocations[driverId] || lastCoords.current[driverId];
    if (!loc) return;

    const full = fullRouteRef.current;
    if (!full || full.length === 0) return;

    let furthestIdx = -1;
    for (let idx = 0; idx < full.length; idx++) {
      const distance = getDistanceInMeters(
        loc.latitude,
        loc.longitude,
        full[idx].latitude,
        full[idx].longitude,
      );

      if (distance <= 40) {
        furthestIdx = idx;
      } else if (furthestIdx >= 0) {
        break;
      }
    }

    if (furthestIdx < 0) return;

    const remaining = full.slice(furthestIdx);
    const lastPoint = remaining[remaining.length - 1];

    if (
      remaining.length <= 1 &&
      lastPoint &&
      getDistanceInMeters(loc.latitude, loc.longitude, lastPoint.latitude, lastPoint.longitude) <= 40
    ) {
      setRouteCoords([]);
      return;
    }

    setRouteCoords(remaining);
  }, [driverId, request?.status, busLocations[driverId ?? '']]);

  // ✅ Auto-fit when accepted, but don’t fight user; once per request
  useEffect(() => {
    if (request?.status !== 'accepted') {
      lastAutoFitRequestIdRef.current = null;
      return;
    }

    const id = requestId ?? null;
    if (id && lastAutoFitRequestIdRef.current === id) return;

    if (cameraMode === 'free' || recentlyInteracted(2500)) return;

    lastAutoFitRequestIdRef.current = id;

    // give route a moment to load so fit looks clean
    setTimeout(() => fitActiveRide(), 350);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.status, requestId, driverId]);

  // ───────────────────────────────────────────────────────────────────
  // Notifications
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (request?.status === 'accepted') {
      Notifications.scheduleNotificationAsync({
        content: { title: 'Stop Accepted 🚌', body: 'Navigate to the requested stop.' },
        trigger: null,
      });
    } else if (request?.status === 'completed') {
      Notifications.scheduleNotificationAsync({
        content: { title: 'Stop Completed ✅', body: 'You have serviced the stop.' },
        trigger: null,
      });
    }
  }, [request?.status]);

  // ───────────────────────────────────────────────────────────────────
  // Near stop alert
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (
      request?.status === 'accepted' &&
      driverId &&
      request.stop &&
      lastCoords.current[driverId] &&
      !notifiedRef.current
    ) {
      const driverLoc = lastCoords.current[driverId];
      const dist = getDistanceInMeters(
        driverLoc.latitude,
        driverLoc.longitude,
        request.stop.latitude,
        request.stop.longitude,
      );
      if (dist < 50) {
        showAlert('You are within 50 meters of the stop.', 'Almost There!');
        notifiedRef.current = true;
      }
    }
  }, [request, driverId, activeBusIds]);

  // ───────────────────────────────────────────────────────────────────
  // Animate cards
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (request) {
      Animated.timing(slideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [request, slideAnim]);

  useEffect(() => {
    if (showBoardingCard) {
      Animated.timing(boardingSlideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } else {
      Animated.timing(boardingSlideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [showBoardingCard, boardingSlideAnim]);

  // Keep your existing translate logic for sharing buttons
  const shareTranslateY = Animated.add(
    slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -cardHeight + 8] }),
    boardingSlideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -boardingCardHeight + 8] }),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_COLOR }}>
      {/* Bottom-Right Start/Stop Sharing Button */}
      {request?.status !== 'accepted' && (
        <Animated.View
          style={[
            styles.bottomRightButtonContainer,
            { transform: [{ translateY: shareTranslateY }] },
          ]}
        >
          <TouchableOpacity
            style={styles.shareButton}
            onPress={async () => {
              if (!driverId) {
                showAlert('Driver ID missing');
                return;
              }
              try {
                if (isSharing) {
                  await stopSharing();
                } else {
                  await startSharing();
                }
              } catch (err) {
                console.error(err);
                showAlert('Error toggling location sharing');
              }
            }}
          >
            <Icon name={isSharing ? 'gps-off' : 'gps-fixed'} size={24} color="#fff" />
            <Text style={styles.shareButtonText}>{isSharing ? 'Stop Sharing' : 'Start Sharing'}</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Bottom-Left Add Students Button */}
      {isSharing && !showBoardingCard && (
        <Animated.View
          style={[
            styles.bottomLeftButtonContainer,
            {
              transform: [
                {
                  translateY: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -cardHeight + 8],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => {
              setCompleteAfterSave(false);
              setShowBoardingCard(true);
            }}
          >
            <Icon name="group-add" size={24} color="#fff" />
            <Text style={styles.shareButtonText}>Add Students</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

        {/* Banner when sharing is OFF (should come back every time) */}
        {!isSharing && hasLocationPermission && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Not sharing location. Tap “Start Sharing” to go online.
            </Text>
          </View>
        )}

        {/* Optional: sharing ON but bus doc is stale/not fresh */}
      {isSharing && !driverOnline && hasLocationPermission && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Sharing is ON, but your location hasn’t updated yet.
          </Text>
        </View>
      )}


      {/* Banner if location permission denied */}
      {!hasLocationPermission && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Location permission denied. Enable location to share your position.
          </Text>
        </View>
      )}

      {/* Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        region={region}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        rotateEnabled={false}
        pitchEnabled={false}
        customMapStyle={grayscaleMapStyle}
        onPanDrag={() => {
          markUserInteraction();
        }}
        onTouchStart={() => {
          markUserInteraction();
        }}
        onTouchEnd={() => {
          setTimeout(() => {
            userInteractingRef.current = false;
          }, 250);
        }}
        onRegionChangeComplete={(newRegion) => {
          if (!isProgrammaticMove() && userInteractingRef.current) {
            setCameraMode('free');
          }

          const clamped = clampToBounds(newRegion, STOPS_BOUNDS);

          const needsAdjustment =
            clamped.latitude !== newRegion.latitude ||
            clamped.longitude !== newRegion.longitude ||
            clamped.latitudeDelta !== newRegion.latitudeDelta ||
            clamped.longitudeDelta !== newRegion.longitudeDelta;

          setRegion(clamped);

          if (needsAdjustment) {
            markProgrammaticMove();
            mapRef.current?.animateToRegion(clamped, 260);
          }
        }}
      >
        {activeBusIds.map((id) => {
          const loc = busLocations[id];
          if (!loc) return null;

          return (
            <MarkerAnimated
              key={id}
              coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
              flat
              rotation={loc.heading}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <Image
                source={busIcon}
                style={{ width: 120, height: 120, opacity: loc.isFresh ? 1 : 0.55 }}
                resizeMode="contain"
              />
            </MarkerAnimated>
          );
        })}

        {/* Permanent Stop Markers */}
        {LOCATIONS.map((stop) => (
          <Marker
            description={stop.name}
            key={stop.id}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <MapMarker icon="location-on" />
          </Marker>
        ))}

        {/* Requested Stop Markers */}
        {requests.map((req) => (
          <Marker
            key={req.id}
            coordinate={{
              latitude: req.stop.latitude,
              longitude: req.stop.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <MapMarker icon="flag" />
          </Marker>
        ))}

        {/* Route polyline */}
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor={PRIMARY_COLOR} />
        )}
      </MapView>

      {/* ✅ Map controls (float ABOVE cards) — switch side when Add Students is shown */}
            {/* ✅ Bottom-left map controls (float ABOVE cards + above Add Students when visible) */}
        <View
          pointerEvents="box-none"
          style={[styles.fabWrapBottomLeft, { bottom: mapControlsBottom }]}
        >
          <TouchableOpacity style={styles.fab} onPress={centerOnMe} activeOpacity={0.9}>
            <Icon name="my-location" size={22} color="#111" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.fab} onPress={fitStops} activeOpacity={0.9}>
            <Icon name="map" size={22} color="#111" />
          </TouchableOpacity>

          {request?.status === 'accepted' && (
            <TouchableOpacity style={styles.fabPrimary} onPress={fitActiveRide} activeOpacity={0.9}>
              <Icon name="alt-route" size={22} color="#fff" />
              <Text style={styles.fabPrimaryText}>Fit</Text>
            </TouchableOpacity>
          )}
        </View>


      {/* Bottom Card */}
      <Animated.View
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
        style={[
          styles.bottomCard,
          {
            transform: [
              {
                translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [cardHeight, 0],
                }),
              },
            ],
            opacity: slideAnim,
          },
        ]}
      >
        {request ? (
          <>
            <Text style={styles.cardTitle}>Request Status: {request.status}</Text>
            <Text style={styles.cardSubtitle}>
              {request.status === 'accepted' ? 'Navigate to Stop' : 'Awaiting Acceptance'}
            </Text>
            {request.stop?.name && <Text style={styles.cardSubtitle}>Pickup: {request.stop.name}</Text>}
            {eta && request.status !== 'pending' && <Text style={styles.etaText}>ETA: {eta}</Text>}

            {request.status === 'pending' && !request.driverUid && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => requestId && updateStatus(requestId, 'accepted')}
              >
                <Text style={styles.cancelButtonText}>Accept Stop</Text>
              </TouchableOpacity>
            )}

            {request.status === 'accepted' && request.driverUid === driverId && (
              <>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => {
                    setCompleteAfterSave(true);
                    setShowBoardingCard(true);
                  }}
                >
                  <Text style={styles.actionButtonText}>Stop Completed</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={async () => {
                    if (requestId) {
                      await updateStatus(requestId, 'cancelled');
                      setRequest(null);
                      setRequestId(null);
                      setRouteCoords([]);
                      fullRouteRef.current = [];
                      setEta(null);
                      showAlert('Stop canceled.');
                    }
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel Stop</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        ) : (
          <Text style={styles.noRideText}>No active requests</Text>
        )}
      </Animated.View>

      {/* Boarding Count Card */}
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
            <TouchableOpacity
              style={styles.counterButton}
              onPress={() => setBoardingCount(Math.max(0, boardingCount - 1))}
            >
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
              setCompleteAfterSave(false);
            }}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// Find nearest predefined stop
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

// Haversine distance (meters)
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

const styles = StyleSheet.create({
  map: { flex: 1 },

  bottomRightButtonContainer: {
    position: 'absolute',
    bottom: 20,
    right: 10,
    zIndex: 500,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PRIMARY_COLOR,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    elevation: 4,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 6,
    fontWeight: '500',
  },

  bottomLeftButtonContainer: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    zIndex: 500,
  },

  banner: {
    position: 'absolute',
    top: 80,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255,165,0,0.9)',
    padding: 12,
    borderRadius: 8,
    zIndex: 400,
  },
  bannerText: {
    color: '#000',
    fontSize: 14,
    textAlign: 'center',
  },

  // ✅ Map controls
  fabWrapBottomLeft: {
    position: 'absolute',
    left: 14,
    zIndex: 520,
    alignItems: 'flex-start',
    gap: 10,
  },
  fabWrapBottomRight: {
    position: 'absolute',
    right: 14,
    zIndex: 520,
    alignItems: 'flex-end',
    gap: 10,
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 6,
  },
  fabPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY_COLOR,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 7,
  },
  fabPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },

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
  cardTitle: { fontSize: 18, fontWeight: '600', marginBottom: 6 },
  cardSubtitle: { fontSize: 14, color: '#555', marginBottom: 4 },
  etaText: { fontSize: 14, fontWeight: '500', color: PRIMARY_COLOR, marginBottom: 12 },

  actionButton: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },

  cancelButton: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },

  noRideText: { fontSize: 16, color: '#888', textAlign: 'center' },

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
});
