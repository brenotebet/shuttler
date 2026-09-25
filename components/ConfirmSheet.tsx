// components/ConfirmSheet.tsx
//
// Reusable confirm/cancel bottom sheet, styled to match PickupConfirmModal —
// the app's one other confirm-style sheet — so "are you sure?" moments read
// consistently instead of mixing native Alert.alert with custom sheets.
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native'
import { Text } from './Text';
import BottomSheet from './BottomSheet';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { WHITE, GRAY_200, GRAY_500, GRAY_900, DANGER_COLOR } from '../src/constants/theme';

export type ConfirmSheetProps = {
  visible: boolean;
  icon?: string;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  primaryColor: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmSheet({
  visible,
  icon = 'help-outline',
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  primaryColor,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const accentColor = destructive ? DANGER_COLOR : primaryColor;

  return (
    <BottomSheet visible={visible} onClose={onCancel} sheetStyle={styles.sheet}>
      <View style={styles.handle} />

      <View style={[styles.iconCircle, { backgroundColor: `${accentColor}18` }]}>
        <Icon name={icon} size={40} color={accentColor} />
      </View>

      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: accentColor }]}
        onPress={onConfirm}
      >
        <Text style={styles.primaryBtnText}>{confirmLabel}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel}>
        <Text style={styles.secondaryBtnText}>{cancelLabel}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    padding: 28,
    paddingBottom: 44,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: GRAY_200,
    borderRadius: 2,
    marginBottom: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: GRAY_900,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: GRAY_500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: WHITE,
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: GRAY_200,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: GRAY_500,
  },
});
