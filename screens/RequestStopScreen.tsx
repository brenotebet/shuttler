// src/screens/RequestStopScreen.tsx
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
  orderBy,
  limit,
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import InfoBanner from '../components/InfoBanner';
import { LOCATIONS, STUDENT_REQUEST_TTL_MS, FRESHNESS_WINDOW_SECONDS } from '../src/constants/stops';

export { LOCATIONS };

export default function RequestStopScreen({ navigation }: { navigation: any }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busOnline, setBusOnline] = useState(false);

  // 1) Listen for active buses
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'buses'),
      (snapshot) => {
        let anyBusOnline = false;

        snapshot.forEach((docSnap) => {
          const data: any = docSnap.data();

          if (data?.online !== true) return;

          const updatedAt = data?.updatedAt;
          const lastSeen = data?.lastSeen;

          const lastUpdatedMs: number | null =
            typeof updatedAt?.toMillis === 'function'
              ? updatedAt.toMillis()
              : typeof lastSeen?.toMillis === 'function'
                ? lastSeen.toMillis()
                : typeof updatedAt === 'string'
                  ? new Date(updatedAt).getTime()
                  : typeof lastSeen === 'string'
                    ? new Date(lastSeen).getTime()
                    : null;

          if (lastUpdatedMs === null || Number.isNaN(lastUpdatedMs)) return;

          if ((Date.now() - lastUpdatedMs) / 1000 < FRESHNESS_WINDOW_SECONDS) {
            anyBusOnline = true;
          }
        });

        setBusOnline(anyBusOnline);
      },
      (err) => {
        console.error('buses snapshot error', err);
      },
    );

    return () => unsub();
  }, []);

  // 2) Create stop request
  const handleRequest = async () => {
    const user = auth.currentUser;

    if (!user) {
      showAlert('You must be logged in to request a stop.');
      return;
    }

    if (!LOCATIONS[selectedIndex]?.id) {
      showAlert('Select a stop first.');
      return;
    }

    if (!busOnline) {
      showAlert('No buses online right now.');
      return;
    }

    const studentUid = user.uid;
    const selectedStop = LOCATIONS[selectedIndex];

    try {
      // Student may only have ONE active request
      const existingSnap = await getDocs(
        query(
          collection(db, 'stopRequests'),
          where('studentUid', '==', studentUid),
          where('status', 'in', ['pending', 'accepted']),
          orderBy('createdAt', 'desc'),
          limit(1),
        ),
      );

      if (!existingSnap.empty) {
        showAlert('You already have a stop in progress.');
        navigation.goBack();
        return;
      }

      await addDoc(collection(db, 'stopRequests'), {
        studentUid,
        studentEmail: user.email ?? null,
        stopId: selectedStop.id,
        stop: {
          id: selectedStop.id,
          name: selectedStop.name,
          latitude: selectedStop.latitude,
          longitude: selectedStop.longitude,
        },
        status: 'pending',
        driverUid: null,
        acceptedAt: null,
        createdAt: serverTimestamp(),
        expiresAtMs: Date.now() + STUDENT_REQUEST_TTL_MS,
      });

      showAlert('Stop requested successfully!');
      navigation.goBack();
    } catch (err: any) {
      const code = err?.code ?? '';
      if (String(code).includes('failed-precondition')) {
        showAlert('Firestore index missing for this query. Check console for index link.', 'Index required');
      } else if (String(code).includes('permission-denied')) {
        showAlert('Permission denied. Firestore rules blocked the operation.', 'Permission denied');
      } else {
        showAlert(err?.message ?? 'Error requesting stop', 'Error requesting stop');
      }
    }
  };

  // 3) UI
  if (!busOnline) {
    return (
      <ScreenContainer>
        <View style={styles.centerContent}>
          <Text style={styles.warningTitle}>No buses online</Text>
          <Text style={styles.warningText}>Please try again once a driver is available.</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={styles.title}>Request a Stop</Text>
        <Text style={styles.description}>Choose your pickup location and we'll notify the driver instantly.</Text>
      </View>

      <InfoBanner
        icon="notifications-active"
        title="Keep your ride moving"
        description="You can only have one active pickup at a time."
        style={styles.helperBanner}
      />

      <View style={styles.card}>
        <Text style={styles.heading}>Pickup location</Text>

        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={selectedIndex}
            onValueChange={(value) => setSelectedIndex(value)}
            style={styles.picker}
            dropdownIconColor={PRIMARY_COLOR}
          >
            {LOCATIONS.map((loc, index) => (
              <Picker.Item key={loc.id} label={loc.name} value={index} />
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
  helperBanner: {
    marginBottom: spacing.section,
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
