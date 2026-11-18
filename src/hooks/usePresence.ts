// src/hooks/usePresence.ts
// Animate something in when it appears and out before it disappears.
// Conditionally rendered UI otherwise vanishes in one frame, because the
// state that shows it is cleared before any close animation can play.
//
//   const busCard = usePresence(selectedBusId);
//   {busCard.value && <Animated.View style={presenceStyle(busCard.anim)}>…}
//
// busCard.value is the live value, or the last one while the card animates
// out, so the card keeps its content until it's gone.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { MOTION } from '../constants/motion';
import { useAccessibility } from '../contexts/AccessibilityContext';
import { isPresent, presenceAction, presenceDisplayValue } from '../utils/presence';

type Options = {
  /** Replay the entrance when the value switches straight to another. */
  replayOnChange?: boolean;
  /** 'pop' springs in (cards); 'fade' eases in (lists, controls); 'sheet' is the bottom-sheet spring. */
  enter?: 'pop' | 'fade' | 'sheet';
};

export function usePresence<T>(value: T | null | undefined | false, options: Options = {}) {
  const { motionReduced } = useAccessibility();
  const initiallyShown = isPresent(value);
  const anim = useRef(new Animated.Value(initiallyShown ? 1 : 0)).current;
  const [mounted, setMounted] = useState(initiallyShown);
  const prevRef = useRef<T | null>(initiallyShown ? value : null);
  const lastRef = useRef<T | null>(prevRef.current);
  if (isPresent(value)) lastRef.current = value;

  useEffect(() => {
    const next = isPresent(value) ? value : null;
    const action = presenceAction(prevRef.current, next, options.replayOnChange);
    prevRef.current = next;
    if (action === 'none') return;
    anim.stopAnimation();

    if (action === 'exit') {
      if (motionReduced) {
        anim.setValue(0);
        setMounted(false);
        return;
      }
      Animated.timing(anim, {
        toValue: 0,
        duration: options.enter === 'sheet' ? MOTION.sheetExitMs : MOTION.exitMs,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        // Not finished = it came back mid-exit; stay mounted.
        if (finished) setMounted(false);
      });
      return;
    }

    setMounted(true);
    if (action === 'replay') anim.setValue(0);
    if (motionReduced) {
      anim.setValue(1);
      return;
    }
    (options.enter === 'fade'
      ? Animated.timing(anim, {
        toValue: 1,
        duration: MOTION.fadeInMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
      : Animated.spring(anim, {
        toValue: 1,
        ...(options.enter === 'sheet' ? MOTION.sheetSpring : MOTION.popIn),
        useNativeDriver: true,
      })
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, motionReduced]);

  return {
    value: presenceDisplayValue(value, lastRef.current, mounted),
    anim,
    /** True while animating out: make it ignore touches. */
    exiting: !isPresent(value) && mounted,
  };
}

/**
 * The standard look for a presence animation: fade, a slight rise, and an
 * optional slight scale. `rise` is negative to drop in from above.
 */
export function presenceStyle(anim: Animated.Value, { rise = 8, scale = 0.94 } = {}) {
  return {
    opacity: anim,
    transform: [
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) },
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [scale, 1] }) },
    ],
  };
}
