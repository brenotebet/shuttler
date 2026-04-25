import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR } from '../src/constants/theme';

type Props = {
  icon?: string;
  label?: string;
  color?: string;
};

function MapMarker({ icon, label, color = PRIMARY_COLOR }: Props) {
  return (
    <View style={styles.wrapper}>
      {label ? (
        <View style={styles.labelChip}>
          <Text style={styles.labelText} numberOfLines={1}>{label}</Text>
        </View>
      ) : null}

      <View style={[styles.circle, { backgroundColor: color }]}>
        {icon ? (
          <Icon name={icon} size={12} color="#fff" />
        ) : (
          <View style={styles.dot} />
        )}
      </View>

      <View style={[styles.stem, { borderTopColor: color }]} />
    </View>
  );
}

export default React.memo(MapMarker);

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  labelChip: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 3,
    maxWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  labelText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#111',
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  stem: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
