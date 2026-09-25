import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle, TouchableOpacity, ActivityIndicator } from 'react-native'
import { Text } from './Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { CARD_BACKGROUND, TEXT_PRIMARY, TEXT_SECONDARY, GRAY_700, BORDER_COLOR, DANGER_COLOR } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

// 'tip' is the original shadowed card (a prominent standalone tip/pointer).
// The other variants are a flatter, more compact status strip meant to sit in
// a stack of banners at the top of a screen — colors below are the values
// already in use across the app's status banners, kept as-is rather than
// redesigned so this is a consolidation, not a restyle.
export type InfoBannerVariant = 'tip' | 'neutral' | 'warning' | 'purple' | 'error';

const VARIANT_COLORS: Record<Exclude<InfoBannerVariant, 'tip'>, { bg: string; border: string; text: string }> = {
  neutral: { bg: '#f8fafc', border: BORDER_COLOR, text: GRAY_700 },
  warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
  purple: { bg: '#f5f3ff', border: '#c4b5fd', text: '#7c3aed' },
  error: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
};

export type InfoBannerProps = {
  icon?: string;
  title: string;
  description?: string;
  variant?: InfoBannerVariant;
  /** Flat variants only: shows a spinner instead of the icon. */
  loading?: boolean;
  /** Flat variants only: makes the whole banner tappable. */
  onPress?: () => void;
  /** Flat variants only: a small link rendered under the title. */
  action?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
};

export default function InfoBanner({
  icon = 'info-outline',
  title,
  description,
  variant = 'tip',
  loading = false,
  onPress,
  action,
  style,
}: InfoBannerProps) {
  const { primaryColor } = useOrgTheme();

  if (variant !== 'tip') {
    const colors = VARIANT_COLORS[variant];
    const Container = onPress ? TouchableOpacity : View;
    return (
      <Container
        style={[styles.flatContainer, { backgroundColor: colors.bg, borderColor: colors.border }, style]}
        {...(onPress ? { onPress, activeOpacity: 0.8 } : {})}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Icon name={icon} size={16} color={colors.text} />
        )}
        <View style={styles.flatTextWrapper}>
          <Text style={[styles.flatTitle, { color: colors.text }]}>{title}</Text>
          {action ? (
            <TouchableOpacity onPress={action.onPress} style={styles.flatActionLink}>
              <Text style={styles.flatActionLinkText}>{action.label}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Container>
    );
  }

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
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.item,
  },
  textWrapper: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  description: { fontSize: 14, color: TEXT_SECONDARY, lineHeight: 20 },
  flatContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: 14,
  },
  flatTextWrapper: { flex: 1 },
  flatTitle: { fontSize: 13, fontWeight: '500' },
  flatActionLink: { marginTop: 4 },
  flatActionLinkText: { fontSize: 13, color: DANGER_COLOR, fontWeight: '700' },
});
