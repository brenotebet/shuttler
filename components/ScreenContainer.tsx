import React from 'react';
import { SafeAreaView, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { BACKGROUND_COLOR } from '../src/constants/theme';
import { spacing } from '../src/styles/common';

export type ScreenContainerProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
};

export default function ScreenContainer({
  children,
  style,
  padded = true,
}: ScreenContainerProps) {
  return (
    <SafeAreaView
      style={[styles.safe, padded ? styles.padded : null, style]}
    >
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
  },
  padded: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.screenPadding,
    paddingBottom: spacing.section,
  },
});
