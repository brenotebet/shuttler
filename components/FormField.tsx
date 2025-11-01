import React from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TextInputProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { borderRadius, spacing } from '../src/styles/common';

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
        placeholderTextColor="#9ca3af"
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
    color: '#2f2f2f',
    marginBottom: 6,
  },
  input: {
    height: 50,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    fontSize: 16,
    color: '#1f2933',
  },
});
