// src/screens/RequestStopScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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
  doc,
  getDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import InfoBanner from '../components/InfoBanner';

// ===== DEBUG HELPERS =====
const RS_DEBUG = true;

function rsLog(tag: string, data?: any) {
  if (!RS_DEBUG) return;
  const ts = new Date().toISOString();
  if (data !== undefined) console.log(`[RequestStop][${ts}][${tag}]`, data);
  else console.log(`[RequestStop][${ts}][${tag}]`);
}

function rsErr(tag: string, err: any) {
  const ts = new Date().toISOString();
  console.error(`[RequestStop][${ts}][${tag}] ERROR`, {
    name: err?.name,
    code: err?.code,
    message: err?.message,
    stack: err?.stack,
    raw: err,
  });
}

function summarizeSnap(label: string, snap: any) {
  try {
    const size = snap?.size ?? snap?.docs?.length ?? 0;
    const ids = snap?.docs?.map((d: any) => d.id) ?? [];
    rsLog(`${label}:snapshot`, { size, ids });
  } catch (e) {
    rsErr(`${label}:summarizeSnap`, e);
  }
}


export const LOCATIONS = [
  { id: 'stop1', name: 'MPCC', latitude: 38.61071, longitude: -89.81481 },
  { id: 'stop2', name: 'PAC', latitude: 38.6079, longitude: -89.81561 },
  { id: 'stop3', name: 'Performance Center', latitude: 38.59875, longitude: -89.82447 },
  { id: 'stop4', name: 'Carnegie Hall', latitude: 38.60699, longitude: -89.81709 },
  { id: 'stop5', name: 'McKendree West Clubhouse', latitude: 38.60573, longitude: -89.82468 },
];

