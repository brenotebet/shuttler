import React from 'react';
import { View, StyleSheet } from 'react-native'
import { Text } from './Text';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { grayscaleMapStyle } from '../src/constants/mapConfig';
import { CARD_BACKGROUND } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

type StopRequest = {
  id: string;
  studentUid?: string;
  studentEmail?: string;
  driverUid?: string;
  driverId?: string;
  status: string;
  stop?: { latitude: number; longitude: number; name?: string } | null;
  childName?: string | null;
  childGrade?: string | null;
};

type Props = {
  item: StopRequest;
  studentName?: string;
};

function StopRequestCard({ item, studentName }: Props) {
  const { primaryColor } = useOrgTheme();
  const riderLabel = item.childName ?? studentName ?? item.studentEmail ?? item.studentUid ?? 'Unknown';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{item.childName ? 'Child' : 'Student'}: {riderLabel}</Text>
      {item.childGrade ? <Text style={styles.detail}>{item.childGrade}</Text> : null}
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
            <Icon name="flag" size={26} color={primaryColor} />
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
  detail: { fontSize: 14, color: '#374151' },
  smallMap: { height: 150, width: '100%', marginVertical: 8 },
});
