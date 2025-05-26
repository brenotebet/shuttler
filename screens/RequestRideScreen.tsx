import React, { useState } from 'react';
import { View, Text, Button, Alert } from 'react-native';
import * as Location from 'expo-location';
import { Picker } from '@react-native-picker/picker';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';

const DESTINATIONS = [
  { name: 'MPCC', latitude: 38.61071, longitude: -89.81481 },
  { name: 'PAC', latitude: 38.6079, longitude: -89.81561 },
  { name: 'Performance Center', latitude: 38.59875, longitude: -89.82447 },
];

export default function RequestRideScreen() {
  const [selected, setSelected] = useState<string | null>(null);

  const handleRequest = async () => {
    if (!selected) {
      Alert.alert('Please select a drop-off location.');
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location permission denied');
      return;
    }

    const pickup = await Location.getCurrentPositionAsync({});
    const dropoff = DESTINATIONS.find((d) => d.name === selected);

    try {
      await addDoc(collection(db, 'rideRequests'), {
        studentEmail: auth.currentUser?.email,
        pickup: {
          latitude: pickup.coords.latitude,
          longitude: pickup.coords.longitude,
        },
        dropoff,
        status: 'pending',
        timestamp: serverTimestamp(),
      });
      Alert.alert('Ride requested!');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text>Choose a drop-off location:</Text>
      <Picker
        selectedValue={selected}
        onValueChange={(itemValue: React.SetStateAction<string | null>) => setSelected(itemValue)}
        style={{ marginVertical: 10 }}
      >
        <Picker.Item label="Select a destination..." value={null} />
        {DESTINATIONS.map((d) => (
          <Picker.Item key={d.name} label={d.name} value={d.name} />
        ))}
      </Picker>
      <Button title="Request Ride" onPress={handleRequest} />
    </View>
  );
}