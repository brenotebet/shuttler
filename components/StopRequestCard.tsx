import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Polygon } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { campusCoords, outerRing, grayscaleMapStyle } from '../src/constants/mapConfig';
import { PRIMARY_COLOR, CARD_BACKGROUND } from '../src/constants/theme';

type StopRequest = {
  id: string;
  studentEmail: string;
  driverId?: string;
  status: string;
  stop: { latitude: number; longitude: number; name?: string };
};

type Props = {
  item: StopRequest;
  driverId: string | null;
  updateStatus: (id: string, status: string) => void;
};

export default function StopRequestCard({ item, driverId, updateStatus }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Student: {item.studentEmail}</Text>
      <Text>Stop: {item.stop?.name || 'Unknown'}</Text>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.smallMap}
        initialRegion={{
          latitude: item.stop.latitude,
          longitude: item.stop.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        customMapStyle={grayscaleMapStyle}
      >
        <Polygon coordinates={outerRing} holes={[campusCoords]} fillColor="rgba(0,0,0,0.2)" strokeWidth={0} />
        <Polygon coordinates={campusCoords} strokeColor="black" strokeWidth={2} fillColor="transparent" />
        <Marker coordinate={item.stop} anchor={{ x: 0.5, y: 1 }}>
          <Icon name="flag" size={26} color={PRIMARY_COLOR} />
        </Marker>
      </MapView>

      {item.status === 'pending' && !item.driverId && (
        <TouchableOpacity style={styles.acceptButton} onPress={() => updateStatus(item.id, 'accepted')}>
          <Text style={styles.acceptButtonText}>Accept Stop</Text>
        </TouchableOpacity>
      )}

      {item.status === 'accepted' && item.driverId === driverId && (
        <TouchableOpacity style={styles.actionButton} onPress={() => updateStatus(item.id, 'completed')}>
          <Text style={styles.actionButtonText}>Stop Completed</Text>
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
    backgroundColor: CARD_BACKGROUND,
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
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 8,
    alignItems: 'center',
  },
  acceptButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  actionButton: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 8,
    alignItems: 'center',
  },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
});

