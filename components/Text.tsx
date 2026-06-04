/**
 * Drop-in replacement for React Native's Text.
 * Reads fontScale from AccessibilityContext and multiplies every fontSize
 * in the style prop (inline objects, StyleSheet refs, or arrays all work
 * because StyleSheet.flatten resolves them all to a plain object).
 */
import React from 'react';
import { Text as RNText, TextProps, StyleSheet } from 'react-native';
import { useAccessibility } from '../src/contexts/AccessibilityContext';

export function Text({ style, ...props }: TextProps) {
  const { fontScale } = useAccessibility();

  if (fontScale === 1) {
    return <RNText style={style} {...props} />;
  }

  const flat = StyleSheet.flatten(style) ?? {};
  const scaled =
    typeof flat.fontSize === 'number'
      ? { ...flat, fontSize: flat.fontSize * fontScale }
      : flat;

  return <RNText style={scaled} {...props} />;
}

export default Text;
