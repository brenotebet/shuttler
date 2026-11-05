// components/MenuSectionLabel.tsx
// Small uppercase heading that groups MenuItem tiles on the role menus
// (admin, driver, rider/parent), plus a spacer for the trailing
// Switch Organization / Logout pair.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { GRAY_400 } from '../src/constants/theme';
import { spacing } from '../src/styles/common';

export default function MenuSectionLabel({ label, first }: { label: string; first?: boolean }) {
  return (
    <View style={[styles.divider, first && styles.dividerFirst]} accessibilityRole="header">
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function MenuSectionSpacer() {
  return <View style={styles.spacer} />;
}

const styles = StyleSheet.create({
  divider: {
    marginTop: spacing.section,
    marginBottom: spacing.item / 2,
    paddingHorizontal: 4,
  },
  dividerFirst: {
    marginTop: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY_400,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  spacer: {
    height: spacing.section,
  },
});
