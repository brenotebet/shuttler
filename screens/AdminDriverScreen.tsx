// src/screens/AdminDriverScreen.tsx

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Polygon, MapStyleElement } from 'react-native-maps';
import { campusCoords, outerRing, grayscaleMapStyle } from '../src/constants/mapConfig';
import { db } from '../firebase/firebaseconfig';
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  query,
  where,
} from 'firebase/firestore';
import { useDriver } from '../drivercontext/DriverContext';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { GOOGLE_MAPS_API_KEY } from '../config';

const polyline = require('@mapbox/polyline');

// Grayscale map style (shared)

export default function AdminDriverScreen() {
  const navigation = useNavigation<{ navigate: (screen: string) => void }>();
  const { driverId } = useDriver();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!driverId) {
      setRequests([]);
      setLoading(false);
      return;
    }

    // Fetch all “pending” & “accepted” & “in-transit” rides
    const q = query(
      collection(db, 'rideRequests'),
      where('status', 'in', ['pending', 'accepted', 'in-transit'])
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const arr: any[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        arr.push({
          id: docSnap.id,
          ...(d as any),
        });
      });

      // Filter: show rides that belong to this driver OR are pending
      const myList = arr.filter(
        (r) =>
          r.driverId === driverId ||
          (r.status === 'pending' && !r.driverId)
      );
      setRequests(myList);
      setLoading(false);
    });

    return () => unsub();
  }, [driverId]);

  // Accept / Picked Up / Dropped Off logic
  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const updateData: any = { status: newStatus };
      if (newStatus === 'accepted' && driverId) {
        updateData.driverId = driverId;
      }
      await updateDoc(doc(db, 'rideRequests', id), updateData);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  // Render each request card
  const renderItem = ({ item }: { item: any }) => {
    // We'll fetch & draw the route polyline between pickup→dropoff for preview
    const [route, setRoute] = useState<Array<{ latitude: number; longitude: number }>>([]);

    useEffect(() => {
      let isActive = true;
      const loadRoute = async () => {
        const origin = `${item.pickup.latitude},${item.pickup.longitude}`;
        const destination = `${item.dropoff.latitude},${item.dropoff.longitude}`;
        try {
          const res = await fetch(
            `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${GOOGLE_MAPS_API_KEY}`
          );
          const json = await res.json();
          if (json.routes?.length && isActive) {
            const points = polyline.decode(json.routes[0].overview_polyline.points);
            const coords = points.map(([lat, lng]: [number, number]) => ({
              latitude: lat,
              longitude: lng,
            }));
            setRoute(coords);
          }
        } catch (e) {
          console.warn('AdminDriver: loadRoute error', e);
        }
      };
      loadRoute();
      return () => {
        isActive = false;
      };
    }, [item]);

    return (
      <View style={styles.card}>
        <Text style={styles.title}>Student: {item.studentEmail}</Text>
        <Text>Destination: {item.dropoff?.name || 'Unknown'}</Text>
        <MapView
          provider={PROVIDER_GOOGLE}
          style={styles.smallMap}
          initialRegion={{
            latitude: (item.pickup.latitude + item.dropoff.latitude) / 2,
            longitude: (item.pickup.longitude + item.dropoff.longitude) / 2,
            latitudeDelta: Math.abs(item.pickup.latitude - item.dropoff.latitude) + 0.005,
            longitudeDelta: Math.abs(item.pickup.longitude - item.dropoff.longitude) + 0.005,
          }}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          customMapStyle={grayscaleMapStyle}
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

          <Marker coordinate={item.pickup} title="Pickup" pinColor="green" />
          <Marker
            coordinate={{ latitude: item.dropoff.latitude, longitude: item.dropoff.longitude }}
            title="Drop-Off"
            pinColor="red"
          />

          {route.length > 0 && (
            <Polyline coordinates={route} strokeWidth={3} strokeColor="#4B2E83" />
          )}
        </MapView>

        {item.status === 'pending' && !item.driverId && (
          <TouchableOpacity
            style={styles.acceptButton}
            onPress={() => updateStatus(item.id, 'accepted')}
          >
            <Text style={styles.acceptButtonText}>Accept Ride</Text>
          </TouchableOpacity>
        )}

        {item.status === 'accepted' && item.driverId === driverId && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => updateStatus(item.id, 'in-transit')}
          >
            <Text style={styles.actionButtonText}>Passenger Picked Up</Text>
          </TouchableOpacity>
        )}

        {item.status === 'in-transit' && item.driverId === driverId && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => updateStatus(item.id, 'completed')}
          >
            <Text style={styles.actionButtonText}>Passenger Dropped Off</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#4B2E83" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Text style={styles.header}>Ride Requests</Text>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Text style={styles.noRequests}>No active requests</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    margin: 12,
    textAlign: 'center',
  },
  noRequests: {
    textAlign: 'center',
    color: '#555',
    marginTop: 20,
    fontSize: 16,
  },
  card: {
    marginHorizontal: 12,
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    elevation: 2,
  },
  title: { fontWeight: 'bold', marginBottom: 4 },
  smallMap: {
    height: 150,
    width: '100%',
    marginVertical: 8,
  },
  acceptButton: {
    backgroundColor: '#4B2E83',
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 8,
    alignItems: 'center',
  },
  acceptButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  actionButton: {
    backgroundColor: '#4B2E83',
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 8,
    alignItems: 'center',
  },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
});
