import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR, CARD_BACKGROUND } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

export type InfoBannerProps = {
  icon?: string;
  title: string;
  description?: string;
  style?: StyleProp<ViewStyle>;
};

export default function InfoBanner({
  icon = 'info-outline',
  title,
  description,
  style,
}: InfoBannerProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconWrapper}>
        <Icon name={icon} size={22} color={PRIMARY_COLOR} />
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
    backgroundColor: '#ede9f3',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.item,
  },
  textWrapper: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: PRIMARY_COLOR,
  },
  description: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
  },
});
