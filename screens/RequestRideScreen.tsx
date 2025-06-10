import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { Picker } from '@react-native-picker/picker';
import { collection, addDoc, serverTimestamp, doc, onSnapshot, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR } from '../src/constants/theme';

export const LOCATIONS = [
  { id: 'stop1', name: 'MPCC', latitude: 38.61071, longitude: -89.81481 },
  { id: 'stop2', name: 'PAC', latitude: 38.60790, longitude: -89.81561 },
  { id: 'stop3', name: 'Performance Center', latitude: 38.59875, longitude: -89.82447 },
  { id: 'stop4', name: 'Carnegie Hall', latitude: 38.60699, longitude: -89.81709},
  { id: 'stop5', name: 'McKendree West Clubhouse', latitude: 38.60573, longitude: -89.82468},
];

export default function RequestRideScreen({ navigation }: { navigation: any }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busOnline, setBusOnline] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'buses'), (snapshot) => {
      let anyBusOnline = false;

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const lastUpdated = new Date(data.timestamp?.toDate?.() || data.timestamp);
        const now = new Date();
        const secondsAgo = (now.getTime() - lastUpdated.getTime()) / 1000;

        if (secondsAgo < 15) {
          anyBusOnline = true;
        }
      });

      setBusOnline(anyBusOnline);
    });

    return () => unsub();
  }, []);

  const handleRequest = async () => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    showAlert('Permission denied for location');
    return;
  }

  const existing = await getDocs(query(
    collection(db, 'rideRequests'),
    where('studentEmail', '==', auth.currentUser?.email),
    where('status', 'in', ['pending', 'accepted', 'in-transit'])
  ));

  if (!existing.empty) {
    showAlert('You already have a ride in progress.');
    return;
  }

  const location = await Location.getCurrentPositionAsync({});
  const selectedDropoff = LOCATIONS[selectedIndex];

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

    showAlert('Ride requested successfully!');
    navigation.goBack();
  } catch (err: any) {
    showAlert(err.message, 'Error requesting ride');
  }
};

  if (!busOnline) {
    return (
      <View style={styles.center}>
        <Text style={styles.warningText}>
          No buses are currently online. Please try again later.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ padding: 20 }}>
      <Text>Select Drop-off Location</Text>
      <Picker
        selectedValue={selectedIndex}
        onValueChange={(itemValue) => setSelectedIndex(itemValue)}
        style={{ marginBottom: 20 }}
      >
        {LOCATIONS.map((loc, index) => (
          <Picker.Item label={loc.name} value={index} key={loc.name} />
        ))}
      </Picker>
      <TouchableOpacity style={styles.button} onPress={handleRequest}>
        <Text style={styles.buttonText}>Request Ride</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  warningText: { fontSize: 16, color: 'red', textAlign: 'center' },
  button: {
    backgroundColor: PRIMARY_COLOR,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
});