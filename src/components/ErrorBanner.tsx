import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

interface Props {
  message: string | null;
  onDismiss?: () => void;
  style?: object;
}

export default function ErrorBanner({ message, onDismiss, style }: Props) {
  if (!message) return null;
  return (
    <View style={[styles.banner, style]}>
      <Icon name="error-outline" size={18} color="#991b1b" style={styles.icon} />
      <Text style={styles.text}>{message}</Text>
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Icon name="close" size={18} color="#991b1b" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    fontSize: 14,
    color: '#991b1b',
    lineHeight: 20,
  },
});
