
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
  MIN_LAT_DELTA,
  MAX_LAT_DELTA,
  MIN_LON_DELTA,
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
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { GOOGLE_MAPS_API_KEY } from '../config';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR } from '../src/constants/theme';
import MapMarker from '../components/MapMarker';
import { LOCATIONS } from './RequestRideScreen';

const polyline = require('@mapbox/polyline');

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
  const headings = useRef<{ [id: string]: number }>({});
  const [busLocations, setBusLocations] = useState<{
    [id: string]: { latitude: number; longitude: number; heading: number };
  }>({});

  // 5) Slide-up bottom card when a ride is active
  const slideAnim = useRef(new Animated.Value(0)).current;

  // 6) “Bus online” flag (true if we see a fresh bus doc <10s old)
  const [busOnline, setBusOnline] = useState(false);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);

  const mapRef = useRef<MapView | null>(null);


  // 7) “Heads-up” flag so we only alert once when near pickup
  const notifiedRef = useRef(false);





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

    // (b) Subscribe to “buses” collection for live driver location
    unsubBus = onSnapshot(collection(db, 'buses'), (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) {
        return;
      }
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

      const newLocations: {
        [id: string]: { latitude: number; longitude: number; heading: number };
      } = {};

      recent.forEach((bus) => {
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

      setBusLocations(newLocations);

      const recentIds = recent.map((b) => b.id);
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

    // (c) Subscribe to ride requests (pending or assigned to this driver)
    unsubRide = onSnapshot(
      query(collection(db, 'rideRequests'), where('status', 'in', ['pending', 'accepted', 'in-transit'])),
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...(docSnap.data() as any) });
        });

        // Ride already assigned to this driver takes priority
        const current = list.find(
          (r) => r.driverId === driverId && r.status !== 'completed'
        );
        const pending = list.find(
          (r) => r.status === 'pending' && !r.driverId
        );

        const selected = current || pending || null;

        if (selected) {
          setRide(selected);
          setRideId(selected.id);
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

  // Update ride status helper
  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const data: any = { status: newStatus };
      if (newStatus === 'accepted' && driverId) {
        data.driverId = driverId;
      }
      await updateDoc(doc(db, 'rideRequests', id), data);
    } catch (err: any) {
      showAlert(err.message, 'Error');
    }
  };

  // ───────────────────────────────────────────────────────────────────
  // 2) Fetch route & ETA whenever “ride” or driver location updates
  // ───────────────────────────────────────────────────────────────────
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

  const fetchTimeout = useRef<NodeJS.Timeout | null>(null);
  const driverOnline = activeBusIds.includes(driverId || '');
  useEffect(() => {
    if (!driverId) return;
    if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
    fetchTimeout.current = setTimeout(fetchRoute, 2000);
    return () => {
      if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
    };
  }, [driverId, ride?.status, driverOnline, busLocations[driverId ?? '']]);

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
        showAlert('You are within 50 meters of pickup.', 'Almost There!');
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
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {/* ───── Bottom-Right “Start/Stop Sharing” Button ───── */}

      {(ride?.status !== 'accepted' && ride?.status !== 'in-transit') && (

        <Animated.View
          style={[
            styles.bottomRightButtonContainer,
            {
              transform: [
                {
                  translateY: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -300],
                  }),
                },
              ],
            },
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
                  await startSharing(driverId);
                }
              } catch (err) {
                console.error(err);
                showAlert('Error toggling location sharing');
              }
            }}
          >
            <Icon name={isSharing ? 'gps-off' : 'gps-fixed'} size={24} color="#fff" />
            <Text style={styles.shareButtonText}>
              {isSharing ? 'Stop Sharing' : 'Start Sharing'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}

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
            latitudeDelta: Math.min(
              Math.max(newRegion.latitudeDelta, MIN_LAT_DELTA),
              MAX_LAT_DELTA
            ),
            longitudeDelta: Math.min(
              Math.max(newRegion.longitudeDelta, MIN_LON_DELTA),
              MAX_LON_DELTA
            ),
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
        {activeBusIds.map((id) => {
          const loc = busLocations[id];
          if (!loc) return null;
          return (
            <MarkerAnimated
              key={id}
              coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
              flat
              rotation={loc.heading}
              anchor={{ x: 0.5, y: 1.0 }}
            >
              <Image source={busIcon} style={{ width: 120, height: 120 }} resizeMode="contain" />
            </MarkerAnimated>
          );
        })}

        {LOCATIONS.map((stop) => (
          <Marker
            description= {stop.name}
            key={stop.id}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            anchor={{ x: 0.5, y: 1 }}
            >
          <MapMarker icon="location-on" />
          </Marker>
        ))}

        {/* Pickup marker */}
        {ride?.pickup && (
          <Marker
            coordinate={{
              latitude: ride.pickup.latitude,
              longitude: ride.pickup.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <MapMarker icon="location-on" />
          </Marker>
        )}

        {/* Drop-off marker */}
        {ride?.dropoff && (
          <Marker
            coordinate={{
              latitude: ride.dropoff.latitude,
              longitude: ride.dropoff.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <MapMarker icon="flag" />
          </Marker>
        )}

        {/* Route polyline */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeWidth={4}
            strokeColor={PRIMARY_COLOR}
          />
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
              {ride.status === 'accepted'
                ? 'Navigate to Pickup'
                : ride.status === 'in-transit'
                ? 'Dropping Off'
                : 'Awaiting Acceptance'}
            </Text>
            {eta && ride.status !== 'pending' && (
              <Text style={styles.etaText}>ETA: {eta}</Text>
            )}

            {ride.status === 'pending' && !ride.driverId && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => rideId && updateStatus(rideId, 'accepted')}
              >
                <Text style={styles.cancelButtonText}>Accept Ride</Text>
              </TouchableOpacity>
            )}

            {ride.status === 'accepted' && ride.driverId === driverId && (
              <>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => rideId && updateStatus(rideId, 'in-transit')}
                >
                  <Text style={styles.actionButtonText}>Passenger Picked Up</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={async () => {
                    if (rideId) {
                      await deleteDoc(doc(db, 'rideRequests', rideId));
                      setRide(null);
                      setRideId(null);
                      setRouteCoords([]);
                      setEta(null);
                      showAlert('Ride cancelled');
                    }
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel Ride</Text>
                </TouchableOpacity>
              </>
            )}

            {ride.status === 'in-transit' && ride.driverId === driverId && (
              <>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => rideId && updateStatus(rideId, 'completed')}
                >
                  <Text style={styles.actionButtonText}>Passenger Dropped Off</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={async () => {
                    if (rideId) {
                      await deleteDoc(doc(db, 'rideRequests', rideId));
                      setRide(null);
                      setRideId(null);
                      setRouteCoords([]);
                      setEta(null);
                      showAlert('Ride cancelled');
                    }
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel Ride</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        ) : (
          <Text style={styles.noRideText}>No active requests</Text>
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

  // Bottom-right share button
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
    color: PRIMARY_COLOR,
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
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
});
