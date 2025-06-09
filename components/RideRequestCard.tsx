import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Polygon } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { campusCoords, outerRing, grayscaleMapStyle } from '../src/constants/mapConfig';
import { GOOGLE_MAPS_API_KEY } from '../config';

const polyline = require('@mapbox/polyline');

type RideRequest = {
  id: string;
  studentEmail: string;
  driverId?: string;
  status: string;
  pickup: { latitude: number; longitude: number };
  dropoff: { latitude: number; longitude: number; name?: string };
};

type Props = {
  item: RideRequest;
  driverId: string | null;
  updateStatus: (id: string, status: string) => void;
};

export default function RideRequestCard({ item, driverId, updateStatus }: Props) {
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
        <Polygon coordinates={outerRing} holes={[campusCoords]} fillColor="rgba(0,0,0,0.2)" strokeWidth={0} />
        <Polygon coordinates={campusCoords} strokeColor="black" strokeWidth={2} fillColor="transparent" />
        <Marker coordinate={item.pickup} anchor={{ x: 0.5, y: 1 }}>
          <Icon name="location-on" size={28} color="#4B2E83" />
        </Marker>
        <Marker
          coordinate={{ latitude: item.dropoff.latitude, longitude: item.dropoff.longitude }}
          anchor={{ x: 0.5, y: 1 }}
        >
          <Icon name="flag" size={26} color="#4B2E83" />
        </Marker>
        {route.length > 0 && <Polyline coordinates={route} strokeWidth={3} strokeColor="#4B2E83" />}
      </MapView>

      {item.status === 'pending' && !item.driverId && (
        <TouchableOpacity style={styles.acceptButton} onPress={() => updateStatus(item.id, 'accepted')}>
          <Text style={styles.acceptButtonText}>Accept Ride</Text>
        </TouchableOpacity>
      )}

      {item.status === 'accepted' && item.driverId === driverId && (
        <TouchableOpacity style={styles.actionButton} onPress={() => updateStatus(item.id, 'in-transit')}>
          <Text style={styles.actionButtonText}>Passenger Picked Up</Text>
        </TouchableOpacity>
      )}

      {item.status === 'in-transit' && item.driverId === driverId && (
        <TouchableOpacity style={styles.actionButton} onPress={() => updateStatus(item.id, 'completed')}>
          <Text style={styles.actionButtonText}>Passenger Dropped Off</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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

