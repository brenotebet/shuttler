import React from 'react';
import { TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { Text } from './Text';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { borderRadius, cardShadow } from '../src/styles/common';

export type AppButtonProps = {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  color?: string; // override — falls back to org theme color
};

export default function AppButton({
  label,
  onPress,
  style,
  disabled = false,
  variant = 'primary',
  color: colorProp,
}: AppButtonProps) {
  const { primaryColor } = useOrgTheme();
  const color = colorProp ?? primaryColor;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.base,
        variant === 'primary'
          ? { backgroundColor: color }
          : { borderColor: color, borderWidth: 1, backgroundColor: 'transparent' },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, variant === 'secondary' && { color }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    ...cardShadow,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.6,
    shadowOpacity: 0.04,
  },
});
