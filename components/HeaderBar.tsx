import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { PRIMARY_COLOR, BACKGROUND_COLOR, TEXT_PRIMARY } from '../src/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';


export type HeaderBarProps = {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
};

function HeaderBar({ title, showBack = true, onBack }: HeaderBarProps) {
  const navigation = useNavigation();

  const handleBack = useCallback(() => {
    if (onBack) onBack();
    else (navigation as any).goBack();
  }, [onBack, navigation]);

  return (
    <View style={styles.container}>
      {showBack ? (
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={PRIMARY_COLOR} />
        </TouchableOpacity>
      ) : (
        <View style={styles.placeholder} />
      )}
      <Text style={styles.title}>{title}</Text>
      <View style={styles.placeholder} />
    </View>
  );
}

export default React.memo(HeaderBar);

const styles = StyleSheet.create({
  container: {
    backgroundColor: BACKGROUND_COLOR,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    padding: 4,
  },
  placeholder: {
    width: 24,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '600',
  },
});
