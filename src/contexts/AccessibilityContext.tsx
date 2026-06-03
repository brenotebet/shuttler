import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FONT_SCALE_KEY = 'shuttler_font_scale';
const REDUCE_MOTION_KEY = 'shuttler_reduce_motion';

export type FontScale = 1 | 1.2 | 1.4;

type AccessibilityContextType = {
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
};

const AccessibilityContext = createContext<AccessibilityContextType>({
  fontScale: 1,
  setFontScale: () => {},
  reduceMotion: false,
  setReduceMotion: () => {},
});

export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fontScale, setFontScaleState] = useState<FontScale>(1);
  const [reduceMotion, setReduceMotionState] = useState(false);

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

  return (
    <AccessibilityContext.Provider value={{ fontScale, setFontScale, reduceMotion, setReduceMotion }}>
      {children}
    </AccessibilityContext.Provider>
  );
};

export const useAccessibility = () => useContext(AccessibilityContext);
