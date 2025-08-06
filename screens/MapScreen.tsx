// src/screens/MapScreen.tsx

import React, { useEffect, useRef, useState } from 'react';
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
  Platform,
  Dimensions,
} from 'react-native';
import MapView, {
  PROVIDER_GOOGLE,
  MarkerAnimated,
  AnimatedRegion,
  Polygon,
  Polyline,
  Region,
  Marker,
} from 'react-native-maps';
import MapMarker from '../components/MapMarker';
import {
  campusCoords,
  outerRing,
  grayscaleMapStyle,
  MAX_LAT_DELTA,
  MAX_LON_DELTA,
} from '../src/constants/mapConfig';
import {
  PRIMARY_COLOR,
  BACKGROUND_COLOR,
} from '../src/constants/theme';
import * as Location from 'expo-location';
import {
  BottomTabNavigationProp,
} from '@react-navigation/bottom-tabs';
import {
  CompositeNavigationProp,
  useNavigation,
} from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StudentTabParamList } from '../tabs/StudentTabs';
import { RootStackParamList } from '../navigation/StackNavigator';
import {
  collection,
  query,
  where,
  onSnapshot,
  deleteDoc,
  addDoc,
  serverTimestamp,
  getDocs,
  doc,
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { showAlert } from '../src/utils/alerts';
import { fetchDirections } from '../src/utils/directions';

const SIDEBAR_WIDTH = 220;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LOCATIONS = [
  { id: 'stop1', name: 'MPCC', latitude: 38.61071, longitude: -89.81481 },
  { id: 'stop2', name: 'PAC', latitude: 38.6079, longitude: -89.81561 },
  { id: 'stop3', name: 'Performance Center', latitude: 38.59875, longitude: -89.82447 },
  { id: 'stop4', name: 'Carnegie Hall', latitude: 38.60699, longitude: -89.81709 },
  { id: 'stop5', name: 'McKendree West Clubhouse', latitude: 38.60573, longitude: -89.82468 },
];


function computeBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
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

export default function MapScreen() {
  const navigation = useNavigation<
    CompositeNavigationProp<
      BottomTabNavigationProp<StudentTabParamList, 'Map'>,
      NativeStackNavigationProp<RootStackParamList>
    >
  >();
  const [region, setRegion] = useState<Region | null>(null);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);
  const [request, setRequest] = useState<any>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [eta, setEta] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [busOnline, setBusOnline] = useState<boolean>(false);
  const [busLocations, setBusLocations] = useState<{
    [id: string]: { latitude: number; longitude: number; heading: number };
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


  // Animate bottom card
  const slideAnim = useRef(new Animated.Value(0)).current;



  // Bus icon
  const busIcon = require('../assets/bus-icon.png');

  // 1) Initialize map & subscribe to Firestore
  useEffect(() => {
    let unsubBus: () => void;
    let unsubRide: () => void;

    // Center map on user
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission denied');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    })();

    // Subscribe to live buses
    unsubBus = onSnapshot(collection(db, 'buses'), (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) {
        return;
      }
      const recentBuses = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const timestamp = data.timestamp?.toDate?.() || new Date(data.timestamp);
          return {
            id: docSnap.id,
            latitude: data.latitude as number,
            longitude: data.longitude as number,
            timestamp,
          };
        })
        .filter((bus) => {
          const secondsAgo = (Date.now() - bus.timestamp.getTime()) / 1000;
          return secondsAgo < 10;
        });

      setBusOnline(recentBuses.length > 0);

      const newLocations: {
        [id: string]: { latitude: number; longitude: number; heading: number };
      } = {};

      recentBuses.forEach((bus) => {
        const { id, latitude, longitude } = bus;

        const prev = lastCoords.current[id];
        if (prev) {
          const raw = computeBearing(
            prev.latitude,
            prev.longitude,
            latitude,
            longitude
          );
          headings.current[id] = quantizeBearing(raw);
        } else {
          headings.current[id] = 0;
        }

        lastCoords.current[id] = { latitude, longitude };
        newLocations[id] = {
          latitude,
          longitude,
          heading: headings.current[id],
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
              toValue: {
                latitude,
                longitude,
                latitudeDelta: 0,
                longitudeDelta: 0,
              } as any,
              duration: 2900,
              useNativeDriver: false,
            } as any)
            .start();
        }
      });

      setBusLocations(newLocations);

      const recentIds = recentBuses.map((b) => b.id);
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
    });

    // Subscribe to this student's stopRequests
    unsubRide = onSnapshot(
      query(
        collection(db, 'stopRequests'),
        where('studentEmail', '==', auth.currentUser?.email),
        where('status', 'in', ['pending', 'accepted'])
      ),
      (snapshot) => {
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          const data = docSnap.data();
          setRequest(data);
          setRequestId(docSnap.id);
          setDriverId(data.driverId || null);
        } else {
          setRequest(null);
          setRequestId(null);
          setRouteCoords([]);
          setEta(null);
          setDriverId(null);
        }
      }
    );

    return () => {
      if (unsubBus) unsubBus();
      if (unsubRide) unsubRide();
    };
  }, []);

  // 2) Fetch route + ETA whenever request or bus updates
  const fetchRoute = async () => {
    if (!request || !driverId) {
      setRouteCoords([]);
      setEta(null);
      return;
    }
    const assigned = lastCoords.current[driverId];
    if (!assigned) {
      setRouteCoords([]);
      setEta(null);
      return;
    }

    let destination: { latitude: number; longitude: number };
    if (request.status === 'accepted') {
      destination = request.stop;
    } else {
      setRouteCoords([]);
      setEta(null);
      return;
    }

    try {
      const { coords, eta } = await fetchDirections(assigned, destination);
      setRouteCoords(coords);
      setEta(eta);
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
    if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
    fetchTimeout.current = setTimeout(fetchRoute, 2000);
    return () => {
      if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
    };
  }, [driverId, request?.status, driverOnline, busLocations[driverId ?? '']]);

  // Shorten the displayed route as the driver progresses along it
  useEffect(() => {
    if (!driverId) return;
    const loc = busLocations[driverId];
    if (!loc || routeCoords.length === 0) return;

    let idx = 0;
    while (
      idx < routeCoords.length &&
      getDistanceInMeters(
        loc.latitude,
        loc.longitude,
        routeCoords[idx].latitude,
        routeCoords[idx].longitude
      ) < 30
    ) {
      idx++;
    }
    if (idx > 0) {
      setRouteCoords(routeCoords.slice(idx));
    }
  }, [busLocations[driverId ?? ''], routeCoords, driverId]);

  // 3) Schedule notifications on stop request status change
  useEffect(() => {
    if (request?.status === 'accepted') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Your stop has been accepted! 🎉',
          body: 'A bus is on the way to you.',
        },
        trigger: null,
      });
    } else if (request?.status === 'completed') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Bus has arrived!',
          body: 'Your stop request has been completed.',
        },
        trigger: null,
      });
    }
  }, [request?.status]);

  // 4) Alert when bus is near pickup
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
        request.stop.longitude
      );
      if (dist < 50) {
        showAlert('The bus is arriving at your pickup location!', 'Heads up!');
        notifiedRef.current = true;
      }
    }
  }, [request, driverId, activeBusIds]);

  // 5) Auto‐switch tabs when request status changes
  useEffect(() => {
    if (request?.status === 'completed') {
      navigation.navigate('StudentHistory');
    }
  }, [request?.status, navigation]);

  // 6) Animate bottom card in/out
  useEffect(() => {
    if (request) {
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [request]);

  // Animate sidebar in/out when a bus is selected
  useEffect(() => {
    Animated.timing(sidebarAnim, {
      toValue: selectedBusId ? 0 : SIDEBAR_WIDTH,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [selectedBusId]);

  const handleBusPress = async (id: string) => {
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
        { latitude: userLoc.coords.latitude, longitude: userLoc.coords.longitude }
      );
      setBusEta(e);
    } catch (err) {
      console.error('Failed to fetch ETA', err);
      setBusEta(null);
    }

    let nearestIdx = 0;
    let minDist = Number.MAX_VALUE;
    LOCATIONS.forEach((stop, idx) => {
      const d = getDistanceInMeters(
        loc.latitude,
        loc.longitude,
        stop.latitude,
        stop.longitude
      );
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

    mapRef.current?.animateToRegion(
      {
        latitude: loc.latitude,
        longitude: loc.longitude + lonOffset,
        latitudeDelta: latDelta,
        longitudeDelta: lonDelta,
      },
      500,
    );
  };

  // Handle "Request Stop"
  const handleRequest = async (index: number) => {
    if (!busOnline) {
      showAlert('No buses are currently online. Please try again later.');
      return;
    }
    const existing = await getDocs(
      query(
        collection(db, 'stopRequests'),
        where('studentEmail', '==', auth.currentUser?.email),
        where('status', 'in', ['pending', 'accepted'])
      )
    );
    if (!existing.empty) {
      showAlert('You already have a stop in progress.');
      return;
    }
    const selectedStop = LOCATIONS[index];
    try {
      await addDoc(collection(db, 'stopRequests'), {
        studentEmail: auth.currentUser?.email,
        stop: {
          latitude: selectedStop.latitude,
          longitude: selectedStop.longitude,
          name: selectedStop.name,
        },
        status: 'pending',
        timestamp: serverTimestamp(),
      });
      showAlert('Stop requested successfully!');
      setShowLocationList(false);
      setSelectedStopIndex(null);
    } catch (err: any) {
      showAlert(err.message, 'Error requesting stop');
    }
  };

  if (!region) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_COLOR }}>
      {/* Floating Search Bar */}
      {!selectedBusId && (
        <TouchableOpacity
          style={styles.searchContainer}
          onPress={() => setShowLocationList((prev) => !prev)}
          activeOpacity={0.8}
        >
          <Text style={styles.searchText}>
            {selectedStopIndex === null
              ? 'Where to?'
              : LOCATIONS[selectedStopIndex].name}
          </Text>
          <Icon name="keyboard-arrow-down" size={24} color="#888" />
        </TouchableOpacity>
      )}

      {/* Drop-off Options List */}
      {showLocationList && !selectedBusId && (
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

      {/* Map */}
      {region ? (
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
          onRegionChangeComplete={(newRegion) => {
            const latMin = 38.59678;
            const latMax = 38.61775;
            const lonMin = -89.82802;
            const lonMax = -89.79585;

            const clampedRegion = {
              latitude: Math.min(Math.max(newRegion.latitude, latMin), latMax),
              longitude: Math.min(Math.max(newRegion.longitude, lonMin), lonMax),
              latitudeDelta: Math.min(newRegion.latitudeDelta, MAX_LAT_DELTA),
              longitudeDelta: Math.min(newRegion.longitudeDelta, MAX_LON_DELTA),
            };

            const needsAdjustment =
              clampedRegion.latitude !== newRegion.latitude ||
              clampedRegion.longitude !== newRegion.longitude ||
              clampedRegion.latitudeDelta !== newRegion.latitudeDelta ||
              clampedRegion.longitudeDelta !== newRegion.longitudeDelta;

            setRegion(clampedRegion);

            if (needsAdjustment) {
              mapRef.current?.animateToRegion(clampedRegion, 300);
            }
          }}
        >
          {}
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

          {/* Animated Bus Markers */}
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
                  style={{ width: 120, height: 120 }}
                  resizeMode="contain"
                />
              </MarkerAnimated>
            );
          })}

          {/* Requested Stop Marker */}
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

          {/* Route Polyline */}
          {routeCoords.length > 0 && (
            <Polyline
              coordinates={routeCoords}
              strokeWidth={4}
              strokeColor={PRIMARY_COLOR}
            />
          )}
        </MapView>
      ) : (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={PRIMARY_COLOR} />
        </View>
      )}

      {selectedBusId && (
        <TouchableWithoutFeedback onPress={() => setSelectedBusId(null)}>
          <View style={styles.transparentOverlay} />
        </TouchableWithoutFeedback>
      )}

      {/* Bus Info Sidebar */}
      <Animated.View
        pointerEvents={selectedBusId ? 'auto' : 'none'}
        style={[
          styles.sidebar,
          { transform: [{ translateX: sidebarAnim }], display: selectedBusId ? 'flex' : 'none' },
        ]}
      >
        <Text style={styles.sidebarTitle}>
          {`Bogey Bus ${selectedBusId ?? ''}`.trim()}
        </Text>
        {busEta && <Text style={styles.sidebarText}>ETA to you: {busEta}</Text>}
        {nextStop && <Text style={styles.sidebarText}>Next stop: {nextStop}</Text>}
      </Animated.View>

      {/* Bottom Card / Ride Info */}
      <Animated.View
        style={[
          styles.bottomCard,
          {
            transform: [
              {
                translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [300, 0],
                }),
              },
            ],
            opacity: slideAnim,
          },
        ]}
      >
        {request ? (
          <>
            <Text style={styles.cardTitle}>Stop Status: {request.status}</Text>
            <Text style={styles.cardSubtitle}>
              {request.status === 'accepted' ? 'Bus is on the way' : 'Waiting'}
            </Text>
            {eta && <Text style={styles.etaText}>ETA: {eta}</Text>}
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={async () => {
                if (requestId) {
                  await deleteDoc(doc(db, 'stopRequests', requestId));
                  setRequest(null);
                  setRequestId(null);
                  setRouteCoords([]);
                  setEta(null);
                  showAlert('Stop request canceled.');
                }
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel Request</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.noRideText}>No active stop</Text>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

function getDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
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
  map: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  searchText: {
    flex: 1,
    fontSize: 16,
    color: '#888',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 99,
  },
  transparentOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 99,
  },
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
  locationText: {
    fontSize: 16,
    color: '#333',
  },
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
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
  },
  etaText: {
    fontSize: 14,
    fontWeight: '500',
    color: PRIMARY_COLOR,
    marginBottom: 12,
  },
  cancelButton: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  noRideText: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
  },
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
    borderBottomRightRadius: 20,
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
  sidebarText: {
    fontSize: 16,
    marginBottom: 8,
    color: '#fff',
  },
});
