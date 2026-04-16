import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { grayscaleMapStyle } from '../src/constants/mapConfig';
import { PRIMARY_COLOR, CARD_BACKGROUND } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

type StopRequest = {
  id: string;
  studentUid?: string;
  studentEmail?: string;
  driverUid?: string;
  driverId?: string;
  status: string;
  stop?: { latitude: number; longitude: number; name?: string } | null;
};

type Props = {
  item: StopRequest;
  studentName?: string;
};

function StopRequestCard({ item, studentName }: Props) {
  const studentLabel = studentName ?? item.studentEmail ?? item.studentUid ?? 'Unknown student';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Student: {studentLabel}</Text>
      <Text style={styles.detail}>Stop: {item.stop?.name || 'Unknown'}</Text>
      {item.stop ? (
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
          <Marker coordinate={item.stop} anchor={{ x: 0.5, y: 1 }}>
            <Icon name="flag" size={26} color={PRIMARY_COLOR} />
          </Marker>
        </MapView>
      ) : null}

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
  title: { fontSize: 15, fontWeight: '600', marginBottom: 4, color: '#111827' },
  detail: {
    fontSize: 14,
    color: '#374151',
  },
  smallMap: {
    height: 150,
    width: '100%',
    marginVertical: 8,
  },
});
