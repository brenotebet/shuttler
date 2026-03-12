import React from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow } from '../src/styles/common';

export type AppButtonProps = {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

export default function AppButton({
  label,
  onPress,
  style,
  disabled = false,
  variant = 'primary',
}: AppButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          variant === 'secondary' && styles.secondaryText,
        ]}
      >
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
  primary: {
    backgroundColor: PRIMARY_COLOR,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: PRIMARY_COLOR,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryText: {
    color: PRIMARY_COLOR,
  },
  disabled: {
    opacity: 0.6,
    shadowOpacity: 0.04,
  },
});
