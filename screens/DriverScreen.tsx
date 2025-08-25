
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
  deleteDoc,
  updateDoc,
  serverTimestamp,
  addDoc
} from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';
import MapMarker from '../components/MapMarker';
import { LOCATIONS } from './RequestStopScreen';
import { fetchDirections } from '../src/utils/directions';

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

  // 2) Current stop request assigned to this driver
  const [request, setRequest] = useState<any>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);

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

  // 5) Slide-up bottom card when a request is active
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [cardHeight, setCardHeight] = useState(300);

  // Boarding count card state
  const [boardingCount, setBoardingCount] = useState(0);
  const [showBoardingCard, setShowBoardingCard] = useState(false);
  const boardingSlideAnim = useRef(new Animated.Value(0)).current;
  const [boardingCardHeight, setBoardingCardHeight] = useState(200);
  const [completeAfterSave, setCompleteAfterSave] = useState(false);

  // 6) “Bus online” flag (true if we see a fresh bus doc <10s old)
  const [busOnline, setBusOnline] = useState(false);
  const [activeBusIds, setActiveBusIds] = useState<string[]>([]);

  const mapRef = useRef<MapView | null>(null);


  // 7) “Heads-up” flag so we only alert once when near pickup
  const notifiedRef = useRef(false);





  // Bus icon (reuse the same 50×50 PNG you used on student side)
  const busIcon = require('../assets/bus-icon.png');

  // ───────────────────────────────────────────────────────────────────
  // 1) On mount: request location & subscribe to “buses” + “stopRequests”
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

    // (c) Subscribe to stop requests (pending or assigned to this driver)
    unsubRide = onSnapshot(
      query(collection(db, 'stopRequests'), where('status', 'in', ['pending', 'accepted'])),
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...(docSnap.data() as any) });
        });
        setRequests(list);

        // Request already assigned to this driver takes priority
        const current = list.find(
          (r) => r.driverId === driverId && r.status !== 'completed'
        );
        const pending = list.find(
          (r) => r.status === 'pending' && !r.driverId
        );

        const selected = current || pending || null;

        if (selected) {
          setRequest(selected);
          setRequestId(selected.id);
        } else {
          setRequest(null);
          setRequestId(null);
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

  // Update stop request status helper
  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const data: any = { status: newStatus };
      if (newStatus === 'accepted' && driverId) {
        data.driverId = driverId;
      }
      if (newStatus === 'completed') {
        data.completedTimestamp = serverTimestamp();
      }
      await updateDoc(doc(db, 'stopRequests', id), data);
    } catch (err: any) {
      showAlert(err.message, 'Error');
    }
  };

  // Save boarding count to database
  const saveBoardingCount = async () => {
    if (!driverId) return;
    const loc = lastCoords.current[driverId];
    if (!loc) {
      showAlert('Driver location unavailable');
      return;
    }
    const nearest = getNearestStop(loc.latitude, loc.longitude);
    try {
      await addDoc(collection(db, 'boardingCounts'), {
        driverId,
        count: boardingCount,
        stop: {
          id: nearest.id,
          name: nearest.name,
          latitude: nearest.latitude,
          longitude: nearest.longitude,
        },
        requestId: requestId || null,
        studentEmail: request?.studentEmail || null,
        timestamp: serverTimestamp(),
      });
      if (completeAfterSave && request && requestId && request.status === 'accepted') {
        await updateStatus(requestId, 'completed');
      }
      showAlert('Boarding saved');
    } catch (err: any) {
      showAlert(err.message, 'Error saving boarding');
    }
    setBoardingCount(0);
    setShowBoardingCard(false);
    setCompleteAfterSave(false);
  };

  // ───────────────────────────────────────────────────────────────────
  // 2) Fetch route & ETA whenever request or driver location updates
  // ───────────────────────────────────────────────────────────────────
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
  }, [driverId, request?.status, driverOnline, busLocations[driverId ?? '']]);

  // Gradually remove visited points from the route polyline
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

  // ───────────────────────────────────────────────────────────────────
  // 3) Schedule local notifications for accepted/completed
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (request?.status === 'accepted') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Stop Accepted 🚌',
          body: 'Navigate to the requested stop.',
        },
        trigger: null,
      });
    } else if (request?.status === 'completed') {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Stop Completed ✅',
          body: 'You have serviced the stop.',
        },
        trigger: null,
      });
    }
  }, [request?.status]);

  // ───────────────────────────────────────────────────────────────────
  // 4) Alert driver when within ~50m of stop
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
        request.stop.longitude
      );
      if (dist < 50) {
        showAlert('You are within 50 meters of the stop.', 'Almost There!');
        notifiedRef.current = true;
      }
    }
  }, [request, driverId, activeBusIds]);

  // ───────────────────────────────────────────────────────────────────
  // 5) Animate bottom status card in/out
  // ───────────────────────────────────────────────────────────────────
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

  // Animate boarding count card
  useEffect(() => {
    if (showBoardingCard) {
      Animated.timing(boardingSlideAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(boardingSlideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [showBoardingCard]);

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

  const shareTranslateY = Animated.add(
    slideAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -cardHeight + 8],
    }),
    boardingSlideAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -boardingCardHeight + 8],
    })
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {/* ───── Bottom-Right “Start/Stop Sharing” Button ───── */}

      {(request?.status !== 'accepted') && (

        <Animated.View
          style={[
            styles.bottomRightButtonContainer,
            {
              transform: [{ translateY: shareTranslateY }],
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

      {/* ───── Bottom-Left “Add Students” Button ───── */}
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

      {/* ───── Banner if no fresh driver location ───── */}
      {!driverOnline && (
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
        {activeBusIds.map((id) => {
          const loc = busLocations[id];
          if (!loc) return null;
          return (
            <MarkerAnimated
              key={id}
              coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
              flat
              rotation={loc.heading}
              anchor={{ x: 0.5, y: .5 }}
            >
              <Image source={busIcon} style={{ width: 120, height: 120 }} resizeMode="contain" />
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
          <Polyline
            coordinates={routeCoords}
            strokeWidth={4}
            strokeColor={PRIMARY_COLOR}
          />
        )}
      </MapView>

      {/* ───── Bottom Card: Ride Info + Cancel ───── */}
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
              {request.status === 'accepted'
                ? 'Navigate to Stop'
                : 'Awaiting Acceptance'}
            </Text>
            {eta && request.status !== 'pending' && (
              <Text style={styles.etaText}>ETA: {eta}</Text>
            )}

            {request.status === 'pending' && !request.driverId && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => requestId && updateStatus(requestId, 'accepted')}
              >
                <Text style={styles.cancelButtonText}>Accept Stop</Text>
              </TouchableOpacity>
            )}

            {request.status === 'accepted' && request.driverId === driverId && (
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
                      await deleteDoc(doc(db, 'stopRequests', requestId));
                      setRequest(null);
                      setRequestId(null);
                      setRouteCoords([]);
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

      {/* ───── Boarding Count Card ───── */}
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
            <TouchableOpacity
              style={styles.counterButton}
              onPress={() => setBoardingCount(boardingCount + 1)}
            >
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

  bottomLeftButtonContainer: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    zIndex: 500,
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
  counterButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
  countText: {
    fontSize: 24,
    marginHorizontal: 20,
    fontWeight: '500',
  },
});
