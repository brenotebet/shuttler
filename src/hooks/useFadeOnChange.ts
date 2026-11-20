// src/hooks/useFadeOnChange.ts
// Fade (and nudge up) content in whenever `key` changes, so text that
// updates in place — like a ride's status — eases in instead of cutting.
import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { MOTION } from '../constants/motion';
import { useAccessibility } from '../contexts/AccessibilityContext';

export function useFadeOnChange(key: string | number | null | undefined) {
  const { motionReduced } = useAccessibility();
  const anim = useRef(new Animated.Value(1)).current;
  const prevKeyRef = useRef(key);

  useEffect(() => {
    if (prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    anim.stopAnimation();
    if (motionReduced) {
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: MOTION.crossfadeMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [key, motionReduced, anim]);

  return {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
  };
}
