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
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
import MapView, {
  PROVIDER_GOOGLE,
  MarkerAnimated,
  AnimatedRegion,
  Polyline,
  Region,
  Marker,
} from 'react-native-maps';
import MapMarker from '../components/MapMarker';
import { grayscaleMapStyle, MAX_LAT_DELTA, MAX_LON_DELTA } from '../src/constants/mapConfig';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';
import * as Location from 'expo-location';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StudentTabParamList } from '../tabs/StudentTabs';
import { RootStackParamList } from '../navigation/StackNavigator';
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
import { fetchDirections } from '../src/utils/directions';
import InfoBanner from '../components/InfoBanner';
import { STUDENT_REQUEST_TTL_MS, FRESHNESS_WINDOW_SECONDS } from '../src/constants/stops';
import { useOrg } from '../src/org/OrgContext';
import { useAuth } from '../src/auth/AuthProvider';

const STALE_WINDOW_SECONDS = 90;

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

type CameraMode = 'free' | 'followUser' | 'overview';

type BusPopup = {
  etaToYou: string | null;
  nextStop: string | null;
  lastSeenText: string | null;
  driverName: string | null;
};

export default function MapScreen() {
  const navigation = useNavigation<
    CompositeNavigationProp<
      BottomTabNavigationProp<StudentTabParamList, 'Map'>,
      NativeStackNavigationProp<RootStackParamList>
    >
  >();

  const { org } = useOrg();
  const { orgId } = useAuth();
  const stops = org?.stops ?? [];
  // Returns a Firestore CollectionReference scoped to the current org
  const orgCol = (name: string) =>
    orgId ? collection(db, 'orgs', orgId, name) : collection(db, name);

  const insets = useSafeAreaInsets();

  const STOPS_BOUNDS = useMemo(() => getStopsBounds(stops), [stops]);
  const PADDED_BOUNDS = useMemo(() => padBounds(STOPS_BOUNDS, 0.3), [STOPS_BOUNDS]);
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

  const [request, setRequest] = useState<any>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [ownRequest, setOwnRequest] = useState<any>(null);

  const [ownRequestReady, setOwnRequestReady] = useState(false);

  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [eta, setEta] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [stopsBefore, setStopsBefore] = useState<number | null>(null);
  const [busOnline, setBusOnline] = useState<boolean>(false);

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
  const [selectedStopIndex, setSelectedStopIndex] = useState<number | null>(null);

  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [selectedBusPopup, setSelectedBusPopup] = useState<BusPopup | null>(null);
  const [driverFirstNames, setDriverFirstNames] = useState<Record<string, string>>({});

  const mapRef = useRef<MapView | null>(null);

  const notifiedRef = useRef(false);
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

  const rideActive = !!request && (request.status === 'pending' || request.status === 'accepted');

  const resolvedDriverId = useMemo(() => {
    if (!request?.stop) return driverId;

    if (driverId && (busLocations[driverId] || lastCoords.current[driverId])) {
      return driverId;
    }

    let bestId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const id of activeBusIds) {
      const loc = busLocations[id] || lastCoords.current[id];
      if (!loc) continue;

      const dist = getDistanceInMeters(
        loc.latitude,
        loc.longitude,
        request.stop.latitude,
        request.stop.longitude,
      );

      if (dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    }

    return bestId;
  }, [activeBusIds, busLocations, driverId, request?.stop]);

  // ✅ NEW: for “hide only destination stop marker while active”
  const destinationStopId = request?.stop?.id ?? request?.stopId ?? null;

  const userLocRef = useRef<{ latitude: number; longitude: number } | null>(null);

  // Map padding so “fit” respects the bottom card
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

  const getEdgePadding = () => ({
    top: insets.top + 120,
    right: 70,
    bottom: mapBottomPadding + 80,
    left: 70,
  });

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
        clampToBounds(
          {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          PADDED_BOUNDS,
        ),
        500,
      );
    } catch (e) {
      console.error('centerOnUser error', e);
    }
  };

  // Fit campus using fitToCoordinates + edgePadding
  const fitStops = () => {
    markProgrammaticMove();
    setCameraMode('followUser');

    const points = stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
    mapRef.current?.fitToCoordinates(points, { edgePadding: getEdgePadding(), animated: true });

    const r = INITIAL_REGION;
    setRegion(r);
  };

  const fitActiveRide = () => {
    if (!request || (request.status !== 'accepted' && request.status !== 'pending') || !driverId || !request.stop) return;

    const d = busLocations[driverId] || lastCoords.current[driverId];
    if (!d) return;

    const points = [
      { latitude: d.latitude, longitude: d.longitude },
      { latitude: request.stop.latitude, longitude: request.stop.longitude },
    ];

    if (userLocRef.current) {
      points.push(userLocRef.current);
    }

    markProgrammaticMove();
    setCameraMode('overview');
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: getEdgePadding(),
      animated: true,
    });
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
          mapRef.current?.fitToCoordinates(points, { edgePadding: getEdgePadding(), animated: true });
        }, 10);
      }

      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation },
        (pos) => {
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
            };
          })
          .filter(Boolean)
          .map((bus: any) => {
            const secondsAgo = (Date.now() - bus.timestamp.getTime()) / 1000;
            return { ...bus, secondsAgo };
          });

        const freshBuses = buses.filter((bus: any) => bus.secondsAgo < FRESHNESS_WINDOW_SECONDS);
        const visibleBuses = buses.filter((bus: any) => bus.secondsAgo < STALE_WINDOW_SECONDS);

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
              .timing({
                latitude,
                longitude,
                duration: 2900,
                useNativeDriver: false,
              } as any)
              .start();
          }
        });

        setBusLocations(newLocations);

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

    if (!studentUid) {
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
      where('studentUid', '==', studentUid),
      where('status', 'in', ['pending', 'accepted']),
      orderBy('createdAt', 'desc'),
      limit(1),
    );

    const qExpiredCancelled = query(
      orgCol('stopRequests'),
      where('studentUid', '==', studentUid),
      where('status', '==', 'cancelled'),
      where('cancelledReason', '==', 'ttl_expired_15m'),
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
  }, [studentUid]);

  useEffect(() => {
    if (!ownRequestReady) return;

    if (ownRequest) {
      setRequest(ownRequest);
      setRequestId(ownRequest.id);
      setDriverId(ownRequest.driverUid || ownRequest.driverId || null);
      closeSelectedBus();
      return;
    }

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

      const getNearestStopIndex = (lat: number, lon: number) => {
        let nearestIdx = 0;
        let minDist = Number.MAX_VALUE;
        stops.forEach((stop, idx) => {
          const d = getDistanceInMeters(lat, lon, stop.latitude, stop.longitude);
          if (d < minDist) {
            minDist = d;
            nearestIdx = idx;
          }
        });
        return nearestIdx;
      };

      const busStopIdx = getNearestStopIndex(assigned.latitude, assigned.longitude);
      const requestedStopIdx = stops.findIndex((stop) => stop.id === request.stop.id);

      if (requestedStopIdx < 0) {
        setStopsBefore(null);
      } else {
        const rawDiff = (requestedStopIdx - busStopIdx + stops.length) % stops.length;
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
    if (request) {
      Animated.timing(slideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [request, slideAnim]);

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
      updateDoc(doc(db, 'orgs', orgId ?? '', 'stopRequests', requestId), {
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

    const latDelta = region ? region.latitudeDelta / 1.5 : 0.008;
    const lonDelta = region ? region.longitudeDelta / 1.5 : 0.008;

    markProgrammaticMove();
    mapRef.current?.animateToRegion(
      clampToBounds(
        {
          latitude: loc.latitude,
          longitude: loc.longitude,
          latitudeDelta: latDelta,
          longitudeDelta: lonDelta,
        },
        PADDED_BOUNDS,
      ),
      650,
    );
  };

const handleRequest = async (index: number) => {
  if (!busOnline) {
    showAlert('No buses are currently online. Please try again later.');
    return;
  }
  if (!studentUid) {
    showAlert('You must be logged in to request a stop.');
    return;
  }

  const selectedStop = stops[index];

  try {
    if (__DEV__) console.log('[handleRequest] auth.uid =', auth.currentUser?.uid, 'studentUid =', studentUid);

    // (A) Check existing
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
      setSelectedStopIndex(null);
      return;
    }

    // Create request
    try {
      const ref = await addDoc(orgCol('stopRequests'), {
        orgId: orgId ?? '',
        studentUid,
        studentEmail: studentEmail ?? null,
        stopId: selectedStop.id,
        stop: {
          id: selectedStop.id,
          name: selectedStop.name,
          latitude: selectedStop.latitude,
          longitude: selectedStop.longitude,
        },
        status: 'pending',
        driverUid: null,
        acceptedAt: null,
        createdAt: serverTimestamp(),
        expiresAtMs: Date.now() + STUDENT_REQUEST_TTL_MS,
      });

      if (__DEV__) console.log('[handleRequest] created stopRequest', ref.id);
    } catch (e: any) {
      console.error('[handleRequest] addDoc FAILED', e?.code, e?.message);
      throw e;
    }

    showAlert('Stop requested successfully!');
    setShowLocationList(false);
    setSelectedStopIndex(null);
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
        <Icon name="directions-bus" size={56} color={PRIMARY_COLOR} style={{ marginBottom: 20 }} />
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
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
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
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: BACKGROUND_COLOR }}>
      {!rideActive && !selectedBusId && (
        <TouchableOpacity
          style={[styles.searchContainer, { top: topOverlay }]}
          onPress={() => setShowLocationList((prev) => !prev)}
          activeOpacity={0.8}
        >
          <Text style={styles.searchText}>
            {selectedStopIndex === null ? 'Request a stop' : stops[selectedStopIndex]?.name}
          </Text>
          <Icon name="keyboard-arrow-down" size={24} color="#888" />
        </TouchableOpacity>
      )}

      {!rideActive && !showLocationList && !selectedBusId && (
        <View style={[styles.tipContainer, { top: topOverlay + 60 }]}>
          <InfoBanner
            icon="lightbulb-outline"
            title="Quick pointers"
            description="Tap “Request a stop” to pick your pickup or tap a bus to see its ETA and next stop."
          />
        </View>
      )}

      {!rideActive && showLocationList && !selectedBusId && (
        <TouchableWithoutFeedback onPress={() => setShowLocationList(false)}>
          <View style={styles.overlay}>
            <View style={[styles.locationListContainer, { top: topOverlay + 60 }]}>
              <FlatList
                data={stops}
                keyExtractor={(item) => item.id}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    style={styles.locationItem}
                    onPress={() => {
                      setSelectedStopIndex(index);
                      handleRequest(index);
                    }}
                  >
                    <Text style={styles.locationText}>{item.name}</Text>
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
        region={region}
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
          if (!isProgrammaticMove() && userInteractingRef.current) {
            setCameraMode('free');
          }

          const clamped = clampToBounds(newRegion, PADDED_BOUNDS);

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
        {/* ✅ Campus stops always visible, but hide the destination stop marker while ride is active */}
        {stops.filter((s) => !rideActive || s.id !== destinationStopId).map((stop) => (
          <Marker
            description={stop.name}
            key={stop.id}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <MapMarker icon="location-on" />
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
              >
                <Image
                  source={busIcon}
                  style={{ width: 54, height: 54, opacity: loc.isFresh ? 1 : 0.55 }}
                  resizeMode="contain"
                />
              </MarkerAnimated>

              {isSelected && (
                <Marker
                  coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
                  anchor={{ x: 0.5, y: 1.42 }}
                  tappable={false}
                  tracksViewChanges
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
                </Marker>
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
          >
            <MapMarker icon="flag" label={request.stop.name} />
          </Marker>
        )}

        {routeCoords.length > 0 && (
          <>
            <Polyline
              coordinates={routeCoords}
              strokeWidth={2}
              strokeColor={PRIMARY_COLOR + '40'}
              lineCap="round"
              lineJoin="round"
              zIndex={1}
            />
            <Polyline
              coordinates={routeCoords}
              strokeWidth={5}
              strokeColor={PRIMARY_COLOR}
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
          <TouchableOpacity style={styles.fabPrimary} onPress={fitActiveRide} activeOpacity={0.9}>
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
        {request ? (
          <>
            <View style={styles.cardHandle} />

            <View style={styles.cardRow}>
              {request.stop?.name ? (
                <Text style={styles.cardStopName}>{request.stop.name}</Text>
              ) : null}
              <View style={[
                styles.cardBadge,
                request.status === 'completed'
                  ? styles.cardBadgeDone
                  : request.status === 'cancelled'
                    ? styles.cardBadgeExpired
                    : styles.cardBadgeActive,
              ]}>
                <Text style={styles.cardBadgeText}>
                  {request.status === 'cancelled' && request.cancelledReason === 'ttl_expired_15m'
                    ? 'Expired'
                    : request.status === 'completed'
                      ? 'Completed'
                      : 'Active'}
                </Text>
              </View>
            </View>

            <Text style={styles.cardSubtitle}>
              {request.status === 'cancelled' && request.cancelledReason === 'ttl_expired_15m'
                ? 'Your request timed out after 15 minutes.'
                : request.status === 'completed'
                  ? 'The bus has passed your stop.'
                  : 'Your stop is confirmed. The bus will pick you up.'}
            </Text>

            {(eta || stopsBefore !== null) && (
              <View style={styles.cardInfoRow}>
                {eta ? <Text style={styles.etaText}>{eta} away</Text> : null}
                {eta && stopsBefore !== null ? <Text style={styles.cardInfoDot}> · </Text> : null}
                {stopsBefore !== null ? (
                  <Text style={styles.cardInfoMeta}>{stopsBefore} stop{stopsBefore !== 1 ? 's' : ''} before you</Text>
                ) : null}
              </View>
            )}

            {request.studentUid === studentUid && request.status === 'pending' && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={async () => {
                  if (!requestId) return;

                  await updateDoc(doc(db, 'orgs', orgId ?? '', 'stopRequests', requestId), { status: 'cancelled' });

                  setRequest(null);
                  setRequestId(null);
                  setRouteCoords([]);
                  fullRouteRef.current = [];
                  setEta(null);
                  setStopsBefore(null);
                  showAlert('Stop request canceled.');
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
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 100,
  },
  tipContainer: { position: 'absolute', left: 20, right: 20, zIndex: 90 },
  searchText: { flex: 1, fontSize: 16, color: '#888' },
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
  cardBadgeText: { fontSize: 12, fontWeight: '600', color: '#111' },
  cardTitle: { fontSize: 18, fontWeight: '600', marginBottom: 6 },
  cardSubtitle: { fontSize: 14, color: '#555', marginBottom: 4 },
  cardInfoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 4 },
  etaText: { fontSize: 15, fontWeight: '700', color: PRIMARY_COLOR },
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
  noRideText: { fontSize: 16, color: '#888', textAlign: 'center' },

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
});
