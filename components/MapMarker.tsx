import React from 'react';
import { View, StyleSheet } from 'react-native'
import { Text } from './Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useOrgTheme } from '../src/org/useOrgTheme';

type Props = {
  icon?: string;
  label?: string;
  color?: string;
};

function MapMarker({ icon, label, color: colorProp }: Props) {
  const { primaryColor } = useOrgTheme();
  const color = colorProp ?? primaryColor;
  return (
    <View style={styles.wrapper}>
      {label ? (
        <View style={styles.chip}>
          <View style={[styles.chipAccent, { backgroundColor: color }]} />
          <Text style={styles.chipText} numberOfLines={1}>{label}</Text>
        </View>
      ) : null}

      {icon ? (
        // Special marker (e.g. destination flag): solid fill with icon
        <View style={[styles.pinFilled, { backgroundColor: color }]}>
          <Icon name={icon} size={14} color="#fff" />
        </View>
      ) : (
        // Regular stop: white ring + colored center dot
        <View style={[styles.pin, { borderColor: color }]}>
          <View style={[styles.pinCore, { backgroundColor: color }]} />
        </View>
      )}

      <View style={[styles.stem, { backgroundColor: color }]} />
    </View>
  );
}

export default React.memo(MapMarker);

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 5,
    maxWidth: 140,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 4,
  },
  chipAccent: {
    width: 4,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#111',
    paddingHorizontal: 7,
    paddingVertical: 4,
    letterSpacing: 0.1,
  },
  pin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 5,
  },
  pinCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pinFilled: {
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
    elevation: 5,
  },
  stem: {
    width: 2,
    height: 8,
    borderRadius: 1,
  },
});
