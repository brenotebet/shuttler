// src/screens/MapScreen.tsx
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Image,
  FlatList,
  TouchableWithoutFeedback,
  Dimensions,
  Alert,
  Modal,
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
import MapView, {
  PROVIDER_GOOGLE,
  MarkerAnimated,
  AnimatedRegion,
  Polyline,
  Polygon,
  Region,
  Marker,
} from 'react-native-maps';
import MapMarker from '../components/MapMarker';
import { grayscaleMapStyle, MAX_LAT_DELTA, MAX_LON_DELTA } from '../src/constants/mapConfig';
import { BACKGROUND_COLOR } from '../src/constants/theme';
import * as Location from 'expo-location';
import { StudentTabParamList } from '../tabs/StudentTabs';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  serverTimestamp,
  getDocs,
  doc,
  updateDoc,
  orderBy,
  limit,
  getDoc,
  setDoc, // ✅ ADDED
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { showAlert } from '../src/utils/alerts';
import { showToast } from '../src/components/Toast';
import { notifyDriversNewRequest } from '../src/utils/pushNotifications';
import { fetchDirections } from '../src/utils/directions';
import InfoBanner from '../components/InfoBanner';
import { STUDENT_REQUEST_TTL_MS, FRESHNESS_WINDOW_SECONDS } from '../src/constants/stops';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import { useOrg, Route } from '../src/org/OrgContext';
import { useAuth } from '../src/auth/AuthProvider';
import { loadChildProfiles, type ChildProfile } from './ParentChildLinkScreen';
import { isRouteActive, getNextOpenText, getTodayScheduleText } from '../src/utils/scheduleUtils';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { useFirstLoginOnboarding } from '../src/hooks/useFirstLoginOnboarding';
import PickupConfirmModal from '../src/components/PickupConfirmModal';

// Bus marker stays visible as long as online:true in Firestore.
// Opacity reflects freshness (full = recent GPS, dimmed = GPS stale but driver hasn't stopped sharing).

// Maximum distance from the nearest stop to allow a pickup request.
// Keeps requests honest — students must physically be on/near campus.
const STOP_REQUEST_RADIUS_M = 400;

function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1),
    φ2 = toRad(lat2),
    Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function quantizeBearing(bearing: number) {
  return (Math.round(bearing / 90) * 90) % 360;
}

type Bounds = { latMin: number; latMax: number; lonMin: number; lonMax: number };

function getStopsBounds(stops: { latitude: number; longitude: number }[]): Bounds {
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

function padBounds(b: Bounds, factor = 0.3): Bounds {
  const latPad = (b.latMax - b.latMin) * factor;
  const lonPad = (b.lonMax - b.lonMin) * factor;
  return {
    latMin: b.latMin - latPad,
    latMax: b.latMax + latPad,
    lonMin: b.lonMin - lonPad,
    lonMax: b.lonMax + lonPad,
  };
}

function boundsRegion(bounds: Bounds, pad = 0.18): Region {
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

// Jarvis march (gift-wrapping) convex hull over lat/lon points
function convexHull(pts: { latitude: number; longitude: number }[]) {
  const n = pts.length;
  if (n < 3) return [...pts];

  // Start from the westernmost (lowest longitude) point
  let start = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i].longitude < pts[start].longitude) start = i;
  }

  const hull: { latitude: number; longitude: number }[] = [];
  let p = start;
  do {
    hull.push(pts[p]);
    let q = (p + 1) % n;
    for (let i = 0; i < n; i++) {
      // Negative cross product → pts[i] is more counter-clockwise than pts[q]
      const cross =
        (pts[q].longitude - pts[p].longitude) * (pts[i].latitude - pts[p].latitude) -
        (pts[q].latitude - pts[p].latitude) * (pts[i].longitude - pts[p].longitude);
      if (cross < 0) q = i;
    }
    p = q;
  } while (p !== start && hull.length <= n);

  return hull;
}

// Expand each hull point outward from the centroid by padMeters
function expandHull(
  hull: { latitude: number; longitude: number }[],
  padMeters = 350,
) {
  if (hull.length === 0) return hull;
  const cx = hull.reduce((s, p) => s + p.latitude, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.longitude, 0) / hull.length;
  const latPad = padMeters / 111000;
  const lonPad = padMeters / (111000 * Math.cos((cx * Math.PI) / 180));
  return hull.map((p) => {
    const dlat = p.latitude - cx;
    const dlon = p.longitude - cy;
    const len = Math.sqrt(dlat * dlat + dlon * dlon) || 1e-10;
    return {
      latitude: p.latitude + (dlat / len) * latPad,
      longitude: p.longitude + (dlon / len) * lonPad,
    };
  });
}

// Chaikin smoothing — each iteration cuts corners by replacing every edge
// A→B with two new points at 25% and 75% along the edge, then closing the
// loop. After 3 passes a 3-point triangle becomes a smooth 24-point blob.
function smoothHull(
  pts: { latitude: number; longitude: number }[],
  iterations = 3,
): { latitude: number; longitude: number }[] {
  let result = pts;
  for (let iter = 0; iter < iterations; iter++) {
    const next: { latitude: number; longitude: number }[] = [];
    const n = result.length;
    for (let i = 0; i < n; i++) {
      const a = result[i];
      const b = result[(i + 1) % n];
      next.push({
        latitude: a.latitude * 0.75 + b.latitude * 0.25,
        longitude: a.longitude * 0.75 + b.longitude * 0.25,
      });
      next.push({
        latitude: a.latitude * 0.25 + b.latitude * 0.75,
        longitude: a.longitude * 0.25 + b.longitude * 0.75,
      });
    }
    result = next;
  }
  return result;
}

type CameraMode = 'free' | 'followUser' | 'overview';

type BusPopup = {
  etaToYou: string | null;
  nextStop: string | null;
  lastSeenText: string | null;
  driverName: string | null;
};

