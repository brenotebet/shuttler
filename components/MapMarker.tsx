import React from 'react';
import { View, StyleSheet } from 'react-native'
import { Text } from './Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { WHITE, BLACK, GRAY_900 } from '../src/constants/theme';
import { borderRadius } from '../src/styles/common';
import { MAX_STOP_DOTS } from '../src/utils/routeDisplay';

type Props = {
  icon?: string;
  label?: string;
  color?: string;
  /** Fade the name label out (kept in layout so the marker isn't re-laid-out). */
  labelHidden?: boolean;
  /** Route colors for a stop on several routes, shown as small dots above the pin. */
  dots?: string[];
};

function MapMarker({ icon, label, color: colorProp, labelHidden, dots }: Props) {
  const { primaryColor } = useOrgTheme();
  const color = colorProp ?? primaryColor;
  const shownDots = dots ? dots.slice(0, MAX_STOP_DOTS) : [];
  const extraDots = dots ? dots.length - shownDots.length : 0;
  return (
    <View style={styles.wrapper}>
      {label ? (
        <View style={[styles.chip, labelHidden && { opacity: 0 }]}>
          <View style={[styles.chipAccent, { backgroundColor: color }]} />
          <Text style={styles.chipText} numberOfLines={1}>{label}</Text>
        </View>
      ) : null}

      {shownDots.length > 0 ? (
        <View style={styles.dotRow}>
          {shownDots.map((c, i) => (
            <View key={`${c}-${i}`} style={[styles.dot, { backgroundColor: c }]} />
          ))}
          {extraDots > 0 ? <Text style={styles.dotMore}>+{extraDots}</Text> : null}
        </View>
      ) : null}

      {icon ? (
        // Special marker (e.g. destination flag): solid fill with icon
        <View style={[styles.pinFilled, { backgroundColor: color }]}>
          <Icon name={icon} size={14} color={WHITE} />
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
    backgroundColor: WHITE,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    marginBottom: 5,
    maxWidth: 140,
    shadowColor: BLACK,
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
    color: GRAY_900,
    paddingHorizontal: 7,
    paddingVertical: 4,
    letterSpacing: 0.1,
  },
  pin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    backgroundColor: WHITE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: BLACK,
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
    borderColor: WHITE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: WHITE,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginBottom: 3,
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 3,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotMore: {
    fontSize: 9,
    fontWeight: '700',
    color: GRAY_900,
  },
  stem: {
    width: 2,
    height: 8,
    borderRadius: 1,
  },
});
