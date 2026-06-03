import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { useAccessibility } from '../src/contexts/AccessibilityContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  sheetStyle?: ViewStyle;
};

export default function BottomSheet({ visible, onClose, children, sheetStyle }: Props) {
  const [modalVisible, setModalVisible] = useState(visible);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(500)).current;
  const { reduceMotion } = useAccessibility();

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      if (reduceMotion) {
        overlayOpacity.setValue(1);
        sheetY.setValue(0);
      } else {
        Animated.parallel([
          Animated.timing(overlayOpacity, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
          Animated.spring(sheetY, {
            toValue: 0,
            damping: 28,
            stiffness: 280,
            mass: 0.8,
            useNativeDriver: true,
          }),
        ]).start();
      }
    } else {
      if (reduceMotion) {
        overlayOpacity.setValue(0);
        sheetY.setValue(500);
        setModalVisible(false);
      } else {
        Animated.parallel([
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(sheetY, {
            toValue: 500,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => setModalVisible(false));
      }
    }
  }, [visible, reduceMotion]);

  return (
    <Modal
      visible={modalVisible}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop fades independently */}
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <TouchableOpacity style={styles.flex} activeOpacity={1} onPress={onClose} />
      </Animated.View>

      {/* Sheet slides up independently */}
      <Animated.View
        style={[styles.sheetAnchor, { transform: [{ translateY: sheetY }] }]}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.sheet, sheetStyle]}>
          {children}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  flex: { flex: 1 },
  sheetAnchor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
});
