import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR } from '../src/constants/theme';

type Props = {
  icon: string;
  label?: string;
};

export default function MapMarker({ icon, label }: Props) {
  return (
    <View style={styles.container}>
      <Icon name={icon} size={20} color="#fff" />
      {label && <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: PRIMARY_COLOR,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 12,
    alignItems: 'center',
  },
  label: {
    color: '#fff',
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '500',
  },
});
