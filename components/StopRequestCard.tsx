import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Polygon } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { campusCoords, outerRing, grayscaleMapStyle } from '../src/constants/mapConfig';
import { PRIMARY_COLOR, CARD_BACKGROUND } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

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

function StopRequestCard({ item, driverId, updateStatus }: Props) {
  const handleAccept = useCallback(() => updateStatus(item.id, 'accepted'), [item.id, updateStatus]);
  const handleComplete = useCallback(() => updateStatus(item.id, 'completed'), [item.id, updateStatus]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Student: {item.studentEmail}</Text>
      <Text style={styles.detail}>Stop: {item.stop?.name || 'Unknown'}</Text>
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
        <TouchableOpacity style={styles.button} onPress={handleAccept} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Accept Stop</Text>
        </TouchableOpacity>
      )}

      {item.status === 'accepted' && item.driverId === driverId && (
        <TouchableOpacity style={styles.button} onPress={handleComplete} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Stop Completed</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default React.memo(StopRequestCard);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 0,
    marginBottom: spacing.section,
    padding: spacing.section,
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    ...cardShadow,
  },
  title: { fontWeight: 'bold', marginBottom: 4, color: '#111827' },
  detail: {
    fontSize: 14,
    color: '#374151',
  },
  smallMap: {
    height: 150,
    width: '100%',
    marginVertical: 8,
  },
  button: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    marginTop: spacing.item,
    alignItems: 'center',
    ...cardShadow,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

