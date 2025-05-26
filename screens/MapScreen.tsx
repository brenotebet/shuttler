import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Button } from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { db, auth } from '../firebase/firebaseconfig';
import { doc, collection, query, where, onSnapshot, deleteDoc } from 'firebase/firestore';
const polyline = require('@mapbox/polyline');
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import { GOOGLE_MAPS_API_KEY } from '../config';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Map'>;
};

export default function MapScreen({ navigation }: Props) {
  const [region, setRegion] = useState<Region | null>(null);
  const [busLocation, setBusLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [ride, setRide] = useState<any>(null);
  const [rideId, setRideId] = useState<string | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [eta, setEta] = useState<string | null>(null);

  useEffect(() => {
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
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    })();

    const unsubBus = onSnapshot(doc(db, 'buses', 'busA'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setBusLocation({ latitude: data.latitude, longitude: data.longitude });
      }
    });

    const rideQuery = query(
      collection(db, 'rideRequests'),
      where('studentEmail', '==', auth.currentUser?.email),
      where('status', 'in', ['pending', 'accepted', 'in-transit'])
    );

    const unsubRide = onSnapshot(rideQuery, (snapshot) => {
      if (!snapshot.empty) {
        const docSnap = snapshot.docs[0];
        setRide(docSnap.data());
        setRideId(docSnap.id);
      } else {
        setRide(null);
        setRideId(null);
        setRouteCoords([]);
        setEta(null);
      }
    });

    return () => {
      unsubBus();
      unsubRide();
    };
  }, []);

  useEffect(() => {
    const fetchRoute = async () => {
      if (!ride || !busLocation) {
        setRouteCoords([]);
        setEta(null);
        return;
      }

      let origin = '';
      let destination = '';

      if (ride.status === 'accepted') {
        origin = `${busLocation.latitude},${busLocation.longitude}`;
        destination = `${ride.pickup.latitude},${ride.pickup.longitude}`;
      } else if (ride.status === 'in-transit') {
        origin = `${ride.pickup.latitude},${ride.pickup.longitude}`;
        destination = `${ride.dropoff.latitude},${ride.dropoff.longitude}`;
      } else {
        setRouteCoords([]);
        setEta(null);
        return;
      }

      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${GOOGLE_MAPS_API_KEY}`;
      try {
        const res = await fetch(url);
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

    fetchRoute();
  }, [ride, busLocation]);

  if (!region) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView style={styles.map} region={region} showsUserLocation>
        {busLocation && (
          <Marker coordinate={busLocation} title="Bus A" pinColor="blue" />
        )}
        {ride?.pickup && (
          <Marker coordinate={ride.pickup} title="Pickup Location" pinColor="green" />
        )}
        {ride?.dropoff && (
          <Marker coordinate={ride.dropoff} title={`Drop-off: ${ride.dropoff.name}`} pinColor="red" />
        )}
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor="purple" />
        )}
      </MapView>

      {ride && (
        <View style={styles.statusBox}>
          <Text>Ride Status: {ride.status}</Text>
          <Text>Drop-off: {ride.dropoff?.name}</Text>
          {eta && <Text>ETA: {eta}</Text>}
          <Button
            title="Cancel Ride"
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
          />
        </View>
      )}

      {!ride && (
        <Button title="Go to request" onPress={() => navigation.navigate('RequestRide')} />
      )}

      <Button title="Go to admin" onPress={() => navigation.navigate('AdminDriver')} />
      <Button title="Go to driver" onPress={() => navigation.navigate('DriverScreen')} />
    </View>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  statusBox: {
    padding: 10,
    backgroundColor: '#fff',
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    borderRadius: 10,
    elevation: 4,
  },
});