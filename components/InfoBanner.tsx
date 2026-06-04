import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { Text } from './Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { CARD_BACKGROUND, TEXT_PRIMARY, TEXT_SECONDARY } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

export type InfoBannerProps = {
  icon?: string;
  title: string;
  description?: string;
  style?: StyleProp<ViewStyle>;
};

export default function InfoBanner({ icon = 'info-outline', title, description, style }: InfoBannerProps) {
  const { primaryColor } = useOrgTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.iconWrapper, { backgroundColor: `${primaryColor}22` }]}>
        <Icon name={icon} size={22} color={primaryColor} />
      </View>
      <View style={styles.textWrapper}>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    padding: spacing.item,
    ...cardShadow,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.item,
  },
  textWrapper: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  description: { fontSize: 14, color: TEXT_SECONDARY, lineHeight: 20 },
});
