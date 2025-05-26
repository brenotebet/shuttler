import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Button, Alert, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { db } from '../firebase/firebaseconfig';
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  query,
  where
} from 'firebase/firestore';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AdminDriver'>;
};

interface RideRequest {
  id: string;
  status: 'pending' | 'accepted' | 'in-transit' | 'completed';
  studentEmail: string;
  pickup: { latitude: number; longitude: number };
  dropoff: { latitude: number; longitude: number; name: string };
}

export default function AdminDriverScreen({ navigation }: Props) {
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [activeRideId, setActiveRideId] = useState<string | null>(null);

  useEffect(() => {
  const q = query(collection(db, 'rideRequests'), where('status', 'in', ['pending', 'accepted', 'in-transit']));
  const unsub = onSnapshot(q, (snapshot) => {
    const safeData: RideRequest[] = [];

    snapshot.forEach((docSnap) => {
      const d = docSnap.data();

      if (
        d.status &&
        d.studentEmail &&
        d.pickup?.latitude &&
        d.dropoff?.latitude &&
        d.dropoff?.name
      ) {
        safeData.push({
          id: docSnap.id,
          status: d.status,
          studentEmail: d.studentEmail,
          pickup: d.pickup,
          dropoff: d.dropoff,
        });
      }
    });

    setRequests(safeData);

    const active = safeData.find((r) => r.status === 'accepted' || r.status === 'in-transit');
    setActiveRideId(active ? active.id : null);
  });

  return () => unsub();
}, []);

  const updateStatus = async (id: string, newStatus: RideRequest['status']) => {
    try {
      await updateDoc(doc(db, 'rideRequests', id), { status: newStatus });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const renderItem = ({ item }: { item: RideRequest }) => (
    <View style={styles.card}>
      <Text style={styles.title}>From: {item.studentEmail}</Text>
      <Text>To: {item.dropoff?.name || 'Unknown'}</Text>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: item.pickup.latitude,
          longitude: item.pickup.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
      >
        <Marker coordinate={item.pickup} title="Pickup" pinColor="green" />
        <Marker coordinate={item.dropoff} title="Drop-off" pinColor="red" />
        <Polyline
          coordinates={[item.pickup, item.dropoff]}
          strokeWidth={3}
          strokeColor="purple"
        />
      </MapView>

      {item.status === 'pending' && !activeRideId && (
        <Button title="Accept Ride" onPress={() => updateStatus(item.id, 'accepted')} />
      )}

      {item.status === 'accepted' && (
        <Button title="Passenger Picked Up" onPress={() => updateStatus(item.id, 'in-transit')} />
      )}

      {item.status === 'in-transit' && (
        <Button title="Passenger Dropped Off" onPress={() => updateStatus(item.id, 'completed')} />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Ride Requests</Text>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Text>No active requests</Text>}
      />
      <Button title="Go to Driver Location Screen" onPress={() => navigation.navigate('DriverScreen')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 10 },
  header: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  card: {
    marginBottom: 20,
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#f9f9f9',
  },
  title: { fontWeight: 'bold', marginBottom: 5 },
  map: {
    height: 150,
    width: '100%',
    marginVertical: 10,
  },
});
