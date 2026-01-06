// src/screens/MapScreen.tsx
import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  SafeAreaView,
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
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { showAlert } from '../src/utils/alerts';
import { fetchDirections } from '../src/utils/directions';
import InfoBanner from '../components/InfoBanner';

const SIDEBAR_WIDTH = 220;
const FRESHNESS_WINDOW_SECONDS = 30;
const STALE_WINDOW_SECONDS = 90;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const LOCATIONS = [
  { id: 'stop1', name: 'MPCC', latitude: 38.61071, longitude: -89.81481 },
  { id: 'stop2', name: 'PAC', latitude: 38.6079, longitude: -89.81561 },
  { id: 'stop3', name: 'Performance Center', latitude: 38.59875, longitude: -89.82447 },
  { id: 'stop4', name: 'Carnegie Hall', latitude: 38.60699, longitude: -89.81709 },
  { id: 'stop5', name: 'McKendree West Clubhouse', latitude: 38.60573, longitude: -89.82468 },
];

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

  // Fallback safety
  if (!Number.isFinite(latMin) || !Number.isFinite(latMax) || !Number.isFinite(lonMin) || !Number.isFinite(lonMax)) {
    return { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 };
  }

  return { latMin, latMax, lonMin, lonMax };
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

export default function MapScreen() {
  const navigation = useNavigation<
    CompositeNavigationProp<
      BottomTabNavigationProp<StudentTabParamList, 'Map'>,
      NativeStackNavigationProp<RootStackParamList>
    >
  >();

  const STOPS_BOUNDS = useMemo(() => getStopsBounds(LOCATIONS), []);
  const INITIAL_REGION = useMemo(() => boundsRegion(STOPS_BOUNDS, 0.90), [STOPS_BOUNDS]);

  const [region, setRegion] = useState<Region | null>(null);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);

  const [studentUid, setStudentUid] = useState<string | null>(null);
  const [studentEmail, setStudentEmail] = useState<string | null>(null);

  const [request, setRequest] = useState<any>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [ownRequest, setOwnRequest] = useState<any>(null);

  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [eta, setEta] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
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
  const [busEta, setBusEta] = useState<string | null>(null);
  const [nextStop, setNextStop] = useState<string | null>(null);

  const sidebarAnim = useRef(new Animated.Value(SIDEBAR_WIDTH)).current;
  const mapRef = useRef<MapView | null>(null);

  const notifiedRef = useRef(false);
  const busRegions = useRef<{ [id: string]: AnimatedRegion }>({});
  const lastCoords = useRef<{ [id: string]: { latitude: number; longitude: number } }>({});
  const headings = useRef<{ [id: string]: number }>({});
  const fullRouteRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const didInitialFitRef = useRef(false);
  const lastUserInteractionRef = useRef(0);
  const markUserInteraction = () => {
  lastUserInteractionRef.current = Date.now();
  userInteractingRef.current = true;
};
const recentlyInteracted = (ms = 2000) => Date.now() - lastUserInteractionRef.current < ms;


  const slideAnim = useRef(new Animated.Value(0)).current;

  // ✅ measure bottom card height so buttons can float ABOVE it
  const [bottomCardHeight, setBottomCardHeight] = useState(0);

  // ✅ Camera UX
  const [cameraMode, setCameraMode] = useState<CameraMode>('followUser');
  const userInteractingRef = useRef(false);
  const lastProgrammaticMoveRef = useRef<number>(0);
  const markProgrammaticMove = () => {
    lastProgrammaticMoveRef.current = Date.now();
  };
  const isProgrammaticMove = () => Date.now() - lastProgrammaticMoveRef.current < 1200;

  const busIcon = require('../assets/bus-icon.png');

  const formatLastSeen = (seconds: number) => {
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
  };

  // ✅ Hide “browsing” UI when ride exists (pending/accepted)
  const rideActive = !!request && (request.status === 'pending' || request.status === 'accepted');

  const centerOnUser = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission denied');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
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
          STOPS_BOUNDS,
        ),
        500,
      );
    } catch (e) {
      console.error('centerOnUser error', e);
    }
  };

  const fitStops = () => {
    markProgrammaticMove();
    setCameraMode('followUser');
    const r = INITIAL_REGION;
    mapRef.current?.animateToRegion(r, 550);
    setRegion(r);
  };

  const fitActiveRide = () => {
    if (!request || request.status !== 'accepted' || !driverId || !request.stop) return;

    const d = busLocations[driverId] || lastCoords.current[driverId];
    if (!d) return;

    const points = [
      { latitude: d.latitude, longitude: d.longitude },
      { latitude: request.stop.latitude, longitude: request.stop.longitude },
    ];

    markProgrammaticMove();
    setCameraMode('overview');
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: { top: 120, right: 70, bottom: 320, left: 70 },
      animated: true,
    });
  };

  // ✅ Track auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setStudentUid(u?.uid ?? null);
      setStudentEmail(u?.email ?? null);
    });
    return () => unsub();
  }, []);

  // 1) Init + buses
  useEffect(() => {
    let unsubBus: (() => void) | undefined;
    let locationSub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission denied');
        return;
      }

      // ✅ fitcampus='stops'
      if (!didInitialFitRef.current) {
        didInitialFitRef.current = true;
        setRegion(INITIAL_REGION);
        markProgrammaticMove();
        setTimeout(() => mapRef.current?.animateToRegion(INITIAL_REGION, 450), 10);
      }

      locationSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation },
        () => {},
      );
    })();

    unsubBus = onSnapshot(
      collection(db, 'buses'),
      (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return;

        const buses = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();

            const timestamp =
              data?.updatedAt?.toDate?.() ||
              data?.lastSeen?.toDate?.() ||
              (typeof data?.updatedAt === 'string' ? new Date(data.updatedAt) : null) ||
              (typeof data?.lastSeen === 'string' ? new Date(data.lastSeen) : null) ||
              null;

            if (!timestamp || isNaN(timestamp.getTime())) return null;

            const online = data?.online === true;
            if (!online) return null;

            if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return null;

            return {
              id: docSnap.id,
              latitude: data.latitude as number,
              longitude: data.longitude as number,
              timestamp: timestamp as Date,
              online,
            };
          })
          .filter(Boolean)
          .map((bus: any) => {
            const secondsAgo = (Date.now() - bus.timestamp.getTime()) / 1000;
            return { ...bus, secondsAgo };
          });

        const freshBuses = buses.filter((bus) => bus.secondsAgo < FRESHNESS_WINDOW_SECONDS);
        const visibleBuses = buses.filter((bus) => bus.secondsAgo < STALE_WINDOW_SECONDS);

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
                  toValue: { latitude, longitude, latitudeDelta: 0, longitudeDelta: 0 } as any,
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

    return () => {
      if (unsubBus) unsubBus();
      if (locationSub) locationSub.remove();
    };
  }, [INITIAL_REGION, STOPS_BOUNDS]);

  // 2) subscribe to student's accepted/pending
  useEffect(() => {
    if (!studentUid) {
      setOwnRequest(null);
      return;
    }

    const qAccepted = query(
      collection(db, 'stopRequests'),
      where('studentUid', '==', studentUid),
      where('status', '==', 'accepted'),
      limit(1),
    );

    const qPending = query(
      collection(db, 'stopRequests'),
      where('studentUid', '==', studentUid),
      where('status', '==', 'pending'),
      limit(1),
    );

    const unsubAccepted = onSnapshot(
      qAccepted,
      (snap) => {
        if (!snap.empty) {
          const d = snap.docs[0];
          setOwnRequest({ id: d.id, ...(d.data() as any) });
        } else {
          setOwnRequest((current: any) => (current?.status === 'accepted' ? null : current));
        }
      },
      (err) => console.error('own accepted stopRequests snapshot error', err),
    );

    const unsubPending = onSnapshot(
      qPending,
      (snap) => {
        setOwnRequest((current: any) => {
          if (current?.status === 'accepted') return current;
          if (!snap.empty) {
            const d = snap.docs[0];
            return { id: d.id, ...(d.data() as any) };
          }
          return current?.status === 'pending' ? null : current;
        });
      },
      (err) => console.error('own pending stopRequests snapshot error', err),
    );

    return () => {
      unsubAccepted();
      unsubPending();
    };
  }, [studentUid]);

  // 3) consolidate
  useEffect(() => {
    if (ownRequest) {
      setRequest(ownRequest);
      setRequestId(ownRequest.id);
      setDriverId(ownRequest.driverUid || ownRequest.driverId || null);
      return;
    }

    setRequest(null);
    setRequestId(null);
    setRouteCoords([]);
    fullRouteRef.current = [];
    setEta(null);
    setDriverId(null);
    notifiedRef.current = false;

    // restore browsing UI state
    setSelectedBusId(null);
    setBusEta(null);
    setNextStop(null);
    setShowLocationList(false);
  }, [ownRequest]);

  // 4) route/ETA
  const fetchRoute = async () => {
    if (!request || !driverId) {
      setRouteCoords([]);
      setEta(null);
      return;
    }

    const assigned = busLocations[driverId] || lastCoords.current[driverId];
    if (!assigned) {
      setRouteCoords([]);
      setEta(null);
      return;
    }

    if (request.status !== 'accepted') {
      setRouteCoords([]);
      setEta(null);
      return;
    }

    try {
      const { coords, eta: etaText } = await fetchDirections(assigned, request.stop);
      fullRouteRef.current = coords;
      setRouteCoords(coords);
      setEta(etaText);
    } catch (error) {
      console.error('Failed to fetch route:', error);
      setRouteCoords([]);
      setEta(null);
    }
  };

  const fetchTimeout = useRef<NodeJS.Timeout | null>(null);
  const driverOnline = activeBusIds.includes(driverId || '');

    useEffect(() => {
      if (!driverId) return;
      if (!request || request.status !== 'accepted') return;
      if (!driverOnline) return;

      if (fetchTimeout.current) clearTimeout(fetchTimeout.current);

      const busLoc = busLocations[driverId] || lastCoords.current[driverId];
      if (!busLoc) return;

      const full = fullRouteRef.current;

      // ✅ If we don't have a route yet, fetch it ASAP (this fixes "polyline never draws")
      if (!full || full.length === 0) {
        fetchTimeout.current = setTimeout(() => {
          fetchRoute();
        }, 250);

        return () => {
          if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
        };
      }

      // ✅ Progressive trimming (more stable): advance along route only if we're within ~40m
      // This avoids jumping the polyline to a far "closest point" when the bus is off-route.
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
          // lightweight guard to reduce rerenders
          if (prev.length === trimmed.length) return prev;
          return trimmed;
        });
      }

      // ✅ Periodic refresh to keep ETA and route geometry accurate as bus moves
      fetchTimeout.current = setTimeout(() => {
        fetchRoute();
      }, 1200);

      return () => {
        if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [driverId, request?.status, driverOnline, busLocations[driverId ?? '']]);




  // Auto-fit when accepted
  useEffect(() => {
    if (request?.status !== 'accepted') return;

    // Don’t fight the user if they just moved the map
    if (cameraMode === 'free' || recentlyInteracted(2500)) return;

    fitActiveRide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.status, driverId]);


  // Notifications
  useEffect(() => {
    if (request?.status === 'accepted') {
      Notifications.scheduleNotificationAsync({
        content: { title: 'Your stop has been accepted! 🎉', body: 'A bus is on the way to you.' },
        trigger: null,
      });
    } else if (request?.status === 'completed') {
      Notifications.scheduleNotificationAsync({
        content: { title: 'Bus has arrived!', body: 'Your stop request has been completed.' },
        trigger: null,
      });
    }
  }, [request?.status]);

  // Arrival alert
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
        showAlert('The bus is arriving at your pickup location!', 'Heads up!');
        notifiedRef.current = true;
      }
    }
  }, [request, driverId, activeBusIds]);

  // Auto-switch when completed
  useEffect(() => {
    if (request?.status === 'completed') {
      navigation.navigate('StudentHistory');
    }
  }, [request?.status, navigation]);

  // Animate bottom card
  useEffect(() => {
    if (request) {
      Animated.timing(slideAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [request, slideAnim]);

  // Sidebar animation
  useEffect(() => {
    Animated.timing(sidebarAnim, {
      toValue: selectedBusId ? 0 : SIDEBAR_WIDTH,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [selectedBusId, sidebarAnim]);

  const handleBusPress = async (id: string) => {
    // ✅ buses visible always, but you can still decide whether tapping is allowed during active ride:
    // if (rideActive) return;

    const loc = busLocations[id];
    if (!loc) return;

    setSelectedBusId(id);
    setShowLocationList(false);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setBusEta(null);
        return;
      }
      const userLoc = await Location.getCurrentPositionAsync({});
      const { eta: e } = await fetchDirections(
        { latitude: loc.latitude, longitude: loc.longitude },
        { latitude: userLoc.coords.latitude, longitude: userLoc.coords.longitude },
      );
      setBusEta(e);
    } catch (err) {
      console.error('Failed to fetch ETA', err);
      setBusEta(null);
    }

    let nearestIdx = 0;
    let minDist = Number.MAX_VALUE;
    LOCATIONS.forEach((stop, idx) => {
      const d = getDistanceInMeters(loc.latitude, loc.longitude, stop.latitude, stop.longitude);
      if (d < minDist) {
        minDist = d;
        nearestIdx = idx;
      }
    });

    const nextIdx = (nearestIdx + 1) % LOCATIONS.length;
    setNextStop(LOCATIONS[nextIdx].name);

    const latDelta = region ? region.latitudeDelta / 1.5 : 0.008;
    const lonDelta = region ? region.longitudeDelta / 1.5 : 0.008;
    const lonOffset = (lonDelta * (SIDEBAR_WIDTH / SCREEN_WIDTH)) / 2;

    markProgrammaticMove();
    mapRef.current?.animateToRegion(
      clampToBounds(
        {
          latitude: loc.latitude,
          longitude: loc.longitude + lonOffset,
          latitudeDelta: latDelta,
          longitudeDelta: lonDelta,
        },
        STOPS_BOUNDS,
      ),
      500,
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

    const selectedStop = LOCATIONS[index];

    try {
      const [existing, acceptedForStop] = await Promise.all([
        getDocs(
          query(
            collection(db, 'stopRequests'),
            where('studentUid', '==', studentUid),
            where('status', 'in', ['pending', 'accepted']),
            limit(1),
          ),
        ),
        getDocs(
          query(
            collection(db, 'stopRequests'),
            where('status', '==', 'accepted'),
            where('stopId', '==', selectedStop.id),
            orderBy('createdAt', 'desc'),
            limit(1),
          ),
        ),
      ]);

      if (!existing.empty) {
        showAlert('You already have a stop in progress.');
        setShowLocationList(false);
        setSelectedStopIndex(null);
        return;
      }

      if (!acceptedForStop.empty) {
        const docSnap = acceptedForStop.docs[0];
        const data = { id: docSnap.id, ...(docSnap.data() as any) };

        setOwnRequest(null);
        setRequest(data);
        setRequestId(data.id);
        setDriverId(data.driverUid || data.driverId || null);

        showAlert('A bus is already headed to this stop. Showing the current ride.');
        setShowLocationList(false);
        setSelectedStopIndex(index);
        return;
      }

      const ref = await addDoc(collection(db, 'stopRequests'), {
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
        createdAt: serverTimestamp(),
      });

      console.log('[MapScreen][handleRequest] created stopRequest', ref.id);

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

  if (!region) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
      </SafeAreaView>
    );
  }

  const selectedBus = selectedBusId ? busLocations[selectedBusId] : null;

  // ✅ Buttons float above tabbar + above bottom card when it slides up
  const buttonsBottom = 96 + (request ? Math.min(bottomCardHeight, 260) + 10 : 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_COLOR }}>
      {/* ✅ During active ride, hide dropdown + tips */}
      {!rideActive && !selectedBusId && (
        <TouchableOpacity
          style={styles.searchContainer}
          onPress={() => setShowLocationList((prev) => !prev)}
          activeOpacity={0.8}
        >
          <Text style={styles.searchText}>
            {selectedStopIndex === null ? 'Request a stop' : LOCATIONS[selectedStopIndex].name}
          </Text>
          <Icon name="keyboard-arrow-down" size={24} color="#888" />
        </TouchableOpacity>
      )}

      {!rideActive && !showLocationList && !selectedBusId && (
        <View style={styles.tipContainer}>
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
            <View style={styles.locationListContainer}>
              <FlatList
                data={LOCATIONS}
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
        {/* ✅ Stops markers hidden during active ride */}
        {!rideActive &&
          LOCATIONS.map((stop) => (
            <Marker
              description={stop.name}
              key={stop.id}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              anchor={{ x: 0.5, y: 1 }}
            >
              <MapMarker icon="location-on" />
            </Marker>
          ))}

        {/* ✅ Bus markers ALWAYS visible */}
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
              onPress={() => handleBusPress(id)}
            >
              <Image
                source={busIcon}
                style={{ width: 120, height: 120, opacity: loc.isFresh ? 1 : 0.55 }}
                resizeMode="contain"
              />
            </MarkerAnimated>
          );
        })}

        {/* Ride pickup marker */}
        {request?.stop && (
          <MarkerAnimated
            coordinate={{
              latitude: request.stop.latitude,
              longitude: request.stop.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <MapMarker icon="location-on" />
          </MarkerAnimated>
        )}

        {/* Route */}
        {routeCoords.length > 0 && <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor={PRIMARY_COLOR} />}
      </MapView>

      {/* ✅ Bottom-left controls above tabs AND above the bottom card */}
      <View pointerEvents="box-none" style={[styles.fabWrapBottomLeft, { bottom: buttonsBottom }]}>
        <TouchableOpacity style={styles.fab} onPress={centerOnUser} activeOpacity={0.9}>
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

        {cameraMode === 'free' && (
          <View style={styles.freePanPill}>
            <Text style={styles.freePanText}>Map moved</Text>
            <TouchableOpacity onPress={() => (request?.status === 'accepted' ? fitActiveRide() : fitStops())}>
              <Text style={styles.freePanLink}>{request?.status === 'accepted' ? 'Recenter ride' : 'Recenter'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Sidebar (still allowed; buses always visible) */}
      {selectedBusId && (
        <TouchableWithoutFeedback onPress={() => setSelectedBusId(null)}>
          <View style={styles.transparentOverlay} />
        </TouchableWithoutFeedback>
      )}

      <Animated.View
        pointerEvents={selectedBusId ? 'auto' : 'none'}
        style={[
          styles.sidebar,
          { transform: [{ translateX: sidebarAnim }], display: selectedBusId ? 'flex' : 'none' },
        ]}
      >
        <Text style={styles.sidebarTitle}>{`Bogey Bus ${selectedBusId ?? ''}`.trim()}</Text>
        {busEta && <Text style={styles.sidebarText}>ETA to you: {busEta}</Text>}
        {selectedBus && <Text style={styles.sidebarText}>Last seen: {formatLastSeen(selectedBus.secondsAgo)}</Text>}
        {nextStop && <Text style={styles.sidebarText}>Next stop: {nextStop}</Text>}
      </Animated.View>

      {/* Bottom Card */}
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
            <Text style={styles.cardTitle}>Stop Status: {request.status}</Text>
            <Text style={styles.cardSubtitle}>{request.status === 'accepted' ? 'Bus is on the way' : 'Waiting'}</Text>

            {request.stop?.name && <Text style={styles.cardSubtitle}>Pickup: {request.stop.name}</Text>}
            {eta && <Text style={styles.etaText}>ETA: {eta}</Text>}

            {request.studentUid === studentUid && request.status === 'pending' && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={async () => {
                  if (!requestId) return;

                  await updateDoc(doc(db, 'stopRequests', requestId), { status: 'cancelled' });

                  setRequest(null);
                  setRequestId(null);
                  setRouteCoords([]);
                  fullRouteRef.current = [];
                  setEta(null);
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

  searchContainer: {
    position: 'absolute',
    top: 80,
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
  tipContainer: { position: 'absolute', top: 140, left: 20, right: 20, zIndex: 90 },
  searchText: { flex: 1, fontSize: 16, color: '#888' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 99 },
  transparentOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 99 },
  locationListContainer: {
    position: 'absolute',
    top: 140,
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

  // Bottom-left controls (dynamic bottom set inline)
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

  freePanPill: {
    marginTop: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    maxWidth: 170,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  freePanText: { fontSize: 12, color: '#374151', marginBottom: 2, fontWeight: '600' },
  freePanLink: { fontSize: 12, color: PRIMARY_COLOR, fontWeight: '800' },

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
  cancelButton: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  noRideText: { fontSize: 16, color: '#888', textAlign: 'center' },

  sidebar: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: SIDEBAR_WIDTH,
    bottom: 0,
    backgroundColor: PRIMARY_COLOR,
    padding: 20,
    paddingTop: 50,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 10,
    zIndex: 101,
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
    marginTop: 30,
    color: '#fff',
  },
  sidebarText: { fontSize: 16, marginBottom: 8, color: '#fff' },
});
