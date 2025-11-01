import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

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
      <ScreenContainer>
        <View style={styles.centerContent}>
          <Text style={styles.warningTitle}>No buses online</Text>
          <Text style={styles.warningText}>
            Please try again in a few moments once a driver is available.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={styles.title}>Request a Stop</Text>
        <Text style={styles.description}>
          Choose your pickup location and we’ll notify the driver instantly.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Pickup location</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={selectedIndex}
            onValueChange={(itemValue) => setSelectedIndex(itemValue)}
            style={styles.picker}
            dropdownIconColor={PRIMARY_COLOR}
          >
            {LOCATIONS.map((loc, index) => (
              <Picker.Item label={loc.name} value={index} key={loc.name} />
            ))}
          </Picker>
        </View>

        <AppButton label="Request Stop" onPress={handleRequest} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.section,
  },
  warningTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: PRIMARY_COLOR,
    marginBottom: 8,
  },
  warningText: {
    fontSize: 16,
    color: '#4b5563',
    textAlign: 'center',
  },
  hero: {
    marginBottom: spacing.section * 1.5,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: PRIMARY_COLOR,
    marginBottom: 6,
  },
  description: {
    fontSize: 15,
    color: '#4b5563',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section * 1.5,
    ...cardShadow,
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2933',
    marginBottom: spacing.section,
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: BACKGROUND_COLOR,
    marginBottom: spacing.section,
  },
  picker: {
    height: 52,
    width: '100%',
  },
});
