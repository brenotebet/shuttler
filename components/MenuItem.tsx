// src/components/MenuItem.tsx

import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native'
import { Text } from './Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { CARD_BACKGROUND, TEXT_PRIMARY, TEXT_SECONDARY, DANGER_COLOR } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { useAccessibility } from '../src/contexts/AccessibilityContext';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

export type MenuItemProps = {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
  variant?: 'default' | 'danger';
  badge?: boolean;
};

function MenuItem({ icon, title, description, onPress, variant = 'default', badge = false }: MenuItemProps) {
  const { primaryColor } = useOrgTheme();
  const { fontScale } = useAccessibility();
  const isDanger = variant === 'danger';

  return (
    <TouchableOpacity style={styles.item} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.iconWrap}>
        <Icon
          name={icon}
          size={28}
          color={isDanger ? DANGER_COLOR : primaryColor}
        />
        {badge && <View style={styles.badgeDot} />}
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, isDanger && styles.dangerTitle, { fontSize: 16 * fontScale }]}>{title}</Text>
        <Text style={[styles.description, { fontSize: 14 * fontScale }]}>{description}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(MenuItem);

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.item,
    paddingHorizontal: spacing.section,
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  iconWrap: {
    marginRight: spacing.section,
    position: 'relative',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f59e0b',
    borderWidth: 2,
    borderColor: CARD_BACKGROUND,
  },
  textContainer: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY },
  dangerTitle: { color: DANGER_COLOR },
  description: { fontSize: 14, color: TEXT_SECONDARY, marginTop: 2 },
});