export default function MapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { org } = useOrg();
  const { orgId, role } = useAuth();
  const { primaryColor } = useOrgTheme();
  useFirstLoginOnboarding();
  const stops = org?.stops ?? [];
  const orgRoutes = org?.routes ?? [];
  // Returns a Firestore CollectionReference scoped to the current org.
  // Throws if orgId is not loaded — callers must only run after org is available.
  const orgCol = (name: string) => {
    if (!orgId) throw new Error(`orgCol('${name}') called before orgId is available`);
    return collection(db, 'orgs', orgId, name);
  };

  // Tick every 60s so schedule-based UI updates without a restart
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // True if at least one route with a schedule is currently open, OR if no routes have schedules set
  const serviceIsOpen = useMemo(() => {
    const scheduled = orgRoutes.filter((r) => r.schedule);
    if (scheduled.length === 0) return true;
    return scheduled.some((r) => isRouteActive(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgRoutes, clockTick]);

  const insets = useSafeAreaInsets();

  const STOPS_BOUNDS = useMemo(() => getStopsBounds(stops), [stops]);
  const PADDED_BOUNDS = useMemo(() => padBounds(STOPS_BOUNDS, 0.3), [STOPS_BOUNDS]);
  const CLAMP_BOUNDS = useMemo(() => padBounds(STOPS_BOUNDS, 0.25), [STOPS_BOUNDS]);
  // Two-pass expansion: expand first so Chaikin has room to round corners,
  // then expand again after smoothing to guarantee all stops sit inside the
  // final shape (Chaikin cuts corners inward by up to ~25% of edge length).
  const campusHull = useMemo(
    () => expandHull(smoothHull(expandHull(convexHull(stops), 500)), 600),
    [stops],
  );
  const INITIAL_REGION = useMemo(() => {
    if (org?.mapCenter) {
      return {
        latitude: org.mapCenter.latitude,
        longitude: org.mapCenter.longitude,
        latitudeDelta: 0.021,
        longitudeDelta: 0.033,
      };
    }
    return boundsRegion(STOPS_BOUNDS, 0.9);
  }, [org?.mapCenter, STOPS_BOUNDS]);

  const [region, setRegion] = useState<Region | null>(null);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);

  const [studentUid, setStudentUid] = useState<string | null>(null);
  const [studentEmail, setStudentEmail] = useState<string | null>(null);
  const [childProfiles, setChildProfiles] = useState<ChildProfile[]>([]);
  const [selectedChild, setSelectedChild] = useState<ChildProfile | null>(null);
  const [showChildPicker, setShowChildPicker] = useState(false);

  const [request, setRequest] = useState<any>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [ownRequest, setOwnRequest] = useState<any>(null);
  const [dismissedRequestId, setDismissedRequestId] = useState<string | null>(null);
  const [showPickupConfirm, setShowPickupConfirm] = useState(false);

  const [ownRequestReady, setOwnRequestReady] = useState(false);

  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [eta, setEta] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [stopsBefore, setStopsBefore] = useState<number | null>(null);
  const [busOnline, setBusOnline] = useState<boolean>(false);
  const [busRouteIds, setBusRouteIds] = useState<Record<string, string | null>>({});

  type RequestableStop = {
    key: string; // unique: stopId or stopId+routeId
    stop: typeof stops[0];
    routeId: string | null;
    routeName: string | null;
    position: number | null;
    totalStops: number | null;
  };

  // One entry per stop-route combination.
  // A stop on two routes expands into two list entries so the student picks the route explicitly.
  // Stops not assigned to any route appear once with no route metadata.
  const requestableStops = useMemo((): RequestableStop[] => {
    if (orgRoutes.length === 0) {
      return stops.map((stop) => ({
        key: stop.id,
        stop,
        routeId: null,
        routeName: null,
        position: null,
        totalStops: null,
      }));
    }

    const stopById = new Map(stops.map((s) => [s.id, s]));
    const seenStopIds = new Set<string>();
    const entries: RequestableStop[] = [];

    for (const route of orgRoutes) {
      route.stopIds.forEach((stopId, idx) => {
        const stop = stopById.get(stopId);
        if (!stop) return;
        seenStopIds.add(stopId);
        entries.push({
          key: `${stopId}::${route.id}`,
          stop,
          routeId: route.id,
          routeName: route.name,
          position: idx + 1,
          totalStops: route.stopIds.length,
        });
      });
    }

    // Stops not on any route
    for (const stop of stops) {
      if (!seenStopIds.has(stop.id)) {
        entries.push({ key: stop.id, stop, routeId: null, routeName: null, position: null, totalStops: null });
      }
    }

    return entries;
  }, [orgRoutes, stops]);

  // Legacy lookup used by the active-ride bottom card (request already has routeId stamped).
  const routeStopMap = useMemo(() => {
    const map = new Map<string, { routeId: string; routeName: string; position: number; totalStops: number }>();
    for (const route of orgRoutes) {
      route.stopIds.forEach((stopId, idx) => {
        if (!map.has(stopId)) {
          map.set(stopId, { routeId: route.id, routeName: route.name, position: idx + 1, totalStops: route.stopIds.length });
        }
      });
    }
    return map;
  }, [orgRoutes]);

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

  const [showLocationList, setShowLocationList] = useState(false);
  const [selectedStopKey, setSelectedStopKey] = useState<string | null>(null);
  const [ttlCountdown, setTtlCountdown] = useState<string | null>(null);

  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [selectedBusPopup, setSelectedBusPopup] = useState<BusPopup | null>(null);
  const [driverFirstNames, setDriverFirstNames] = useState<Record<string, string>>({});

  const mapRef = useRef<MapView | null>(null);
  const regionRef = useRef<Region | null>(null);

  const notifiedRef = useRef(false);
  const prevRequestStatusRef = useRef<string | null>(null);
  const busRegions = useRef<{ [id: string]: AnimatedRegion }>({});
  const lastCoords = useRef<{ [id: string]: { latitude: number; longitude: number } }>({});
  const headings = useRef<{ [id: string]: number }>({});
  const fullRouteRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const didInitialFitRef = useRef(false);

  const lastUserInteractionRef = useRef(0);
  const userInteractingRef = useRef(false);
  const lastProgrammaticMoveRef = useRef<number>(0);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const [bottomCardHeight, setBottomCardHeight] = useState(0);

  const [cameraMode, setCameraMode] = useState<CameraMode>('followUser');

  const busIcon = require('../assets/bus-icon.png');

  const [forceBusTracks, setForceBusTracks] = useState(true);
  const forceTracksTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bumpBusTracks = () => {
    setForceBusTracks(true);
    if (forceTracksTimerRef.current) clearTimeout(forceTracksTimerRef.current);
    forceTracksTimerRef.current = setTimeout(() => setForceBusTracks(false), 900);
  };

  const cloudAnim = useRef(new Animated.Value(0)).current;

  const markUserInteraction = () => {
    lastUserInteractionRef.current = Date.now();
    userInteractingRef.current = true;
  };
  const recentlyInteracted = (ms = 2000) => Date.now() - lastUserInteractionRef.current < ms;

  const markProgrammaticMove = () => {
    lastProgrammaticMoveRef.current = Date.now();
  };
  const isProgrammaticMove = () => Date.now() - lastProgrammaticMoveRef.current < 1200;

  const showCloud = () => {
    cloudAnim.stopAnimation();
    Animated.spring(cloudAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  };

  const hideCloud = () => {
    cloudAnim.stopAnimation();
    Animated.timing(cloudAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  const closeSelectedBus = () => {
    setSelectedBusId(null);
    setSelectedBusPopup(null);
    hideCloud();
  };

  const formatLastSeen = (seconds: number) => {
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
  };

  // ✅ NEW: ensure /publicUsers/{uid} exists for this signed-in user
  const ensurePublicUserProfile = async (uid: string, email: string | null) => {
    try {
      // Prefer auth displayName if present; fallback to email prefix; else "Student"
      const authName = auth.currentUser?.displayName ?? null;
      const emailPrefix = email?.split?.('@')?.[0] ?? null;
      const displayName = (authName || emailPrefix || 'Student').trim();

      if (!orgId) return;
      await setDoc(
        doc(db, 'orgs', orgId, 'publicUsers', uid),
        {
          displayName,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      // Don't block app if this fails; feed will fall back to uid/email
      console.error('Failed to ensure public user profile', err);
    }
  };

  // ✅ UPDATED: driver name lookup now uses /publicUsers because /users is private
  const getDriverFirstName = async (uid: string) => {
    if (!uid) return 'Driver';
    if (driverFirstNames[uid]) return driverFirstNames[uid];

    try {
      if (!orgId) return 'Driver';
      const snap = await getDoc(doc(db, 'orgs', orgId, 'publicUsers', uid));
      const data = (snap.data() as any) || {};
      const displayName = typeof data?.displayName === 'string' ? data.displayName : 'Driver';
      const firstName = displayName?.split?.(' ')?.[0] || 'Driver';

      setDriverFirstNames((prev) => ({ ...prev, [uid]: firstName }));
      return firstName;
    } catch {
      return 'Driver';
    }
  };

  // Suppress the bottom card for a dismissed expired/completed request
  const visibleRequest = request && request.id === dismissedRequestId ? null : request;
  const rideActive = !!visibleRequest && (
    visibleRequest.status === 'pending' ||
    visibleRequest.status === 'accepted' ||
    visibleRequest.status === 'awaiting_confirmation'
  );

  const resolvedDriverId = useMemo(() => {
    if (!request?.stop) return driverId;

    // If a specific driver was assigned and is still visible, keep them.
    if (driverId && (busLocations[driverId] || lastCoords.current[driverId])) {
      return driverId;
    }

    const requestRouteId: string | null = request?.routeId ?? null;

    // Two-pass: first pick the closest bus on the correct route,
    // fall back to closest bus overall only if no route match exists.
    let routeMatchId: string | null = null;
    let routeMatchDist = Number.POSITIVE_INFINITY;
    let anyBestId: string | null = null;
    let anyBestDist = Number.POSITIVE_INFINITY;

    for (const id of activeBusIds) {
      const loc = busLocations[id] || lastCoords.current[id];
      if (!loc) continue;

      const dist = getDistanceInMeters(
        loc.latitude,
        loc.longitude,
        request.stop.latitude,
        request.stop.longitude,
      );

      if (requestRouteId && busRouteIds[id] === requestRouteId && dist < routeMatchDist) {
        routeMatchDist = dist;
        routeMatchId = id;
      }
      if (dist < anyBestDist) {
        anyBestDist = dist;
        anyBestId = id;
      }
    }

    return routeMatchId ?? anyBestId;
  }, [activeBusIds, busLocations, busRouteIds, driverId, request?.routeId, request?.stop]);

  // ✅ NEW: for "hide only destination stop marker while active"
  const destinationStopId = request?.stop?.id ?? request?.stopId ?? null;

  const userLocRef = useRef<{ latitude: number; longitude: number } | null>(null);

  // Map padding so "fit" respects the bottom card
  const mapBottomPadding = insets.bottom + (request ? bottomCardHeight : 0) + 18;
  const mapPadding = useMemo(
    () => ({
      top: insets.top + 12,
      right: 18,
      bottom: mapBottomPadding,
      left: 18,
    }),
    [insets.top, mapBottomPadding],
  );

  const centerOnUser = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission denied');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      userLocRef.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };

      markProgrammaticMove();
      setCameraMode('followUser');
      mapRef.current?.animateToRegion(
        {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        600,
      );
    } catch (e) {
      console.error('centerOnUser error', e);
    }
  };

  const fitToPoints = (
    points: { latitude: number; longitude: number }[],
    mode: 'followUser' | 'overview' = 'overview',
    minDelta = 0.01,
  ) => {
    if (!points.length) return;
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latDelta = Math.max((maxLat - minLat) * 1.6, minDelta);
    const lngDelta = Math.max((maxLng - minLng) * 1.6, minDelta);
    markProgrammaticMove();
    setCameraMode(mode);
    mapRef.current?.animateToRegion(
      {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: latDelta,
        longitudeDelta: lngDelta,
      },
      600,
    );
  };

  // Fit all campus stops
  const fitStops = () => {
    const points = stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
    fitToPoints(points, 'followUser', 0.01);
  };

  const fitActiveRide = () => {
    if (!request || !request.stop) return;

    const points: { latitude: number; longitude: number }[] = [
      { latitude: request.stop.latitude, longitude: request.stop.longitude },
    ];

    const busId = resolvedDriverId;
    if (busId) {
      const d = busLocations[busId] || lastCoords.current[busId];
      if (d) points.push({ latitude: d.latitude, longitude: d.longitude });
    }

    if (points.length < 2) return;

    fitToPoints(points, 'overview', 0.012);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setStudentUid(u?.uid ?? null);
      setStudentEmail(u?.email ?? null);

      // ✅ Ensure public profile exists for this user
      if (u?.uid) {
        void ensurePublicUserProfile(u.uid, u.email ?? null);
      }

      setOwnRequestReady(false);
      setOwnRequest(null);
      setRequest(null);
      setRequestId(null);
      setRouteCoords([]);
      fullRouteRef.current = [];
      setEta(null);
      setStopsBefore(null);
      setDriverId(null);
      notifiedRef.current = false;
      closeSelectedBus();
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (role !== 'parent' || !studentUid || !orgId) { setChildProfiles([]); return; }
    loadChildProfiles(orgId, studentUid).then((profiles) => {
      setChildProfiles(profiles);
      if (profiles.length === 1) setSelectedChild(profiles[0]);
    }).catch(() => setChildProfiles([]));
  }, [role, studentUid, orgId]);

  useEffect(() => {
    let mounted = true;
    let unsubBus: (() => void) | undefined;
    let locationSub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!mounted || status !== 'granted') {
        if (status !== 'granted') showAlert('Permission denied');
        return;
      }

      if (!didInitialFitRef.current) {
        didInitialFitRef.current = true;
        setRegion(INITIAL_REGION);
        markProgrammaticMove();

        setTimeout(() => {
          const points = stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
          if (points.length) fitToPoints(points, 'followUser', 0.01);
        }, 10);
      }

      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation },
        (pos) => {
          // Only store readings with acceptable accuracy to prevent a bad initial
          // fix from falsely triggering the "outside service area" boundary check.
          const acc = pos.coords.accuracy;
          if (acc !== null && acc > 100) return;
          userLocRef.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        },
      );
      if (!mounted) { sub.remove(); return; }
      locationSub = sub;
    })();

    unsubBus = onSnapshot(
      orgCol('buses'),
      (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return;

        const toDateSafe = (v: any): Date | null => {
          if (!v) return null;

          if (typeof v?.toDate === 'function') {
            const d = v.toDate();
            return d instanceof Date && !isNaN(d.getTime()) ? d : null;
          }
          if (typeof v === 'number') {
            const d = new Date(v);
            return !isNaN(d.getTime()) ? d : null;
          }
          if (typeof v === 'string') {
            const d = new Date(v);
            return !isNaN(d.getTime()) ? d : null;
          }
          return null;
        };

        const buses = snapshot.docs
          .map((docSnap) => {
            const data: any = docSnap.data();

            const latitude =
              typeof data.latitude === 'number'
                ? data.latitude
                : typeof data.lat === 'number'
                ? data.lat
                : typeof data?.coords?.latitude === 'number'
                ? data.coords.latitude
                : null;

            const longitude =
              typeof data.longitude === 'number'
                ? data.longitude
                : typeof data.lng === 'number'
                ? data.lng
                : typeof data?.coords?.longitude === 'number'
                ? data.coords.longitude
                : null;

            if (latitude == null || longitude == null) return null;

            const online =
              data?.online === true ||
              data?.isOnline === true ||
              data?.sharing === true ||
              data?.isSharing === true;

            if (!online) return null;

            const timestamp =
              toDateSafe(data?.updatedAt) ||
              toDateSafe(data?.lastSeen) ||
              toDateSafe(data?.lastUpdated) ||
              toDateSafe(data?.timestamp) ||
              toDateSafe(data?.sentAt) ||
              null;

            if (!timestamp) return null;

            return {
              id: docSnap.id,
              latitude,
              longitude,
              timestamp,
              online,
              routeId: typeof data.routeId === 'string' ? data.routeId : null,
            };
          })
          .filter(Boolean)
          .map((bus: any) => {
            const secondsAgo = (Date.now() - bus.timestamp.getTime()) / 1000;
            return { ...bus, secondsAgo };
          });

        const freshBuses = buses.filter((bus: any) => bus.secondsAgo < FRESHNESS_WINDOW_SECONDS);
        const visibleBuses = buses; // all online buses; opacity reflects freshness

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

        visibleBuses.forEach((bus: any) => {
          const { id, latitude, longitude, secondsAgo, timestamp } = bus;

          const prev = lastCoords.current[id];
          if (prev) {
            headings.current[id] = computeBearing(prev.latitude, prev.longitude, latitude, longitude);
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
              .timing({
                latitude,
                longitude,
                duration: 1800,
                useNativeDriver: false,
              } as any)
              .start();
          }
        });

        setBusLocations(newLocations);

        const newRouteIds: Record<string, string | null> = {};
        visibleBuses.forEach((bus: any) => { newRouteIds[bus.id] = bus.routeId ?? null; });
        setBusRouteIds(newRouteIds);

        const recentIds = visibleBuses.map((b: any) => b.id);
        setActiveBusIds(recentIds);

        bumpBusTracks();

        Object.keys(busRegions.current).forEach((key) => {
          if (!recentIds.includes(key)) delete busRegions.current[key];
        });
        Object.keys(lastCoords.current).forEach((key) => {
          if (!recentIds.includes(key)) delete lastCoords.current[key];
        });
        Object.keys(headings.current).forEach((key) => {
          if (!recentIds.includes(key)) delete headings.current[key];
        });
      },
      (err) => {
        console.error('buses snapshot error', {
          code: (err as any)?.code,
          message: (err as any)?.message,
        });
      },
    );

    return () => {
      mounted = false;
      if (unsubBus) unsubBus();
      if (locationSub) locationSub.remove();
      if (forceTracksTimerRef.current) clearTimeout(forceTracksTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [INITIAL_REGION, STOPS_BOUNDS, bottomCardHeight, insets.top, insets.bottom]);

  useEffect(() => {
    setOwnRequestReady(false);

    // Parents request under their own uid (childName is metadata on the doc)
    const watchUid = studentUid;

    if (!watchUid) {
      setOwnRequest(null);
      setOwnRequestReady(true);
      return;
    }

    let activeRequest: any = null;
    let expiredRequest: any = null;
    let activeReady = false;
    let expiredReady = false;

    const reconcileOwnRequest = () => {
      if (!activeReady || !expiredReady) return;
      setOwnRequest(activeRequest || expiredRequest || null);
      setOwnRequestReady(true);
    };

    const qActive = query(
      orgCol('stopRequests'),
      where('studentUid', '==', watchUid),
      where('status', 'in', ['pending', 'accepted', 'awaiting_confirmation']),
      orderBy('createdAt', 'desc'),
      limit(1),
    );

    const qExpiredCancelled = query(
      orgCol('stopRequests'),
      where('studentUid', '==', watchUid),
      where('cancelledReason', 'in', ['ttl_expired_15m', 'driver_offline', 'no_buses_online']),
      orderBy('cancelledAt', 'desc'),
      limit(1),
    );

    const unsubActive = onSnapshot(
      qActive,
      (snap) => {
        activeReady = true;
        activeRequest = snap.empty ? null : { id: snap.docs[0].id, ...(snap.docs[0].data() as any) };
        reconcileOwnRequest();
      },
      (err) => {
        activeReady = true;
        console.error('own active stopRequests snapshot error', err);
        reconcileOwnRequest();
      },
    );

    const unsubExpired = onSnapshot(
      qExpiredCancelled,
      (snap) => {
        expiredReady = true;
        expiredRequest = snap.empty ? null : { id: snap.docs[0].id, ...(snap.docs[0].data() as any) };
        reconcileOwnRequest();
      },
      (err) => {
        expiredReady = true;
        console.error('own expired stopRequests snapshot error', err);
        reconcileOwnRequest();
      },
    );

    return () => {
      unsubActive();
      unsubExpired();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentUid, role]);

  useEffect(() => {
    if (!ownRequestReady) return;

    if (ownRequest) {
      const prev = prevRequestStatusRef.current;
      const next = ownRequest.status;

      if (next === 'cancelled' && prev && prev !== 'cancelled') {
        const reason = ownRequest.cancelledReason;
        if (reason === 'driver_offline') {
          showToast('Your driver went offline. Your request was cancelled.', 'error');
        } else if (reason === 'no_buses_online') {
          showToast('No buses are online — service has ended for now.', 'error');
        }
      }

      prevRequestStatusRef.current = next;
      setRequest(ownRequest);
      setRequestId(ownRequest.id);
      setDriverId(ownRequest.driverUid || ownRequest.driverId || null);
      closeSelectedBus();
      return;
    }

    prevRequestStatusRef.current = null;
    setRequest(null);
    setRequestId(null);
    setRouteCoords([]);
    fullRouteRef.current = [];
    setEta(null);
    setStopsBefore(null);
    setDriverId(null);
    notifiedRef.current = false;

    closeSelectedBus();
    setShowLocationList(false);
  }, [ownRequest, ownRequestReady]);

  const fetchRoute = async () => {
    if (!request || !resolvedDriverId || !request.stop) {
      setRouteCoords([]);
      setEta(null);
      setStopsBefore(null);
      return;
    }

    const assigned = busLocations[resolvedDriverId] || lastCoords.current[resolvedDriverId];
    if (!assigned) {
      setRouteCoords([]);
      setEta(null);
      setStopsBefore(null);
      return;
    }

    if (request.status !== 'accepted' && request.status !== 'pending') {
      setRouteCoords([]);
      setEta(null);
      setStopsBefore(null);
      return;
    }

    try {
      const { coords, eta: etaText } = await fetchDirections(assigned, request.stop);
      fullRouteRef.current = coords;
      setRouteCoords(coords);
      setEta(etaText);

      // Use the route the student requested on (stored in request.routeId).
      // Falls back to the flat stops array if no route is configured.
      const requestRoute = orgRoutes.find((r) => r.id === (request.routeId ?? null)) ?? null;
      const orderedStops = requestRoute
        ? requestRoute.stopIds
            .map((id) => stops.find((s) => s.id === id))
            .filter((s): s is typeof stops[0] => s !== undefined)
        : stops;

      const getNearestStopIndex = (lat: number, lon: number) => {
        let nearestIdx = 0;
        let minDist = Number.MAX_VALUE;
        orderedStops.forEach((stop, idx) => {
          const d = getDistanceInMeters(lat, lon, stop.latitude, stop.longitude);
          if (d < minDist) {
            minDist = d;
            nearestIdx = idx;
          }
        });
        return nearestIdx;
      };

      const busStopIdx = getNearestStopIndex(assigned.latitude, assigned.longitude);
      const requestedStopIdx = orderedStops.findIndex((stop) => stop.id === request.stop.id);

      if (requestedStopIdx < 0) {
        setStopsBefore(null);
      } else {
        const rawDiff = (requestedStopIdx - busStopIdx + orderedStops.length) % orderedStops.length;
        setStopsBefore(Math.max(0, rawDiff - 1));
      }
    } catch (error) {
      console.error('Failed to fetch route:', error);
      setRouteCoords([]);
      setEta(null);
      setStopsBefore(null);
    }
  };

  const fetchTimeout = useRef<NodeJS.Timeout | null>(null);
  const driverOnline = activeBusIds.includes(resolvedDriverId || '');

  useEffect(() => {
    if (!resolvedDriverId) return;
    if (!request || (request.status !== 'accepted' && request.status !== 'pending')) return;
    if (!driverOnline) return;

    if (fetchTimeout.current) clearTimeout(fetchTimeout.current);

    const busLoc = busLocations[resolvedDriverId] || lastCoords.current[resolvedDriverId];
    if (!busLoc) return;

    const full = fullRouteRef.current;

    if (!full || full.length === 0) {
      fetchTimeout.current = setTimeout(() => {
        fetchRoute();
      }, 250);

      return () => {
        if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
      };
    }

    let furthestIdx = -1;
    for (let idx = 0; idx < full.length; idx++) {
      const p = full[idx];
      const d = getDistanceInMeters(busLoc.latitude, busLoc.longitude, p.latitude, p.longitude);

      if (d <= 40) {
        furthestIdx = idx;
      } else if (furthestIdx >= 0) {
        break;
      }
    }

    if (furthestIdx >= 0) {
      const trimmed = full.slice(furthestIdx);
      setRouteCoords((prev) => {
        if (prev.length === trimmed.length) return prev;
        return trimmed;
      });
    }

    fetchTimeout.current = setTimeout(() => {
      fetchRoute();
    }, 1200);

    return () => {
      if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedDriverId, request?.status, driverOnline, busLocations[resolvedDriverId ?? '']]);

  useEffect(() => {
    if (!rideActive) return;
    if (cameraMode === 'free' || recentlyInteracted(2500)) return;
    fitActiveRide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.status, driverId, bottomCardHeight]);

  useEffect(() => {
    if (request?.status === 'completed') {
      Notifications.scheduleNotificationAsync({
        content: { title: 'Bus has arrived!', body: 'Your stop request has been completed.' },
        trigger: null,
      });
    }
  }, [request?.status]);

  useEffect(() => {
    if (
      rideActive &&
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
        showAlert('The bus is arriving at your pickup location!', 'Heads up!');
        notifiedRef.current = true;
      }
    }
  }, [request, driverId, activeBusIds]);

  useEffect(() => {
    if (visibleRequest) {
      Animated.timing(slideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [visibleRequest, slideAnim]);

  useEffect(() => {
    if (!selectedBusId) return;
    const loc = busLocations[selectedBusId];
    if (!loc) return;
    setSelectedBusPopup((prev) => ({
      etaToYou: prev?.etaToYou ?? null,
      nextStop: prev?.nextStop ?? null,
      lastSeenText: formatLastSeen(loc.secondsAgo),
      driverName: prev?.driverName ?? null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusId, busLocations[selectedBusId ?? '']]);

  const selectedEtaTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (selectedEtaTimerRef.current) clearInterval(selectedEtaTimerRef.current as any);
    selectedEtaTimerRef.current = null;

    if (!selectedBusId) return;

    const tick = async () => {
      try {
        const busLoc = busLocations[selectedBusId] || lastCoords.current[selectedBusId];
        const userLoc = userLocRef.current;
        if (!busLoc || !userLoc) return;

        const { eta: e } = await fetchDirections(
          { latitude: busLoc.latitude, longitude: busLoc.longitude },
          { latitude: userLoc.latitude, longitude: userLoc.longitude },
        );

        setSelectedBusPopup((prev) => ({
          etaToYou: e ?? prev?.etaToYou ?? null,
          nextStop: prev?.nextStop ?? null,
          lastSeenText: prev?.lastSeenText ?? null,
          driverName: prev?.driverName ?? null,
        }));
      } catch {}
    };

    tick();
    selectedEtaTimerRef.current = setInterval(tick, 2500) as any;

    return () => {
      if (selectedEtaTimerRef.current) clearInterval(selectedEtaTimerRef.current as any);
      selectedEtaTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusId, busLocations[selectedBusId ?? '']]);


  useEffect(() => {
    if (!requestId || !request) return;
    if (request.status !== 'pending' && request.status !== 'accepted') return;

    const createdAtMs = request?.createdAt?.toMillis?.() ?? null;
    if (!createdAtMs) return;

    const expiresAtMs = typeof request?.expiresAtMs === 'number' ? request.expiresAtMs : createdAtMs + STUDENT_REQUEST_TTL_MS;
    const remainingMs = expiresAtMs - Date.now();

    const expireRequest = () => {
      if (!orgId) return;
      updateDoc(doc(db, 'orgs', orgId, 'stopRequests', requestId), {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelledReason: 'ttl_expired_15m',
      }).catch((err) => {
        console.error('Failed to expire timed student request', err);
      });
    };

    if (remainingMs <= 0) {
      expireRequest();
      return;
    }

    const timeout = setTimeout(expireRequest, remainingMs);
    return () => clearTimeout(timeout);
  }, [request, requestId]);

  useEffect(() => {
    if (!request || (request.status !== 'pending' && request.status !== 'accepted')) {
      setTtlCountdown(null);
      return;
    }
    const update = () => {
      const createdAtMs = request?.createdAt?.toMillis?.() ?? null;
      if (!createdAtMs) { setTtlCountdown(null); return; }
      const expiresAtMs = typeof request?.expiresAtMs === 'number'
        ? request.expiresAtMs
        : createdAtMs + STUDENT_REQUEST_TTL_MS;
      const remainingMs = expiresAtMs - Date.now();
      if (remainingMs <= 0) { setTtlCountdown(null); return; }
      const mins = Math.ceil(remainingMs / 60000);
      setTtlCountdown(mins <= 1 ? 'Less than 1 min left' : `${mins} min left`);
    };
    update();
    const timer = setInterval(update, 10000);
    return () => clearInterval(timer);
  }, [request?.id, request?.status]);

  // Show pickup confirmation modal when driver marks boarding
  useEffect(() => {
    if (request?.status === 'awaiting_confirmation') {
      setShowPickupConfirm(true);
    }
  }, [request?.status]);

  // Auto-complete confirmation after 5 minutes if rider doesn't respond
  useEffect(() => {
    if (request?.status !== 'awaiting_confirmation' || !requestId || !orgId) return;
    const expiresAt: number = request?.confirmationExpiresAtMs ?? 0;
    const remaining = expiresAt - Date.now();

    const complete = () => {
      updateDoc(doc(db, 'orgs', orgId, 'stopRequests', requestId), {
        status: 'completed',
        completedAt: serverTimestamp(),
        completedReason: 'confirmation_auto_expired',
      }).catch(() => {});
    };

    if (remaining <= 0) { complete(); return; }
    const timer = setTimeout(complete, remaining);
    return () => clearTimeout(timer);
  }, [request?.status, request?.confirmationExpiresAtMs, requestId, orgId]);

  const handleBusPress = async (id: string) => {
    const loc = busLocations[id];
    if (!loc) return;

    setSelectedBusId(id);
    setShowLocationList(false);

    const driverName = await getDriverFirstName(id);

    setSelectedBusPopup({
      etaToYou: null,
      nextStop: null,
      lastSeenText: formatLastSeen(loc.secondsAgo),
      driverName,
    });
    showCloud();

    let nearestIdx = 0;
    let minDist = Number.MAX_VALUE;
    stops.forEach((stop, idx) => {
      const d = getDistanceInMeters(loc.latitude, loc.longitude, stop.latitude, stop.longitude);
      if (d < minDist) {
        minDist = d;
        nearestIdx = idx;
      }
    });
    const nextIdx = (nearestIdx + 1) % stops.length;
    const nextStopName = stops[nextIdx]?.name ?? '';

    setSelectedBusPopup((prev) => ({
      etaToYou: prev?.etaToYou ?? null,
      nextStop: nextStopName,
      lastSeenText: prev?.lastSeenText ?? formatLastSeen(loc.secondsAgo),
      driverName: prev?.driverName ?? null,
    }));

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const userLoc = await Location.getCurrentPositionAsync({});
        userLocRef.current = { latitude: userLoc.coords.latitude, longitude: userLoc.coords.longitude };
      }
    } catch {}

    const latDelta = regionRef.current ? regionRef.current.latitudeDelta / 1.5 : 0.008;
    const lonDelta = regionRef.current ? regionRef.current.longitudeDelta / 1.5 : 0.008;

    markProgrammaticMove();
    mapRef.current?.animateToRegion(
      clampToBounds(
        {
          latitude: loc.latitude,
          longitude: loc.longitude,
          latitudeDelta: latDelta,
          longitudeDelta: lonDelta,
        },
        CLAMP_BOUNDS,
      ),
      600,
    );
  };

const handleRequest = async (entry: RequestableStop) => {
  if (!busOnline) {
    showAlert('No buses are currently online. Please try again later.');
    return;
  }
  if (!studentUid) {
    showAlert('You must be logged in to request a stop.');
    return;
  }

  // Parents must select a child before confirming — if multiple, show picker
  if (role === 'parent') {
    if (childProfiles.length === 0) {
      showAlert('Add a child in "My Children" before requesting a stop.', 'No children added');
      return;
    }
    if (childProfiles.length > 1 && !selectedChild) {
      setShowChildPicker(true);
      return;
    }
  }

  const { stop: selectedStop, routeId: entryRouteId } = entry;

  // Block requests from users who aren't physically near a stop.
  if (stops.length > 0) {
    if (!userLocRef.current) {
      showAlert(
        'Your location isn\'t available yet. Make sure GPS is enabled and wait a moment, then try again.',
        'Location required',
      );
      return;
    }
    const { latitude: ulat, longitude: ulng } = userLocRef.current;
    let nearestDist = Infinity;
    for (const s of stops) {
      const d = getDistanceInMeters(ulat, ulng, s.latitude, s.longitude);
      if (d < nearestDist) nearestDist = d;
    }
    if (nearestDist > STOP_REQUEST_RADIUS_M) {
      showAlert(
        `You're ${Math.round(nearestDist)} m from the nearest stop. Move within ${STOP_REQUEST_RADIUS_M} m of a stop shown on the map and try again.`,
        'Too far from a stop',
      );
      return;
    }
  }

  try {
    if (__DEV__) console.log('[handleRequest] auth.uid =', auth.currentUser?.uid, 'studentUid =', studentUid);

    let existing;
    try {
      existing = await getDocs(
        query(
          orgCol('stopRequests'),
          where('studentUid', '==', studentUid),
          where('status', 'in', ['pending', 'accepted']),
          limit(1),
        ),
      );
      if (__DEV__) console.log('[handleRequest] existing ok, empty?', existing.empty);
    } catch (e: any) {
      console.error('[handleRequest] existing query FAILED', e?.code, e?.message);
      throw e;
    }

    if (!existing.empty) {
      showAlert('You already have a stop in progress.');
      setShowLocationList(false);
      setSelectedStopKey(null);
      return;
    }

    try {
      const activeChild = selectedChild ?? (childProfiles.length === 1 ? childProfiles[0] : null);
      const ref = await addDoc(orgCol('stopRequests'), {
        orgId: orgId,
        studentUid,
        studentEmail: studentEmail ?? null,
        childName: activeChild ? activeChild.name : null,
        childGrade: activeChild?.grade ?? null,
        stopId: selectedStop.id,
        stop: {
          id: selectedStop.id,
          name: selectedStop.name,
          latitude: selectedStop.latitude,
          longitude: selectedStop.longitude,
        },
        status: 'pending',
        driverUid: null,
        routeId: entryRouteId ?? null,
        createdAt: serverTimestamp(),
        expiresAtMs: Date.now() + STUDENT_REQUEST_TTL_MS,
      });

      if (__DEV__) console.log('[handleRequest] created stopRequest', ref.id);
      if (orgId) void notifyDriversNewRequest(orgId);
    } catch (e: any) {
      console.error('[handleRequest] addDoc FAILED', e?.code, e?.message);
      throw e;
    }

    showAlert('Stop requested successfully!');
    setShowLocationList(false);
    setSelectedStopKey(null);
  } catch (err: any) {
    console.error('[MapScreen][handleRequest] FAILED', {
      code: err?.code,
      message: err?.message,
      err,
    });

    const code = err?.code ?? '';
    if (String(code).includes('failed-precondition')) {
      showAlert('Firestore index missing for this query. Check console for index link.', 'Index required');
    } else if (String(code).includes('permission-denied')) {
      showAlert('Permission denied. Firestore rules blocked the operation.', 'Permission denied');
    } else {
      showAlert(err?.message ?? 'Error requesting stop', 'Error requesting stop');
    }
  }
};

  // Org hasn't configured stops + boundaries yet — show a friendly placeholder
  const orgReady = !!(org && org.mapBoundingBox && (org.stops?.length ?? 0) >= 2);
  if (org && !orgReady) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.notReadyContainer}>
        <Icon name="directions-bus" size={56} color={primaryColor} style={{ marginBottom: 20 }} />
        <Text style={styles.notReadyTitle}>Almost there!</Text>
        <Text style={styles.notReadyBody}>
          Your administrator hasn't finished setting up stops and routes yet.
          Check back once the map is configured.
        </Text>
      </SafeAreaView>
    );
  }

  if (!region || !ownRequestReady) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.center}>
        <ActivityIndicator size="large" color={primaryColor} />
        {!ownRequestReady ? <Text style={{ marginTop: 10, color: '#666' }}>Syncing your ride…</Text> : null}
      </SafeAreaView>
    );
  }

  const cardLift = Math.min(bottomCardHeight, 260) + 10;
  const buttonsLift = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, cardLift],
  });
  const topOverlay = insets.top + 12;

  const cloudScale = cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const cloudOpacity = cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const cloudTranslateY = cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

  const fabBottom = insets.bottom + 18;

  return (
    <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: BACKGROUND_COLOR }}>
      {(role !== 'parent' || childProfiles.length > 0) && !rideActive && !selectedBusId && (
        <TouchableOpacity
          style={[styles.searchContainer, { top: role === 'parent' ? topOverlay + 46 : topOverlay, borderColor: primaryColor + '30', shadowColor: primaryColor }, (!busOnline || !serviceIsOpen) && styles.searchContainerOffline]}
          onPress={() => {
            if (!serviceIsOpen) {
              showAlert('Service is currently closed. Check the hours shown on the map.');
              return;
            }
            if (!busOnline) {
              showAlert('No buses are currently online. Please try again later.');
              return;
            }
            setShowLocationList((prev) => !prev);
          }}
          activeOpacity={0.8}
        >
          <Icon name="place" size={18} color={busOnline && serviceIsOpen ? primaryColor : '#bbb'} style={{ marginRight: 6 }} />
          <Text style={[styles.searchText, (!busOnline || !serviceIsOpen) && styles.searchTextOffline]}>
            {!serviceIsOpen ? 'Service closed' : !busOnline ? 'No buses online' : selectedStopKey === null ? 'Request a stop' : requestableStops.find((e) => e.key === selectedStopKey)?.stop.name ?? 'Request a stop'}
          </Text>
          <Icon name="keyboard-arrow-down" size={24} color={busOnline && serviceIsOpen ? primaryColor : '#bbb'} />
        </TouchableOpacity>
      )}

      {/* Parent: "Link a child" CTA when no children are linked yet */}
      {role === 'parent' && childProfiles.length === 0 && !rideActive && !selectedBusId && (
        <TouchableOpacity
          style={[styles.parentCtaCard, { top: topOverlay }]}
          onPress={() => navigation.navigate('ParentChildLink')}
          activeOpacity={0.85}
        >
          <Icon name="child-care" size={22} color={primaryColor} />
          <View style={{ flex: 1 }}>
            <Text style={styles.parentCtaTitle}>Link a child to get started</Text>
            <Text style={styles.parentCtaBody}>Tap here to add your child's account so you can track their shuttle.</Text>
          </View>
          <Icon name="chevron-right" size={20} color={primaryColor} />
        </TouchableOpacity>
      )}

      {/* Parent: active child indicator pill */}
      {role === 'parent' && selectedChild && !rideActive && !selectedBusId && (
        <TouchableOpacity
          style={[styles.activeChildPill, { top: topOverlay, borderColor: primaryColor + '40' }]}
          onPress={() => childProfiles.length > 1 && setShowChildPicker(true)}
          activeOpacity={childProfiles.length > 1 ? 0.7 : 1}
        >
          <View style={[styles.activeChildDot, { backgroundColor: primaryColor }]} />
          <Text style={[styles.activeChildText, { color: primaryColor }]}>
            Tracking {selectedChild.name.split(' ')[0]}
          </Text>
          {childProfiles.length > 1 && (
            <Icon name="swap-horiz" size={16} color={primaryColor} style={{ marginLeft: 2 }} />
          )}
        </TouchableOpacity>
      )}

      {!rideActive && !showLocationList && !selectedBusId && (
        <View style={[styles.tipContainer, {
          top: role === 'parent' && childProfiles.length === 0
            ? topOverlay + 96    // CTA card (~82px) + 14 gap
            : role === 'parent' && childProfiles.length > 0
              ? topOverlay + 116  // pill (36) + gap (10) + search bar (50) + gap (20)
              : topOverlay + 60,  // search bar (50) + gap (10)
        }]}>
          {!serviceIsOpen ? (
            // Outside operating hours — show schedule
            <View style={styles.hoursCard}>
              <View style={styles.hoursCardHeader}>
                <Icon name="schedule" size={16} color="#374151" />
                <Text style={styles.hoursCardTitle}>Service Closed</Text>
              </View>
              {orgRoutes.filter((r) => r.schedule).map((r) => {
                const nextOpen = getNextOpenText(r);
                const todayText = getTodayScheduleText(r);
                return (
                  <View key={r.id} style={styles.hoursRouteBlock}>
                    <Text style={[styles.hoursRouteName, { color: primaryColor }]}>{r.name}</Text>
                    {todayText ? <Text style={styles.hoursEntry}>{todayText}</Text> : null}
                    {nextOpen ? <Text style={[styles.hoursEntry, { color: primaryColor }]}>{nextOpen}</Text> : null}
                  </View>
                );
              })}
            </View>
          ) : !busOnline ? (
            // Service hours are open but no driver is sharing location
            <View style={styles.noBusCard}>
              <View style={styles.noBusIconWrap}>
                <Icon name="directions-bus" size={28} color="#6b7280" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.noBusTitle}>No buses online right now</Text>
                <Text style={styles.noBusBody}>
                  Service is active today but no driver has started their shift yet. Check back shortly.
                </Text>
              </View>
            </View>
          ) : (
            // Buses are online — show tips
            <InfoBanner
              icon="lightbulb-outline"
              title={role === 'parent' ? 'Live tracking' : 'Quick pointers'}
              description={role === 'parent'
                ? 'Tap a bus to see its ETA and next stop. Your child\'s pickup status will appear below.'
                : 'Tap "Request a stop" to pick your pickup, or tap a bus to see its ETA and next stop.'}
            />
          )}
          {activeBusIds.length > 0 && (
            <View style={styles.busCountChip}>
              <View style={styles.busCountDot} />
              <Text style={styles.busCountText}>
                {activeBusIds.length} bus{activeBusIds.length !== 1 ? 'es' : ''} online
              </Text>
            </View>
          )}
        </View>
      )}

      {!rideActive && showLocationList && !selectedBusId && (
        <TouchableWithoutFeedback onPress={() => setShowLocationList(false)}>
          <View style={styles.overlay}>
            <View style={[styles.locationListContainer, { top: role === 'parent' ? topOverlay + 106 : topOverlay + 60 }]}>
              <FlatList
                data={requestableStops}
                keyExtractor={(item) => item.key}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.locationItem}
                    onPress={() => {
                      const routeLabel = item.routeName ? ` · ${item.routeName}` : '';
                      Alert.alert(
                        'Request pickup',
                        `Request a pickup at ${item.stop.name}${routeLabel}?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Request',
                            onPress: () => {
                              setSelectedStopKey(item.key);
                              handleRequest(item);
                            },
                          },
                        ],
                      );
                    }}
                  >
                    <Text style={styles.locationText}>{item.stop.name}</Text>
                    {item.routeName ? (
                      <Text style={styles.locationRouteMeta}>
                        {item.position !== null ? `Stop ${item.position} of ${item.totalStops} · ` : ''}{item.routeName}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                )}
              />
            </View>
          </View>
        </TouchableWithoutFeedback>
      )}

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={region ?? INITIAL_REGION}
        mapPadding={mapPadding}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        rotateEnabled={false}
        pitchEnabled={false}
        customMapStyle={grayscaleMapStyle}
        onPanDrag={markUserInteraction}
        onTouchStart={markUserInteraction}
        onTouchEnd={() => {
          setTimeout(() => {
            userInteractingRef.current = false;
          }, 250);
        }}
        onRegionChangeComplete={(newRegion) => {
          regionRef.current = newRegion;
          if (!isProgrammaticMove() && userInteractingRef.current) {
            setCameraMode('free');
          }
        }}
      >
        {/* Campus boundary — convex hull of all stops */}
        {campusHull.length >= 3 && (
          <Polygon
            coordinates={campusHull}
            strokeColor={primaryColor + '99'}
            fillColor={primaryColor + '12'}
            strokeWidth={2}
            lineDashPattern={[8, 6]}
          />
        )}

        {/* Campus stops — hidden destination stop while ride is active */}
        {stops.filter((s) => !rideActive || s.id !== destinationStopId).map((stop) => (
          <Marker
            key={`${stop.id}-${primaryColor}`}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={2}
            tracksViewChanges={false}
          >
            <MapMarker label={stop.name} />
          </Marker>
        ))}

        {activeBusIds.map((id) => {
          const loc = busLocations[id];
          if (!loc) return null;

          const isSelected = selectedBusId === id;
          const animatedCoord = busRegions.current[id];

          return (
            <React.Fragment key={id}>
              <MarkerAnimated
                coordinate={animatedCoord ?? { latitude: loc.latitude, longitude: loc.longitude }}
                flat
                rotation={loc.heading}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={() => handleBusPress(id)}
                tracksViewChanges={isSelected || forceBusTracks}
                zIndex={50}
              >
                <Image
                  source={busIcon}
                  style={{ width: 70, height: 70, opacity: loc.isFresh ? 1 : 0.55 }}
                  resizeMode="contain"
                />
              </MarkerAnimated>

              {isSelected && (
                <MarkerAnimated
                  coordinate={animatedCoord ?? { latitude: loc.latitude, longitude: loc.longitude }}
                  anchor={{ x: 0.5, y: 1.42 }}
                  tappable={false}
                  tracksViewChanges
                  zIndex={100}
                >
                  <Animated.View
                    style={{
                      opacity: cloudOpacity,
                      transform: [{ translateY: cloudTranslateY }, { scale: cloudScale }],
                    }}
                  >
                    <View style={styles.busCloud}>
                      <View style={styles.busCloudInner}>
                        <View style={styles.busCloudHeader}>
                          <Text style={styles.busCloudTitle}>{selectedBusPopup?.driverName ?? 'Driver'}</Text>
                          <TouchableOpacity onPress={closeSelectedBus} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                            <Icon name="close" size={18} color="#9CA3AF" />
                          </TouchableOpacity>
                        </View>

                        {selectedBusPopup?.etaToYou ? (
                          <Text style={styles.busCloudText}>ETA to you: {selectedBusPopup.etaToYou}</Text>
                        ) : null}

                        <Text style={styles.busCloudMuted}>
                          Last seen: {selectedBusPopup?.lastSeenText ?? formatLastSeen(loc.secondsAgo)}
                        </Text>

                        {selectedBusPopup?.nextStop ? (
                          <Text style={styles.busCloudMuted}>Next stop: {selectedBusPopup.nextStop}</Text>
                        ) : null}
                      </View>

                      <View style={styles.busCloudTail} />
                    </View>
                  </Animated.View>
                </MarkerAnimated>
              )}
            </React.Fragment>
          );
        })}

        {/* Destination pin only while ride is active */}
        {rideActive && request?.stop && (
          <Marker
            coordinate={{
              latitude: request.stop.latitude,
              longitude: request.stop.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            zIndex={10}
          >
            <MapMarker icon="flag" label={request.stop.name} color="#22c55e" />
          </Marker>
        )}

        {routeCoords.length > 0 && (
          <>
            <Polyline
              coordinates={routeCoords}
              strokeWidth={2}
              strokeColor={primaryColor + '40'}
              lineCap="round"
              lineJoin="round"
              zIndex={1}
            />
            <Polyline
              coordinates={routeCoords}
              strokeWidth={5}
              strokeColor={primaryColor}
              lineCap="round"
              lineJoin="round"
              zIndex={2}
            />
          </>
        )}
      </MapView>

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.fabWrapBottomLeft,
          {
            bottom: fabBottom,
            transform: [{ translateY: Animated.multiply(buttonsLift, -1) }],
          },
        ]}
      >
        <TouchableOpacity style={styles.fab} onPress={centerOnUser} activeOpacity={0.9}>
          <Icon name="my-location" size={22} color="#111" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.fab} onPress={fitStops} activeOpacity={0.9}>
          <Icon name="map" size={22} color="#111" />
        </TouchableOpacity>

        {rideActive && (
          <TouchableOpacity style={[styles.fabPrimary, { backgroundColor: primaryColor }]} onPress={fitActiveRide} activeOpacity={0.9}>
            <Icon name="alt-route" size={22} color="#fff" />
            <Text style={styles.fabPrimaryText}>Fit</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      {selectedBusId && (
        <TouchableWithoutFeedback onPress={closeSelectedBus}>
          <View style={styles.transparentOverlay} />
        </TouchableWithoutFeedback>
      )}

      <Animated.View
        onLayout={(e) => setBottomCardHeight(e.nativeEvent.layout.height)}
        style={[
          styles.bottomCard,
          {
            transform: [{ translateY: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [300, 0] }) }],
            opacity: slideAnim,
          },
        ]}
      >
        {visibleRequest ? (
          <>
            <View style={styles.cardHandle} />

            <View style={styles.cardRow}>
              {visibleRequest.stop?.name ? (
                <Text style={styles.cardStopName}>{visibleRequest.stop.name}</Text>
              ) : null}
              <View style={[
                styles.cardBadge,
                visibleRequest.status === 'completed'
                  ? styles.cardBadgeDone
                  : visibleRequest.status === 'awaiting_confirmation'
                    ? styles.cardBadgeConfirming
                    : visibleRequest.status === 'cancelled'
                      ? styles.cardBadgeExpired
                      : styles.cardBadgeActive,
              ]}>
                <Text style={styles.cardBadgeText}>
                  {visibleRequest.status === 'cancelled'
                    ? (visibleRequest.cancelledReason === 'ttl_expired_15m' ? 'Expired' : 'Cancelled')
                    : visibleRequest.status === 'completed'
                      ? 'Completed'
                      : visibleRequest.status === 'awaiting_confirmation'
                        ? 'Confirming…'
                        : 'Active'}
                </Text>
              </View>
            </View>

            {(() => {
              const info = routeStopMap.get(visibleRequest.stop?.id);
              if (!info) return null;
              return (
                <Text style={styles.cardRouteMeta}>
                  Stop {info.position} of {info.totalStops} · {info.routeName}
                </Text>
              );
            })()}

            <Text style={styles.cardSubtitle}>
              {visibleRequest.status === 'cancelled'
                ? visibleRequest.cancelledReason === 'driver_offline'
                  ? 'Your driver went offline. Tap dismiss to start a new request.'
                  : visibleRequest.cancelledReason === 'no_buses_online'
                    ? 'No buses are currently online. Service has ended for now.'
                    : 'The request timed out after 15 minutes.'
                : visibleRequest.status === 'completed'
                  ? 'The bus has passed this stop.'
                  : visibleRequest.status === 'awaiting_confirmation'
                    ? 'The driver recorded a boarding — tap to confirm your pickup.'
                    : role === 'parent'
                      ? `${visibleRequest.childName ? `${visibleRequest.childName}'s` : "Your child's"} stop is confirmed. The bus will pick them up.`
                      : 'Your stop is confirmed. The bus will pick you up.'}
            </Text>

            {(eta || stopsBefore !== null) && (
              <View style={styles.cardInfoRow}>
                {eta ? <Text style={[styles.etaText, { color: primaryColor }]}>{eta} away</Text> : null}
                {eta && stopsBefore !== null ? <Text style={styles.cardInfoDot}> · </Text> : null}
                {stopsBefore !== null ? (
                  <Text style={styles.cardInfoMeta}>{stopsBefore} stop{stopsBefore !== 1 ? 's' : ''} before you</Text>
                ) : null}
              </View>
            )}

            {ttlCountdown && (
              <View style={[styles.cardInfoRow, { marginTop: 2 }]}>
                <Icon name="timer" size={13} color="#9CA3AF" />
                <Text style={[styles.cardInfoMeta, { marginLeft: 4 }]}>{ttlCountdown}</Text>
              </View>
            )}

            {/* Confirm pickup button */}
            {visibleRequest.status === 'awaiting_confirmation' && (
              <TouchableOpacity
                style={[styles.confirmPickupBtn, { backgroundColor: primaryColor }]}
                onPress={() => setShowPickupConfirm(true)}
              >
                <Icon name="directions-bus" size={16} color="#fff" />
                <Text style={styles.confirmPickupBtnText}>Confirm pickup</Text>
              </TouchableOpacity>
            )}

            {/* Dismiss button for terminal states */}
            {(visibleRequest.status === 'completed' || visibleRequest.status === 'cancelled') && (
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={() => setDismissedRequestId(visibleRequest.id)}
              >
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </TouchableOpacity>
            )}

            {visibleRequest.studentUid === studentUid && (visibleRequest.status === 'accepted' || visibleRequest.status === 'pending') && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  Alert.alert(
                    'Cancel request?',
                    'Are you sure you want to cancel your stop request?',
                    [
                      { text: 'Keep it', style: 'cancel' },
                      {
                        text: 'Cancel request',
                        style: 'destructive',
                        onPress: async () => {
                          if (!requestId || !orgId) return;
                          await updateDoc(doc(db, 'orgs', orgId, 'stopRequests', requestId), { status: 'cancelled' });
                          setRequest(null);
                          setRequestId(null);
                          setRouteCoords([]);
                          fullRouteRef.current = [];
                          setEta(null);
                          setStopsBefore(null);
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel Request</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <Text style={styles.noRideText}>No active stop</Text>
        )}
      </Animated.View>

      {/* Child picker — shown when parent has multiple children */}
      <Modal visible={showChildPicker} transparent animationType="slide" onRequestClose={() => setShowChildPicker(false)}>
        <TouchableWithoutFeedback onPress={() => setShowChildPicker(false)}>
          <View style={styles.childPickerOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.childPickerSheet}>
                <Text style={styles.childPickerTitle}>Who is this stop for?</Text>
                {childProfiles.map((child) => (
                  <TouchableOpacity
                    key={child.id}
                    style={[styles.childPickerRow, selectedChild?.id === child.id && { backgroundColor: `${primaryColor}12` }]}
                    onPress={() => {
                      setSelectedChild(child);
                      setShowChildPicker(false);
                    }}
                  >
                    <View style={[styles.childPickerAvatar, { backgroundColor: `${primaryColor}22` }]}>
                      <Icon name="person" size={18} color={primaryColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.childPickerName}>{child.name}</Text>
                      {child.grade ? <Text style={styles.childPickerGrade}>{child.grade}</Text> : null}
                    </View>
                    {selectedChild?.id === child.id && <Icon name="check" size={20} color={primaryColor} />}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Pickup confirmation + feedback modal */}
      {showPickupConfirm && request && orgId && studentUid && (
        <PickupConfirmModal
          visible={showPickupConfirm}
          requestId={requestId!}
          orgId={orgId}
          studentUid={studentUid}
          stopName={request.stop?.name ?? 'your stop'}
          primaryColor={primaryColor}
          onDone={() => setShowPickupConfirm(false)}
        />
      )}

    </SafeAreaView>
  );
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

const styles = StyleSheet.create({
  map: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  notReadyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BACKGROUND_COLOR,
    padding: 40,
  },
  notReadyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
    textAlign: 'center',
  },
  notReadyBody: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
  },

  searchContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BACKGROUND_COLOR,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 100,
  },
  tipContainer: { position: 'absolute', left: 20, right: 20, zIndex: 90 },
  busCountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  busCountDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#16a34a',
    marginRight: 5,
  },
  busCountText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  hoursCard: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  noBusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  noBusIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noBusTitle: { fontSize: 14, fontWeight: '700', color: '#111', marginBottom: 4 },
  noBusBody: { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  hoursCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  hoursCardTitle: { fontSize: 14, fontWeight: '700', color: '#111' },
  hoursRouteBlock: { marginBottom: 8 },
  hoursRouteName: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  hoursEntry: { fontSize: 13, color: '#374151' },
  searchText: { flex: 1, fontSize: 15, fontWeight: '500', color: '#374151' },
  searchContainerOffline: { backgroundColor: '#f3f4f6' },
  searchTextOffline: { color: '#aaa' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 99 },
  transparentOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 99 },

  locationListContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: BACKGROUND_COLOR,
    borderRadius: 12,
    maxHeight: 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 8,
  },
  locationItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  locationText: { fontSize: 16, color: '#333' },
  locationRouteMeta: { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  fabWrapBottomLeft: {
    position: 'absolute',
    left: 14,
    zIndex: 120,
    alignItems: 'flex-start',
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
  cardHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 14,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardStopName: { fontSize: 20, fontWeight: '700', color: '#111', flex: 1, marginRight: 10 },
  cardBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  cardBadgeActive: { backgroundColor: '#D1FAE5' },
  cardBadgeDone: { backgroundColor: '#E5E7EB' },
  cardBadgeExpired: { backgroundColor: '#FEE2E2' },
  cardBadgeConfirming: { backgroundColor: '#FEF3C7' },
  cardBadgeText: { fontSize: 12, fontWeight: '600', color: '#111' },
  cardTitle: { fontSize: 18, fontWeight: '600', marginBottom: 6 },
  cardSubtitle: { fontSize: 14, color: '#555', marginBottom: 4 },
  cardRouteMeta: { fontSize: 12, color: '#9ca3af', marginBottom: 4 },
  cardInfoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 4 },
  etaText: { fontSize: 15, fontWeight: '700' },
  cardInfoDot: { fontSize: 14, color: '#9CA3AF' },
  cardInfoMeta: { fontSize: 14, color: '#6B7280' },
  cancelButton: {
    borderWidth: 1.5,
    borderColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  cancelButtonText: { color: '#DC2626', fontSize: 15, fontWeight: '600' },
  confirmPickupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  confirmPickupBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  dismissButton: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  dismissButtonText: { color: '#6B7280', fontSize: 15, fontWeight: '600' },
  noRideText: { fontSize: 16, color: '#888', textAlign: 'center' },
  childPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  childPickerSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    gap: 4,
  },
  childPickerTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 12, textAlign: 'center' },
  childPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  childPickerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  childPickerName: { fontSize: 15, fontWeight: '600', color: '#111' },
  childPickerGrade: { fontSize: 12, color: '#6b7280', marginTop: 1 },

  busCloud: {
    width: Math.min(260, SCREEN_WIDTH - 40),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    zIndex: 999,
  },
  busCloudInner: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
  },
  busCloudTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 13,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(255,255,255,0.96)',
    marginTop: -1,
    alignSelf: 'center',
  },
  busCloudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  busCloudTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111',
    flex: 1,
  },
  busCloudText: {
    fontSize: 16,
    color: '#111',
    marginBottom: 6,
    fontWeight: '600',
  },
  busCloudMuted: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '600',
    marginBottom: 4,
  },
  parentCtaCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    padding: 14,
    zIndex: 90,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  parentCtaTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
    marginBottom: 2,
  },
  parentCtaBody: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
  },
  activeChildPill: {
    position: 'absolute',
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1.5,
    zIndex: 90,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  activeChildDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  activeChildText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
