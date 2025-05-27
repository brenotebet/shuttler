import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import { db } from '../firebase/firebaseconfig';
import { doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { useLocationSharing } from '../location/LocationContext';
import { GOOGLE_MAPS_API_KEY } from '../config';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
const polyline = require('@mapbox/polyline');

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'DriverScreen'>;
};

export default function DriverScreen({ navigation }: Props) {
  const { isSharing, startSharing, stopSharing } = useLocationSharing();
  const [ride, setRide] = useState<any>(null);
  const [eta, setEta] = useState<string | null>(null);

  useEffect(() => {
    const rideQuery = query(
      collection(db, 'rideRequests'),
      where('status', 'in', ['accepted', 'in-transit'])
    );

    const unsub = onSnapshot(rideQuery, (snapshot) => {
      if (!snapshot.empty) {
        setRide(snapshot.docs[0].data());
      } else {
        setRide(null);
        setEta(null);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const fetchETA = async () => {
      if (!ride) return;

      const loc = await Location.getCurrentPositionAsync({});
      const origin = `${loc.coords.latitude},${loc.coords.longitude}`;
      let destination = '';

      if (ride.status === 'accepted') {
        destination = `${ride.pickup.latitude},${ride.pickup.longitude}`;
      } else if (ride.status === 'in-transit') {
        destination = `${ride.dropoff.latitude},${ride.dropoff.longitude}`;
      } else {
        return;
      }

      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${GOOGLE_MAPS_API_KEY}`;
      try {
        const res = await fetch(url);
        const json = await res.json();

        if (json.routes?.length) {
          setEta(json.routes[0].legs[0].duration.text);
        }
      } catch (err) {
        console.error('Failed to fetch ETA:', err);
        setEta(null);
      }
    };

    fetchETA();
  }, [ride]);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Driver Control</Text>

      <Button
        title={isSharing ? 'Stop Sharing Location' : 'Start Sharing Location'}
        onPress={isSharing ? stopSharing : startSharing}
      />

      {ride && (
        <View style={styles.statusBox}>
          <Text>Ride Status: {ride.status}</Text>
          <Text>Heading to: {ride.status === 'accepted' ? 'Pickup' : 'Drop-off'}</Text>
          {eta && <Text>ETA: {eta}</Text>}
        </View>
      )}

      {!ride && (
        <Text style={styles.noRide}>No active ride assigned.</Text>
      )}
      <Button title="Go to admin" onPress={() => navigation.navigate('AdminDriver')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  header: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  statusBox: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#eee',
    borderRadius: 10,
  },
  noRide: { marginTop: 20, fontStyle: 'italic' },
});
