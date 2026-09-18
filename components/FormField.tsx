import React from 'react';
import { View, TextInput, StyleSheet, TextInputProps, StyleProp, ViewStyle } from 'react-native'
import { Text } from './Text';
import { borderRadius, spacing } from '../src/styles/common';
import { WHITE, GRAY_300, GRAY_400, GRAY_800, GRAY_900 } from '../src/constants/theme';

export type FormFieldProps = TextInputProps & {
  label: string;
  containerStyle?: StyleProp<ViewStyle>;
};

export default function FormField({ label, style, containerStyle, ...inputProps }: FormFieldProps) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={GRAY_400}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.section,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: GRAY_800,
    marginBottom: 6,
  },
  input: {
    height: 50,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: GRAY_300,
    paddingHorizontal: 16,
    backgroundColor: WHITE,
    fontSize: 16,
    color: GRAY_900,
  },
});