export default function RequestStopScreen({ navigation }: { navigation: any }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busOnline, setBusOnline] = useState(false);

  // Debug UI counters so even if console is flaky you can SEE taps.
  const [tapCount, setTapCount] = useState(0);
  const [lastBusDebug, setLastBusDebug] = useState<{
    docs: number;
    anyOnlineFlagTrue: boolean;
    anyFreshOnline: boolean;
    freshestSecondsAgo: number | null;
    lastUpdatedIso: string | null;
  }>({
    docs: 0,
    anyOnlineFlagTrue: false,
    anyFreshOnline: false,
    freshestSecondsAgo: null,
    lastUpdatedIso: null,
  });

  const mountOnceRef = useRef(false);

  useEffect(() => {
    if (mountOnceRef.current) return;
    mountOnceRef.current = true;
    rsLog('screen:mounted', { uid: auth.currentUser?.uid ?? null });
    return () => rsLog('screen:unmounted');
  }, []);

  // 1) Listen for active buses
  useEffect(() => {
    rsLog('buses:subscribe:start');

    const unsub = onSnapshot(
      collection(db, 'buses'),
        (snapshot) => {
    const docsCount = snapshot.size;

    let anyBusOnline = false;
    let anyOnlineFlagTrue = false;

    let freshestSecondsAgo: number | null = null;
    let freshestLastUpdatedMs: number | null = null;

    snapshot.forEach((docSnap) => {
      const data: any = docSnap.data();

      const onlineFlag = data?.online === true;
      if (onlineFlag) anyOnlineFlagTrue = true;

      // ✅ robust timestamp -> milliseconds
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

      const secondsAgo = (Date.now() - lastUpdatedMs) / 1000;

      if (freshestSecondsAgo === null || secondsAgo < freshestSecondsAgo) {
        freshestSecondsAgo = secondsAgo;
        freshestLastUpdatedMs = lastUpdatedMs;
      }

      if (onlineFlag && secondsAgo < 15) {
        anyBusOnline = true;
      }
    });

    const freshestLastUpdatedIso =
      freshestLastUpdatedMs !== null ? new Date(freshestLastUpdatedMs).toISOString() : null;

    setBusOnline(anyBusOnline);
    setLastBusDebug({
      docs: docsCount,
      anyOnlineFlagTrue,
      anyFreshOnline: anyBusOnline,
      freshestSecondsAgo,
      lastUpdatedIso: freshestLastUpdatedIso,
    });

    rsLog('buses:update', {
      docsCount,
      anyOnlineFlagTrue,
      anyBusOnline,
      freshestSecondsAgo,
      freshestLastUpdatedIso,
    });
  },

      (err) => {
        rsErr('buses:subscribe:error', err);
      },
    );

    return () => {
      rsLog('buses:subscribe:cleanup');
      unsub();
    };
  }, []);

  // 2) Create stop request (secure + reuse accepted)
  const handleRequest = async () => {
    const user = auth.currentUser;

    rsLog('tap:handleRequest', {
      uid: user?.uid ?? null,
      email: user?.email ?? null,
      selectedIndex,
      stop: LOCATIONS[selectedIndex],
      busOnline,
    });

    if (!user) {
      rsLog('guard:auth_missing');
      showAlert('You must be logged in to request a stop.');
      return;
    }

    if (!LOCATIONS[selectedIndex]?.id) {
      rsLog('guard:selectedStop_missing', { selectedIndex, stop: LOCATIONS[selectedIndex] });
      showAlert('Select a stop first.');
      return;
    }

    if (!busOnline) {
      rsLog('guard:busOffline_blocked');
      showAlert('No buses online right now.');
      return;
    }

    const studentUid = user.uid;
    const selectedStop = LOCATIONS[selectedIndex];

    // Optional: log /users/{uid} doc exists (rules depend on it for role checks elsewhere)
    try {
      const snap = await getDoc(doc(db, 'users', studentUid));
      rsLog('precheck:userDoc', { exists: snap.exists(), data: snap.exists() ? snap.data() : null });
    } catch (e) {
      rsErr('precheck:userDoc_failed', e);
    }

    try {
      // Student may only have ONE active request
      rsLog('phase1:checkActiveRequest:start');

      const q1 = query(
        collection(db, 'stopRequests'),
        where('studentUid', '==', studentUid),
        where('status', 'in', ['pending', 'accepted']),
        orderBy('createdAt', 'desc'),
        limit(1),
      );

      rsLog('phase1:checkActiveRequest:query', {
        studentUid,
        statusIn: ['pending', 'accepted'],
        orderBy: 'createdAt desc',
        limit: 1,
      });

      const existingSnap = await getDocs(q1);
      summarizeSnap('phase1:checkActiveRequest', existingSnap);

      if (!existingSnap.empty) {
        rsLog('phase1:existing_found', {
          id: existingSnap.docs[0].id,
          data: existingSnap.docs[0].data(),
        });
        showAlert('You already have a stop in progress.');
        navigation.goBack();
        return;
      }

      // Reuse accepted request for THIS stop (do not create a new one)
      rsLog('phase2:reuseAcceptedForStop:start', { stopId: selectedStop.id });

      const q2 = query(
        collection(db, 'stopRequests'),
        where('status', '==', 'accepted'),
        where('stopId', '==', selectedStop.id),
        orderBy('createdAt', 'desc'),
        limit(1),
      );

      rsLog('phase2:reuseAcceptedForStop:query', {
        statusEq: 'accepted',
        stopIdEq: selectedStop.id,
        orderBy: 'createdAt desc',
        limit: 1,
      });

      const acceptedForStopSnap = await getDocs(q2);
      summarizeSnap('phase2:reuseAcceptedForStop', acceptedForStopSnap);

      if (!acceptedForStopSnap.empty) {
        rsLog('phase2:accepted_exists_for_stop', {
          id: acceptedForStopSnap.docs[0].id,
          data: acceptedForStopSnap.docs[0].data(),
        });
        showAlert('A bus is already headed to this stop. We will show you the current ride.');
        navigation.goBack();
        return;
      }

      rsLog('phase3:createRequest:start');

      const payload = {
        studentUid,
        studentEmail: user.email ?? null, // display only
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
      };

      rsLog('phase3:createRequest:payload', payload);

      const ref = await addDoc(collection(db, 'stopRequests'), payload);

      rsLog('phase3:createRequest:success', { id: ref.id });
      showAlert('Stop requested successfully!');
      navigation.goBack();
    } catch (err: any) {
      rsErr('handleRequest:catch', err);

      const code = err?.code ?? '';
      if (String(code).includes('failed-precondition')) {
        showAlert('Firestore index missing for this query. Check console for index link.', 'Index required');
      } else if (String(code).includes('permission-denied')) {
        showAlert('Permission denied. Firestore rules blocked the operation.', 'Permission denied');
      } else {
        showAlert(err?.message ?? 'Error requesting stop', 'Error requesting stop');
      }
    } finally {
      rsLog('tap:handleRequest:done');
    }
  };

  // 3) UI
  if (!busOnline) {
    return (
      <ScreenContainer>
        <View style={styles.centerContent}>
          <Text style={styles.warningTitle}>No buses online</Text>
          <Text style={styles.warningText}>Please try again once a driver is available.</Text>

          <View style={{ height: 16 }} />

          <Text style={{ fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
            Debug buses: docs={lastBusDebug.docs} | onlineFlagTrue={String(lastBusDebug.anyOnlineFlagTrue)} | freshOnline=
            {String(lastBusDebug.anyFreshOnline)} | freshestSecondsAgo=
            {lastBusDebug.freshestSecondsAgo === null ? 'null' : Math.round(lastBusDebug.freshestSecondsAgo)} | last=
            {lastBusDebug.lastUpdatedIso ?? 'null'}
          </Text>

          <View style={{ height: 16 }} />

          {/* Tap-proof debug button */}
          <TouchableOpacity
            onPress={() => {
              setTapCount((n) => n + 1);
              rsLog('debugTap:pressed', { tapCount: tapCount + 1 });
              showAlert(`Debug tap: ${tapCount + 1}`);
            }}
            style={{
              marginTop: 8,
              backgroundColor: PRIMARY_COLOR,
              paddingVertical: 12,
              paddingHorizontal: 18,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Debug Tap ({tapCount})</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={styles.title}>Request a Stop</Text>
        <Text style={styles.description}>Choose your pickup location and we’ll notify the driver instantly.</Text>
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

        {/* Tap-proof wrapper: guarantees logs even if AppButton were broken */}
        <View
          onStartShouldSetResponder={() => true}
          onResponderRelease={() => {
            setTapCount((n) => n + 1);
            rsLog('responderRelease:wrapper', { tapCount: tapCount + 1 });
            handleRequest();
          }}
          style={{ width: '100%' }}
        >
          <AppButton
            label={`Request Stop (tap ${tapCount})`}
            onPress={() => {
              setTapCount((n) => n + 1);
              rsLog('onPress:AppButton', { tapCount: tapCount + 1 });
              handleRequest();
            }}
          />
        </View>

        <Text style={{ marginTop: 10, color: '#6b7280', fontSize: 12 }}>
          Debug: taps={tapCount} | busOnline={String(busOnline)} | selected={LOCATIONS[selectedIndex]?.id}
        </Text>

        <Text style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
          Debug buses: docs={lastBusDebug.docs} | onlineFlagTrue={String(lastBusDebug.anyOnlineFlagTrue)} | freshestSecondsAgo=
          {lastBusDebug.freshestSecondsAgo === null ? 'null' : Math.round(lastBusDebug.freshestSecondsAgo)}
        </Text>
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
