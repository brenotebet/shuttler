// src/screens/MapScreen.tsx

import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Animated,
  Image,
  FlatList,
  TouchableWithoutFeedback,
  Platform,
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
import {
  campusCoords,
  outerRing,
  grayscaleMapStyle,
  MIN_LAT_DELTA,
  MAX_LAT_DELTA,
  MIN_LON_DELTA,
  MAX_LON_DELTA,
} from '../src/constants/mapConfig';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
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
import { GOOGLE_MAPS_API_KEY } from '../config';


const polyline = require('@mapbox/polyline');


type TabParamList = {
  Map: undefined;
  RideHistory: undefined;
};

type NavigationProp = {
  navigate: (screen: keyof TabParamList) => void;
};

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
  const navigation = useNavigation<NavigationProp>();
  const [region, setRegion] = useState<Region | null>(null);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);
  const [ride, setRide] = useState<any>(null);
  const [rideId, setRideId] = useState<string | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [eta, setEta] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [busOnline, setBusOnline] = useState<boolean>(false);
  const [busLocations, setBusLocations] = useState<{
    [id: string]: { latitude: number; longitude: number; heading: number };
  }>({});

  const [showLocationList, setShowLocationList] = useState(false);
  const [selectedDropoffIndex, setSelectedDropoffIndex] = useState<number | null>(null);

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
        Alert.alert('Permission denied');
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

    // Subscribe to this student's rideRequests
    unsubRide = onSnapshot(
      query(
        collection(db, 'rideRequests'),
        where('studentEmail', '==', auth.currentUser?.email),
        where('status', 'in', ['pending', 'accepted', 'in-transit'])
      ),
      (snapshot) => {
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          const rideData = docSnap.data();
          setRide(rideData);
          setRideId(docSnap.id);
          setDriverId(rideData.driverId || null);
        } else {
          setRide(null);
          setRideId(null);
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

  // 2) Fetch route + ETA whenever ride or bus updates
  const fetchRoute = async () => {
      if (!ride || !driverId) {
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
      let origin = `${assigned.latitude},${assigned.longitude}`;
      let destination = '';
      if (ride.status === 'accepted') {
        destination = `${ride.pickup.latitude},${ride.pickup.longitude}`;
      } else if (ride.status === 'in-transit') {
        destination = `${ride.dropoff.latitude},${ride.dropoff.longitude}`;
      } else {
        setRouteCoords([]);
        setEta(null);
        return;
      }
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${GOOGLE_MAPS_API_KEY}`
        );
        const json = await res.json();
        if (json.routes?.length) {
          const route = json.routes[0];
          const points = polyline.decode(route.overview_polyline.points);
          const coords = points.map(([lat, lng]: [number, number]) => ({
            latitude: lat,
            longitude: lng,
          }));
          setRouteCoords(coords);
          setEta(route.legs[0].duration.text);
        }
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
  }, [driverId, ride?.status, driverOnline]);

  // 3) Schedule notifications on ride status change
  useEffect(() => {
    if (ride?.status === 'accepted') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Your ride has been accepted! 🎉',
          body: 'A bus is on the way to pick you up.',
        },
        trigger: null,
      });
    } else if (ride?.status === 'in-transit') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'You are now in transit 🚌',
          body: 'Sit tight! You’re on your way.',
        },
        trigger: null,
      });
    } else if (ride?.status === 'completed') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'You have arrived!',
          body: 'Your ride has been completed.',
        },
        trigger: null,
      });
    }
  }, [ride?.status]);

  // 4) Alert when bus is near pickup
  useEffect(() => {
    if (
      ride?.status === 'accepted' &&
      driverId &&
      ride.pickup &&
      lastCoords.current[driverId] &&
      !notifiedRef.current
    ) {
      const driverLoc = lastCoords.current[driverId];
      const dist = getDistanceInMeters(
        driverLoc.latitude,
        driverLoc.longitude,
        ride.pickup.latitude,
        ride.pickup.longitude
      );
      if (dist < 50) {
        Alert.alert('Heads up!', 'The bus is arriving at your pickup location!');
        notifiedRef.current = true;
      }
    }
  }, [ride, driverId, activeBusIds]);

  // 5) Auto‐switch tabs when ride status changes
  useEffect(() => {
    if (ride?.status === 'accepted') {
      navigation.navigate('Map');
    } else if (ride?.status === 'completed') {
      navigation.navigate('RideHistory');
    }
  }, [ride?.status, navigation]);

  // 6) Animate bottom card in/out
  useEffect(() => {
    if (ride) {
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
  }, [ride]);

  // Handle "Request Ride"
  const handleRequest = async (index: number) => {
    if (!busOnline) {
      Alert.alert('No buses are currently online. Please try again later.');
      return;
    }
    const existing = await getDocs(
      query(
        collection(db, 'rideRequests'),
        where('studentEmail', '==', auth.currentUser?.email),
        where('status', 'in', ['pending', 'accepted', 'in-transit'])
      )
    );
    if (!existing.empty) {
      Alert.alert('You already have a ride in progress.');
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied for location');
      return;
    }
    const location = await Location.getCurrentPositionAsync({});
    const selectedDropoff = LOCATIONS[index];
    try {
      await addDoc(collection(db, 'rideRequests'), {
        studentEmail: auth.currentUser?.email,
        pickup: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        },
        dropoff: {
          latitude: selectedDropoff.latitude,
          longitude: selectedDropoff.longitude,
          name: selectedDropoff.name,
        },
        status: 'pending',
        timestamp: serverTimestamp(),
      });
      Alert.alert('Ride requested successfully!');
      setShowLocationList(false);
      setSelectedDropoffIndex(null);
    } catch (err: any) {
      Alert.alert('Error requesting ride', err.message);
    }
  };

  if (!region) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#4B2E83" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Floating Search Bar */}
      <TouchableOpacity
        style={styles.searchContainer}   // <- no inline top override here
        onPress={() => setShowLocationList((prev) => !prev)}
        activeOpacity={0.8}
      >
        <Text style={styles.searchText}>
          {selectedDropoffIndex === null
            ? 'Where to?'
            : LOCATIONS[selectedDropoffIndex].name}
        </Text>
        <Icon name="keyboard-arrow-down" size={24} color="#888" />
      </TouchableOpacity>

      {/* Drop-off Options List */}
      {showLocationList && (
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
                      setSelectedDropoffIndex(index);
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
      <MapView
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
          let clampedLat = Math.min(Math.max(newRegion.latitude, latMin), latMax);
          let clampedLon = Math.min(
            Math.max(newRegion.longitude, lonMin),
            lonMax
          );
          let clampedLatDelta = Math.min(
            Math.max(newRegion.latitudeDelta, MIN_LAT_DELTA),
            MAX_LAT_DELTA
          );
          let clampedLonDelta = Math.min(
            Math.max(newRegion.longitudeDelta, MIN_LON_DELTA),
            MAX_LON_DELTA
          );
          setRegion({
            latitude: clampedLat,
            longitude: clampedLon,
            latitudeDelta: clampedLatDelta,
            longitudeDelta: clampedLonDelta,
          });
        }}
      >
        {}
        {/* Permanent Stop Markers */}
        {LOCATIONS.map((stop) => (
          <Marker
            key={stop.id}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            title={stop.name}
            pinColor="#4B2E83"
          />
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
            >
              <Image
                source={busIcon}
                style={{ width: 120, height: 120 }}
                resizeMode="contain"
              />
            </MarkerAnimated>
          );
        })}

        {/* Pickup / Drop-off Markers */}
        {ride?.pickup && (
          <MarkerAnimated
            coordinate={{
              latitude: ride.pickup.latitude,
              longitude: ride.pickup.longitude,
            }}
            title="Pickup Location"
            pinColor="#4B2E83"
          />
        )}
        {ride?.dropoff && (
          <MarkerAnimated
            coordinate={{
              latitude: ride.dropoff.latitude,
              longitude: ride.dropoff.longitude,
            }}
            title={`Drop-off: ${ride.dropoff.name}`}
            pinColor="#4B2E83"
          />
        )}

        {/* Route Polyline */}
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor="#4B2E83" />
        )}
      </MapView>

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
        {ride ? (
          <>
            <Text style={styles.cardTitle}>Ride Status: {ride.status}</Text>
            <Text style={styles.cardSubtitle}>
              {ride.status === 'accepted' ? 'Bus is on the way' : 'In transit'}
            </Text>
            {eta && <Text style={styles.etaText}>ETA: {eta}</Text>}
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={async () => {
                if (rideId) {
                  await deleteDoc(doc(db, 'rideRequests', rideId));
                  setRide(null);
                  setRideId(null);
                  setRouteCoords([]);
                  setEta(null);
                  Alert.alert('Ride request cancelled');
                }
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel Ride</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.noRideText}>No active ride</Text>
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
    backgroundColor: '#fff',
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
  locationListContainer: {
    position: 'absolute',
    top: 140,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
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
    backgroundColor: '#fff',
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
    color: '#4B2E83',
    marginBottom: 12,
  },
  cancelButton: {
    backgroundColor: '#4B2E83',
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
});
