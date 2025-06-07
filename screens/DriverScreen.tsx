
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
} from 'react-native';
import MapView, {
  PROVIDER_GOOGLE,
  MarkerAnimated,
  AnimatedRegion,
  Polygon,
  Polyline,
  Region,
  MapStyleElement,
  Marker,
} from 'react-native-maps';
import * as Location from 'expo-location';
import { useLocationSharing } from '../location/LocationContext';
import { useDriver } from '../drivercontext/DriverContext';
import {
  collection,
  query,
  where,
  onSnapshot,
  runTransaction,
  doc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { GOOGLE_MAPS_API_KEY } from '../config';

const polyline = require('@mapbox/polyline');

export default function DriverScreen() {
  const { isSharing, startSharing, stopSharing } = useLocationSharing();
  const { driverId } = useDriver();

  // 1) Map region
  const [region, setRegion] = useState<Region | null>(null);

  // 2) Current ride assigned to this driver
  const [ride, setRide] = useState<any>(null);
  const [rideId, setRideId] = useState<string | null>(null);

  // 3) Route polyline coordinates & ETA string
  const [routeCoords, setRouteCoords] = useState<Array<{ latitude: number; longitude: number }>>(
    []
  );
  const [eta, setEta] = useState<string | null>(null);

  // 4) AnimatedRegion for each bus-ID (should be only this driver)
  const busRegions = useRef<{ [id: string]: AnimatedRegion }>({});
  const lastCoords = useRef<{ [id: string]: { latitude: number; longitude: number } }>({});

  // 5) Slide-up bottom card when a ride is active
  const slideAnim = useRef(new Animated.Value(0)).current;

  // 6) “Bus online” flag (true if we see a fresh bus doc <10s old)
  const [busOnline, setBusOnline] = useState(false);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);


  // 7) “Heads-up” flag so we only alert once when near pickup
  const notifiedRef = useRef(false);

  // Zoom limits (same as student side)
  const MIN_LAT_DELTA = 0.005;
  const MAX_LAT_DELTA = 0.1;
  const MIN_LON_DELTA = 0.005;
  const MAX_LON_DELTA = 0.02;

  // Grayscale map JSON (copy from student side)
  const grayscaleMapStyle: MapStyleElement[] = [
    { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
    {
      featureType: 'administrative.land_parcel',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#bdbdbd' }],
    },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    {
      featureType: 'road.arterial',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#757575' }],
    },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#dadada' }] },
    {
      featureType: 'road.highway',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#616161' }],
    },
    { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
    { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#e5e5e5' }] },
    { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9c9c9' }] },
    {
      featureType: 'water',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#9e9e9e' }],
    },
  ];

  // Campus boundary (same as student)
  const campusCoords = [
    { latitude: 38.59678, longitude: -89.82788 }, // SW
    { latitude: 38.59667, longitude: -89.79585 }, // SE
    { latitude: 38.61627, longitude: -89.80259 }, // NE
    { latitude: 38.61775, longitude: -89.82802 }, // NW
  ];
  const outerRing = [
    { latitude: 90, longitude: -180 },
    { latitude: 90, longitude: 180 },
    { latitude: -90, longitude: 180 },
    { latitude: -90, longitude: -180 },
  ];

  // Bus icon (reuse the same 50×50 PNG you used on student side)
  const busIcon = require('../assets/bus-icon.png');

  // ───────────────────────────────────────────────────────────────────
  // 1) On mount: request location & subscribe to “buses” + “rideRequests”
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let unsubBus: () => void;
    let unsubRide: () => void;

    // (a) Center map on driver’s current position
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

    // (b) Subscribe to “buses” collection for live driver location
    unsubBus = onSnapshot(collection(db, 'buses'), (snapshot) => {
      const recent = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const ts = data.timestamp?.toDate?.() || new Date(data.timestamp);
          return {
            id: docSnap.id,
            latitude: data.latitude as number,
            longitude: data.longitude as number,
            timestamp: ts,
          };
        })
        .filter((bus) => {
          const secondsAgo = (Date.now() - bus.timestamp.getTime()) / 1000;
          return secondsAgo < 10;
        });

      setBusOnline(recent.length > 0);

      recent.forEach((bus) => {
        const { id, latitude, longitude } = bus;
        lastCoords.current[id] = { latitude, longitude };

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
              } as any
            )
            .start();
        }
      });

      setActiveBusIds(recent.map((b) => b.id));
    });

    // (c) Subscribe to this driver’s assigned rideRequests
    unsubRide = onSnapshot(
      query(
        collection(db, 'rideRequests'),
        where('driverId', '==', driverId),
        where('status', 'in', ['accepted', 'in-transit'])
      ),
      (snapshot) => {
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          setRide({ id: docSnap.id, ...(docSnap.data() as any) });
          setRideId(docSnap.id);
        } else {
          setRide(null);
          setRideId(null);
          setRouteCoords([]);
          setEta(null);
          notifiedRef.current = false;
        }
      }
    );

    return () => {
      if (unsubBus) unsubBus();
      if (unsubRide) unsubRide();
    };
  }, [driverId]);

  // ───────────────────────────────────────────────────────────────────
  // 2) Fetch route & ETA whenever “ride” or driver location updates
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
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

      const origin = `${assigned.latitude},${assigned.longitude}`;
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
      } catch (err) {
        console.error('DriverScreen fetchRoute error', err);
        setRouteCoords([]);
        setEta(null);
      }
    };

    fetchRoute();
  }, [ride, activeBusIds]);

  // ───────────────────────────────────────────────────────────────────
  // 3) Schedule local notifications for accepted/in-transit/completed
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (ride?.status === 'accepted') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Assigned a Pickup 🚌',
          body: 'Navigate to student’s pickup location.',
        },
        trigger: null,
      });
    } else if (ride?.status === 'in-transit') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'En Route to Drop-Off 🎉',
          body: 'Drive the student to their destination.',
        },
        trigger: null,
      });
    } else if (ride?.status === 'completed') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Ride Completed ✅',
          body: 'You have completed the trip.',
        },
        trigger: null,
      });
    }
  }, [ride?.status]);

  // ───────────────────────────────────────────────────────────────────
  // 4) Alert driver when within ~50m of pickup
  // ───────────────────────────────────────────────────────────────────
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
        Alert.alert('Almost There!', 'You are within 50 meters of pickup.');
        notifiedRef.current = true;
      }
    }
  }, [ride, driverId, activeBusIds]);

  // ───────────────────────────────────────────────────────────────────
  // 5) Animate bottom status card in/out
  // ───────────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────────
  // Center-map loading state
  // ───────────────────────────────────────────────────────────────────
  if (!region) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#4B2E83" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {/* ───── Top-Right “Start/Stop Sharing” Button ───── */}
      <View style={styles.topRightButtonContainer}>
        <TouchableOpacity
          style={styles.shareButton}
          onPress={async () => {
            if (!driverId) {
              Alert.alert('Driver ID missing');
              return;
            }
            try {
              if (isSharing) {
                await stopSharing();
              } else {
                await startSharing(driverId);
              }
            } catch (err) {
              console.error(err);
              Alert.alert('Error toggling location sharing');
            }
          }}
        >
          <Icon name={isSharing ? 'gps-off' : 'gps-fixed'} size={24} color="#fff" />
          <Text style={styles.shareButtonText}>
            {isSharing ? 'Stop Sharing' : 'Start Sharing'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ───── Banner if no fresh driver location ───── */}
      {!busOnline && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Not sharing location. Tap “Start Sharing” to go online.
          </Text>
        </View>
      )}

      {/* ───── MapView ───── */}
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
        {/* Dim outside campus */}
        <Polygon
          coordinates={outerRing}
          holes={[campusCoords]}
          fillColor="rgba(0,0,0,0.2)"
          strokeWidth={0}
        />
        <Polygon
          coordinates={campusCoords}
          strokeColor="black"
          strokeWidth={2}
          fillColor="transparent"
        />

        {/* Driver’s animated bus marker */}
        {Object.keys(busRegions.current).map((id) => {
          const regionRef = busRegions.current[id];
          return (
            <MarkerAnimated
              key={id}
              coordinate={regionRef as any}
              anchor={{ x: 0.5, y: 1.0 }}
            >
              <Image source={busIcon} style={{ width: 50, height: 50 }} resizeMode="contain" />
            </MarkerAnimated>
          );
        })}

        {/* Pickup marker */}
        {ride?.pickup && (
          <Marker
            coordinate={{
              latitude: ride.pickup.latitude,
              longitude: ride.pickup.longitude,
            }}
            title="Pickup Here"
            pinColor="#4B2E83"
          />
        )}

        {/* Drop-off marker */}
        {ride?.dropoff && (
          <Marker
            coordinate={{
              latitude: ride.dropoff.latitude,
              longitude: ride.dropoff.longitude,
            }}
            title={`Drop-Off: ${ride.dropoff.name}`}
            pinColor="#4B2E83"
          />
        )}

        {/* Route polyline */}
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor="#4B2E83" />
        )}
      </MapView>

      {/* ───── Bottom Card: Ride Info + Cancel ───── */}
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
              {ride.status === 'accepted' ? 'Navigate to Pickup' : 'Dropping Off'}
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
                  Alert.alert('Ride cancelled');
                }
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel Ride</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.noRideText}>No active ride assigned</Text>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

// Haversine distance (meters)
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

  // Top-right share button
  topRightButtonContainer: {
    position: 'absolute',
    bottom: 20,
    right: 10,
    zIndex: 500,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4B2E83',
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

  // Banner if offline
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
