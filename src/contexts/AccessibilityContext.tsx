import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FONT_SCALE_KEY = 'shuttler_font_scale';
const REDUCE_MOTION_KEY = 'shuttler_reduce_motion';

export type FontScale = 1 | 1.2 | 1.4;

type AccessibilityContextType = {
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  /** The in-app "Reduce motion" setting (what its switch shows). */
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
  /** Whether to cut animations: the in-app setting or the phone's own. */
  motionReduced: boolean;
};

const AccessibilityContext = createContext<AccessibilityContextType>({
  fontScale: 1,
  setFontScale: () => {},
  reduceMotion: false,
  setReduceMotion: () => {},
  motionReduced: false,
});

export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fontScale, setFontScaleState] = useState<FontScale>(1);
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  // The phone's Reduce Motion setting (iOS Accessibility / Android
  // "Remove animations"), followed live.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) setSystemReduceMotion(on); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([FONT_SCALE_KEY, REDUCE_MOTION_KEY]).then(([[, scale], [, motion]]) => {
      if (scale) setFontScaleState(parseFloat(scale) as FontScale);
      if (motion) setReduceMotionState(motion === 'true');
    });
  }, []);

  const setFontScale = useCallback((scale: FontScale) => {
    setFontScaleState(scale);
    AsyncStorage.setItem(FONT_SCALE_KEY, String(scale));
  }, []);

  const setReduceMotion = useCallback((value: boolean) => {
    setReduceMotionState(value);
    AsyncStorage.setItem(REDUCE_MOTION_KEY, value ? 'true' : 'false');
  }, []);

  // Every <Text> in the app consumes this context — a fresh object each render
  // would re-render all of them even when nothing changed.
  const motionReduced = reduceMotion || systemReduceMotion;
  const value = useMemo(
    () => ({ fontScale, setFontScale, reduceMotion, setReduceMotion, motionReduced }),
    [fontScale, setFontScale, reduceMotion, setReduceMotion, motionReduced],
  );

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  );
};

export const useAccessibility = () => useContext(AccessibilityContext);
