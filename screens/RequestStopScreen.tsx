import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';

export const LOCATIONS = [
  { id: 'stop1', name: 'MPCC', latitude: 38.61071, longitude: -89.81481 },
  { id: 'stop2', name: 'PAC', latitude: 38.60790, longitude: -89.81561 },
  { id: 'stop3', name: 'Performance Center', latitude: 38.59875, longitude: -89.82447 },
  { id: 'stop4', name: 'Carnegie Hall', latitude: 38.60699, longitude: -89.81709},
  { id: 'stop5', name: 'McKendree West Clubhouse', latitude: 38.60573, longitude: -89.82468},
];

export default function RequestStopScreen({ navigation }: { navigation: any }) {
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
    const [existing, accepted] = await Promise.all([
      getDocs(
        query(
          collection(db, 'stopRequests'),
          where('studentEmail', '==', auth.currentUser?.email),
          where('status', 'in', ['pending', 'accepted'])
        )
      ),
      getDocs(query(collection(db, 'stopRequests'), where('status', '==', 'accepted'))),
    ]);

    if (!existing.empty) {
      showAlert('You already have a stop in progress.');
      navigation.goBack();
      return;
    }

    if (!accepted.empty) {
      showAlert('A stop has already been requested.');
      navigation.goBack();
      return;
    }

    const selectedStop = LOCATIONS[selectedIndex];

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
      navigation.goBack();
    } catch (err: any) {
      showAlert(err.message, 'Error requesting stop');
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
    <View style={styles.container}>
      <Text style={styles.heading}>Select Stop Location</Text>
      <Picker
        selectedValue={selectedIndex}
        onValueChange={(itemValue) => setSelectedIndex(itemValue)}
        style={styles.picker}
      >
        {LOCATIONS.map((loc, index) => (
          <Picker.Item label={loc.name} value={index} key={loc.name} />
        ))}
      </Picker>
      <TouchableOpacity style={styles.button} onPress={handleRequest}>
        <Text style={styles.buttonText}>Request Stop</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: BACKGROUND_COLOR,
  },
  warningText: { fontSize: 16, color: 'red', textAlign: 'center' },
  container: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
    padding: 20,
  },
  heading: {
    fontSize: 16,
    marginBottom: 10,
    color: '#333',
  },
  picker: { marginBottom: 20 },
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
