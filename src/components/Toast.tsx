import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native'
import { Text } from '../../components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';

export type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

let _show: ((message: string, type: ToastType, durationMs: number) => void) | null = null;
let _nextId = 0;

export function showToast(message: string, type: ToastType = 'info', durationMs = 3500) {
  _show?.(message, type, durationMs);
}

// ---- Single animated toast pill ----

function ToastPill({ toast, onGone }: { toast: ToastMessage; onGone: (id: number) => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(opacity, { toValue: 1, useNativeDriver: true, overshootClamping: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, overshootClamping: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -8, duration: 220, useNativeDriver: true }),
      ]).start(() => onGone(toast.id));
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const icon =
    toast.type === 'success' ? 'check-circle-outline' :
    toast.type === 'error'   ? 'error-outline' :
                               'info-outline';

  return (
    <Animated.View
      style={[
        styles.pill,
        toast.type === 'success' && styles.pillSuccess,
        toast.type === 'error'   && styles.pillError,
        { opacity, transform: [{ translateY }] },
      ]}
      pointerEvents="none"
    >
      <Icon name={icon} size={18} color="#fff" />
      <Text style={styles.pillText}>{toast.message}</Text>
    </Animated.View>
  );
}

// ---- Container — render once at the root ----

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    _show = (message, type, _durationMs) => {
      const id = ++_nextId;
      setToasts((prev) => [...prev, { id, message, type }]);
    };
    return () => { _show = null; };
  }, []);

  const remove = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <View
      style={[styles.container, { top: insets.top + 12 }]}
      pointerEvents="none"
    >
      {toasts.map((t) => (
        <ToastPill key={t.id} toast={t} onGone={remove} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1e293b',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 10,
  },
  pillSuccess: {
    backgroundColor: '#166534',
  },
  pillError: {
    backgroundColor: '#991b1b',
  },
  pillText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
